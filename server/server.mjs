// Minimal local API for the UnShop extension. Run: ANTHROPIC_API_KEY=... npm run server
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { ZodError } from 'zod';
import { analyze, MODEL } from './analyze.mjs';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 96 * 1024;

function send(res, status, body, origin) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  // Only the extension (and local tools) may call this server.
  if (origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)) { headers['access-control-allow-origin'] = origin; headers.vary = 'origin'; }
  res.writeHead(status, { ...headers, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Request too large.'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON.'), { status: 400 })); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !/^chrome-extension:\/\//.test(origin)) return send(res, 403, { error: 'Origin not allowed.' });
  if (req.method === 'OPTIONS') return send(res, 204, {}, origin);
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { ok: true, model: MODEL, keyConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) }, origin);
  }
  if (req.method === 'POST' && url.pathname === '/api/analyze') {
    const started = Date.now();
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return send(res, 401, { error: 'The UnShop server has no ANTHROPIC_API_KEY. Restart it with the key set.' }, origin);
    try {
      const result = await analyze(await readBody(req));
      console.log(`analyze ok · ${result.products.length} products · ${Date.now() - started}ms`);
      return send(res, 200, result, origin);
    } catch (error) {
      let status = error.status || 500, message = error.message;
      if (error instanceof ZodError) { status = 400; message = 'Request did not match the expected shape.'; }
      else if (error instanceof Anthropic.AuthenticationError) { status = 401; message = 'Anthropic API key is missing or invalid on the server.'; }
      else if (error instanceof Anthropic.RateLimitError) { status = 429; message = 'Rate limited by the Anthropic API. Try again shortly.'; }
      else if (error instanceof Anthropic.APIConnectionError) { status = 502; message = 'Could not reach the Anthropic API.'; }
      else if (error instanceof Anthropic.APIError) { status = 502; message = `Anthropic API error ${error.status}.`; }
      console.error(`analyze failed (${status}): ${error.message}`);
      return send(res, status, { error: message }, origin);
    }
  }
  send(res, 404, { error: 'Not found.' }, origin);
});

server.listen(PORT, HOST, () => {
  console.log(`UnShop AI server on http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT} · model ${MODEL}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) console.warn('Warning: ANTHROPIC_API_KEY is not set; /api/analyze will fail until it is.');
});
