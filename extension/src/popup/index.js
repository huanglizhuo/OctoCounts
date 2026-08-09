import { t } from '../i18n/index.js';
import { DEFAULT_SETTINGS } from '../shared/settings.js';
import { BUILD_INFO } from '../shared/buildInfo.js';
import { parseRoute, fingerprintHash } from '../content/github-dom.js';

const $ = id => document.getElementById(id);

const ISSUE_NEW_URL = 'https://github.com/huanglizhuo/OctoCounts/issues/new';
const ISSUE_SEARCH_URL = 'https://github.com/huanglizhuo/OctoCounts/issues';
const ISSUE_TEMPLATE = 'dom-mount-failure.yml';
const REPORTED_KEY = 'reportedDomFingerprints';
const REPORTED_MAX = 20;
// GitHub rejects very long issue URLs, so the prefilled body is capped and the
// copy button carries the untruncated version.
const ISSUE_BODY_MAX = 4000;

$('logoMark').src = chrome.runtime.getURL('icons/icon48.png');
applyTranslations();

function applyTranslations() {
  document.title = t('popup.title');

  $('groupBehaviorLabel').textContent    = t('popup.groupBehavior');
  $('groupAppearanceLabel').textContent  = t('popup.groupAppearance');
  $('groupCacheLabel').textContent       = t('popup.groupCache');

  $('silentUntilSuccessLabel').textContent  = t('popup.silentUntilSuccess');
  $('replaceGhLanguagesLabel').textContent  = t('popup.replaceGhLanguages');
  $('skipForksLabel').textContent           = t('popup.skipForks');
  $('hintSilentDesc').textContent           = t('popup.hintSilent');
  $('hintReplaceGhDesc').textContent        = t('popup.hintReplaceGhLanguages');

  $('cardPlacementLabel').textContent    = t('popup.position');
  $('hintPosition').textContent          = t('popup.hintPosition');
  const placementOpts = $('cardPlacement').querySelectorAll('option');
  if (placementOpts[0]) placementOpts[0].textContent = t('popup.positionTop');
  if (placementOpts[1]) placementOpts[1].textContent = t('popup.positionBottom');

  $('cardTitleLabel').textContent  = t('popup.cardTitle');
  $('cardTitle').placeholder       = t('popup.cardTitlePlaceholder');
  $('hintCardTitle').textContent   = t('popup.hintCardTitle');

  $('cacheTtlLabel').textContent  = t('popup.cacheTtl');
  $('hintCacheTtl').textContent   = t('popup.hintCacheTtl');
  const ttlOpts = $('cacheTtl').querySelectorAll('option');
  if (ttlOpts[0]) ttlOpts[0].textContent = t('popup.ttl1h');
  if (ttlOpts[1]) ttlOpts[1].textContent = t('popup.ttl6h');
  if (ttlOpts[2]) ttlOpts[2].textContent = t('popup.ttl24h');
  if (ttlOpts[3]) ttlOpts[3].textContent = t('popup.ttl7d');
  if (ttlOpts[4]) ttlOpts[4].textContent = t('popup.ttlNever');

  $('footerPrivacy').textContent   = t('popup.privacyNote');
  $('footerIssueLink').textContent = t('popup.reportIssue');
  $('footerStarLink').textContent  = t('popup.starRepo');
  $('welcomeText').textContent     = t('popup.welcomeHint');
  $('tabStatus').textContent       = t('popup.tabStatusIdle');
}

async function load() {
  const sync = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  $('silentUntilSuccess').checked = sync.silentUntilSuccess === true;
  $('cardTitle').value            = sync.cardTitle || '';
  $('cardPlacement').value        = sync.cardPlacement || 'top';
  $('replaceGhLanguages').checked = sync.replaceGhLanguages !== false;
  $('skipForks').checked          = sync.skipForks !== false;
  $('cacheTtl').value             = String(sync.cacheTtlMs);
}

async function save() {
  await chrome.storage.sync.set({
    silentUntilSuccess: $('silentUntilSuccess').checked,
    cardTitle:          $('cardTitle').value.trim(),
    cardPlacement:      $('cardPlacement').value === 'bottom' ? 'bottom' : 'top',
    replaceGhLanguages: $('replaceGhLanguages').checked,
    skipForks:          $('skipForks').checked,
    cacheTtlMs:         Number($('cacheTtl').value),
  });
}

