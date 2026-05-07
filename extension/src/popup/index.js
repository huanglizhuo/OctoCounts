const $ = id => document.getElementById(id);

$('logoMark').src = chrome.runtime.getURL('icons/icon48.png');

async function load() {
  const sync = await chrome.storage.sync.get({
    autoAnalyze: true,
    cardPlacement: 'top',
    ignoreList:  '',
    cacheTtlMs:  86400000,
  });

  $('autoAnalyze').checked  = sync.autoAnalyze;
  $('cardPlacement').value  = sync.cardPlacement || 'top';
  $('ignoreList').value     = sync.ignoreList;
  $('cacheTtl').value       = String(sync.cacheTtlMs);

  try {
    const { count } = await chrome.runtime.sendMessage({ type: 'COUNT_CACHE' });
    $('cacheCount').textContent = count;
  } catch (_) {
    $('cacheCount').textContent = '?';
  }
}

async function save() {
  await chrome.storage.sync.set({
    autoAnalyze: $('autoAnalyze').checked,
    cardPlacement: $('cardPlacement').value === 'bottom' ? 'bottom' : 'top',
    ignoreList:  $('ignoreList').value.trim(),
    cacheTtlMs:  Number($('cacheTtl').value),
  });
}

$('clearCache').addEventListener('click', async () => {
  try {
    const { cleared } = await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
    $('cacheCount').textContent = 0;
    $('clearCache').querySelector('span').textContent = '0';
    $('clearCache').textContent = `Cleared ${cleared} entries ✓`;
  } catch (_) {}
});

document.querySelectorAll('input, select, textarea').forEach(el => {
  el.addEventListener('change', save);
});

load();
