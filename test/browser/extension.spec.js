import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = process.cwd();
const card = (id = 'TEST000001', title = 'Large over-ear headphones', price = '$169.00') => `<article data-component-type="s-search-result" data-asin="${id}"><h2>${title}</h2><span class="a-price"><span class="a-offscreen">${price}</span></span></article>`;

// ai: 'offline' | 'online'. In online mode analyze returns a canned Claude-shaped result.
async function inject(page) {
  await page.addScriptTag({ path: path.join(repo, 'src/model.runtime.js') });
  await page.addScriptTag({ path: path.join(repo, 'src/sites.js') });
  await page.addScriptTag({ path: path.join(repo, 'src/content.js') });
  await page.addStyleTag({ path: path.join(repo, 'src/styles.css') });
}

// Fake store pages for every supported site. `page.__html` is what the next navigation serves.
// Storage is one object shared across sites (like chrome.storage), held here in Node.
async function fixture(page, { html = card(), ai = 'offline', pageScript = '', url = 'https://www.amazon.com/s?k=headphones', expectCards = true } = {}) {
  page.__html = html; page.__script = pageScript;
  const store = page.__store || (page.__store = {});
  if (!page.__bound) {
    page.__bound = true;
    await page.route(/^https:\/\/www\.(amazon|ebay|walmart|target|bestbuy)\.com\//, route => route.fulfill({ contentType: 'text/html', body: `<html><body><main>${page.__html}</main><div id="unrelated"></div><script>${page.__script}</script></body></html>` }));
    await page.exposeBinding('__store', (_src, op, arg) => {
      if (op === 'set') Object.assign(store, JSON.parse(JSON.stringify(arg)));
      if (op === 'remove') for (const k of [].concat(arg)) delete store[k];
      return JSON.parse(JSON.stringify(store));
    });
  }
  await page.addInitScript(mode => {
    window.__aiCalls = [];
    window.chrome = { runtime: {
      sendMessage(message, callback) {
        setTimeout(() => {
          if (message.type === 'unshop:health') return callback(mode === 'online' ? { ok: true, keyConfigured: true, model: 'claude-opus-5-5', label: 'Claude' } : { ok: false, error: 'UnShop AI server is not running.' });
          if (message.type === 'unshop:analyze') {
            window.__aiCalls.push(message.payload);
            return callback({ ok: true, result: { preferences: { budget: 80, compact: true, mustHave: ['foldable'], avoid: ['over-ear'], notes: '' }, searchQuery: 'compact foldable headphones', summary: 'Got it — you want something light you can fold.', products: message.payload.products.map(p => ({ id: p.id, fit: /compact/i.test(p.title) ? 92 : 20, reason: /compact/i.test(p.title) ? 'Small and light' : 'Bulky over-ear' })) } });
          }
          callback({ ok: true });
        }, 10);
      }
    }, storage: { local: {
      get(key, callback) { window.__store('get').then(all => callback(all)); },
      remove(keys, callback) { window.__store('remove', keys).then(() => callback?.()); },
      set(value, callback) { window.__store('set', value).then(() => callback()); }
    } } };
  }, ai);
  await page.goto(url);
  await inject(page);
  if (expectCards) await expect(page.locator('.unshop-ui').first()).toBeAttached();
  return store;
}
// Navigate to another fake store page in the same test (shared storage).
async function visit(page, url, html = page.__html) {
  page.__html = html;
  await page.goto(url); await inject(page);
}

test('idle observer settles, unrelated changes do not scan, burst inserts are batched', async ({ page }) => {
  await fixture(page);
  await page.waitForTimeout(400);
  const initial = await page.evaluate(() => window.__unshop.scans);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__unshop.scans)).toBe(initial);
  await page.evaluate(() => { for (let i = 0; i < 500; i++) document.querySelector('#unrelated').textContent = String(i); });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__unshop.scans)).toBe(initial);
  await page.evaluate(html => { for (let i = 0; i < 100; i++) { const node = document.createElement('div'); node.innerHTML = html.replace('TEST000002', `NEW${i}`); document.querySelector('main').append(node); } }, card('TEST000002', 'Compact earbuds', '$49.00'));
  await expect(page.locator('.unshop-ui')).toHaveCount(101);
  expect(await page.evaluate(() => window.__unshop.scans)).toBeLessThanOrEqual(initial + 2);
  const after = await page.evaluate(() => window.__unshop.scans);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__unshop.scans)).toBe(after);
});

