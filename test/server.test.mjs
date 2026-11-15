import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestSchema, sanitize } from '../server/analyze.mjs';

test('request schema applies defaults and rejects bad ids', () => {
  const req = RequestSchema.parse({ products: [{ id: 'B0ABC', title: 'X', price: null }] });
  assert.equal(req.preferences.compact, false); assert.deepEqual(req.history, []);
  assert.throws(() => RequestSchema.parse({ products: [{ id: '../etc', title: 'X', price: 1 }] }));
  assert.throws(() => RequestSchema.parse({ products: Array.from({ length: 60 }, (_, i) => ({ id: `P${i}`, title: 'x', price: 1 })) }));
});
test('model output is clamped and limited to known products', () => {
  const req = RequestSchema.parse({ query: 'headphones', products: [{ id: 'A', title: 'a', price: 1 }] });
  const out = sanitize({ preferences: { budget: -4, compact: 'yes', mustHave: ['Foldable', 'foldable', ''], avoid: Array(20).fill('x').map((x, i) => x + i), notes: 'n' }, searchQuery: '  small   headphones ', summary: 's', products: [{ id: 'A', fit: 140, reason: 'ok' }, { id: 'ZZ', fit: 50, reason: 'unknown' }] }, req);
  assert.equal(out.preferences.budget, null); assert.equal(out.preferences.compact, false);
  assert.deepEqual(out.preferences.mustHave, ['foldable']); assert.equal(out.preferences.avoid.length, 8);
  assert.equal(out.searchQuery, 'small headphones');
  assert.deepEqual(out.products, [{ id: 'A', fit: 100, reason: 'ok' }]);
});
