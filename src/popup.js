const tag = document.querySelector('#health');
chrome.runtime.sendMessage({ type: 'unshop:health' }, h => {
  if (chrome.runtime.lastError || !h) { tag.textContent = 'AI unavailable'; tag.dataset.s = 'bad'; return; }
  if (h.ok && h.keyConfigured) { tag.textContent = `${h.label || 'AI'} connected`; tag.dataset.s = 'ok'; }
  else if (h.ok) { tag.textContent = 'Server needs setup'; tag.title = h.problem || ''; tag.dataset.s = 'warn'; }
  else if (h.disabled) { tag.textContent = 'AI off · local rules'; }
  else { tag.textContent = 'AI server not running · local rules'; tag.dataset.s = 'bad'; }
});