test('button works even when the page swallows clicks in the capture phase', async ({ page }) => {
  await fixture(page, { pageScript: `document.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); window.__swallowed = true; }, true); document.addEventListener('mousedown', e => { window.__pageMouseDown = (window.__pageMouseDown||0)+1; }, true);` });
  await page.locator('.unshop-reject').click();
  await expect(page.locator('dialog')).toBeVisible();
  expect(await page.evaluate(() => [window.__swallowed, window.__pageMouseDown])).toEqual([undefined, undefined]);
});

test('local mode: reject, restore, undo, reset and persistence', async ({ page }) => {
  await fixture(page);
  await expect(page.locator('#unshop-root .pill')).toContainText('Local rules');
  await page.locator('.unshop-reject').click();
  await page.locator('dialog label', { hasText: 'Too bulky / large' }).click();
  await page.getByLabel('Say more', { exact: false }).fill('Too heavy for commuting');
  await page.getByRole('button', { name: 'Hide & learn' }).click();
  await expect(page.locator('article')).toHaveClass(/unshop-dimmed/);
  await expect(page.locator('.unshop-badge')).toHaveText('You passed on: Large over-ear headphones');
  await expect(page.locator('article h2')).toBeHidden();
  const saved = page.__store['unshopQ:amazon:headphone'];
  expect(saved.rejected.TEST000001.title).toBe('Large over-ear headphones');
  expect(saved.events[0].note).toBe('Too heavy for commuting');
  expect(saved.compact).toBe(true); expect(saved.avoid).toContain('heavy');
  await expect(page.locator('#unshop-root .prefs')).toContainText('Compact');
  await page.getByRole('button', { name: '↶ Undo' }).click();
  await expect(page.locator('article')).not.toHaveClass(/unshop-dimmed/);
  await page.locator('.unshop-reject').click();
  await page.getByRole('button', { name: 'Hide & learn' }).click();
  await page.reload();
  await inject(page);
  await expect(page.locator('article')).toHaveClass(/unshop-dimmed/);
  await page.locator('.unshop-reject').click();
  await expect(page.locator('article')).not.toHaveClass(/unshop-dimmed/);
  await page.getByLabel('More of').fill('smaller headphones under $80');
  await page.getByLabel('Less of').fill('over-ear');
  await page.getByRole('button', { name: 'Refine' }).click();
  await expect(page.locator('#unshop-root .prefs')).toContainText('Under $80');
  await expect(page.locator('#unshop-root .prefs')).toContainText('− over-ear');
  await expect(page.locator('.unshop-badge')).toContainText('Over your $80 budget');
  await expect(page.locator('#unshop-root #search')).toHaveAttribute('href', /rh=p_36%3A-8000/);
  await page.getByRole('button', { name: 'Remove Under $80' }).click();
  await expect(page.locator('#unshop-root .prefs')).not.toContainText('Under $80');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('#unshop-root .prefs')).toContainText('Nothing yet');
});

test('Claude mode: rejection sends context and applies the structured result', async ({ page }) => {
  await fixture(page, { ai: 'online', html: card() + card('TEST000002', 'Compact foldable earbuds', '$49.00') });
  await expect(page.locator('#unshop-root .pill')).toContainText('Claude');
  await page.locator('.unshop-reject').first().click();
  await page.locator('dialog label', { hasText: 'Too bulky / large' }).click();
  await page.getByLabel('Say more', { exact: false }).fill('want something I can fold');
  await page.getByRole('button', { name: 'Hide & learn' }).click();
  await expect(page.locator('#unshop-root .bubble')).toContainText('something light you can fold');
  await expect(page.locator('#unshop-root .prefs')).toContainText('+ foldable');
  await expect(page.locator('article').nth(1).locator('.unshop-badge')).toContainText('% fit');
  await expect(page.locator('#unshop-root .ranked .why').first()).toContainText('Small and light');
  await expect(page.locator('#unshop-root #search')).toContainText('compact foldable headphones');
  const call = await page.evaluate(() => window.__aiCalls[0]);
  expect(call.rejection.note).toBe('want something I can fold');
  expect(call.products.map(p => p.id)).toEqual(['TEST000002']);
  await page.getByLabel('Less of').fill('nothing flashy');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__aiCalls.length)).toBe(2);
  expect(await page.evaluate(() => window.__aiCalls[1].less)).toBe('nothing flashy');
});

