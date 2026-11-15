/* Store adapters. Everything store-specific lives here; content.js only talks to an adapter.
   Selectors were checked against live search pages (Nov 2026). Stores change layouts often:
   if a store stops working, fix its adapter here. */
globalThis.UnShopSites = (() => {
  const text = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  // First dollar amount in a string; for ranges ("$19.99 to $24.99") that's the lowest price.
  const money = s => {
    const m = String(s || '').match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
    const n = m ? Number(m[1].replace(/,/g, '')) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  // First leaf element whose whole text is a price, e.g. "$129.99" or "$24.99 - $26.99".
  const priceLeaf = root => {
    for (const el of root.querySelectorAll('span, div, p')) {
      if (el.children.length === 0 && /^\$\s*\d/.test(el.textContent.trim())) return el.textContent;
    }
    return '';
  };
  const image = (card, sel) => {
    const src = card.querySelector(sel)?.getAttribute('src') || '';
    return /^(https:\/\/|data:image\/svg\+xml|chrome-extension:\/\/)/.test(src) ? src : '';
  };
  const url = (base, params) => {
    const u = new URL(base);
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') u.searchParams.set(k, String(v));
    return u.href;
  };

  const amazon = {
    id: 'amazon', label: 'Amazon', host: /(^|\.)amazon\.com$/,
    isSearch: u => /^\/(?:[^/]+\/)?s\/?$/.test(u.pathname),
    queryParam: 'k', idAttr: 'data-asin',
    card: '[data-component-type="s-search-result"][data-asin]',
    extract(card) {
      const heading = card.querySelector('h2');
      if (!heading) return null;
      const raw = card.querySelector('.a-price:not([data-a-strike]) .a-offscreen, .a-price .a-offscreen')?.textContent || '';
      return {
        id: card.getAttribute('data-asin'),
        title: heading.getAttribute('aria-label') || text(heading),
        price: /^\s*\$[\d,.]+\s*$/.test(raw) ? money(raw) : null,
        image: image(card, 'img.s-image')
      };
    },
    searchUrl: (q, budget) => url('https://www.amazon.com/s', { k: q, rh: budget ? `p_36:-${Math.round(budget * 100)}` : null })
  };

  const ebay = {
    id: 'ebay', label: 'eBay', host: /(^|\.)ebay\.com$/,
    isSearch: u => /^\/sch\//.test(u.pathname),
    queryParam: '_nkw', idAttr: 'data-listingid',
    card: 'li.s-card[data-listingid]',
    extract(card) {
      const titleEl = card.querySelector('.s-card__title');
      // The title holds the name plus a hidden "Opens in a new window or tab" span.
      const title = text(titleEl?.querySelector('span:not(.clipped)') || titleEl);
      if (!title || /^shop on ebay$/i.test(title)) return null;  // eBay's placeholder card
      return { id: card.getAttribute('data-listingid'), title, price: money(text(card.querySelector('.s-card__price'))), image: image(card, '.su-media-container img, img') };
    },
    searchUrl: (q, budget) => url('https://www.ebay.com/sch/i.html', { _nkw: q, _udhi: budget || null })
  };

  const walmart = {
    id: 'walmart', label: 'Walmart', host: /(^|\.)walmart\.com$/,
    isSearch: u => /^\/search\/?$/.test(u.pathname),
    queryParam: 'q', idAttr: 'data-item-id',
    card: '[data-item-id]',
    extract(card) {
      // Walmart has two tile layouts; both carry a screen-reader label that starts with the price:
      // "current price Now $79.00, Was $100.00" or "Price Now $17.99 Was $169.98". First $ = current price.
      let price = null;
      for (const el of card.querySelectorAll('span, div')) {
        if (el.children.length) continue;
        const t = text(el);
        if (/^(?:current price|price)\b/i.test(t) && /\$\s*\d/.test(t)) { price = money(t); break; }
      }
      return {
        id: card.getAttribute('data-item-id'),
        title: text(card.querySelector('[data-automation-id="product-title"]')),
        price: price ?? money(text(card.querySelector('[data-automation-id="product-price"]'))),
        image: image(card, 'img[data-testid="productTileImage"], img')
      };
    },
    searchUrl: (q, budget) => url('https://www.walmart.com/search', { q, max_price: budget || null })
  };

  const target = {
    id: 'target', label: 'Target', host: /(^|\.)target\.com$/,
    isSearch: u => /^\/s\/?$/.test(u.pathname),
    queryParam: 'searchTerm', idAttr: 'data-focusid',
    card: '[data-test="ListingPageProductListing"]',
    extract(card) {
      const link = card.querySelector('a[data-test="product-listing-gallery-desktop-image-link"]');
      const title = (link?.getAttribute('aria-label') || '').replace(/\s*Sponsored$/i, '').trim();
      const id = (card.getAttribute('data-focusid') || '').match(/^\d+/)?.[0] || card.querySelector('a[href*="/A-"]')?.getAttribute('href')?.match(/\/A-(\d+)/)?.[1];
      return { id, title, price: money(priceLeaf(card)), image: image(card, 'img') };
    },
    searchUrl: q => url('https://www.target.com/s', { searchTerm: q })
  };

  const bestbuy = {
    id: 'bestbuy', label: 'Best Buy', host: /(^|\.)bestbuy\.com$/,
    isSearch: u => /^\/site\/searchpage\.jsp$/.test(u.pathname),
    queryParam: 'st', idAttr: 'data-product-id',
    card: 'li.product-list-item[data-product-id]',
    extract(card) {
      // Best Buy often renders prices late (or not at all for some sessions); a missing price is treated as unknown.
      return { id: card.getAttribute('data-product-id'), title: text(card.querySelector('a.product-list-item-link, h2, h3')), price: money(priceLeaf(card)), image: image(card, 'img') };
    },
    searchUrl: q => url('https://www.bestbuy.com/site/searchpage.jsp', { st: q })
  };

  // The packaged demo uses Amazon-style markup with its own storage and a fixed query.
  const demo = { ...amazon, id: 'demo', label: 'Demo', isSearch: () => true, fixedQuery: 'wireless headphones' };

  const SITES = [amazon, ebay, walmart, target, bestbuy];

  function detect(loc = location, doc = document) {
    if (loc.protocol === 'chrome-extension:') return doc.body?.dataset.unshopDemo === 'true' ? demo : null;
    if (loc.protocol !== 'https:') return null;
    return SITES.find(s => s.host.test(loc.hostname)) || null;
  }
  const query = (site, href) => site.fixedQuery || (new URL(href).searchParams.get(site.queryParam) || '').trim();

  return { SITES, detect, query, money, demo };
})();
