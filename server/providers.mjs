// LLM providers for UnShop. Pick one with LLM_PROVIDER in .env; the extension never knows which.
// Every provider receives the same prompt and must return JSON matching ResultSchema.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';

const fail = (message, status = 502) => Object.assign(new Error(message), { status });

// JSON Schema for providers without a native zod helper. Strict-mode friendly:
// every object closes additionalProperties and lists all keys as required.
export function jsonSchemaFor(zodSchema) {
  const walk = node => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out = {};
    for (const [k, v] of Object.entries(node)) if (!['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'].includes(k)) out[k] = walk(v);
    if (out.type === 'object' && out.properties) { out.additionalProperties = false; out.required = Object.keys(out.properties); }
    return out;
  };
  return walk(z.toJSONSchema(zodSchema));
}

// Parse a model's text reply into validated data. Tolerates ```json fences and stray prose.
export function parseJsonReply(text, zodSchema, label) {
  const raw = String(text || '');
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw fail(`${label} did not return JSON.`);
  let data;
  try { data = JSON.parse(raw.slice(start, end + 1)); } catch { throw fail(`${label} returned malformed JSON.`); }
  const parsed = zodSchema.safeParse(data);
  if (!parsed.success) throw fail(`${label} returned JSON in the wrong shape.`);
  return parsed.data;
}

async function http(fetchImpl, url, init, label) {
  let res;
  try { res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(55000) }); }
  catch (error) { throw fail(error.name === 'TimeoutError' ? `${label} took too long to respond.` : `Could not reach ${label}.`); }
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body;
  const detail = String(body?.error?.message || body?.error || '').slice(0, 200);
  if (res.status === 401 || res.status === 403) throw fail(`${label} rejected the API key.`, 401);
  if (res.status === 404) throw fail(`${label} could not find model “${init.model}”. Check UNSHOP_MODEL.`, 502);
  if (res.status === 429) throw fail(`Rate limited by ${label}. Try again shortly.`, 429);
  throw Object.assign(fail(`${label} error ${res.status}${detail ? `: ${detail}` : ''}`), { upstreamStatus: res.status, detail });
}

const withSchema = (user, schema) => `${user}\n\nRespond with only a JSON object (no prose, no code fences) matching this JSON Schema:\n${JSON.stringify(schema)}`;

/* ---------- Claude (Anthropic SDK, structured outputs) ---------- */
let anthropic;
async function callAnthropic({ system, user, zodSchema, model, env }) {
  anthropic ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY || undefined });
  const response = await anthropic.beta.messages.parse({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(zodSchema) },
    system,
    messages: [{ role: 'user', content: user }]
  });
  if (response.stop_reason === 'refusal') throw fail('Claude declined this request.', 422);
  if (response.stop_reason === 'max_tokens') throw fail('Response was cut off.');
  if (!response.parsed_output) throw fail('Claude returned an unreadable response.');
  return response.parsed_output;
}

/* ---------- OpenAI and OpenAI-compatible APIs (OpenRouter, Groq, Together, LM Studio, …) ---------- */
async function callOpenAI({ system, user, zodSchema, model, env, fetchImpl, label }) {
  const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const schema = jsonSchemaFor(zodSchema);
  const request = format => http(fetchImpl, `${base}/chat/completions`, {
    method: 'POST', model,
    headers: { 'content-type': 'application/json', ...(env.OPENAI_API_KEY ? { authorization: `Bearer ${env.OPENAI_API_KEY}` } : {}) },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: withSchema(user, schema) }], response_format: format })
  }, label);
  let body;
  try { body = await request({ type: 'json_schema', json_schema: { name: 'unshop_result', strict: true, schema } }); }
  catch (error) {
    // Many compatible servers don't support json_schema yet; plain JSON mode + validation still works.
    if (error.upstreamStatus !== 400 || !/response_format|json_schema|schema/i.test(error.detail || '')) throw error;
    body = await request({ type: 'json_object' });
  }
  const choice = body?.choices?.[0];
  if (choice?.message?.refusal) throw fail(`${label} declined this request.`, 422);
  if (choice?.finish_reason === 'length') throw fail('Response was cut off.');
  return parseJsonReply(choice?.message?.content, zodSchema, label);
}

/* ---------- Google Gemini ---------- */
async function callGemini({ system, user, zodSchema, model, env, fetchImpl, label }) {
  const base = (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const body = await http(fetchImpl, `${base}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', model,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY || '' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: withSchema(user, jsonSchemaFor(zodSchema)) }] }],
      generationConfig: { responseMimeType: 'application/json' }
    })
  }, label);
  const candidate = body?.candidates?.[0];
  if (!candidate) throw fail(`${label} declined this request.`, 422);
  if (candidate.finishReason === 'MAX_TOKENS') throw fail('Response was cut off.');
  return parseJsonReply((candidate.content?.parts || []).map(p => p.text || '').join(''), zodSchema, label);
}

/* ---------- Ollama (local models, no API key, nothing leaves your machine) ---------- */
async function callOllama({ system, user, zodSchema, model, env, fetchImpl, label }) {
  const base = (env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '');
  const schema = jsonSchemaFor(zodSchema);
  const body = await http(fetchImpl, `${base}/api/chat`, {
    method: 'POST', model,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: false, format: schema, options: { temperature: 0 }, messages: [{ role: 'system', content: system }, { role: 'user', content: withSchema(user, schema) }] })
  }, label);
  return parseJsonReply(body?.message?.content, zodSchema, label);
}

export const PROVIDERS = {
  anthropic: { label: 'Claude', keyEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'], defaultModel: 'claude-opus-5-5', call: callAnthropic },
  openai: { label: 'OpenAI', keyEnv: ['OPENAI_API_KEY'], call: callOpenAI },
  gemini: { label: 'Gemini', keyEnv: ['GEMINI_API_KEY'], call: callGemini },
  ollama: { label: 'Ollama', keyEnv: [], call: callOllama }
};

// Resolve provider settings from the environment. `problem` explains what's missing, if anything.
export function providerConfig(env = process.env) {
  const id = String(env.LLM_PROVIDER || 'anthropic').trim().toLowerCase();
  const provider = PROVIDERS[id];
  if (!provider) return { id, label: id, ready: false, problem: `Unknown LLM_PROVIDER “${id}”. Use one of: ${Object.keys(PROVIDERS).join(', ')}.` };
  // OpenAI-compatible servers (LM Studio, a local vLLM, …) may not need a key.
  const keyless = id === 'openai' && env.OPENAI_BASE_URL && !/api\.openai\.com/.test(env.OPENAI_BASE_URL);
  const label = id === 'openai' && keyless ? 'OpenAI-compatible' : provider.label;
  const model = (env.UNSHOP_MODEL || provider.defaultModel || '').trim();
  let problem = '';
  if (provider.keyEnv.length && !keyless && !provider.keyEnv.some(k => env[k])) problem = `The UnShop server has no ${provider.keyEnv[0]}. Add it to .env and restart.`;
  else if (!model) problem = `Set UNSHOP_MODEL in .env to a ${label} model name, then restart.`;
  return { id, label, model, ready: !problem, problem, call: provider.call };
}
