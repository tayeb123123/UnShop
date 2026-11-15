(() => {
  'use strict';
  if (globalThis.__unshop) return;
  const M = globalThis.UnShopModel, S = globalThis.UnShopSites;
  // Which store is this? Everything store-specific (selectors, prices, search URLs) is in sites.js.
  const site = S.detect(location, document);
  if (!site) return;
  const demo = site.id === 'demo';
  // Each store + search gets its own saved preferences; a new search starts blank.
  // `key` changes when a store swaps results without reloading (Walmart/Target are single-page apps).
  const keyFor = href => demo ? 'unshopDemoState' : M.searchKey(site.id, S.query(site, href), new URL(href).search);
  let key = keyFor(location.href), activeHref = location.href;
  const HANDOFF_MS = 30 * 60 * 1000, MAX_SEARCHES = 30;
  const selector = site.card;
  const cards = new Map();
  const uiToCard = new WeakMap();
  const diagnostics = globalThis.__unshop = { scans: 0, mutations: 0, cards: 0, aiCalls: 0 };
  let state = M.emptyState(), timer, observer, undo = null, chain = Promise.resolve();
  let aiLabel = 'AI';  // provider name reported by the server: Claude, OpenAI, Gemini, Ollama…
  let ai = 'checking', thinking = false, aiSeq = 0, autoScored = false, collapsed = false, hidePoor = false;
  const POOR_FIT = 30, AI_LIMIT = 20;

  /* ---------- Shadow DOM panel ---------- */
  const host = document.createElement('div');
  host.id = 'unshop-root'; host.dataset.unshopOwned = '';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
:host{all:initial;--text:#1d1d1f;--text2:#6e6e73;--text3:#86868b;--sep:rgba(0,0,0,.1);--fill:#f5f5f7;--fill2:#e8e8ed;--bg:#fff;
  --accent:#0071e3;--accent-hover:#0077ed;--green:#34c759;--green-text:#248a3d;--red-text:#d70015;--orange:#ff9f0a;--orange-text:#b25000;
  --ease:cubic-bezier(.25,.1,.25,1);
  font:13px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",system-ui,sans-serif;color:var(--text);position:fixed;right:20px;top:84px;z-index:2147483640;-webkit-font-smoothing:antialiased;letter-spacing:-.01em}
*{box-sizing:border-box}button,input,textarea{font:inherit;color:inherit;letter-spacing:inherit}button{cursor:pointer}button:disabled{opacity:.4;cursor:default}
:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(0,113,227,.35)}
.hidden{display:none!important}
/* Panel */
.panel{width:352px;max-width:calc(100vw - 32px);max-height:calc(100vh - 100px);display:flex;flex-direction:column;background:rgba(255,255,255,.92);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);border:.5px solid var(--sep);border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.12),0 1px 3px rgba(0,0,0,.06);overflow:hidden;transform-origin:top right;animation:panelIn .3s var(--ease) both}
.panel.out{animation:panelOut .18s var(--ease) both}
@keyframes panelIn{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
@keyframes panelOut{to{opacity:0;transform:scale(.98)}}
header{display:flex;align-items:center;gap:10px;padding:14px 12px 12px 16px}
.mark{width:28px;height:28px;flex:none;display:grid;place-items:center}
.mark svg{width:28px;height:28px;display:block}
.brand{line-height:1.2;min-width:0}.brand b{font-size:15px;font-weight:600;letter-spacing:-.02em}
.brand small{display:block;color:var(--text2);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px}
.pill{margin-left:auto;display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:99px;background:var(--fill);font-size:11.5px;font-weight:500;color:var(--text2);white-space:nowrap}
.dot{width:6px;height:6px;border-radius:50%;background:var(--text3)}
.pill[data-s=online] .dot{background:var(--green)}
.pill[data-s=offline] .dot{background:var(--orange)}
.pill[data-s=thinking] .dot{width:10px;height:10px;background:transparent;border:1.5px solid var(--fill2);border-top-color:var(--text2);animation:spin .8s linear infinite}
.icon{border:0;background:var(--fill);width:24px;height:24px;border-radius:50%;display:grid;place-items:center;color:var(--text2);font-size:15px;line-height:1;transition:background .15s var(--ease)}
.icon:hover{background:var(--fill2)}
.progress{display:none}
.scroll{overflow:auto;padding:2px 16px 8px;scrollbar-width:thin}
.panel:not(.out) .scroll>*{animation:fadeIn .35s var(--ease) both}
@keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
/* Message + similar-search offer */
.bubble{background:var(--fill);border-radius:12px;padding:10px 12px;font-size:13px;color:var(--text2);margin-bottom:12px}
.bubble b{color:var(--text);font-weight:600}.bubble.err{color:var(--orange-text)}
.bubble.swap{animation:fadeIn .3s var(--ease)}
.bubble.wait{color:var(--text);animation:breathe 1.6s ease-in-out infinite}
@keyframes breathe{50%{opacity:.55}}
.suggest{background:var(--fill);border-radius:12px;padding:12px;margin-bottom:10px;font-size:13px;color:var(--text2);animation:fadeIn .3s var(--ease) both}
.suggest p{margin:0 0 10px}.suggest b{color:var(--text);font-weight:600}.suggest-row{display:flex;gap:6px}
/* More / Less */
.ask{display:flex;flex-direction:column;gap:6px}
.field{display:flex;align-items:flex-start;gap:10px;border-radius:10px;padding:7px 10px;background:var(--fill);transition:box-shadow .15s var(--ease),background .15s var(--ease)}
.field:focus-within{background:var(--bg);box-shadow:0 0 0 1px var(--accent),0 0 0 4px rgba(0,113,227,.15)}
.sign{flex:none;width:34px;font-size:12px;font-weight:600;margin-top:5px;color:var(--text2)}
.more .sign{color:var(--green-text)}.less .sign{color:var(--red-text)}
.field textarea{flex:1;border:0;resize:none;min-height:26px;max-height:96px;padding:4px 0;outline:0;background:transparent;font-size:13px;line-height:1.4}
.field textarea::placeholder{color:var(--text3)}
.ask-row{display:flex;align-items:center;gap:6px;padding:2px 0 0 2px}
.ask-row small{color:var(--text3);font-size:11.5px;margin-right:auto}
.go{border:0;background:var(--accent);color:#fff;font-weight:500;border-radius:99px;padding:6px 15px;display:inline-flex;align-items:center;gap:7px;font-size:13px;transition:background .15s var(--ease),transform .1s var(--ease)}
.go:hover:not(:disabled){background:var(--accent-hover)}
.go:active:not(:disabled){transform:scale(.97)}
.spin{width:11px;height:11px;border:1.5px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.chip{border:0;background:var(--fill);border-radius:99px;padding:4px 11px;font-size:12px;color:var(--text);transition:background .15s var(--ease)}
.chip:hover{background:var(--fill2)}
.status{font-size:12px;color:var(--text2);margin:10px 0 0}.status:empty{display:none}.status:not(:empty){animation:fadeIn .25s var(--ease)}
/* Section titles */
h3{font-size:13px;font-weight:600;color:var(--text);margin:20px 0 8px;display:flex;align-items:baseline;gap:8px;letter-spacing:-.01em}
h3 span{margin-left:auto;font-weight:400;font-size:12px;color:var(--text3)}
/* Learned preferences */
.prefs{display:flex;flex-wrap:wrap;gap:6px}
.pref{display:inline-flex;align-items:center;gap:3px;padding:4px 5px 4px 11px;font-size:12px;font-weight:500;background:var(--fill);color:var(--text);border-radius:99px}
.pref.neg{color:var(--red-text)}.pref.info{color:var(--text2);padding-right:11px}
.pref.new{animation:fadeIn .3s var(--ease) both;animation-delay:calc(var(--i,0) * 30ms)}
.pref button{border:0;background:transparent;width:18px;height:18px;border-radius:50%;font-size:13px;line-height:1;color:var(--text3);padding:0;transition:background .15s var(--ease),color .15s}
.pref button:hover{background:var(--fill2);color:var(--text)}
.empty{color:var(--text3);font-size:12.5px;margin:0}
.notes{font-size:12px;color:var(--text2);margin:8px 0 0}
/* Shortlist: a plain list with hairline separators */
ol{list-style:none;margin:0;padding:0}
ol li+li .item{border-top:.5px solid var(--sep)}
.item{position:relative;display:grid;grid-template-columns:16px 44px 1fr;align-items:center;gap:10px;padding:10px 2px;cursor:pointer;border:0;background:transparent;text-align:left;width:100%;border-radius:0;transition:background .15s var(--ease)}
.item:hover{background:rgba(0,0,0,.025)}
.item.enter{animation:fadeIn .3s var(--ease) both;animation-delay:calc(var(--i,0) * 35ms)}
.rank{font-size:12px;font-weight:500;color:var(--text3);text-align:center;font-variant-numeric:tabular-nums}
.item.top .rank{color:var(--accent);font-weight:600}
.item.top::after{content:"Best fit";position:absolute;top:10px;right:2px;font-size:11px;font-weight:500;color:var(--accent)}
.item.top .t{padding-right:52px}
.thumb{width:44px;height:44px;border-radius:8px;background:var(--fill);object-fit:contain;display:block}
.t{font-size:13px;font-weight:500;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--text);line-height:1.3}
.meta{display:flex;align-items:center;gap:8px;margin-top:4px;font-size:12px;color:var(--text2)}
.price{font-weight:600;color:var(--text);font-variant-numeric:tabular-nums}
.bar{flex:1;height:4px;background:var(--fill2);border-radius:9px;overflow:hidden;max-width:80px}
.bar i{display:block;height:100%;width:100%;transform-origin:left;background:var(--green);border-radius:9px;transition:transform .6s var(--ease)}
.bar.warn i{background:var(--orange)}
.pct{font-variant-numeric:tabular-nums;min-width:30px;color:var(--text2)}
.why{font-size:12px;color:var(--text3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.why.neg{color:var(--orange-text)}
/* iOS-style switch */
.hp{display:flex;align-items:center;gap:10px;margin:0 0 4px;padding:8px 0;font-size:13px;cursor:pointer}
.hp input{position:absolute;opacity:0;pointer-events:none}
.hp>span:nth-of-type(2){order:-1}
.sw{order:2;width:38px;height:23px;border-radius:99px;background:var(--fill2);position:relative;flex:none;transition:background .2s var(--ease)}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:19px;height:19px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2),0 0 0 .5px rgba(0,0,0,.04);transition:transform .25s var(--ease)}
.hp input:checked+.sw{background:var(--green)}.hp input:checked+.sw::after{transform:translateX(15px)}
.hp input:focus-visible+.sw{box-shadow:0 0 0 3px rgba(0,113,227,.35)}
.hp small{margin-left:auto;color:var(--text3);font-size:12px}
/* Refined search */
.search{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:12px 0 8px;padding:10px 12px;border-radius:10px;background:var(--fill);color:var(--accent);text-decoration:none;font-weight:500;font-size:13px;transition:background .15s var(--ease)}
.search:hover{background:var(--fill2)}
.search span{color:var(--text3);font-weight:400;white-space:nowrap}
footer{display:flex;align-items:center;gap:2px;padding:8px 10px;border-top:.5px solid var(--sep);font-size:12.5px}
.ghost{border:0;background:transparent;border-radius:8px;padding:5px 8px;color:var(--accent);font-size:12.5px;transition:background .15s var(--ease)}.ghost:hover:not(:disabled){background:var(--fill)}
footer .sp{margin-left:auto}
/* Minimised */
.launcher{display:flex;align-items:center;gap:8px;border:.5px solid var(--sep);color:var(--text);background:rgba(255,255,255,.92);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);border-radius:99px;padding:5px 14px 5px 6px;box-shadow:0 6px 20px rgba(0,0,0,.12);font-weight:600;font-size:13px;animation:panelIn .25s var(--ease) both}
.launcher .mark{width:24px;height:24px}.launcher .mark svg{width:24px;height:24px}.launcher small{color:var(--text2);font-weight:400}
/* Rejection sheet */
dialog{border:0;border-radius:16px;padding:0;width:420px;max-width:calc(100vw - 32px);color:var(--text);background:var(--bg);box-shadow:0 20px 60px rgba(0,0,0,.2),0 0 0 .5px var(--sep)}
dialog[open]{animation:sheetIn .25s var(--ease) both}
dialog::backdrop{background:rgba(0,0,0,.25);animation:dim .25s var(--ease) both}
@keyframes sheetIn{from{opacity:0;transform:scale(.98)}to{opacity:1;transform:none}}
@keyframes dim{from{opacity:0}}
dialog form{padding:20px}
.dh{display:flex;gap:12px;align-items:center;margin-bottom:18px}
.dh img,.dh .thumb{width:52px;height:52px;border-radius:10px;flex:none;background:var(--fill);object-fit:contain}
.dh h2{font-size:17px;font-weight:600;margin:0 0 2px;letter-spacing:-.02em}.dh p{margin:0;font-size:12px;color:var(--text2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.close{margin-left:auto;align-self:flex-start}
fieldset{border:0;padding:0;margin:0}legend{font-size:12px;color:var(--text2);margin-bottom:8px}
.reasons{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.reasons label{display:flex;align-items:center;gap:8px;background:var(--fill);border-radius:10px;padding:10px 12px;font-size:13px;cursor:pointer;transition:background .15s var(--ease),color .15s,box-shadow .15s}
.reasons label:hover{background:var(--fill2)}
.reasons input{position:absolute;opacity:0;pointer-events:none}
.reasons label:has(input:checked){background:rgba(0,113,227,.1);color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.reasons label:has(input:focus-visible){box-shadow:0 0 0 3px rgba(0,113,227,.35)}
.ri{display:none}
.note-label{display:block;font-size:12px;color:var(--text2);margin:16px 0 6px}
.note{width:100%;min-height:64px;border:0;border-radius:10px;padding:10px 12px;resize:vertical;outline:0;background:var(--fill);transition:box-shadow .15s var(--ease),background .15s}.note:focus{background:var(--bg);box-shadow:0 0 0 1px var(--accent),0 0 0 4px rgba(0,113,227,.15)}
.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}
.actions .ghost{color:var(--accent)}
.error{color:var(--red-text);font-size:12px;margin:8px 0 0}.error:empty{display:none}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;animation-delay:0s!important;transition-duration:.001ms!important}}
`;
  root.append(style);
  const wrap = document.createElement('div');
  wrap.innerHTML = `
<button class="launcher hidden" type="button" aria-label="Open UnShop"><span class="mark"><svg viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="7" fill="#1d1d1f"/><path d="M9 14.5h10" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg></span>UnShop <small class="lc"></small></button>
<section class="panel" aria-label="UnShop shopping preferences">
  <header><span class="mark" aria-hidden="true"><svg viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="7" fill="#1d1d1f"/><path d="M9 14.5h10" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg></span><div class="brand"><b>UnShop</b><small class="scope"></small></div>
    <span class="pill" data-s="checking" role="status"><span class="dot"></span><span class="pl">Checking AI…</span></span>
    <button class="icon collapse" type="button" aria-label="Minimize UnShop" title="Minimize">–</button><span class="progress" aria-hidden="true"></span></header>
  <div class="scroll">
    <div class="suggest hidden" role="group" aria-label="Preferences from a similar search"><p></p><div class="suggest-row"><button class="go" id="useSimilar" type="button">Use them</button><button class="ghost" id="dismissSimilar" type="button">Start fresh</button></div></div>
    <div class="bubble" aria-live="polite"></div>
    <div class="ask">
      <div class="field more"><span class="sign" aria-hidden="true">More</span><textarea id="more" aria-label="More of" maxlength="500" rows="1" placeholder="smaller, digital, cheaper…"></textarea></div>
      <div class="field less"><span class="sign" aria-hidden="true">Less</span><textarea id="less" aria-label="Less of" maxlength="500" rows="1" placeholder="bulky, flashy, over $80…"></textarea></div>
      <div class="ask-row"><small class="mode-hint"></small><button class="go" id="learn" type="button">Refine</button></div></div>
    <div class="chips suggestions"></div>
    <p class="status" role="status"></p>
    <h3>What I’ve learned</h3><div class="prefs"></div><p class="notes hidden"></p>
    <h3>Best fits on this page <span class="count"></span></h3>
    <label class="hp"><input type="checkbox" id="hidePoor"><span class="sw" aria-hidden="true"></span><span>Hide poor fits</span><small class="hc"></small></label>
    <ol class="ranked"></ol>
    <a class="search" id="search" target="_blank" rel="noopener noreferrer"></a>
  </div>
  <footer><button class="ghost" id="undo" type="button">Undo</button><button class="ghost" id="reset" type="button">Reset</button><span class="sp"></span><button class="ghost" id="settings" type="button">Settings</button></footer>
</section>`;
  root.append(...wrap.children);
  document.body.append(host);
  const $ = s => root.querySelector(s);
  const panel = $('.panel'), launcher = $('.launcher');
  let statusTimer;
  const status = (message, tone = 'ok') => { const el = $('.status'); el.textContent = message; el.style.color = tone === 'err' ? 'var(--coral)' : ''; clearTimeout(statusTimer); if (message) statusTimer = setTimeout(() => { el.textContent = ''; }, 6000); };
  const money = p => Number.isFinite(p) ? `$${p.toFixed(2)}` : 'Price n/a';
  // Motion helpers. Everything respects the OS "reduce motion" setting.
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animate = (el, frames, opts) => (!calm() && el.animate) ? el.animate(frames, { easing: 'cubic-bezier(.2,.8,.2,1)', ...opts }) : { finished: Promise.resolve() };
  const replay = (el, cls) => { el.classList.toggle(cls, false); void el.offsetWidth; el.classList.add(cls); };

  /* ---------- Storage & messaging ---------- */
  function storageGet(k) {
    return new Promise((resolve, reject) => {
      try { chrome.storage.local.get(k, value => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(value[k])); }
      catch (error) { reject(error); }
    });
  }
  function storageSet(k, value) {
    return new Promise((resolve, reject) => {
      try { chrome.storage.local.set({ [k]: value }, () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()); }
      catch (error) { reject(error); }
    });
  }
  function ask(message) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: 'Extension was updated — refresh this tab.' });
          else resolve(response || { ok: false, error: 'No response from extension.' });
        });
      } catch { resolve({ ok: false, error: 'Extension was updated — refresh this tab.' }); }
    });
  }
  // Serialised commits: each takes the latest state, so AI responses can't clobber user actions.
  function commit(update, message, remember = true) {
    const run = chain.then(async () => {
      const prev = state;
      const next = typeof update === 'function' ? update(state) : update;
      try {
        await storageSet(key, { ...next, savedAt: Date.now(), queryText: query(), site: site.id });
        if (remember) undo = prev;
        state = next; render(); if (message) status(message); return true;
      } catch { status('Could not save. Reload the extension, then this tab.', 'err'); return false; }
    });
    chain = run.catch(() => false);
    return run;
  }

  /* ---------- Card extraction & injected controls ---------- */
  function extract(card) {
    let p;
    try { p = site.extract(card); } catch { return null; }
    const id = String(p?.id || '');
    if (!/^[\w-]{1,60}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) return null;
    const title = String(p.title || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!title) return null;
    return { id, title, price: Number.isFinite(p.price) && p.price > 0 ? p.price : null, image: p.image || '' };
  }
  function observe() { observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [site.idAttr] }); }
  function paused(fn) {
    observer?.disconnect();
    try { fn(); } finally { if (observer) observe(); }
  }
  function detach(card, entry) {
    entry?.ui.remove();
    entry?.media?.classList.toggle('unshop-media', false);
    entry?.media?.classList.toggle('unshop-media-rel', false);
    card.classList.remove('unshop-card', 'unshop-dimmed', 'unshop-better', 'unshop-conflict', 'unshop-hidden');
    cards.delete(card);
  }
  /* Controls sit on the product *image* (bottom edge), never over the title or description.
     Anchor = the nearest wrapper around the main image that contains no text of its own
     (titles, prices and descriptions all have text) and isn't a link. No such wrapper → a small
     row above the card content, in the normal flow, so it pushes text down instead of covering it. */
  const textLength = el => {
    let n = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: t => t.parentElement?.closest('[data-unshop-owned]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    while (walker.nextNode() && n <= 30) n += walker.currentNode.nodeValue.replace(/\s+/g, '').length;
    return n;
  };
  function mediaBox(card) {
    let img = null, area = 0;
    for (const el of card.querySelectorAll('img')) {
      const r = el.getBoundingClientRect(), a = r.width * r.height;
      if (r.width >= 60 && r.height >= 60 && a > area) { img = el; area = a; }
    }
    if (!img) return null;
    const r = img.getBoundingClientRect();
    for (let box = img.parentElement; box && box !== card; box = box.parentElement) {
      const b = box.getBoundingClientRect();
      if (b.height > r.height * 1.6 + 40 || textLength(box) > 30) break;  // grew past the image area
      const display = getComputedStyle(box).display;
      if (box.tagName !== 'A' && !box.closest('a') && display !== 'inline' && display !== 'contents' && b.width >= 100 && b.height >= 80) return box;
    }
    return null;
  }
  function place(card, entry, rejected) {
    let mode = 'inline', target = card;
    if (rejected) mode = 'strip';
    else {
      if (!entry.media || !entry.media.isConnected || !card.contains(entry.media)) entry.media = mediaBox(card);
      if (entry.media) { mode = 'media'; target = entry.media; }
    }
    if (entry.ui.dataset.mode !== mode) entry.ui.dataset.mode = mode;
    if (mode === 'media') {
      entry.media.classList.add('unshop-media');
      if (getComputedStyle(entry.media).position === 'static') entry.media.classList.add('unshop-media-rel');
      if (entry.ui.parentElement !== target) target.append(entry.ui);
    } else if (card.firstElementChild !== entry.ui) card.prepend(entry.ui);
  }
  // Images often load after the first scan; once they do, move fallback-row controls onto the image.
  let relayoutTimer;
  function relayout() {
    relayoutTimer = null;
    paused(() => { for (const [card, entry] of cards) if (entry.ui.dataset.mode === 'inline' && !state.rejected[entry.product.id]) place(card, entry, false); });
  }
  const scheduleRelayout = (ms = 150) => { if (!relayoutTimer) relayoutTimer = setTimeout(relayout, ms); };
  document.addEventListener('load', e => { if (e.target instanceof HTMLImageElement && e.target.closest(selector)) scheduleRelayout(); }, true);
  function scan() {
    timer = null; diagnostics.scans++;
    paused(() => {
      const found = new Set([...document.querySelectorAll(selector)].filter(c => !c.parentElement?.closest(selector)).slice(0, 200));
      for (const [card, entry] of cards) if (!found.has(card) || !card.isConnected) detach(card, entry);
      for (const card of found) {
        const product = extract(card);
        if (!product) { detach(card, cards.get(card)); continue; }
        let entry = cards.get(card);
        if (!entry) {
          const ui = document.createElement('div'); ui.dataset.unshopOwned = ''; ui.className = 'unshop-ui';
          const badge = document.createElement('span'); badge.className = 'unshop-badge';
          const button = document.createElement('button'); button.type = 'button'; button.className = 'unshop-reject'; button.dataset.unshopAction = 'toggle';
          ui.append(badge, button);
          entry = { product, ui, badge, button };
          uiToCard.set(ui, card);
          cards.set(card, entry);
        }
        entry.product = product;
        card.classList.add('unshop-card');
        if (!entry.ui.isConnected) place(card, entry, Boolean(state.rejected[product.id]));
      }
      diagnostics.cards = cards.size; render();
    });
    scheduleRelayout(1200);
    maybeAutoScore();
  }
  // Stores attach their own click/mousedown handlers to result cards. Intercept ours at the
  // window capture phase (the very first listener to run) so the page can't swallow them.
  function intercept(event) {
    const ui = event.target instanceof Element ? event.target.closest('.unshop-ui[data-unshop-owned]') : null;
    if (!ui) return;
    event.stopImmediatePropagation();
    if (event.type !== 'click') return;
    event.preventDefault();
    const card = uiToCard.get(ui), entry = card && cards.get(card);
    if (!entry || !event.target.closest('[data-unshop-action]')) return;
    if (state.rejected[entry.product.id]) commit(s => M.restoreProduct(s, entry.product.id), 'Restored.');
    else openDialog(entry);
  }
  for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart']) window.addEventListener(type, intercept, { capture: true, passive: false });

  /* ---------- Rendering ---------- */
  function pref(label, cls, kind, value) {
    const el = document.createElement('span'); el.className = `pref ${cls}`; el.textContent = label; el.dataset.k = label;
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', `Remove ${label}`);
    x.onclick = () => commit(s => M.removePreference(s, kind, value), `Removed “${label}”.`);
    el.append(x); return el;
  }
  function median(prices) {
    const v = prices.filter(Number.isFinite).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  }
  function render() {
    paused(() => {
      const rejectedCount = Object.keys(state.rejected).length;
      const active = M.hasPreferences(state);
      // Bubble
      const bubble = $('.bubble'), before = bubble.textContent; bubble.classList.toggle('err', false);
      if (state.summary) bubble.textContent = state.summary;
      else if (!active) bubble.innerHTML = '<b>Not sure what you want?</b> Start with what you don’t. Press <b>Not for me</b> on any result, or tell me what you want <b>more</b> or <b>less</b> of below.';
      else bubble.textContent = `${rejectedCount ? `Learning from ${rejectedCount} pass${rejectedCount === 1 ? '' : 'es'}.` : 'Using what you told me.'} Good fits get a green dot, conflicts an orange one.`;
      if (ai === 'offline' && lastAiError) { bubble.classList.add('err'); bubble.textContent = `${lastAiError} Using local rules for now.`; }
      if (bubble.textContent !== before && !thinking) replay(bubble, 'swap');
      // Learned prefs
      const prefs = $('.prefs'), seen = new Set([...prefs.querySelectorAll('.pref')].map(el => el.dataset.k)); prefs.replaceChildren();
      if (state.budget) prefs.append(pref(`Under $${state.budget}`, '', 'budget'));
      if (state.compact) prefs.append(pref('Compact', '', 'compact'));
      if (state.priceTilt) prefs.append(pref(state.priceTilt === 'lower' ? 'Cheaper' : 'Higher-end', '', 'priceTilt'));
      for (const t of state.mustHave) prefs.append(pref(`+ ${t}`, '', 'mustHave', t));
      for (const t of state.avoid) prefs.append(pref(`− ${t}`, 'neg', 'avoid', t));
      if (rejectedCount) { const el = document.createElement('span'); el.className = 'pref info'; el.textContent = `${rejectedCount} passed`; el.dataset.k = 'passed'; prefs.append(el); }
      let fresh = 0;
      for (const el of prefs.querySelectorAll('.pref')) if (!seen.has(el.dataset.k)) { el.classList.add('new'); el.style.setProperty('--i', fresh++); }
      if (!prefs.children.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Nothing yet — your rejections will show up here.'; prefs.append(p); }
      $('.notes').textContent = state.notes; $('.notes').classList.toggle('hidden', !state.notes);
      $('#undo').disabled = !undo; $('#reset').disabled = !active && !state.summary;
      // Cards
      const ranked = [];
      let poorCount = 0;
      const ctx = { median: median([...cards.values()].map(e => e.product.price)) };
      for (const [card, entry] of cards) {
        const r = M.evaluate(entry.product, state, ctx);
        card.classList.toggle('unshop-dimmed', r.rejected);
        card.classList.toggle('unshop-better', active && !r.rejected && r.tone === 'good');
        card.classList.toggle('unshop-conflict', active && !r.rejected && r.tone === 'conflict');
        const poor = active && !r.rejected && r.fit < POOR_FIT;
        if (poor) poorCount++;
        const hide = hidePoor && poor, isHidden = card.classList.contains('unshop-hidden');
        if (hide && !isHidden && !entry.hiding) {
          entry.hiding = true;
          animate(card, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 220 }).finished
            .catch(() => {}).finally(() => { entry.hiding = false; if (hidePoor && entry.poor) paused(() => card.classList.add('unshop-hidden')); });
        } else if (!hide && isHidden) {
          card.classList.toggle('unshop-hidden', false);
          animate(card, [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 300 });
        }
        entry.poor = poor;
        const wasRejected = entry.ui.dataset.mode === 'strip';
        place(card, entry, r.rejected);
        if (wasRejected !== r.rejected && entry.ui.isConnected) replay(card, r.rejected ? 'unshop-collapsing' : 'unshop-restoring');
        const label = r.rejected ? 'Restore' : 'Not for me';
        if (entry.button.textContent !== label) entry.button.textContent = label;
        entry.button.setAttribute('aria-label', `${r.rejected ? 'Restore' : 'Not for me'}: ${entry.product.title}`);
        entry.button.dataset.state = r.rejected ? 'rejected' : 'active';
        let badge = '';
        if (r.rejected) badge = `You passed on: ${entry.product.title}`;
        else if (active && r.ai) badge = `${r.fit}% fit`;
        else if (active && r.conflicts.length) badge = r.conflicts[0];
        else if (active && r.matches.length) badge = r.matches[0];
        if (entry.badge.textContent !== badge) { entry.badge.textContent = badge; if (badge && !r.rejected) replay(entry.badge, 'unshop-pop'); }
        entry.badge.dataset.tone = r.tone; entry.badge.hidden = !badge;
        entry.badge.title = r.reasons.join(' · ');
        if (!r.rejected) ranked.push({ card, entry, r });
      }
      ranked.sort((a, b) => b.r.score - a.r.score);
      $('#hidePoor').checked = hidePoor;
      $('.hc').textContent = !active ? 'learn something first' : poorCount ? `${poorCount} ${hidePoor ? 'hidden' : 'below ' + POOR_FIT + '%'}` : 'none right now';
      const list = $('.ranked');
      // FLIP: remember where each shortlisted product was, so re-ranking glides instead of jumping.
      const prev = new Map([...list.querySelectorAll('.item')].map(el => [el.dataset.id, { top: el.getBoundingClientRect().top, fit: Number(el.dataset.fit) }]));
      list.replaceChildren();
      $('.count').textContent = cards.size ? `${ranked.length} of ${cards.size}` : '';
      const placed = [];
      for (const [i, { card, entry, r }] of ranked.slice(0, 5).entries()) {
        const li = document.createElement('li'), item = document.createElement('button');
        item.type = 'button'; item.className = `item${i === 0 && active ? ' top' : ''}`; item.title = 'Show this result on the page';
        item.dataset.id = entry.product.id; item.dataset.fit = r.fit;
        const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = i + 1;
        const img = document.createElement(entry.product.image ? 'img' : 'span'); img.className = 'thumb';
        if (entry.product.image) { img.src = entry.product.image; img.alt = ''; }
        const body = document.createElement('div');
        const t = document.createElement('div'); t.className = 't'; t.textContent = entry.product.title;
        const meta = document.createElement('div'); meta.className = 'meta';
        const price = document.createElement('span'); price.className = 'price'; price.textContent = money(entry.product.price);
        const bar = document.createElement('span'); bar.className = `bar${r.tone === 'conflict' ? ' warn' : ''}`; const fill = document.createElement('i'); bar.append(fill);
        const old = prev.get(entry.product.id);
        fill.style.transform = `scaleX(${(old ? old.fit : 0) / 100})`;
        const pct = document.createElement('span'); pct.className = 'pct'; pct.textContent = `${r.fit}%`;
        meta.append(price, bar, pct);
        const why = document.createElement('div'); why.className = `why${r.tone === 'conflict' ? ' neg' : ''}`; why.textContent = r.reasons.slice(0, 2).join(' · ');
        body.append(t, meta, why); item.append(rank, img, body);
        item.onclick = () => { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); paused(() => card.classList.add('unshop-flash')); setTimeout(() => paused(() => card.classList.remove('unshop-flash')), 1600); };
        li.append(item); list.append(li);
        placed.push({ item, fill, fit: r.fit, old, i });
      }
      for (const { item, fill, fit, old, i } of placed) {
        if (old) {
          const dy = old.top - item.getBoundingClientRect().top;
          if (Math.abs(dy) > 1) animate(item, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420 });
        } else { item.classList.add('enter'); item.style.setProperty('--i', i); }
        requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.transform = `scaleX(${fit / 100})`; }));
      }
      if (!cards.size) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No supported product cards found on this page yet.'; list.append(p); }
      launcher.querySelector('.lc').textContent = active ? `· ${Object.keys(state.rejected).length} passed` : '';
      renderAi(); updateSearch();
    });
  }
  let lastAiError = '';
  function renderAi() {
    const pill = $('.pill'), label = thinking ? 'Thinking…' : { online: aiLabel, offline: 'Local rules', off: 'Local rules', checking: 'Checking AI…' }[ai];
    pill.dataset.s = thinking ? 'thinking' : ai; pill.querySelector('.pl').textContent = label;
    panel.classList.toggle('thinking', thinking);
    pill.title = ai === 'online' ? `Preferences are interpreted by ${aiLabel} via your UnShop server.` : 'The AI server is unavailable; using built-in rules.';
    const go = $('#learn');
    go.disabled = thinking; go.innerHTML = thinking ? '<span class="spin"></span>Thinking' : 'Refine';
    $('.mode-hint').textContent = ai === 'online' ? `${aiLabel} reads your words · Enter to apply` : 'Local rules · Enter to apply';
    const bubble = $('.bubble');
    if (thinking) { bubble.classList.remove('err'); bubble.classList.add('wait'); bubble.textContent = `${aiLabel} is reading your feedback and re-scoring this page…`; }
    else bubble.classList.remove('wait');
  }
  function query() { return S.query(site, location.href); }
  function updateSearch() {
    const q = M.refineQuery(query(), state) || 'headphones';
    const a = $('#search'); a.href = demo ? S.SITES[0].searchUrl(q, state.budget) : site.searchUrl(q, state.budget);
    a.replaceChildren(document.createTextNode(`Search “${q}”${state.budget ? ` under $${state.budget}` : ''}`));
    const s = document.createElement('span'); s.textContent = `${demo ? 'Amazon' : site.label} ›`; a.append(s);
  }
  // Following UnShop's own refined search carries these preferences to the new query.
  $('#search').addEventListener('click', () => {
    if (!demo) storageSet('unshopHandoff', { from: key, to: keyFor($('#search').href), query: query(), at: Date.now() }).catch(() => {});
  });
  const SUGGEST = [['more', 'Smaller'], ['more', 'Cheaper'], ['more', 'Simpler'], ['less', 'Bulky'], ['less', 'Flashy'], ['less', 'Plastic']];
  for (const [box, text] of SUGGEST) {
    const b = document.createElement('button'); b.type = 'button'; b.className = `chip ${box[0]}`; b.textContent = `${box === 'more' ? '+' : '−'} ${text}`;
    b.setAttribute('aria-label', `Add “${text.toLowerCase()}” to ${box === 'more' ? 'More' : 'Less'}`);
    b.onclick = () => { const p = $(`#${box}`); p.value = p.value.trim() ? `${p.value.replace(/[,\s]+$/, '')}, ${text.toLowerCase()}` : text.toLowerCase(); p.focus(); p.dispatchEvent(new Event('input')); };
    $('.suggestions').append(b);
  }

  /* ---------- AI (via the UnShop server) ---------- */
  function visibleProducts() {
    // Skip what's already ruled out locally (rejected, over budget) and cap the count:
    // The model writes a score + reason per product, so fewer products means a faster reply.
    return [...cards.values()].map(e => e.product)
      .filter(p => !state.rejected[p.id] && !(state.budget && Number.isFinite(p.price) && p.price > state.budget))
      .slice(0, AI_LIMIT).map(({ id, title, price }) => ({ id, title, price }));
  }
  function history() {
    return state.events.filter(e => e.type === 'reject').slice(-12).map(e => ({ title: state.rejected[e.productId]?.title || '', reason: M.REASONS.find(r => r.id === e.reason)?.label || e.reason, note: e.note })).filter(h => h.title);
  }
  async function runAi({ more = '', less = '', rejection = null } = {}) {
    if (ai !== 'online') return false;
    const seq = ++aiSeq; thinking = true; renderAi(); diagnostics.aiCalls++;
    const payload = { query: query(), store: demo ? 'Demo' : site.label, more, less, rejection, preferences: { budget: state.budget, compact: state.compact, priceTilt: state.priceTilt, mustHave: state.mustHave, avoid: state.avoid, notes: state.notes }, history: history(), products: visibleProducts() };
    const response = await ask({ type: 'unshop:analyze', payload });
    if (seq !== aiSeq) return false;
    thinking = false;
    if (!response?.ok) {
      lastAiError = response?.error || `${aiLabel} is unavailable.`;
      if (!response?.disabled) ai = 'offline';
      render(); status(lastAiError, 'err'); return false;
    }
    lastAiError = '';
    await commit(s => M.applyAnalysis(s, response.result), null, false);
    return true;
  }
  function maybeAutoScore() {
    if (autoScored || ai !== 'online' || thinking || !cards.size || !M.hasPreferences(state)) return;
    const products = visibleProducts();
    if (products.filter(p => !state.scores[p.id]).length < Math.max(2, products.length / 2)) return;
    autoScored = true; runAi();
  }

  /* ---------- Rejection dialog ---------- */
  function openDialog(entry) {
    root.querySelector('dialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'dlg-title');
    dialog.innerHTML = `<form method="dialog"><div class="dh"><span class="thumb"></span><div><h2 id="dlg-title">Not for you? What’s off?</h2><p class="title"></p></div><button type="button" class="icon close" aria-label="Close">×</button></div>
      <fieldset><legend>Pick the closest reason</legend><div class="reasons"></div></fieldset>
      <label class="note-label" for="note">Say more <span style="font-weight:400;color:var(--mute)">(optional — this is what the AI learns most from)</span></label>
      <textarea id="note" class="note" maxlength="500" placeholder="e.g. too heavy for my commute, I want something I can fold"></textarea>
      <p class="error" role="alert"></p>
      <div class="actions"><button type="button" class="ghost cancel">Cancel</button><button type="submit" class="go save">Hide &amp; learn</button></div></form>`;
    dialog.querySelector('.title').textContent = `${entry.product.title} · ${money(entry.product.price)}`;
    if (entry.product.image) { const img = document.createElement('img'); img.className = 'thumb'; img.src = entry.product.image; img.alt = ''; dialog.querySelector('.dh .thumb').replaceWith(img); }
    const reasons = dialog.querySelector('.reasons');
    for (const r of M.REASONS) {
      const label = document.createElement('label'); const input = document.createElement('input');
      input.type = 'radio'; input.name = 'reason'; input.value = r.id;
      const icon = document.createElement('span'); icon.className = 'ri'; icon.textContent = r.icon; icon.setAttribute('aria-hidden', 'true');
      label.append(input, icon, document.createTextNode(r.label)); reasons.append(label);
    }
    // Close immediately: a modal dialog makes the page inert and returns focus when it closes,
    // so delaying the close (for an exit animation) would steal focus from whatever the shopper clicked next.
    let closing = false;
    const close = () => {
      if (closing) return; closing = true;
      dialog.close(); dialog.remove();
      if (entry.button.isConnected) entry.button.focus({ preventScroll: true });
    };
    dialog.querySelector('.close').onclick = close; dialog.querySelector('.cancel').onclick = close;
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const button = dialog.querySelector('.save'); button.disabled = true;
      const reason = dialog.querySelector('input[name=reason]:checked')?.value || 'other';
      const note = dialog.querySelector('#note').value;
      const product = { id: entry.product.id, title: entry.product.title, price: entry.product.price };
      const ok = await commit(s => M.updatePreferences(s, product, reason, note), 'Hidden. I’ll use that.');
      if (!ok) { button.disabled = false; dialog.querySelector('.error').textContent = 'Save failed. Reload the extension and this tab, then try again.'; return; }
      close();
      runAi({ rejection: { product, reason: M.REASONS.find(r => r.id === reason).label, note } });
    };
    root.append(dialog); dialog.showModal();
    dialog.querySelector('input[name=reason]').focus();
  }

  /* ---------- Panel controls ---------- */
  let collapseTimer;
  function setCollapsed(value, save = true) {
    collapsed = value; clearTimeout(collapseTimer);
    const swap = () => { panel.classList.toggle('out', false); panel.classList.toggle('hidden', value); launcher.classList.toggle('hidden', !value); };
    // Shrink the panel away first, then pop the launcher in (CSS animations run when each appears).
    if (value && save && !calm()) { panel.classList.add('out'); collapseTimer = setTimeout(swap, 190); } else swap();
    if (save) saveUi();
  }
  function saveUi() { storageSet('unshopUi', { collapsed, hidePoor, dismissed }).catch(() => {}); }
  $('#hidePoor').addEventListener('change', e => { hidePoor = e.target.checked; saveUi(); render(); status(hidePoor ? 'Poor fits hidden. Turn this off to see everything.' : 'Showing every result again.'); });
  $('.collapse').onclick = () => { setCollapsed(true); launcher.focus(); };
  launcher.onclick = () => { setCollapsed(false); $('#more').focus(); };
  const clearBoxes = () => { for (const id of ['#more', '#less']) { $(id).value = ''; $(id).style.height = ''; } };
  $('#learn').onclick = async () => {
    const more = $('#more').value.trim(), less = $('#less').value.trim();
    if (!more && !less) { status('Add something to More or Less first.', 'err'); $('#more').focus(); return; }
    if (ai === 'online') {
      const ok = await runAi({ more, less });
      if (ok) { clearBoxes(); replay($('#learn'), 'done'); status(`Updated with ${aiLabel}.`); return; }
    }
    const { state: next, understood } = M.refineMoreLess(state, more, less, query());
    if (!understood.length) { status('I couldn’t pick out a feature there. Try short words like “smaller”, “metal”, “under $60”.', 'err'); return; }
    if (await commit(next, `Got it: ${understood.join(', ')}.`)) { clearBoxes(); replay($('#learn'), 'done'); }
  };
  const grow = el => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 96)}px`; };
  for (const id of ['#more', '#less']) $(id).addEventListener('input', e => grow(e.target));
  for (const id of ['#more', '#less']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#learn').click(); } });
  $('#undo').onclick = async () => { const prev = undo; if (prev && await commit(prev, 'Undone.', false)) { undo = null; render(); } };
  $('#reset').onclick = () => commit(M.emptyState(), 'Preferences reset. Undo is available.');
  $('#settings').onclick = () => { ask({ type: 'unshop:open-options' }); };
  // Keep the store's keyboard shortcuts from stealing keys typed into the panel.
  for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, e => e.stopPropagation());

  /* ---------- Startup ---------- */
  $('#learn').disabled = true; $('#reset').disabled = true;
  const scope = $('.scope');
  scope.title = 'Each search keeps its own preferences. A new search starts fresh.';
  function setScope() {
    scope.textContent = demo ? 'Fictional demo' : query() ? `Preferences for “${query()}” on ${site.label}` : `Preferences for this ${site.label} page`;
  }
  async function carryOver() {
    const handoff = await storageGet('unshopHandoff');
    if (!handoff || handoff.to !== key || handoff.from === key || Date.now() - handoff.at > HANDOFF_MS) return null;
    await new Promise(r => { try { chrome.storage.local.remove('unshopHandoff', r); } catch { r(); } });
    const from = await storageGet(handoff.from);
    if (!from) return null;
    const next = M.normalizeState(from);
    next.summary = `Carried over what you told me on “${String(handoff.query || '').slice(0, 60)}”.`;
    await storageSet(key, { ...next, savedAt: Date.now(), queryText: query(), site: site.id });
    return next;
  }
  // Before multi-store support, Amazon searches were saved under the raw query; move them over once.
  async function migrateLegacy() {
    if (site.id !== 'amazon') return null;
    const old = M.legacySearchKey(query());
    const raw = old && old !== key ? await storageGet(old) : null;
    if (!raw) return null;
    await storageSet(key, { ...raw, savedAt: Date.now(), queryText: query(), site: site.id });
    await new Promise(r => { try { chrome.storage.local.remove(old, r); } catch { r(); } });
    return M.normalizeState(raw);
  }
  function allSaved() {
    return new Promise(resolve => { try { chrome.storage.local.get(null, all => resolve(chrome.runtime.lastError ? {} : all || {})); } catch { resolve({}); } });
  }
  function pruneOldSearches(all) {
    try {
      const old = Object.entries(all).filter(([k]) => k.startsWith(M.SEARCH_PREFIX) && k !== key)
        .sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0)).slice(MAX_SEARCHES - 1).map(([k]) => k);
      chrome.storage.local.remove([...old, 'unshopState']);  // 'unshopState' = pre-0.3 global preferences
    } catch { /* storage unavailable; nothing to prune */ }
  }
  /* Similar searches: an exact match (same store, same canonical search) loads automatically.
     A related search — same product noun, on any store — is only *offered*, because context differs
     ("headphones for running" vs "headphones for the office"). Only stated preferences carry over. */
  let similar = null, dismissed = [];
  function showSimilar(match) {
    similar = match;
    const box = $('.suggest');
    box.classList.toggle('hidden', !match);
    if (!match) return;
    const where = match.site && match.site !== site.id ? ` on ${(S.SITES.find(x => x.id === match.site) || {}).label || match.site}` : '';
    const p = box.querySelector('p'); p.replaceChildren();
    const b = document.createElement('b'); b.textContent = `“${match.queryText}”${where}`;
    p.append('You told me what you like for ', b, '. Use those preferences here?');
  }
  $('#useSimilar').onclick = async () => {
    const m = similar; if (!m) return;
    showSimilar(null);
    await commit(s => M.importPreferences(s, m.state, `Using what you told me for “${m.queryText}”. Edit or remove anything that doesn’t apply here.`), 'Preferences brought over.');
    maybeAutoScore();
  };
  $('#dismissSimilar').onclick = () => {
    dismissed = [...dismissed.filter(k => k !== key), key].slice(-50);
    saveUi(); showSimilar(null);
  };
  // (Re)load everything for the current search. Runs at start and when a store changes search in place.
  async function loadSearch() {
    key = keyFor(location.href); activeHref = location.href;
    state = M.emptyState(); undo = null; autoScored = false; showSimilar(null); setScope();
    const [saved, ui] = await Promise.allSettled([storageGet(key), storageGet('unshopUi')]);
    if (saved.status === 'rejected') status('Storage unavailable. Reload the tab after updating the extension.', 'err');
    if (ui.status === 'fulfilled' && ui.value) {
      if (ui.value.collapsed) setCollapsed(true, false);
      hidePoor = ui.value.hidePoor === true;
      dismissed = Array.isArray(ui.value.dismissed) ? ui.value.dismissed.slice(-50) : [];
    }
    if (saved.status === 'fulfilled' && saved.value) state = M.normalizeState(saved.value);
    else if (!demo) state = (await carryOver().catch(() => null)) || (await migrateLegacy().catch(() => null)) || state;
    if (!demo) {
      const all = await allSaved();
      pruneOldSearches(all);
      if (!M.hasPreferences(state) && !dismissed.includes(key)) showSimilar(M.findSimilar(query(), key, all));
    }
    render();
  }
  // Single-page stores (Walmart, Target) change the URL without reloading: follow along.
  function setActive(active) { host.style.display = active ? '' : 'none'; }
  setInterval(() => {
    if (location.href === activeHref) return;
    activeHref = location.href;
    const isSearch = site.isSearch(new URL(location.href));
    setActive(isSearch);
    if (!isSearch) { paused(() => { for (const [card, entry] of cards) detach(card, entry); }); return; }
    if (keyFor(location.href) !== key) loadSearch().then(() => { scan(); maybeAutoScore(); });
    else scan();  // back on the same search (e.g. from a product page): re-attach controls
  }, 800);

  const startActive = site.isSearch(new URL(location.href));
  setActive(startActive);
  (startActive ? loadSearch() : Promise.resolve()).catch(() => {}).finally(() => {
    $('#learn').disabled = false;
    observer = new MutationObserver(records => {
      if (!site.isSearch(new URL(location.href))) return;
      diagnostics.mutations += records.length;
      const relevant = records.some(record => {
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (target?.closest('[data-unshop-owned]')) return false;
        if (target?.closest(selector)) return true;
        return [...record.addedNodes, ...record.removedNodes].some(n => n.nodeType === 1 && !n.matches('[data-unshop-owned]') && (n.matches(selector) || n.querySelector(selector)));
      });
      if (relevant && !timer) timer = setTimeout(scan, 120);
    });
    if (startActive) scan(); else observe();
    ask({ type: 'unshop:health' }).then(h => {
      ai = h?.ok ? 'online' : h?.disabled ? 'off' : 'offline';
      if (h?.ok && h.label) aiLabel = String(h.label).slice(0, 24);
      if (h?.ok && !h.keyConfigured) { ai = 'offline'; lastAiError = h.problem || 'The AI server is running but is not configured.'; }
      render(); maybeAutoScore();
    });
  });
  window.addEventListener('pagehide', () => { observer?.disconnect(); clearTimeout(timer); timer = null; });
  window.addEventListener('pageshow', event => { if (event.persisted) scan(); });
})();