document.querySelectorAll('input, select, textarea').forEach(el => {
  el.addEventListener('change', save);
});

load();
loadError();
checkPageStatus();
initClearCache();
setFooterVersion();

function setFooterVersion() {
  $('footerVersion').textContent = `v${BUILD_INFO.version}`;
}

async function checkPageStatus() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_) { return; }
  if (!tab?.id) return;

  const isGithubTab = tab.url && tab.url.startsWith('https://github.com/');

  if (!isGithubTab) {
    setTabStatus('idle');
    showWelcomeBanner();
    return;
  }

  try {
    const status = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_STATUS' });
    if (status?.isPrivateRepo) {
      $('noticeText').textContent  = t('popup.privateNotice');
      $('noticeSection').hidden    = false;
      setTabStatus('private');
    } else if (status?.isRepoPage) {
      chrome.storage.local.set({ welcomed: true }).catch(() => {});
      if (status.owner && status.repo) {
        await initRepoPill(status.owner, status.repo);
      } else {
        setTabStatus('active');
      }
      // A missing trustworthy mount point or visibility signal both indicate
      // that GitHub changed a page contract the extension depends on.
      if (status.mountState === 'mount_failed' || status.mountState === 'visibility_unknown') {
        await showMountFailure(tab, status.mountState);
      }
    } else {
      setTabStatus('idle');
      showWelcomeBanner();
    }
  } catch (_) {
    setTabStatus('idle');
    // No answer from the content script. On a repo URL the symptom is identical
    // to a failed mount from the user's point of view, so it gets the same path.
    if (isRepoTabUrl(tab.url)) {
      await showMountFailure(tab, 'no_content_script');
    } else {
      showWelcomeBanner();
    }
  }
}

function isRepoTabUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return false;
    return parseRoute(parsed.pathname) !== null;
  } catch (_) {
    return false;
  }
}

/* ── "card did not appear" report ────────────────────────────────────────── */

async function showMountFailure(tab, reason) {
  let diagnostics = null;
  if (reason === 'mount_failed' || reason === 'visibility_unknown') {
    try {
      diagnostics = await chrome.tabs.sendMessage(tab.id, { type: 'GET_MOUNT_DIAGNOSTICS' });
    } catch (_) {}
  }

  const route = (() => {
    try { return parseRoute(new URL(tab.url).pathname); } catch (_) { return null; }
  })();

  const fingerprint = diagnostics?.fingerprint ?? null;
  const hash = diagnostics?.hash ?? fingerprintHash({ strategy: reason, moduleClasses: [], trace: [] });
  const reportText = buildReportText({ reason, route, fingerprint, hash });

  const section = $('mountFailSection');
  const detail  = $('mountFailDetail');
  const toggle  = $('mountFailToggle');
  const report  = $('mountFailReport');
  const copy    = $('mountFailCopy');

  const alreadyReported = await isAlreadyReported(hash);

  $('mountFailText').textContent = alreadyReported
    ? t('popup.mountFailKnown', { hash })
    : t('popup.mountFail');

  detail.textContent = reportText;
  toggle.textContent = t('popup.showDetails');
  toggle.addEventListener('click', () => {
    const wasHidden = detail.hidden;
    detail.hidden = !wasHidden;
    toggle.textContent = wasHidden ? t('popup.hideDetails') : t('popup.showDetails');
    toggle.setAttribute('aria-expanded', String(wasHidden));
  });

  copy.textContent = t('popup.mountFailCopy');
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(reportText).then(() => {
      copy.textContent = t('popup.mountFailCopied');
      setTimeout(() => { copy.textContent = t('popup.mountFailCopy'); }, 1500);
    }).catch(() => {});
  });

  // Already-reported fingerprints link to the existing thread instead of
  // inviting a duplicate: one GitHub redesign hits every user at once.
  report.textContent = alreadyReported ? t('popup.mountFailViewIssue') : t('popup.mountFailReport');
  report.addEventListener('click', async () => {
    if (alreadyReported) {
      chrome.tabs.create({ url: `${ISSUE_SEARCH_URL}?q=${encodeURIComponent(`is:issue ${hash}`)}` });
      return;
    }
    await rememberReported(hash);
    chrome.tabs.create({ url: buildIssueUrl(hash, reportText) });
  });

  section.hidden = false;
}

