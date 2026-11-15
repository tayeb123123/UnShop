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

import { analyze } from '../server/analyze.mjs';
import { providerConfig, parseJsonReply, jsonSchemaFor } from '../server/providers.mjs';
import { ResultSchema } from '../server/analyze.mjs';

const input = { query: 'cameras', more: 'small and cheap', products: [{ id: 'C1', title: 'Compact Digital Camera', price: 89 }] };
const reply = { preferences: { budget: null, compact: true, priceTilt: 'lower', mustHave: ['digital'], avoid: [], notes: '' }, searchQuery: 'compact digital camera', summary: 'Small and cheap.', products: [{ id: 'C1', fit: 90, reason: 'Small' }] };
function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); const [status, json] = respond(calls.length, calls.at(-1)); return { ok: status < 400, status, json: async () => json }; };
  fn.calls = calls; return fn;
}

test('provider config explains what is missing', () => {
  assert.equal(providerConfig({}).id, 'anthropic');
  assert.match(providerConfig({}).problem, /ANTHROPIC_API_KEY/);
  assert.match(providerConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k' }).problem, /UNSHOP_MODEL/);
  assert.equal(providerConfig({ LLM_PROVIDER: 'ollama', UNSHOP_MODEL: 'qwen2.5:7b' }).ready, true);
  assert.equal(providerConfig({ LLM_PROVIDER: 'openai', OPENAI_BASE_URL: 'http://localhost:1234/v1', UNSHOP_MODEL: 'local' }).label, 'OpenAI-compatible');
  assert.match(providerConfig({ LLM_PROVIDER: 'mistery' }).problem, /Unknown LLM_PROVIDER/);
});
test('JSON schema is strict-mode friendly', () => {
  const s = jsonSchemaFor(ResultSchema);
  assert.equal(s.$schema, undefined); assert.equal(s.additionalProperties, false);
  assert.deepEqual(s.properties.preferences.required.sort(), ['avoid', 'budget', 'compact', 'mustHave', 'notes', 'priceTilt']);
});
test('replies with code fences parse; wrong shapes are rejected', () => {
  assert.equal(parseJsonReply('```json\n' + JSON.stringify(reply) + '\n```', ResultSchema, 'X').summary, 'Small and cheap.');
  assert.throws(() => parseJsonReply('sorry, no', ResultSchema, 'X'), /did not return JSON/);
  assert.throws(() => parseJsonReply('{"summary": 1}', ResultSchema, 'X'), /wrong shape/);
});
test('openai provider sends a strict schema and falls back to json_object', async () => {
  const fetchImpl = fakeFetch(n => n === 1 ? [400, { error: { message: "Invalid parameter: 'response_format' of type 'json_schema' is not supported" } }] : [200, { choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }]);
  const out = await analyze(input, { env: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k', UNSHOP_MODEL: 'm' }, fetchImpl });
  assert.equal(fetchImpl.calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(fetchImpl.calls[0].init.headers.authorization, 'Bearer k');
  assert.equal(fetchImpl.calls[0].body.response_format.json_schema.strict, true);
  assert.equal(fetchImpl.calls[1].body.response_format.type, 'json_object');
  assert.equal(out.preferences.priceTilt, 'lower'); assert.equal(out.label, 'OpenAI'); assert.equal(out.products[0].fit, 90);
});
test('gemini provider reads candidate text', async () => {
  const fetchImpl = fakeFetch(() => [200, { candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] }, finishReason: 'STOP' }] }]);
  const out = await analyze(input, { env: { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'g', UNSHOP_MODEL: 'gm' }, fetchImpl });
  assert.match(fetchImpl.calls[0].url, /\/models\/gm:generateContent$/);
  assert.equal(fetchImpl.calls[0].init.headers['x-goog-api-key'], 'g');
  assert.equal(out.searchQuery, 'compact digital camera');
});
test('ollama provider passes the schema as format; HTTP errors are explained', async () => {
  const ok = fakeFetch(() => [200, { message: { content: JSON.stringify(reply) } }]);
  const out = await analyze(input, { env: { LLM_PROVIDER: 'ollama', UNSHOP_MODEL: 'qwen' }, fetchImpl: ok });
  assert.equal(ok.calls[0].url, 'http://localhost:11434/api/chat'); assert.equal(ok.calls[0].body.format.type, 'object');
  assert.equal(out.label, 'Ollama');
  const missing = fakeFetch(() => [404, { error: 'model "nope" not found' }]);
  await assert.rejects(analyze(input, { env: { LLM_PROVIDER: 'ollama', UNSHOP_MODEL: 'nope' }, fetchImpl: missing }), /could not find model “nope”/);
  const badKey = fakeFetch(() => [401, {}]);
  await assert.rejects(analyze(input, { env: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'x', UNSHOP_MODEL: 'm' }, fetchImpl: badKey }), /rejected the API key/);
});
