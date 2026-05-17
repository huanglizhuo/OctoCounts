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
  const cardPlacementLabel = document.querySelector('label[for="cardPlacement"]');
  if (cardPlacementLabel) cardPlacementLabel.textContent = t('popup.position');
  const opts = $('cardPlacement').querySelectorAll('option');
  if (opts[0]) opts[0].textContent = t('popup.positionTop');
  if (opts[1]) opts[1].textContent = t('popup.positionBottom');
  setText('replaceGhLanguages', 'popup.replaceGhLanguages');
  const cacheTtlLabel = document.querySelector('label[for="cacheTtl"]');
  if (cacheTtlLabel) cacheTtlLabel.textContent = t('popup.cacheTtl');
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
    cacheTtlMs:  86400000,
    replaceGhLanguages: true,
  });

  $('autoAnalyze').checked        = sync.autoAnalyze;
  $('cardPlacement').value        = sync.cardPlacement || 'top';
  $('cacheTtl').value             = String(sync.cacheTtlMs);
  $('replaceGhLanguages').checked = sync.replaceGhLanguages !== false;
}

async function save() {
  await chrome.storage.sync.set({
    autoAnalyze: $('autoAnalyze').checked,
    cardPlacement: $('cardPlacement').value === 'bottom' ? 'bottom' : 'top',
    cacheTtlMs:  Number($('cacheTtl').value),
    replaceGhLanguages: $('replaceGhLanguages').checked,
  });
}

document.querySelectorAll('input, select, textarea').forEach(el => {
  el.addEventListener('change', save);
});

load();
loadError();
checkPageStatus();
initClearCache();

async function checkPageStatus() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_) { return; }
  if (!tab?.id) return;

  try {
    const status = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_STATUS' });
    if (status?.isPrivateRepo) {
      $('noticeText').textContent = t('popup.privateNotice');
      $('noticeSection').hidden = false;
      $('settingsSection').hidden = true;
    }
  } catch (_) {
    // Content script not active on this tab
  }
}

async function loadError() {
  const { lastError } = await chrome.storage.local.get('lastError');
  if (!lastError) return;

  const section = $('errorSection');
  const codeMap = {
    rate_limited: t('error.rateLimited'),
    private_repo: t('error.privateRepo'),
    forbidden: t('error.forbidden'),
    too_large: t('error.tooLarge'),
    not_found: t('error.notFound'),
    auth_error: t('error.authError'),
    offline: t('error.offline'),
    timeout: t('card.error.timedOut'),
    unknown: t('error.unknown'),
  };

  $('errorTitle').textContent = codeMap[lastError.code] || t('error.unknown');
  $('errorRepo').textContent = `${lastError.owner}/${lastError.repo}`;
  $('errorMessage').textContent = lastError.message || '';
  $('errorCode').textContent = lastError.code ? `code: ${lastError.code}` : '';

  if (lastError.timestamp) {
    const d = new Date(lastError.timestamp);
    $('errorTime').textContent = d.toLocaleString();
  }

  const detailEl = $('errorDetail');
  const toggleBtn = $('errorToggleDetail');
  const lines = [];
  if (lastError.status) lines.push(`HTTP status: ${lastError.status}`);
  if (lastError.code) lines.push(`Code: ${lastError.code}`);
  if (lastError.message) lines.push(`Message: ${lastError.message}`);
  if (lastError.detail) lines.push('', String(lastError.detail).trim());
  const detailText = lines.join('\n');

  if (detailText) {
    detailEl.textContent = detailText;
    toggleBtn.hidden = false;
    toggleBtn.textContent = t('popup.showDetails');
    toggleBtn.addEventListener('click', () => {
      const hidden = detailEl.hidden;
      detailEl.hidden = !hidden;
      toggleBtn.textContent = hidden ? t('popup.hideDetails') : t('popup.showDetails');
    });
  }

  const retriesEl = $('errorRetries');
  if (lastError.retryCount > 0) {
    retriesEl.textContent = t('popup.retriedN', { count: lastError.retryCount });
    retriesEl.hidden = false;
  }

  $('errorDismiss').addEventListener('click', async () => {
    await chrome.storage.local.remove('lastError');
    section.hidden = true;
  });

  section.hidden = false;
}

function initClearCache() {
  const btn = $('clearCache');
  const status = $('clearCacheStatus');
  let statusTimer = null;

  btn.textContent = t('popup.clearCache');

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
      status.textContent = t('popup.clearCacheSuccess', { count: res.cleared ?? 0 });
      status.className = 'cache-status cache-status--ok';
    } catch (_) {
      status.textContent = t('popup.clearCacheFail');
      status.className = 'cache-status cache-status--err';
    } finally {
      status.hidden = false;
      btn.disabled = false;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => { status.hidden = true; }, 2500);
    }
  });
}