function buildReportText({ reason, route, fingerprint, hash }) {
  const lines = [
    `Fingerprint: ${hash}`,
    `Reason: ${reason}`,
    `Extension: v${BUILD_INFO.version} (${BUILD_INFO.target})`,
    `Extension locale: ${chrome.i18n?.getUILanguage?.() ?? 'unknown'}`,
    `User agent: ${navigator.userAgent}`,
    `Repository: ${route ? `${route.owner}/${route.repo}` : 'unknown'}`,
    `Route: ${route?.isTreeView ? 'tree' : 'repo-home'}`,
  ];

  if (!fingerprint) {
    lines.push('', 'No page diagnostics available (content script did not respond).');
    return lines.join('\n');
  }

  lines.push(
    `GitHub UI language: ${fingerprint.htmlLang ?? 'unknown'}`,
    `Has legacy .BorderGrid: ${fingerprint.hasLegacyGrid}`,
    `Has CSS-module borderGrid: ${fingerprint.hasModuleGrid}`,
    `Has repo page signal: ${fingerprint.hasRepoSignal}`,
    `Resolved strategy: ${fingerprint.strategy ?? 'none'}`,
    '',
    'Strategy trace:',
    ...(fingerprint.trace ?? []).map(e => `  - ${e.strategy}: ${e.ok ? 'ok' : (e.reason ?? 'rejected')}`),
    '',
    `Section anchors found: ${formatAnchorKinds(fingerprint.anchorKinds)}`,
    '',
    'Sidebar headings:',
    ...(fingerprint.headings ?? []).map(h => `  - ${h}`),
    '',
    'CSS module class names:',
    ...(fingerprint.moduleClasses ?? []).map(c => `  - ${c}`),
  );

  return lines.join('\n');
}

function formatAnchorKinds(anchorKinds) {
  const entries = Object.entries(anchorKinds ?? {});
  if (entries.length === 0) return 'none';
  return entries.map(([kind, count]) => `${kind}×${count}`).join(', ');
}

function buildIssueUrl(hash, reportText) {
  const body = reportText.length > ISSUE_BODY_MAX
    ? `${reportText.slice(0, ISSUE_BODY_MAX)}\n… truncated, full report copied separately`
    : reportText;
  const params = new URLSearchParams({
    template: ISSUE_TEMPLATE,
    title: `[dom] card not inserted (${hash})`,
    diagnostics: body,
  });
  return `${ISSUE_NEW_URL}?${params.toString()}`;
}

async function isAlreadyReported(hash) {
  try {
    const stored = await chrome.storage.local.get(REPORTED_KEY);
    return Array.isArray(stored[REPORTED_KEY]) && stored[REPORTED_KEY].includes(hash);
  } catch (_) {
    return false;
  }
}

async function rememberReported(hash) {
  try {
    const stored = await chrome.storage.local.get(REPORTED_KEY);
    const list = Array.isArray(stored[REPORTED_KEY]) ? stored[REPORTED_KEY] : [];
    if (list.includes(hash)) return;
    await chrome.storage.local.set({
      [REPORTED_KEY]: [...list, hash].slice(-REPORTED_MAX),
    });
  } catch (_) {}
}

async function initRepoPill(owner, repo) {
  const storageKey = `disabled::${owner}/${repo}`;
  const result = await chrome.storage.local.get(storageKey);
  let disabled = result[storageKey] === true;

  const pill = $('tabStatus');
  pill.disabled = false;
  renderPillState(pill, disabled);

  pill.addEventListener('click', async () => {
    disabled = !disabled;
    if (disabled) {
      await chrome.storage.local.set({ [storageKey]: true });
    } else {
      await chrome.storage.local.remove(storageKey);
    }
    renderPillState(pill, disabled);
  });
}

