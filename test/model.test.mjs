import test from 'node:test';
import assert from 'node:assert/strict';
import { refineMoreLess, searchKey, emptyState, normalizeState, updatePreferences, restoreProduct, refinePreferences, applyAnalysis, removePreference, evaluate, refineQuery } from '../src/model.js';

test('legacy or malformed storage becomes safe structured state', () => {
  const state = normalizeState({ rejected: { A: { title: 'Legacy', reason: 'too-large' }, B: null, C: { reason: 'made-up' } }, budget: 'NaN', events: 'broken', mustHave: 'x', scores: { A: { fit: 'no' } } });
  assert.equal(state.version, 3); assert.equal(state.dislikes['too-large'], 1);
  assert.deepEqual(Object.keys(state.rejected), ['A']); assert.equal(state.budget, null); assert.deepEqual(state.events, []);
  assert.deepEqual(state.mustHave, []); assert.deepEqual(state.scores, {});
});
test('feedback is immutable, deduplicated and reversible', () => {
  const original = emptyState(), product = { id: 'A', title: '<script>visible text</script>' };
  const once = updatePreferences(original, product, 'wrong-style', 'Please make smaller');
  const twice = updatePreferences(once, product, 'wrong-style');
  assert.equal(twice.dislikes['wrong-style'], 1); assert.deepEqual(original, emptyState());
  assert.deepEqual(restoreProduct(twice, 'A').rejected, {});
  assert.throws(() => updatePreferences(original, product, 'invalid'));
});
test('rejections infer budget, size and avoid terms locally', () => {
  let s = updatePreferences(emptyState(), { id: 'A', title: 'Big headphones', price: 200 }, 'too-expensive');
  assert.equal(s.budget, 170);
  s = updatePreferences(s, { id: 'B', title: 'Huge', price: 100 }, 'too-large', 'too heavy, no rgb lights');
  assert.equal(s.compact, true); assert.ok(s.avoid.includes('heavy')); assert.ok(s.avoid.includes('rgb lights'));
});
test('typed requests set budget, compact, must-have and avoid', () => {
  const state = refinePreferences(emptyState(), 'smaller headphones under $80, no over-ear, with noise cancelling');
  assert.equal(state.budget, 80); assert.equal(state.compact, true);
  assert.ok(state.avoid.includes('over-ear')); assert.ok(state.mustHave.includes('noise cancelling'));
  assert.ok(evaluate({ id: 'B', title: 'Compact noise cancelling earbuds', price: 49 }, state).score > evaluate({ id: 'C', title: 'Large over-ear headphones', price: 169 }, state).score);
  assert.equal(refinePreferences(emptyState(), "I don't want smaller headphones").compact, false);
  assert.equal(refinePreferences(state, 'any price, any size').budget, null);
});
test('More/Less parser handles casual, varied phrasing', () => {
  const cases = [
    ['I want cameras that are more small and digital and cheap', '', 'cameras', { compact: true, priceTilt: 'lower', mustHave: ['digital'], avoid: [] }],
    ['', 'bulky, flashy, nothing over $80', 'cameras', { budget: 80, compact: true, avoid: ['bulky', 'flashy'] }],
    ['smaller and quieter please, with noise cancelling', 'not too heavy', 'headphones', { compact: true, mustHave: ['quiet', 'noise cancelling'], avoid: ['heavy'] }],
    ["I'd like a lighter one with long battery life under 60 bucks", 'RGB lights and plastic', 'mouse', { budget: 60, compact: true, mustHave: ['long battery life'], avoid: ['rgb lights', 'plastic'] }],
    ['Less plastic, more metal. Under 200', '', 'watch', { budget: 200, mustHave: ['metal'], avoid: ['plastic'] }],
    ['between $50 and $100', '', '', { budget: 100 }],
    ['high-end, leather', 'cheap looking stuff', 'wallet', { priceTilt: 'higher', mustHave: ['leather'], avoid: ['flimsy'] }],
    ['', 'the ones with the huge logo', '', { compact: false, avoid: ['huge logo'] }],
    ['waterproof, maybe 4k', '', 'action camera', { mustHave: ['waterproof', '4k'] }]
  ];
  for (const [more, less, query, expected] of cases) {
    const { state, understood } = refineMoreLess(emptyState(), more, less, query);
    assert.ok(understood.length, `${more}|${less} understood something`);
    for (const [k, v] of Object.entries(expected)) assert.deepEqual(state[k], v, `${more}|${less} → ${k}`);
  }
  assert.deepEqual(refineMoreLess(emptyState(), 'the', '', '').understood, []);
});
test('cheaper without a number prefers below-median prices', () => {
  const { state } = refineMoreLess(emptyState(), 'cheaper', '', '');
  const ctx = { median: 100 };
  assert.ok(evaluate({ id: 'A', title: 'Thing', price: 60 }, state, ctx).fit > evaluate({ id: 'B', title: 'Thing', price: 150 }, state, ctx).fit);
});
test('Claude analysis merges, ranks and can be edited', () => {
  const s = applyAnalysis(emptyState(), { preferences: { budget: 90, compact: true, mustHave: ['Foldable'], avoid: ['rgb'], notes: 'Quiet look' }, searchQuery: 'foldable compact headphones', summary: 'You like small things.', products: [{ id: 'A', fit: 91, reason: 'Small and foldable' }, { id: '__proto__', fit: 1 }] });
  assert.deepEqual(s.mustHave, ['foldable']); assert.equal(s.scores.A.fit, 91); assert.equal(Object.hasOwn(s.scores, '__proto__'), false);
  const good = evaluate({ id: 'A', title: 'Foldable compact headphones', price: 60 }, s);
  const bad = evaluate({ id: 'Z', title: 'RGB gaming headset', price: 120 }, s);
  assert.ok(good.fit > 80 && good.ai); assert.equal(bad.tone, 'conflict'); assert.equal(good.reasons[0], 'Small and foldable');
  assert.equal(refineQuery('headphones', s), 'foldable compact headphones');
  const stale = applyAnalysis(s, { preferences: { budget: 50, compact: true, mustHave: ['foldable'], avoid: [] }, products: [] });
  assert.ok(evaluate({ id: 'A', title: 'Foldable compact headphones', price: 60 }, stale).fit <= 25, 'over budget caps a stale high score');
  const edited = removePreference(s, 'avoid', 'rgb');
  assert.deepEqual(edited.avoid, []); assert.deepEqual(edited.scores, {});
});
test('query refinement is idempotent without AI query', () => {
  const state = refinePreferences(emptyState(), 'compact under $80');
  assert.equal(refineQuery(refineQuery('headphones', state), state), 'headphones compact');
  assert.equal(refineQuery('headphones', updatePreferences(emptyState(), { id: 'A' }, 'too-expensive')), 'headphones');
});
test('feedback and rejection history stay bounded', () => {
  let state = emptyState();
  for (let i = 0; i < 350; i++) state = updatePreferences(state, { id: `P${i}`, title: 'Product' }, 'other', 'x'.repeat(2000));
  assert.equal(Object.keys(state.rejected).length, 300); assert.equal(state.events.length, 100); assert.equal(state.events.at(-1).note.length, 500);
});
test('each search gets its own storage key; budget filter and casing do not split it', () => {
  assert.equal(searchKey('https://www.amazon.com/s?k=Wireless++Headphones&page=2'), 'unshopQ:wireless headphones');
  assert.equal(searchKey('https://www.amazon.com/s?k=wireless%20headphones&rh=p_36%3A-8000'), 'unshopQ:wireless headphones');
  assert.notEqual(searchKey('https://www.amazon.com/s?k=speakers'), searchKey('https://www.amazon.com/s?k=headphones'));
  assert.equal(searchKey('https://www.amazon.com/s?i=electronics&rh=n%3A172541%2Cp_36%3A-5000'), 'unshopQ:browse:electronics|n:172541');
});
test('reserved identifiers cannot alter the state prototype', () => {
  const raw = JSON.parse('{"rejected":{"__proto__":{"reason":"other"},"constructor":{"reason":"other"}}}');
  assert.deepEqual(normalizeState(raw).rejected, {});
  assert.throws(() => updatePreferences(emptyState(), { id: '__proto__' }, 'other'));
});