test('recycled cards, late title arrival, removal and reinjection are safe', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => { const card = document.querySelector('article'); card.dataset.asin = 'TEST000002'; card.querySelector('h2').textContent = 'Compact earbuds'; });
  await expect(page.locator('.unshop-reject')).toHaveAttribute('aria-label', /Compact earbuds/);
  await page.locator('.unshop-reject').click();
  await expect(page.locator('dialog .title')).toContainText('Compact earbuds');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.addScriptTag({ path: path.join(repo, 'src/content.js') });
  await expect(page.locator('#unshop-root')).toHaveCount(1);
  await page.evaluate(() => document.querySelector('article').innerHTML = '<h2></h2>');
  await expect(page.locator('.unshop-ui')).toHaveCount(0);
  await page.evaluate(() => document.querySelector('h2').textContent = '<img src=x onerror=alert(1)>');
  await expect(page.locator('.unshop-ui')).toHaveCount(1);
  await expect(page.locator('#unshop-root .ranked img')).toHaveCount(0);
  await page.evaluate(() => document.querySelector('article').remove());
  await expect(page.locator('#unshop-root .ranked')).toContainText('No supported product');
});

test('Hide poor fits removes low scorers reversibly; Claude only gets plausible products', async ({ page }) => {
  const many = Array.from({ length: 24 }, (_, i) => card(`P${String(i).padStart(2, '0')}`, i % 2 ? `Compact earbuds ${i}` : `Big over-ear headset ${i}`, i === 1 ? '$120.00' : '$40.00')).join('');
  await fixture(page, { ai: 'online', html: many });
  await expect(page.locator('#unshop-root .hc')).toHaveText('learn something first');
  await page.getByLabel('More of').fill('under $80');
  await page.getByRole('button', { name: 'Refine' }).click();
  await expect(page.locator('#unshop-root .bubble')).toContainText('fold');
  const sent = await page.evaluate(() => window.__aiCalls[0].products.map(p => p.id));
  expect(sent.length).toBe(20);
  // The mock returns budget 80 for the next call; P01 is $120 so must be excluded once a budget exists.
  await page.getByLabel('More of').fill('quieter');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__aiCalls.length)).toBe(2);
  expect(await page.evaluate(() => window.__aiCalls[1].products.map(p => p.id))).not.toContain('P01');
  await expect(page.locator('#unshop-root .hc')).toContainText('below 30%');
  const visible = await page.locator('article:visible').count();
  await page.locator('#unshop-root .hp').click();
  await expect(page.locator('#unshop-root .hc')).toContainText('hidden');
  expect(await page.locator('article:visible').count()).toBeLessThan(visible);
  await expect(page.locator('article[data-asin="P03"]')).toBeVisible();
  await page.reload();
  await inject(page);
  await expect(page.locator('#unshop-root #hidePoor')).toBeChecked();
  await page.locator('#unshop-root .hp').click();
  await expect(page.locator('article:visible')).toHaveCount(24);
});

test('preferences are saved per search; a new search starts blank; refined link carries them over', async ({ page }) => {
  await fixture(page);
  await expect(page.locator('#unshop-root .scope')).toHaveText('Preferences for “headphones” on Amazon');
  await page.getByLabel('More of').fill('under $60, no over-ear, with noise cancelling');
  await page.getByRole('button', { name: 'Refine' }).click();
  await expect(page.locator('#unshop-root .prefs')).toContainText('Under $60');
  // A different Amazon search: no preferences.
  await page.goto('https://www.amazon.com/s?k=bluetooth+speaker'); await inject(page);
  await expect(page.locator('#unshop-root .scope')).toHaveText('Preferences for “bluetooth speaker” on Amazon');
  await expect(page.locator('#unshop-root .prefs')).toContainText('Nothing yet');
  await expect(page.locator('.unshop-badge')).toBeHidden();
  // Same search again (page 2, different case): preferences return.
  await page.goto('https://www.amazon.com/s?k=Headphones&page=2'); await inject(page);
  await expect(page.locator('#unshop-root .prefs')).toContainText('Under $60');
  // Following UnShop's refined search link hands them to the new query.
  const href = await page.locator('#unshop-root #search').getAttribute('href');
  await page.locator('#unshop-root #search').evaluate(a => a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) || true);
  await expect.poll(() => page.__store.unshopHandoff?.query).toBe('Headphones');
  await page.goto(href); await inject(page);
  await expect(page.locator('#unshop-root .prefs')).toContainText('Under $60');
  await expect(page.locator('#unshop-root .bubble')).toContainText('Carried over');
  // The handoff is single-use: another unrelated search is still blank.
  await page.goto('https://www.amazon.com/s?k=desk+lamp'); await inject(page);
  await expect(page.locator('#unshop-root .prefs')).toContainText('Nothing yet');
});

