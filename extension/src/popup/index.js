import { t } from '../i18n/index.js';

const $ = id => document.getElementById(id);

$('logoMark').src = chrome.runtime.getURL('icons/icon48.png');
applyTranslations();

function setText(id, key) {
  const el = $(id);
  if (el) {
    if (el.tagName === 'LABEL') {
      const textNode = Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
      if (textNode) textNode.textContent = t(key);
      else el.insertBefore(document.createTextNode(t(key)), el.firstChild);
    } else if (el.tagName === 'OPTION') {
      el.textContent = t(key);
    } else {
      el.textContent = t(key);
    }
  }
}

function applyTranslations() {
  document.title = t('popup.title');
  setText('autoAnalyze', 'popup.autoAnalyze');
  setText('cardPlacement', 'popup.position');
  const opts = $('cardPlacement').querySelectorAll('option');
  if (opts[0]) opts[0].textContent = t('popup.positionTop');
  if (opts[1]) opts[1].textContent = t('popup.positionBottom');
  setText('ignoreList', 'popup.ignoreList');
  const ignoreHint = document.querySelector('label[for="ignoreList"] .hint');
  if (ignoreHint) ignoreHint.textContent = t('popup.ignoreHint');
  $('ignoreList').placeholder = t('popup.ignorePlaceholder');
  setText('replaceGhLanguages', 'popup.replaceGhLanguages');
  setText('cacheTtl', 'popup.cacheTtl');
  const ttlOpts = $('cacheTtl').querySelectorAll('option');
  if (ttlOpts[0]) ttlOpts[0].textContent = t('popup.ttl1h');
  if (ttlOpts[1]) ttlOpts[1].textContent = t('popup.ttl6h');
  if (ttlOpts[2]) ttlOpts[2].textContent = t('popup.ttl24h');
  if (ttlOpts[3]) ttlOpts[3].textContent = t('popup.ttl7d');
  if (ttlOpts[4]) ttlOpts[4].textContent = t('popup.ttlNever');
  const issueLink = document.querySelector('footer a');
  if (issueLink) issueLink.textContent = t('popup.reportIssue');
}

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
