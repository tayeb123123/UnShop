/* Chrome and Node tests share this one implementation. */
globalThis.UnShopModel = (() => {
  const REASONS = [
    { id: 'too-expensive', label: 'Too expensive', icon: '$' },
    { id: 'too-large', label: 'Too bulky / large', icon: '⤢' },
    { id: 'wrong-style', label: 'Not my style', icon: '✧' },
    { id: 'low-quality', label: 'Looks low quality', icon: '☆' },
    { id: 'low-confidence', label: 'Not enough info', icon: '?' },
    { id: 'other', label: 'Something else', icon: '…' }
  ];
  const emptyState = () => ({ version: 3, dislikes: {}, rejected: {}, events: [], budget: null, compact: false, priceTilt: null, mustHave: [], avoid: [], notes: '', summary: '', query: '', scores: {} });
  const clean = (value, size = 500) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, size) : '';
  const validId = id => typeof id === 'string' && /^[\w-]{1,60}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
  const terms = list => Array.isArray(list) ? [...new Set(list.map(t => clean(t, 40).toLowerCase()).filter(Boolean))].slice(0, 12) : [];
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentions = (title, term) => new RegExp(`(^|[^a-z0-9])${escapeRe(term).replace(/[- ]/g, '[- ]?')}s?([^a-z0-9]|$)`, 'i').test(title);

  function normalizeState(raw) {
    const next = emptyState();
    if (!raw || typeof raw !== 'object') return next;
    next.budget = Number.isFinite(raw.budget) && raw.budget > 0 ? Math.min(raw.budget, 1000000) : null;
    next.compact = raw.compact === true;
    next.priceTilt = ['lower', 'higher'].includes(raw.priceTilt) ? raw.priceTilt : null;
    next.mustHave = terms(raw.mustHave); next.avoid = terms(raw.avoid).filter(t => !next.mustHave.includes(t));
    next.notes = clean(raw.notes, 400); next.summary = clean(raw.summary, 400); next.query = clean(raw.query, 120);
    for (const [id, item] of Object.entries(raw.rejected || {}).slice(-300)) {
      if (!validId(id) || !item || !REASONS.some(r => r.id === item.reason)) continue;
      next.rejected[id] = { title: clean(item.title), reason: item.reason, price: Number.isFinite(item.price) ? item.price : null, at: Number(item.at) || 0 };
      next.dislikes[item.reason] = (next.dislikes[item.reason] || 0) + 1;
    }
    next.events = Array.isArray(raw.events) ? raw.events.slice(-100).filter(e => e && typeof e === 'object').map(e => ({ type: clean(e.type, 20), productId: clean(e.productId, 60), reason: clean(e.reason, 40), note: clean(e.note), at: Number(e.at) || 0 })) : [];
    const scores = Object.entries(raw.scores && typeof raw.scores === 'object' ? raw.scores : {}).filter(([id, s]) => validId(id) && s && Number.isFinite(s.fit)).slice(-120);
    for (const [id, s] of scores) next.scores[id] = { fit: Math.max(0, Math.min(100, Math.round(s.fit))), reason: clean(s.reason, 120), at: Number(s.at) || 0 };
    return next;
  }
  function updatePreferences(state, product, reasonId, note = '') {
    if (!validId(product?.id)) throw new Error('Product identifier is unavailable.');
    if (!REASONS.some(r => r.id === reasonId)) throw new Error('Choose a valid reason.');
    const next = normalizeState(state);
    next.rejected[product.id] = { title: clean(product.title), reason: reasonId, price: Number.isFinite(product.price) ? product.price : null, at: Date.now() };
    next.events.push({ type: 'reject', productId: product.id, reason: reasonId, note: clean(note), at: Date.now() });
    // Local inference that needs no LLM: "too expensive" at $X implies a budget below X.
    if (reasonId === 'too-expensive' && Number.isFinite(product.price) && product.price > 1) {
      const cap = Math.floor(product.price * 0.85);
      if (!next.budget || cap < next.budget) next.budget = cap;
    }
    if (reasonId === 'too-large') next.compact = true;
    // Notes on a rejection describe what was wrong, so they parse as "less of".
    if (note) return parseFeedback(next, note, { polarity: -1 }).state;
    return normalizeState(next);
  }
  function restoreProduct(state, id) {
    const next = normalizeState(state); delete next.rejected[id]; return normalizeState(next);
  }
  /* ---------- Local language parser (works with no LLM) ----------
     Handles casual phrasing: "I want cameras that are more small and digital and cheap",
     "less bulky, nothing over $80", "not too heavy", "smaller and quieter please". */
  const FILLER = /\b(?:i(?:'d| would)?(?: really)? (?:like|want|need|prefer|love)|i'?m (?:looking for|after)|looking for|show me|give me|find me|get me|please|thanks|ideally|preferably|maybe|kind of|kinda|sort of|a (?:bit|little|lot)|bit|lots?|really|very|super|way|much|quite|pretty|rather|somewhat|extra|even|something|anything|stuff|things?|ones?|items?|products?|options?|models?|versions?|that(?:'s| is| are)?|which (?:is|are)|(?:it|they|those|these) (?:should|must|need to|needs to) be|should be|has to be|have to be|needs? to be|to be|can be|could be|i can|i could|so (?:that|i)|one that|ones that)\b/g;
  const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'my', 'me', 'i', 'it', 'its', 'is', 'are', 'be', 'am', 'was', 'some', 'any', 'this', 'that', 'those', 'these', 'more', 'most', 'less', 'least', 'fewer', 'with', 'has', 'have', 'having', 'got', 'get', 'and', 'or', 'but', 'so', 'than', 'then', 'also', 'just', 'only', 'can', 'could', 'should', 'would', 'will', 'do', 'does', 'good', 'great', 'nice', 'better', 'best', 'decent', 'solid', 'kind', 'type', 'style', 'looking', 'one', 'ones', 'like', 'want', 'need', 'too', 'enough', 'bucks', 'dollars', 'usd', 'please', 'don\'t', 'dont', 'not', 'no']);
  const COMPARATIVE = { smaller: 'small', bigger: 'big', larger: 'large', lighter: 'lightweight', heavier: 'heavy', quieter: 'quiet', louder: 'loud', brighter: 'bright', darker: 'dark', faster: 'fast', slower: 'slow', sharper: 'sharp', simpler: 'simple', easier: 'easy', sturdier: 'sturdy', stronger: 'strong', softer: 'soft', thinner: 'thin', slimmer: 'slim', longer: 'long', shorter: 'short', newer: 'new', cheaper: 'cheap', pricier: 'pricey', warmer: 'warm', cooler: 'cool', cleaner: 'clean', plainer: 'plain', flashier: 'flashy', fancier: 'fancy', comfier: 'comfy', tougher: 'tough' };
  const SMALL = new Set(['small', 'compact', 'tiny', 'mini', 'little', 'portable', 'pocket', 'pocketable', 'pocket-sized', 'lightweight', 'light', 'slim', 'thin', 'travel', 'packable', 'foldable']);
  const BIG = new Set(['big', 'large', 'bulky', 'heavy', 'huge', 'chunky', 'thick', 'oversized', 'massive', 'giant']);
  const CHEAP = new Set(['cheap', 'affordable', 'inexpensive', 'budget', 'economical', 'bargain', 'value', 'low-cost', 'low cost', 'lower price', 'low price']);
  const PRICEY = new Set(['pricey', 'expensive', 'costly', 'overpriced', 'premium', 'high-end', 'high end', 'luxury', 'luxurious', 'upscale', 'fancy']);
  const NEG_START = /^(?:(?:i|we|i'd|i would)\s+)?(?:no|not|non|never|nothing|none|without|w\/o|avoid|avoiding|minus|zero|skip|less|fewer|lose|ditch|don'?t (?:want|need|like)|do not (?:want|need|like)|hate|dislike|not so|too|anti)\b\s*/;
  const POS_START = /^(?:more|with|w\/|has|have|having|plus|add|extra|lots of|plenty of|must have|needs?|want|prefer|include|including)\b\s*/;
  const money = s => Number(String(s).replace(/[,$\s]/g, '')) * (/k$/i.test(s) ? 1000 : 1);
  const plural = w => w.endsWith('s') ? w.slice(0, -1) : `${w}s`;
  // Extract and remove price limits. Returns { text, budget (number|null|undefined=no change) }.
  function takeBudget(text, polarity) {
    let budget;
    const NUM = '\\$?\\s*(\\d[\\d,]*(?:\\.\\d{1,2})?k?)';
    const rules = [
      [new RegExp(`(?:between\\s*)?\\$?(\\d[\\d,]*)\\s*(?:-|–|to|and)\\s*${NUM}`, 'i'), m => money(m[2])],                       // $50-$100 / 50 to 100
      [new RegExp(`(?:under|below|less than|cheaper than|no more than|not more than|at most|max(?:imum)?|up to|upto|within|<=?|budget(?: of| is)?|around|about|roughly|~)\\s*${NUM}`, 'i'), m => money(m[1])],
      [new RegExp(`${NUM}\\s*(?:or less|or under|or below|max|maximum|tops|or cheaper|budget)`, 'i'), m => money(m[1])],
      [new RegExp(`(?:over|above|more than|pricier than|>=?)\\s*${NUM}`, 'i'), m => polarity < 0 ? money(m[1]) : undefined] // "less: over $80"
    ];
    for (const [re, value] of rules) {
      const m = text.match(re);
      if (m) { const v = value(m); if (v > 0) budget = Math.min(v, 1000000); text = text.replace(m[0], ' '); }
    }
    if (/\b(?:no budget|any price|price (?:doesn'?t|does not) matter|money(?:'s| is) no object)\b/.test(text)) { budget = null; text = text.replace(/\b(?:no budget|any price|price (?:doesn'?t|does not) matter|money(?:'s| is) no object)\b/g, ' '); }
    return { text, budget };
  }
  function parseFeedback(state, text, { polarity = 1, query = '' } = {}) {
    const next = normalizeState(state), understood = [];
    let t = ` ${clean(text, 600).toLowerCase().replace(/[“”"]/g, '').replace(/[’]/g, "'")} `;
    if (!t.trim()) return { state: next, understood };
    const b = takeBudget(t, polarity); t = b.text;
    if (b.budget !== undefined) { next.budget = b.budget; understood.push(b.budget ? `under $${b.budget}` : 'any price'); }
    if (/\b(?:any size|size (?:doesn'?t|does not) matter)\b/.test(t)) { next.compact = false; understood.push('any size'); t = t.replace(/\b(?:any size|size (?:doesn'?t|does not) matter)\b/g, ' '); }
    const nouns = new Set(clean(query, 120).toLowerCase().split(/[^a-z0-9-]+/).filter(w => w.length > 2).flatMap(w => [w, plural(w)]));
    t = t.replace(/\bcheap(?:ly)?[- ](?:looking|feeling|made|quality|build)\b|\bflimsy\b/g, ' flimsy ');
    t = t.replace(FILLER, ' ').replace(/\bfor (?:my |the |a )?[a-z ]+$/g, ' ');  // drop trailing purpose clauses ("for my commute")
    // Split into phrases at punctuation/conjunctions and before polarity words ("more small less bulky").
    const phrases = t.split(/[,;.!?\n/&+]|\b(?:and|or|but|also|plus|while|yet|though)\b|(?=\b(?:more|less|fewer|no|not|without|with|too)\b)/).map(s => s.trim()).filter(Boolean);
    const add = (list, other, term, label) => {
      if (!term || term.length < 2) return;
      next[other] = next[other].filter(x => x !== term);
      if (!next[list].includes(term)) next[list].push(term);
      understood.push(label ?? `${list === 'mustHave' ? '+' : '−'} ${term}`);
    };
    for (let p of phrases) {
      let sign = polarity;
      let m;
      while ((m = p.match(NEG_START)) || (m = p.match(POS_START))) {
        // Negation always means "avoid", in either box ("no rgb" in Less is still an avoid).
        if (NEG_START.test(p)) sign = -1;
        p = p.slice(m[0].length);
        if (!p) break;
      }
      // "too heavy" is always negative regardless of box.
      const raw = p.split(/[^a-z0-9$'-]+/).filter(Boolean).map(w => COMPARATIVE[w] || w.replace(/'s$/, ''));
      const words = [];
      for (let i = 0; i < raw.length; i++) {
        const w = raw[i];
        if (raw[i + 1] && (CHEAP.has(`${w} ${raw[i + 1]}`) || PRICEY.has(`${w} ${raw[i + 1]}`))) { i++; continue; }  // handled below
        if (SMALL.has(w)) { if (sign > 0) { next.compact = true; understood.push('compact'); } else { next.compact = false; understood.push('any size'); } continue; }
        const describes = raw.slice(i + 1).some(x => !STOP.has(x) && !nouns.has(x) && x.length > 1);  // "huge logo": a feature, not product size
        if (BIG.has(w) && describes) { words.push(w); continue; }
        if (BIG.has(w)) { if (sign < 0) { next.compact = true; add('avoid', 'mustHave', w); } else { next.compact = false; understood.push('bigger'); } continue; }
        if (CHEAP.has(w)) { next.priceTilt = sign > 0 ? 'lower' : 'higher'; understood.push(sign > 0 ? 'cheaper' : 'pricier'); continue; }
        if (PRICEY.has(w)) { next.priceTilt = sign > 0 ? 'higher' : 'lower'; understood.push(sign > 0 ? 'pricier' : 'cheaper'); continue; }
        if (w.length < 2 || STOP.has(w) || nouns.has(w) || /^\$?\d+(?:\.\d+)?$/.test(w)) continue;
        words.push(w);
      }
      for (const two of [p.match(/\b(low[- ]cost|lower price|low price|high[- ]end)\b/)?.[1]].filter(Boolean)) {
        const up = PRICEY.has(two) ? sign > 0 : sign < 0;
        next.priceTilt = up ? 'higher' : 'lower'; understood.push(up ? 'pricier' : 'cheaper');
      }
      const term = words.slice(0, 3).join(' ');
      if (term) add(sign > 0 ? 'mustHave' : 'avoid', sign > 0 ? 'avoid' : 'mustHave', term);
    }
    next.mustHave = next.mustHave.slice(-12); next.avoid = next.avoid.slice(-12);
    if (understood.length) next.scores = {};  // scores were for the old preferences
    return { state: normalizeState(next), understood: [...new Set(understood)] };
  }
  // Two-box input: what the shopper wants more of, and less of.
  function refineMoreLess(state, more = '', less = '', query = '') {
    const a = parseFeedback(state, more, { polarity: 1, query });
    const b = parseFeedback(a.state, less, { polarity: -1, query });
    return { state: b.state, understood: [...new Set([...a.understood, ...b.understood])] };
  }
  function refinePreferences(state, text, query = '') { return parseFeedback(state, text, { polarity: 1, query }).state; }
  // Merge a validated AI response into state.
  function applyAnalysis(state, result) {
    const next = normalizeState(state);
    const p = result?.preferences || {};
    next.budget = Number.isFinite(p.budget) && p.budget > 0 ? p.budget : null;
    next.compact = p.compact === true;
    next.priceTilt = ['lower', 'higher'].includes(p.priceTilt) ? p.priceTilt : null;
    // Size and price live in their own fields; don't also show them as feature chips.
    const flag = t => ['small', 'smaller', 'compact', 'compact size', 'tiny', 'little', 'cheap', 'cheaper', 'affordable', 'inexpensive', 'budget', 'low cost', 'low price', 'expensive', 'pricey'].includes(t);
    next.mustHave = terms(p.mustHave).filter(t => !flag(t)); next.avoid = terms(p.avoid).filter(t => !flag(t));
    next.notes = clean(p.notes, 400); next.summary = clean(result?.summary, 400); next.query = clean(result?.searchQuery, 120);
    const now = Date.now();
    for (const s of Array.isArray(result?.products) ? result.products : []) if (validId(s.id) && Number.isFinite(s.fit)) next.scores[s.id] = { fit: s.fit, reason: clean(s.reason, 120), at: now };
    return normalizeState(next);
  }
  function removePreference(state, kind, value) {
    const next = normalizeState(state);
    if (kind === 'budget') next.budget = null;
    else if (kind === 'compact') next.compact = false;
    else if (kind === 'priceTilt') next.priceTilt = null;
    else if (kind === 'mustHave' || kind === 'avoid') next[kind] = next[kind].filter(t => t !== value);
    next.scores = {};  // stale once preferences change
    return normalizeState(next);
  }
  // ctx.median: median visible price, used for "cheaper"/"pricier" without a number.
  function evaluate(product, state, ctx = {}) {
    if (Object.hasOwn(state.rejected, product.id)) return { score: -1000, fit: 0, reasons: ['You passed on this'], rejected: true, tone: 'rejected' };
    const conflicts = [], matches = [];
    const title = product.title || '';
    if (state.budget && Number.isFinite(product.price) && product.price > state.budget) conflicts.push(`Over your $${state.budget} budget`);
    else if (state.budget && Number.isFinite(product.price)) matches.push(`Within $${state.budget}`);
    if (state.compact && /\b(bulky|large|over[- ]ear|heavy|oversized|xl)\b/i.test(title)) conflicts.push('Looks large');
    if (state.compact && /\b(compact|mini|small|earbuds|in[- ]ear|portable|foldable|lightweight|slim)\b/i.test(title)) matches.push('Compact');
    let tilt = 0;
    if (state.priceTilt && Number.isFinite(product.price) && ctx.median > 0) {
      const cheaper = product.price <= ctx.median * 0.9, pricier = product.price >= ctx.median * 1.15;
      if (state.priceTilt === 'lower' && cheaper) { tilt = 12; matches.push('Cheaper than most here'); }
      if (state.priceTilt === 'lower' && pricier) { tilt = -12; }
      if (state.priceTilt === 'higher' && pricier) { tilt = 12; matches.push('Higher-end than most here'); }
      if (state.priceTilt === 'higher' && cheaper) { tilt = -12; }
    }
    for (const t of state.avoid) if (mentions(title, t)) conflicts.push(`Has “${t}”`);
    for (const t of state.mustHave) if (mentions(title, t)) matches.push(`Has “${t}”`);
    const ai = state.scores[product.id];
    const local = 50 + matches.filter(x => !x.startsWith('Cheaper') && !x.startsWith('Higher')).length * 12 - conflicts.length * 25 + tilt;
    const overBudget = Boolean(state.budget && Number.isFinite(product.price) && product.price > state.budget);
    const blended = ai ? Math.round(ai.fit * 0.75 + local * 0.25) - (conflicts.length ? 10 : 0) : local;
    // A stated budget is a hard limit: over-budget items never rank as good fits.
    const fit = Math.max(0, Math.min(overBudget ? 25 : 100, blended));
    const reasons = [];
    if (ai?.reason) reasons.push(ai.reason);
    reasons.push(...conflicts, ...matches);
    if (!reasons.length) reasons.push('No known conflicts yet');
    const tone = conflicts.length ? 'conflict' : fit >= 70 ? 'good' : 'neutral';
    return { score: fit, fit, reasons: [...new Set(reasons)].slice(0, 3), rejected: false, tone, ai: Boolean(ai), conflicts, matches };
  }
  function scoreProduct(product, state) { return evaluate(product, normalizeState(state)).score; }
  function explain(product, state) { return evaluate(product, normalizeState(state)).reasons.join(' · '); }
  function refineQuery(query, state) {
    if (state.query) return clean(state.query, 200);
    let result = clean(query, 200);
    if (state.compact && !/\b(compact|smaller|small|portable)\b/i.test(result)) result += ' compact';
    for (const t of state.mustHave.slice(0, 2)) if (!result.toLowerCase().includes(t)) result += ` ${t}`;
    return result.trim();
  }
  /* ---------- Search identity ----------
     Preferences are saved per store + search. Searches are compared by their canonical form,
     so "Wireless Headphones", "headphones wireless" and "wireless headphone" are the same search. */
  const SEARCH_PREFIX = 'unshopQ:';
  const normQuery = q => (typeof q === 'string' ? q : '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
  const QUERY_STOP = new Set(['a', 'an', 'the', 'for', 'with', 'and', 'or', 'of', 'in', 'on', 'to', 'my', 'me', 'by', 'from', 'w', 'buy', 'shop', 'sale', 'best', 'top', 'new']);
  function singular(w) {
    if (w.length <= 3 || /(ss|us|is)$/.test(w)) return w;
    if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
    if (/(ches|shes|xes|zes|sses)$/.test(w)) return w.slice(0, -2);
    return w.endsWith('s') ? w.slice(0, -1) : w;
  }
  function queryTokens(q) {
    return [...new Set(normQuery(q).replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(w => w && !QUERY_STOP.has(w)).map(singular))].sort();
  }
  const canonicalQuery = q => queryTokens(q).join(' ').slice(0, 120);
  function searchKey(siteId, query, fallback = '') {
    const c = canonicalQuery(query);
    return `${SEARCH_PREFIX}${siteId}:${c || `browse:${String(fallback).slice(0, 100)}`}`;
  }
  const legacySearchKey = query => (normQuery(query) ? SEARCH_PREFIX + normQuery(query) : null);  // pre-multi-store Amazon keys
  // Overlap of two searches' words (Jaccard). 1 = same words, 0 = nothing shared.
  function querySimilarity(a, b) {
    const A = new Set(queryTokens(a)), B = new Set(queryTokens(b));
    if (!A.size || !B.size) return 0;
    let shared = 0; for (const w of A) if (B.has(w)) shared++;
    return shared / (A.size + B.size - shared);
  }
  // The thing being bought: last word before any "for/with/under…" clause.
  // "wireless headphones" → headphone, "camera bag" → bag, "shoes for running" → shoe.
  function headNoun(q) {
    const main = normQuery(q).split(/\b(?:for|with|without|under|below|from|by|in|on|that|to)\b/)[0];
    const words = main.replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(w => w && !QUERY_STOP.has(w) && !/^\d+$/.test(w));
    return words.length ? singular(words[words.length - 1]) : '';
  }
  // How related two searches are, 0–1. Same product noun counts most ("bluetooth headphones" ≈
  // "wireless headphones"); sharing words around a different noun doesn't ("camera" ≠ "camera bag").
  function relatedness(a, b) {
    const overlap = querySimilarity(a, b), ha = headNoun(a), hb = headNoun(b);
    if (!ha || !hb) return overlap;         // no clear noun (e.g. only a model number): fall back to word overlap
    return ha === hb ? 0.5 + overlap / 2 : 0;
  }
  // Pick the most similar saved search that actually has preferences. Exact same search on the
  // same store is excluded (that one loads automatically). Everything else needs the shopper's OK.
  function findSimilar(query, currentKey, saved, threshold = 0.5) {
    let best = null;
    for (const [k, raw] of Object.entries(saved || {})) {
      if (!k.startsWith(SEARCH_PREFIX) || k === currentKey || !raw?.queryText) continue;
      const st = normalizeState(raw);
      if (!(st.budget || st.compact || st.priceTilt || st.mustHave.length || st.avoid.length)) continue;
      const score = relatedness(query, raw.queryText);
      if (score < threshold) continue;
      const cand = { key: k, score, queryText: String(raw.queryText).slice(0, 80), site: String(raw.site || ''), savedAt: Number(raw.savedAt) || 0, state: st };
      if (!best || cand.score > best.score || (cand.score === best.score && cand.savedAt > best.savedAt)) best = cand;
    }
    return best;
  }
  // Bring over what the shopper *said* (budget, size, price, features). Rejections and scores are
  // tied to specific products on another page, so they stay behind.
  function importPreferences(state, from, summary = '') {
    const next = normalizeState(state), src = normalizeState(from);
    for (const k of ['budget', 'compact', 'priceTilt', 'notes']) next[k] = src[k];
    next.mustHave = [...new Set([...next.mustHave, ...src.mustHave])];
    next.avoid = [...new Set([...next.avoid, ...src.avoid])].filter(t => !next.mustHave.includes(t));
    next.scores = {}; next.query = ''; next.summary = clean(summary, 400);
    return normalizeState(next);
  }
  function hasPreferences(state) {
    return Boolean(state.budget || state.compact || state.priceTilt || state.mustHave.length || state.avoid.length || Object.keys(state.rejected).length);
  }
  return { SEARCH_PREFIX, searchKey, legacySearchKey, normQuery, canonicalQuery, queryTokens, querySimilarity, headNoun, relatedness, findSimilar, importPreferences, REASONS, emptyState, normalizeState, updatePreferences, restoreProduct, refinePreferences, refineMoreLess, parseFeedback, applyAnalysis, removePreference, evaluate, scoreProduct, explain, refineQuery, hasPreferences };
})();