test('More/Less boxes understand casual sentences without Claude', async ({ page }) => {
  await fixture(page, { url: 'https://www.amazon.com/s?k=cameras', html: card('C1', 'Compact Digital Camera 4K', '$90.00') + card('C2', 'Large Film Camera with Strap', '$300.00') + card('C3', 'Mini Digital Camera for Kids', '$40.00') });
  await page.getByLabel('More of').fill('I want cameras that are more small and digital and cheap');
  await page.getByLabel('Less of').fill('bulky, nothing over $200');
  await page.keyboard.press('Enter');
  await expect(page.locator('#unshop-root .status')).toContainText('Got it: compact, + digital, cheaper, under $200, − bulky.');
  const prefs = page.locator('#unshop-root .prefs');
  for (const chip of ['Under $200', 'Compact', 'Cheaper', '+ digital', '− bulky']) await expect(prefs).toContainText(chip);
  await expect(prefs).not.toContainText('cameras');
  await expect(page.getByLabel('More of')).toHaveValue('');
  await expect(page.locator('#unshop-root .ranked .t').first()).toHaveText('Mini Digital Camera for Kids');
  await page.locator('#unshop-root .chip', { hasText: '− Flashy' }).click();
  await expect(page.getByLabel('Less of')).toHaveValue('flashy');
});