function renderPillState(pill, disabled) {
  pill.setAttribute('aria-pressed', String(!disabled));
  if (disabled) {
    pill.className   = 'status-pill status-pill--idle';
    pill.textContent = t('popup.tabStatusRepoOff');
  } else {
    pill.className   = 'status-pill status-pill--active';
    pill.textContent = t('popup.tabStatusActive');
  }
}

function setTabStatus(state) {
  const el = $('tabStatus');
  el.disabled = true;
  el.removeAttribute('aria-pressed');
  el.className = `status-pill status-pill--${state}`;
  const key = state === 'active'  ? 'tabStatusActive'
    : state === 'private' ? 'tabStatusPrivate'
    : 'tabStatusIdle';
  el.textContent = t(`popup.${key}`);
}

async function showWelcomeBanner() {
  try {
    const { welcomed } = await chrome.storage.local.get('welcomed');
    if (!welcomed) $('welcomeSection').hidden = false;
  } catch (_) {}
}

async function loadError() {
  const { lastError } = await chrome.storage.local.get('lastError');
  if (!lastError) return;

  const section = $('errorSection');
  const codeMap = {
    rate_limited: t('error.rateLimited'),
    private_repo: t('error.privateRepo'),
    forbidden:    t('error.forbidden'),
    too_large:    t('error.tooLarge'),
    not_found:    t('error.notFound'),
    auth_error:   t('error.authError'),
    offline:      t('error.offline'),
    timeout:      t('card.error.timedOut'),
    unknown:      t('error.unknown'),
  };

  $('errorTitle').textContent   = codeMap[lastError.code] || t('error.unknown');
  $('errorRepo').textContent    = `${lastError.owner}/${lastError.repo}`;
  $('errorMessage').textContent = lastError.message || '';
  $('errorCode').textContent    = lastError.code ? `code: ${lastError.code}` : '';

  if (lastError.timestamp) {
    $('errorTime').textContent = new Date(lastError.timestamp).toLocaleString();
  }

  const detailEl  = $('errorDetail');
  const toggleBtn = $('errorToggleDetail');
  const lines = [];
  if (lastError.status)  lines.push(`HTTP status: ${lastError.status}`);
  if (lastError.code)    lines.push(`Code: ${lastError.code}`);
  if (lastError.message) lines.push(`Message: ${lastError.message}`);
  if (lastError.detail)  lines.push('', String(lastError.detail).trim());
  const detailText = lines.join('\n');

  if (detailText) {
    detailEl.textContent    = detailText;
    toggleBtn.hidden        = false;
    toggleBtn.textContent   = t('popup.showDetails');
    toggleBtn.addEventListener('click', () => {
      const hidden       = detailEl.hidden;
      detailEl.hidden    = !hidden;
      toggleBtn.textContent = hidden ? t('popup.hideDetails') : t('popup.showDetails');
    });
  }

  const retriesEl = $('errorRetries');
  if (lastError.retryCount > 0) {
    retriesEl.textContent = t('popup.retriedN', { count: lastError.retryCount });
    retriesEl.hidden      = false;
  }

  $('errorDismiss').addEventListener('click', async () => {
    await chrome.storage.local.remove('lastError');
    section.hidden = true;
  });

  section.hidden = false;
}

function initClearCache() {
  const btn    = $('clearCache');
  const label  = $('clearCacheBtn');
  const status = $('clearCacheStatus');
  let timer    = null;

  const baseLabel = t('popup.clearCache');
  label.textContent = baseLabel;

  async function refreshCount() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'COUNT_CACHE' });
      const n = res?.count ?? 0;
      label.textContent = n > 0 ? `${baseLabel} (${n})` : baseLabel;
    } catch (_) {}
  }
  refreshCount();

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
      status.textContent = t('popup.clearCacheSuccess', { count: res.cleared ?? 0 });
      status.className   = 'cache-status cache-status--ok';
      refreshCount();
    } catch (_) {
      status.textContent = t('popup.clearCacheFail');
      status.className   = 'cache-status cache-status--err';
    } finally {
      status.hidden  = false;
      btn.disabled   = false;
      clearTimeout(timer);
      timer = setTimeout(() => { status.hidden = true; }, 2500);
    }
  });
}
