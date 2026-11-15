const tag = document.querySelector('#health');
chrome.runtime.sendMessage({ type: 'unshop:health' }, h => {
  if (chrome.runtime.lastError || !h) { tag.textContent = 'AI unavailable'; tag.dataset.s = 'bad'; return; }
  if (h.ok && h.keyConfigured) { tag.textContent = 'Claude connected'; tag.dataset.s = 'ok'; }
  else if (h.ok) { tag.textContent = 'Server has no API key'; tag.dataset.s = 'warn'; }
  else if (h.disabled) { tag.textContent = 'AI off · local rules'; }
  else { tag.textContent = 'AI server not running · local rules'; tag.dataset.s = 'bad'; }
});
