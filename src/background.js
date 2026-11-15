// Service worker: the only part of the extension that talks to the UnShop AI server.
// Content scripts on amazon.com can't reliably fetch localhost, so they message us instead.
const DEFAULTS = { aiEnabled: true, serverUrl: 'http://localhost:8787' };

async function settings() {
  const { unshopSettings } = await chrome.storage.local.get('unshopSettings');
  return { ...DEFAULTS, ...(unshopSettings || {}) };
}

async function call(path, init = {}, timeoutMs = 60000) {
  const { serverUrl } = await settings();
  const base = new URL(serverUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) && base.protocol !== 'https:') throw new Error('Remote servers must use https.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(new URL(path, base), { ...init, signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Server responded ${res.status}.`);
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Claude took too long to respond.');
    if (error instanceof TypeError) throw new Error('UnShop AI server is not running. Start it with “npm run server”.');
    throw error;
  } finally { clearTimeout(timer); }
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'unshop:analyze') {
    settings().then(s => {
      if (!s.aiEnabled) return reply({ ok: false, disabled: true, error: 'AI is turned off in settings.' });
      return call('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message.payload) })
        .then(result => reply({ ok: true, result }));
    }).catch(error => reply({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'unshop:health') {
    settings().then(s => s.aiEnabled ? call('/api/health', {}, 4000).then(h => reply({ ok: true, ...h })) : reply({ ok: false, disabled: true, error: 'AI is turned off.' }))
      .catch(error => reply({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'unshop:open-options') { chrome.runtime.openOptionsPage(); reply({ ok: true }); return false; }
  return false;
});
