const DEFAULTS = { aiEnabled: true, serverUrl: 'http://localhost:8787' };
const $ = s => document.querySelector(s);

function health() {
  const tag = $('#health'); tag.textContent = 'Checking…'; tag.dataset.s = '';
  chrome.runtime.sendMessage({ type: 'unshop:health' }, h => {
    if (chrome.runtime.lastError || !h) { tag.textContent = 'Unavailable'; tag.dataset.s = 'bad'; return; }
    if (h.ok && h.keyConfigured) { tag.textContent = `Connected · ${h.label || 'AI'} · ${h.model}`; tag.dataset.s = 'ok'; }
    else if (h.ok) { tag.textContent = 'Server needs setup'; tag.title = h.problem || ''; tag.dataset.s = 'warn'; }
    else if (h.disabled) { tag.textContent = 'Off · local rules'; tag.dataset.s = ''; }
    else { tag.textContent = 'Server not running'; tag.dataset.s = 'bad'; tag.title = h.error || ''; }
  });
}

chrome.storage.local.get('unshopSettings', ({ unshopSettings }) => {
  const s = { ...DEFAULTS, ...(unshopSettings || {}) };
  $('#aiEnabled').checked = s.aiEnabled; $('#serverUrl').value = s.serverUrl;
  health();
});

function save() {
  let url;
  try { url = new URL($('#serverUrl').value.trim() || DEFAULTS.serverUrl); } catch { $('#health').textContent = 'Invalid URL'; $('#health').dataset.s = 'bad'; return; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && url.protocol !== 'https:') { $('#health').textContent = 'Use https for remote servers'; $('#health').dataset.s = 'bad'; return; }
  chrome.storage.local.set({ unshopSettings: { aiEnabled: $('#aiEnabled').checked, serverUrl: url.origin } }, health);
}
$('#save').addEventListener('click', save);
$('#aiEnabled').addEventListener('change', save);

const button = $('#reset');
button.addEventListener('click', () => {
  button.disabled = true;
  chrome.storage.local.get(null, all => {
    const keys = Object.keys(all || {}).filter(k => k.startsWith('unshopQ:'));
    chrome.storage.local.remove([...keys, 'unshopState', 'unshopDemoState', 'unshopUi', 'unshopHandoff'], () => {
      $('#status').textContent = chrome.runtime.lastError ? 'Could not delete. Reload settings and try again.' : `Deleted preferences for ${keys.length} search${keys.length === 1 ? '' : 'es'}. Refresh open Amazon and demo tabs to apply.`;
      button.disabled = false;
    });
  });
});
