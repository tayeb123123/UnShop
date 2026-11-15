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
:host{all:initial;--ink:#13241b;--ink2:#46594d;--mute:#7b8b80;--line:#e4e9e3;--bg:#ffffff;--soft:#f4f7f1;--lime:#c9f16b;--lime2:#e9fbc4;--green:#2f7d4f;--coral:#d4492f;--coral2:#fdece7;--amber:#a86a00;--amber2:#fff4dc;
  font:13.5px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);position:fixed;right:18px;top:84px;z-index:2147483640;-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}button,input,textarea{font:inherit;color:inherit}button{cursor:pointer}button:disabled{opacity:.45;cursor:default}
:focus-visible{outline:2px solid var(--green);outline-offset:2px}
.panel{width:360px;max-width:calc(100vw - 28px);max-height:calc(100vh - 100px);display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--line);border-radius:18px;box-shadow:0 18px 50px -12px rgba(19,36,27,.28),0 2px 6px rgba(19,36,27,.06);overflow:hidden}
.hidden{display:none!important}
header{display:flex;align-items:center;gap:10px;padding:14px 14px 12px 16px;border-bottom:1px solid var(--line)}
.mark{width:32px;height:32px;border-radius:10px;background:var(--ink);color:var(--lime);display:grid;place-items:center;font-weight:800;font-size:15px;letter-spacing:-.5px;flex:none}
.brand{line-height:1.15}.brand b{font-size:15px;letter-spacing:-.2px}.brand small{display:block;color:var(--mute);font-size:11.5px}
.pill{margin-left:auto;display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:99px;background:var(--soft);font-size:11px;font-weight:600;color:var(--ink2);white-space:nowrap}
.dot{width:7px;height:7px;border-radius:50%;background:#b8c2bb}.pill[data-s=online] .dot{background:#34a853}.pill[data-s=thinking] .dot{background:#7cc242;animation:pulse 1s infinite}.pill[data-s=offline] .dot{background:#e0a03a}
@keyframes pulse{50%{opacity:.25}}
.icon{border:0;background:transparent;width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--ink2);font-size:18px;line-height:1}.icon:hover{background:var(--soft)}
.scroll{overflow:auto;padding:14px 16px 4px}
.bubble{background:var(--soft);border-radius:4px 14px 14px 14px;padding:10px 12px;font-size:13px;color:var(--ink2);margin-bottom:12px}
.suggest{border:1px solid #c9f16b;background:#f7fde9;border-radius:14px;padding:10px 12px;margin-bottom:10px;font-size:12.5px;color:var(--ink2)}.suggest p{margin:0 0 8px}.suggest b{color:var(--ink)}.suggest-row{display:flex;gap:6px}
.bubble b{color:var(--ink)}.bubble.err{background:var(--amber2);color:#6b4a07}
.bubble.wait{background:linear-gradient(90deg,var(--soft),#e9fbc4,var(--soft));background-size:200% 100%;animation:shimmer 1.4s linear infinite;color:var(--ink)}
@keyframes shimmer{to{background-position:-200% 0}}
.ask{display:flex;flex-direction:column;gap:6px}
.field{display:flex;align-items:flex-start;gap:8px;border:1px solid var(--line);border-radius:12px;padding:6px 6px 6px 8px;background:#fff;transition:border-color .15s,box-shadow .15s}
.field.more:focus-within{border-color:#9fc77a;box-shadow:0 0 0 3px #c9f16b55}.field.less:focus-within{border-color:#ee9f8e;box-shadow:0 0 0 3px #fdece7}
.sign{flex:none;width:44px;height:24px;border-radius:7px;display:grid;place-items:center;font-size:11px;font-weight:750;letter-spacing:.02em;margin-top:2px}
.more .sign{background:var(--lime2);color:#2c4a12}.less .sign{background:var(--coral2);color:#8c2a17}
.field textarea{flex:1;border:0;resize:none;min-height:28px;max-height:96px;padding:4px 2px;outline:0;background:transparent;font-size:13px;line-height:1.4}
.ask-row{display:flex;align-items:center;gap:6px;padding:0 0 0 2px}
.chip.m{border-color:#d6efa8}.chip.l{border-color:#f6cdc3}
.ask-row small{color:var(--mute);font-size:11px;margin-right:auto}
.go{border:0;background:var(--ink);color:#fff;font-weight:650;border-radius:10px;padding:7px 13px;display:inline-flex;align-items:center;gap:6px}.go:hover:not(:disabled){background:#24402f}
.spin{width:12px;height:12px;border:2px solid #ffffff55;border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 2px}
.chip{border:1px solid var(--line);background:#fff;border-radius:99px;padding:4px 10px;font-size:12px;color:var(--ink2)}.chip:hover{border-color:#b9c9b9;background:var(--soft)}
h3{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin:18px 0 8px;font-weight:700;display:flex;align-items:center;gap:8px}
h3 span{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:500}
.prefs{display:flex;flex-wrap:wrap;gap:6px}
.pref{display:inline-flex;align-items:center;gap:4px;border-radius:99px;padding:3px 4px 3px 10px;font-size:12px;font-weight:600;background:var(--lime2);color:#2c4a12}
.pref.neg{background:var(--coral2);color:#8c2a17}.pref.info{background:var(--soft);color:var(--ink2)}
.pref button{border:0;background:transparent;width:18px;height:18px;border-radius:50%;font-size:13px;line-height:1;color:inherit;opacity:.6;padding:0}.pref button:hover{opacity:1;background:#0000000f}
.empty{color:var(--mute);font-size:12.5px;margin:0}
.notes{font-size:12px;color:var(--ink2);margin:8px 0 0;font-style:italic}
ol{list-style:none;margin:0;padding:0}
.item{display:grid;grid-template-columns:48px 1fr;gap:10px;padding:9px 6px;border-radius:12px;cursor:pointer;border:0;background:transparent;text-align:left;width:100%}
.item:hover{background:var(--soft)}
.thumb{width:48px;height:48px;border-radius:9px;background:var(--soft);object-fit:contain;display:block}
.t{font-size:12.5px;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.meta{display:flex;align-items:center;gap:8px;margin-top:4px;font-size:11.5px;color:var(--ink2)}
.price{font-weight:700;color:var(--ink)}
.bar{flex:1;height:5px;background:#edf0ec;border-radius:9px;overflow:hidden;max-width:80px}.bar i{display:block;height:100%;background:var(--green);border-radius:9px}
.bar.warn i{background:#e0a03a}
.why{font-size:11.5px;color:var(--mute);margin-top:2px}
.why.neg{color:var(--coral)}
.search{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:14px 0 6px;padding:10px 12px;border-radius:12px;background:var(--ink);color:#fff;text-decoration:none;font-weight:600;font-size:12.5px}
.search:hover{background:#24402f}.search span{opacity:.75;font-weight:500}
footer{display:flex;align-items:center;gap:4px;padding:8px 10px;border-top:1px solid var(--line);font-size:12px;color:var(--mute)}
.ghost{border:0;background:transparent;border-radius:8px;padding:5px 8px;color:var(--ink2);font-size:12px}.ghost:hover:not(:disabled){background:var(--soft)}
footer .sp{margin-left:auto}
.hp{display:flex;align-items:center;gap:8px;margin:0 0 8px;padding:8px 10px;border-radius:12px;background:var(--soft);font-size:12.5px;font-weight:600;cursor:pointer}
.hp input{position:absolute;opacity:0;pointer-events:none}
.sw{width:30px;height:18px;border-radius:99px;background:#cdd5ce;position:relative;flex:none;transition:background .15s}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px #0003;transition:transform .15s}
.hp input:checked+.sw{background:var(--green)}.hp input:checked+.sw::after{transform:translateX(12px)}
.hp input:focus-visible+.sw{outline:2px solid var(--green);outline-offset:2px}
.hp small{margin-left:auto;color:var(--mute);font-weight:500}
.status{font-size:12px;color:var(--green);min-height:0;margin:8px 0 0}.status:empty{display:none}
.launcher{display:flex;align-items:center;gap:8px;border:1px solid var(--line);background:#fff;border-radius:99px;padding:6px 14px 6px 6px;box-shadow:0 10px 30px -8px rgba(19,36,27,.3);font-weight:650}
.launcher .mark{width:28px;height:28px;border-radius:50%;font-size:13px}.launcher small{color:var(--mute);font-weight:500}
dialog{border:0;border-radius:20px;padding:0;width:420px;max-width:calc(100vw - 28px);color:var(--ink);background:#fff;box-shadow:0 30px 80px -10px rgba(19,36,27,.45)}
dialog::backdrop{background:rgba(19,36,27,.38);backdrop-filter:blur(2px)}
dialog form{padding:20px}
.dh{display:flex;gap:12px;align-items:center;margin-bottom:14px}
.dh img,.dh .thumb{width:56px;height:56px;border-radius:12px;flex:none}
.dh h2{font-size:17px;margin:0 0 2px;letter-spacing:-.2px}.dh p{margin:0;font-size:12px;color:var(--ink2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.close{margin-left:auto;align-self:flex-start}
fieldset{border:0;padding:0;margin:0}legend{font-size:12px;font-weight:650;color:var(--ink2);margin-bottom:8px}
.reasons{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.reasons label{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:12px;padding:9px 10px;font-size:12.5px;font-weight:600;cursor:pointer}
.reasons label:hover{background:var(--soft)}.reasons input{position:absolute;opacity:0;pointer-events:none}
.reasons label:has(input:checked){border-color:var(--ink);background:var(--soft);box-shadow:inset 0 0 0 1px var(--ink)}
.reasons label:has(input:focus-visible){outline:2px solid var(--green);outline-offset:2px}
.ri{width:22px;height:22px;border-radius:7px;background:var(--soft);display:grid;place-items:center;font-size:12px;flex:none}
.note-label{display:block;font-size:12px;font-weight:650;color:var(--ink2);margin:14px 0 6px}
.note{width:100%;min-height:64px;border:1px solid var(--line);border-radius:12px;padding:9px 11px;resize:vertical;outline:0}.note:focus{border-color:#9fc77a;box-shadow:0 0 0 3px #c9f16b55}
.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
.error{color:var(--coral);font-size:12px;margin:8px 0 0}.error:empty{display:none}
.hint{font-size:11.5px;color:var(--mute);margin:8px 0 0}
`;
  root.append(style);
  const wrap = document.createElement('div');
  wrap.innerHTML = `
<button class="launcher hidden" type="button" aria-label="Open UnShop"><span class="mark">u−</span>UnShop <small class="lc"></small></button>
<section class="panel" aria-label="UnShop shopping preferences">
  <header><span class="mark" aria-hidden="true">u−</span><div class="brand"><b>UnShop</b><small class="scope"></small></div>
    <span class="pill" data-s="checking" role="status"><span class="dot"></span><span class="pl">Checking AI…</span></span>
    <button class="icon collapse" type="button" aria-label="Minimize UnShop" title="Minimize">–</button></header>
  <div class="scroll">
    <div class="suggest hidden" role="group" aria-label="Preferences from a similar search"><p></p><div class="suggest-row"><button class="go" id="useSimilar" type="button">Use them</button><button class="ghost" id="dismissSimilar" type="button">Start fresh</button></div></div>
    <div class="bubble" aria-live="polite"></div>
    <div class="ask">
      <div class="field more"><span class="sign" aria-hidden="true">MORE</span><textarea id="more" aria-label="More of" maxlength="500" rows="1" placeholder="smaller, digital, cheaper…"></textarea></div>
      <div class="field less"><span class="sign" aria-hidden="true">LESS</span><textarea id="less" aria-label="Less of" maxlength="500" rows="1" placeholder="bulky, flashy, over $80…"></textarea></div>
      <div class="ask-row"><small class="mode-hint"></small><button class="go" id="learn" type="button">Refine</button></div></div>
    <div class="chips suggestions"></div>
    <p class="status" role="status"></p>
    <h3>What I’ve learned</h3><div class="prefs"></div><p class="notes hidden"></p>
    <h3>Best fits on this page <span class="count"></span></h3>
    <label class="hp"><input type="checkbox" id="hidePoor"><span class="sw" aria-hidden="true"></span><span>Hide poor fits on the page</span><small class="hc"></small></label>
    <ol class="ranked"></ol>
    <a class="search" id="search" target="_blank" rel="noopener noreferrer"></a>
  </div>
  <footer><button class="ghost" id="undo" type="button">↶ Undo</button><button class="ghost" id="reset" type="button">Reset</button><span class="sp"></span><button class="ghost" id="settings" type="button">Settings</button></footer>
</section>`;
  root.append(...wrap.children);
  document.body.append(host);
  const $ = s => root.querySelector(s);
  const panel = $('.panel'), launcher = $('.launcher');
  let statusTimer;
  const status = (message, tone = 'ok') => { const el = $('.status'); el.textContent = message; el.style.color = tone === 'err' ? 'var(--coral)' : ''; clearTimeout(statusTimer); if (message) statusTimer = setTimeout(() => { el.textContent = ''; }, 6000); };
  const money = p => Number.isFinite(p) ? `$${p.toFixed(2)}` : 'Price n/a';

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
    card.classList.remove('unshop-card', 'unshop-dimmed', 'unshop-better', 'unshop-conflict', 'unshop-hidden');
    cards.delete(card);
  }
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
        if (entry.ui.parentElement !== card) card.prepend(entry.ui);
      }
      diagnostics.cards = cards.size; render();
    });
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
    const el = document.createElement('span'); el.className = `pref ${cls}`; el.textContent = label;
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
      const bubble = $('.bubble'); bubble.classList.remove('err');
      if (state.summary) bubble.textContent = state.summary;
      else if (!active) bubble.innerHTML = '<b>Not sure what you want?</b> Start with what you don’t. Hit <b>✕ Not for me</b> on any result, or tell me what you want <b>more</b> or <b>less</b> of below.';
      else bubble.textContent = `${rejectedCount ? `Learning from ${rejectedCount} pass${rejectedCount === 1 ? '' : 'es'}.` : 'Using what you told me.'} Results that fit are outlined in green; conflicts in amber.`;
      if (ai === 'offline' && lastAiError) { bubble.classList.add('err'); bubble.textContent = `${lastAiError} Using local rules for now.`; }
      // Learned prefs
      const prefs = $('.prefs'); prefs.replaceChildren();
      if (state.budget) prefs.append(pref(`Under $${state.budget}`, '', 'budget'));
      if (state.compact) prefs.append(pref('Compact', '', 'compact'));
      if (state.priceTilt) prefs.append(pref(state.priceTilt === 'lower' ? 'Cheaper' : 'Higher-end', '', 'priceTilt'));
      for (const t of state.mustHave) prefs.append(pref(`+ ${t}`, '', 'mustHave', t));
      for (const t of state.avoid) prefs.append(pref(`− ${t}`, 'neg', 'avoid', t));
      if (rejectedCount) { const el = document.createElement('span'); el.className = 'pref info'; el.textContent = `${rejectedCount} passed`; el.style.paddingRight = '10px'; prefs.append(el); }
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
        card.classList.toggle('unshop-hidden', hidePoor && poor);
        const label = r.rejected ? '↶ Restore' : '✕ Not for me';
        if (entry.button.textContent !== label) entry.button.textContent = label;
        entry.button.setAttribute('aria-label', `${r.rejected ? 'Restore' : 'Not for me'}: ${entry.product.title}`);
        entry.button.dataset.state = r.rejected ? 'rejected' : 'active';
        let badge = '';
        if (r.rejected) badge = `You passed on: ${entry.product.title}`;
        else if (active && r.ai) badge = `${r.fit}% fit`;
        else if (active && r.conflicts.length) badge = r.conflicts[0];
        else if (active && r.matches.length) badge = `✓ ${r.matches[0]}`;
        if (entry.badge.textContent !== badge) entry.badge.textContent = badge;
        entry.badge.dataset.tone = r.tone; entry.badge.hidden = !badge;
        entry.badge.title = r.reasons.join(' · ');
        if (!r.rejected) ranked.push({ card, entry, r });
      }
      ranked.sort((a, b) => b.r.score - a.r.score);
      $('#hidePoor').checked = hidePoor;
      $('.hc').textContent = !active ? 'learn something first' : poorCount ? `${poorCount} ${hidePoor ? 'hidden' : 'below ' + POOR_FIT + '%'}` : 'none right now';
      const list = $('.ranked'); list.replaceChildren();
      $('.count').textContent = cards.size ? `${ranked.length} of ${cards.size}` : '';
      for (const { card, entry, r } of ranked.slice(0, 5)) {
        const li = document.createElement('li'), item = document.createElement('button');
        item.type = 'button'; item.className = 'item'; item.title = 'Show this result on the page';
        const img = document.createElement(entry.product.image ? 'img' : 'span'); img.className = 'thumb';
        if (entry.product.image) { img.src = entry.product.image; img.alt = ''; }
        const body = document.createElement('div');
        const t = document.createElement('div'); t.className = 't'; t.textContent = entry.product.title;
        const meta = document.createElement('div'); meta.className = 'meta';
        const price = document.createElement('span'); price.className = 'price'; price.textContent = money(entry.product.price);
        const bar = document.createElement('span'); bar.className = `bar${r.tone === 'conflict' ? ' warn' : ''}`; const fill = document.createElement('i'); fill.style.width = `${r.fit}%`; bar.append(fill);
        const pct = document.createElement('span'); pct.textContent = `${r.fit}%`;
        meta.append(price, bar, pct);
        const why = document.createElement('div'); why.className = `why${r.tone === 'conflict' ? ' neg' : ''}`; why.textContent = r.reasons.slice(0, 2).join(' · ');
        body.append(t, meta, why); item.append(img, body);
        item.onclick = () => { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); paused(() => card.classList.add('unshop-flash')); setTimeout(() => paused(() => card.classList.remove('unshop-flash')), 1600); };
        li.append(item); list.append(li);
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
    const s = document.createElement('span'); s.textContent = `${demo ? 'Amazon' : site.label} ↗`; a.append(s);
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
    const close = () => { dialog.close(); dialog.remove(); if (entry.button.isConnected) entry.button.focus({ preventScroll: true }); };
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
  function setCollapsed(value, save = true) {
    collapsed = value; panel.classList.toggle('hidden', value); launcher.classList.toggle('hidden', !value);
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
      if (ok) { clearBoxes(); status(`Updated with ${aiLabel}.`); return; }
    }
    const { state: next, understood } = M.refineMoreLess(state, more, less, query());
    if (!understood.length) { status('I couldn’t pick out a feature there. Try short words like “smaller”, “metal”, “under $60”.', 'err'); return; }
    if (await commit(next, `Got it: ${understood.join(', ')}.`)) clearBoxes();
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