// Markup copied (trimmed) from each store's live search page, Nov 2026.
const STORES = {
  ebay: { url: 'https://www.ebay.com/sch/i.html?_nkw=wireless+headphones', label: 'eBay', link: /ebay\.com\/sch\/i\.html\?_nkw=.*&_udhi=50/, html: `<ul>
    <li class="s-card" data-listingid="2500219655424533"><div class="s-card__title"><span>Shop on eBay</span></div><span class="s-card__price">$20.00</span></li>
    <li class="s-card" data-listingid="395390195043"><div class="su-media-container"><img src="https://i.ebayimg.com/a.webp"></div><div class="s-card__title"><span class="su-styled-text">Jabra Elite 65t True Wireless Earbud Headphones</span><span class="clipped">Opens in a new window or tab</span></div><span class="s-card__price">$19.99</span> to <span class="s-card__price">$24.99</span></li>
    <li class="s-card" data-listingid="395388332344"><div class="s-card__title"><span class="su-styled-text">Big Studio Over-Ear Headphones</span></div><span class="s-card__price">$1,249.00</span></li></ul>`,
    expect: { count: 2, titles: ['Jabra Elite 65t True Wireless Earbud Headphones', 'Big Studio Over-Ear Headphones'], prices: ['$19.99', '$1249.00'] } },
  walmart: { url: 'https://www.walmart.com/search?q=wireless+headphones', label: 'Walmart', link: /walmart\.com\/search\?q=.*&max_price=50/, html: `
    <div data-item-id="5530776824"><img data-testid="productTileImage" src="https://i5.walmartimages.com/a.jpg"><span data-automation-id="product-title">Skullcandy Crusher XT Wireless Foldable over-Ear Headphones</span><div data-automation-id="product-price"><div aria-hidden="true"><span>Now</span><span>$</span><span>79</span><span>00</span></div><span>current price Now $79.00, Was $100.00</span></div></div>
    <div data-item-id="1006012037"><h3 data-automation-id="product-title">onn. Wireless Earbuds</h3><div><span class="ld_Ec">Price Now $14.88 Was $20.00 Options from $14.88 – $19.58</span><span>$</span><span>14</span></div></div>`,
    expect: { count: 2, titles: ['Skullcandy Crusher XT Wireless Foldable over-Ear Headphones', 'onn. Wireless Earbuds'], prices: ['$79.00', '$14.88'] } },
  target: { url: 'https://www.target.com/s?searchTerm=wireless+headphones', label: 'Target', link: /target\.com\/s\?searchTerm=/, html: `
    <div data-test="ListingPageProductListing" data-focusid="91938794_product_card"><a data-test="product-listing-gallery-desktop-image-link" aria-label="Shokz OpenRun Bluetooth Wireless Headphones Sponsored" href="/p/x/-/A-92750139"><img src="https://target.scene7.com/a"></a><div data-test="text-quill"><span data-test="text-quill-insert-0">$129.99</span></div></div>
    <div data-test="ListingPageProductListing" data-focusid="94779264_product_card"><a data-test="product-listing-gallery-desktop-image-link" aria-label="JLab Go Pods ANC True Wireless Earbuds" href="/p/y/-/A-94779264"></a><div><span>$24.99 - $26.99</span></div></div>`,
    expect: { count: 2, titles: ['Shokz OpenRun Bluetooth Wireless Headphones', 'JLab Go Pods ANC True Wireless Earbuds'], prices: ['$129.99', '$24.99'] } },
  bestbuy: { url: 'https://www.bestbuy.com/site/searchpage.jsp?st=wireless+headphones', label: 'Best Buy', link: /bestbuy\.com\/site\/searchpage\.jsp\?st=/, html: `<ul>
    <li class="product-list-item grid-view" data-product-id="6505727"><a class="product-list-item-link" href="/site/a">Sony - WH-1000XM5 Wireless Noise Cancelling Over-the-Ear Headphones - Black</a></li>
    <li class="product-list-item grid-view" data-product-id="13051189"></li></ul>`,
    expect: { count: 1, titles: ['Sony - WH-1000XM5 Wireless Noise Cancelling Over-the-Ear Headphones - Black'], prices: ['Price n/a'] } }
};
for (const [id, store] of Object.entries(STORES)) {
  test(`${store.label}: reads real-style cards, prices, and builds its own search link`, async ({ page }) => {
    await fixture(page, { url: store.url, html: store.html });
    await expect(page.locator('.unshop-ui')).toHaveCount(store.expect.count);
    for (const t of store.expect.titles) await expect(page.locator(`.unshop-reject[aria-label="Not for me: ${t}"]`)).toHaveCount(1);
    await expect(page.locator('#unshop-root .scope')).toHaveText(`Preferences for “wireless headphones” on ${store.label}`);
    const prices = await page.locator('#unshop-root .ranked .price').allTextContents();
    expect(prices.sort()).toEqual([...store.expect.prices].sort());
    await page.getByLabel('More of').fill('under $50');
    await page.keyboard.press('Enter');
    await expect(page.locator('#unshop-root #search')).toHaveAttribute('href', store.link);
    await expect(page.locator('#unshop-root #search')).toContainText(`${store.label} ↗`);
    await page.locator('.unshop-reject').first().click();
    await page.getByRole('button', { name: 'Hide & learn' }).click();
    await expect(page.locator('.unshop-dimmed')).toHaveCount(1);
    expect(page.__store[`unshopQ:${id}:headphone wireless`].site).toBe(id);
  });
}

test('similar searches: offered across stores, never forced; unrelated searches stay blank', async ({ page }) => {
  await fixture(page, { url: 'https://www.amazon.com/s?k=wireless+headphones' });
  await expect(page.locator('#unshop-root .suggest')).toBeHidden();
  await page.getByLabel('More of').fill('under $60, noise cancelling');
  await page.keyboard.press('Enter');
  await expect(page.locator('#unshop-root .prefs')).toContainText('Under $60');
  // Same product noun on another store → offered, not applied.
  await visit(page, STORES.ebay.url.replace('wireless', 'bluetooth'), STORES.ebay.html);
  await expect(page.locator('#unshop-root .suggest')).toContainText('“wireless headphones” on Amazon');
  await expect(page.locator('#unshop-root .prefs')).toContainText('Nothing yet');
  await page.getByRole('button', { name: 'Use them' }).click();
  await expect(page.locator('#unshop-root .prefs')).toContainText('Under $60');
  await expect(page.locator('#unshop-root .prefs')).toContainText('+ noise cancelling');
  await expect(page.locator('#unshop-root .bubble')).toContainText('Using what you told me for “wireless headphones”');
  await expect(page.locator('#unshop-root .suggest')).toBeHidden();
  // Different product that shares a word → not offered.
  await visit(page, 'https://www.ebay.com/sch/i.html?_nkw=headphone+case', STORES.ebay.html);
  await expect(page.locator('#unshop-root .scope')).toContainText('headphone case');
  await expect(page.locator('#unshop-root .suggest')).toBeHidden();
  // Same search, different word order and plural → it's the same search: loads directly, no prompt.
  await visit(page, 'https://www.amazon.com/s?k=Headphone+Wireless', card());
  await expect(page.locator('#unshop-root .prefs')).toContainText('Under $60');
  await expect(page.locator('#unshop-root .suggest')).toBeHidden();
  // "Start fresh" is remembered for that search.
  await visit(page, STORES.walmart.url.replace('wireless+', ''), STORES.walmart.html);
  await expect(page.locator('#unshop-root .suggest')).toBeVisible();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await expect(page.locator('#unshop-root .suggest')).toBeHidden();
  await visit(page, STORES.walmart.url.replace('wireless+', ''), STORES.walmart.html);
  await expect(page.locator('#unshop-root .scope')).toContainText('“headphones” on Walmart');
  await expect(page.locator('#unshop-root .suggest')).toBeHidden();
  await expect(page.locator('#unshop-root .prefs')).toContainText('Nothing yet');
});

