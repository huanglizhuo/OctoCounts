const $ = id => document.getElementById(id);

$('logoMark').src = chrome.runtime.getURL('icons/icon48.png');

async function load() {
  const sync = await chrome.storage.sync.get({
    autoAnalyze: true,
    cardPlacement: 'top',
    ignoreList:  '',
    cacheTtlMs:  86400000,
    replaceGhLanguages: true,
  });

  $('autoAnalyze').checked        = sync.autoAnalyze;
  $('cardPlacement').value        = sync.cardPlacement || 'top';
  $('ignoreList').value           = sync.ignoreList;
  $('cacheTtl').value             = String(sync.cacheTtlMs);
  $('replaceGhLanguages').checked = sync.replaceGhLanguages !== false;

}

async function save() {
  await chrome.storage.sync.set({
    autoAnalyze: $('autoAnalyze').checked,
    cardPlacement: $('cardPlacement').value === 'bottom' ? 'bottom' : 'top',
    ignoreList:  $('ignoreList').value.trim(),
    cacheTtlMs:  Number($('cacheTtl').value),
    replaceGhLanguages: $('replaceGhLanguages').checked,
  });
}

document.querySelectorAll('input, select, textarea').forEach(el => {
  el.addEventListener('change', save);
});

load();