test('single-page stores: switching search in place swaps preferences; leaving search hides UnShop', async ({ page }) => {
  await fixture(page, { url: STORES.walmart.url, html: STORES.walmart.html });
  await page.getByLabel('More of').fill('metal');
  await page.keyboard.press('Enter');
  await expect(page.locator('#unshop-root .prefs')).toContainText('+ metal');
  await page.evaluate(() => history.pushState({}, '', '/search?q=desk+lamp'));
  await expect(page.locator('#unshop-root .scope')).toHaveText('Preferences for “desk lamp” on Walmart');
  await expect(page.locator('#unshop-root .prefs')).toContainText('Nothing yet');
  await page.evaluate(() => history.pushState({}, '', '/search?q=wireless+headphones'));
  await expect(page.locator('#unshop-root .prefs')).toContainText('+ metal');
  await page.evaluate(() => history.pushState({}, '', '/ip/5530776824'));
  await expect(page.locator('#unshop-root')).toBeHidden();
  await expect(page.locator('.unshop-ui')).toHaveCount(0);
  await page.evaluate(() => history.pushState({}, '', '/search?q=wireless+headphones'));
  await expect(page.locator('#unshop-root')).toBeVisible();
  await expect(page.locator('.unshop-ui')).toHaveCount(2);
});

test('collapse to launcher and back', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Minimize UnShop' }).click();
  await expect(page.locator('#unshop-root .panel')).toBeHidden();
  await page.getByRole('button', { name: 'Open UnShop' }).click();
  await expect(page.locator('#unshop-root .panel')).toBeVisible();
});

test('real MV3 extension loads demo, background worker and settings with CSP enforced', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'unshop-browser-'));
  const context = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${repo}`, `--load-extension=${repo}`] });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`chrome-extension://${id}/src/demo.html`);
    await expect(page.locator('.unshop-ui')).toHaveCount(12);
    // The pill settles on Claude if a local server is running, Local rules otherwise.
    await expect(page.locator('#unshop-root .pill')).toHaveText(/Claude|Local rules/);
    await page.locator('.unshop-reject').first().click();
    await page.getByRole('button', { name: 'Hide & learn' }).click();
    await expect(page.locator('.unshop-dimmed')).toHaveCount(1);
    await page.screenshot({ path: 'work/unshop-demo.png' });
    await page.reload();
    await expect(page.locator('.unshop-dimmed')).toHaveCount(1);
    await page.goto(`chrome-extension://${id}/src/options.html`);
    await expect(page.locator('#health')).not.toHaveText('Checking…');
    await page.getByRole('button', { name: 'Delete saved preferences' }).click();
    await expect(page.locator('#status')).toContainText('Deleted preferences');
    await page.goto(`chrome-extension://${id}/src/demo.html`);
    await expect(page.locator('.unshop-dimmed')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); await rm(dir, { recursive: true, force: true }); }
});

test('storage failure preserves state, input draft and recoverable dialog', async ({ page }) => {
  await fixture(page);
  await page.getByLabel('More of').fill('smaller headphones under $80');
  await page.evaluate(() => { window.chrome.storage.local.set = () => { throw new Error('Extension context invalidated'); }; });
  await page.locator('.unshop-reject').click();
  await page.getByRole('button', { name: 'Hide & learn' }).click();
  await expect(page.locator('dialog .error')).toContainText('Save failed');
  await expect(page.locator('article')).not.toHaveClass(/unshop-dimmed/);
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('More of')).toHaveValue('smaller headphones under $80');
});
