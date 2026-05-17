import cardCss from '../styles/card.css?inline';
import { t } from '../i18n/index.js';
import { formatNumber, formatCompact, formatPercent } from '../shared/format.js';
import { buildBarItems, languageColor } from '../shared/chart.js';
import { mountPanel, unmountPanel } from './panel.js';

const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RETRIES = 4;
const NON_RETRYABLE = new Set(['too_large', 'private_repo', 'forbidden', 'auth_error']);

let _pollTimer = null;
let _pollStart = null;
let _disabled = false;
let _analyzing = false;
let _retryCount = 0;
let _generation = 0;

function findBorderGrid() {
  const selectors = [
    '.Layout-sidebar .BorderGrid',
    '[data-pjax-container] .BorderGrid',
    '.repository-sidebar .BorderGrid',
    '.BorderGrid',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

export function unmountCard() {
  _generation++;
  stopPolling();
  _analyzing = false;
  restoreGhLanguagesSection();
  document.querySelector('[data-octocount-card]')?.remove();
}

export function mountCard({ owner, repo, ref, autoAnalyze, placement = 'top', replaceGhLanguages = true, forceRefresh = false, silentUntilSuccess = false }) {
  _disabled = false;
  _generation++;
  const gen = _generation;

  const grid = findBorderGrid();
  if (!grid) {
    let tries = 0;
    const retry = setInterval(() => {
      tries++;
      const g = findBorderGrid();
      if (g) {
        clearInterval(retry);
        _doMount(g, { owner, repo, ref, autoAnalyze, placement, replaceGhLanguages, forceRefresh, silentUntilSuccess, gen });
      } else if (tries >= 5) {
        clearInterval(retry);
      }
    }, 200);
    return false;
  }
  return _doMount(grid, { owner, repo, ref, autoAnalyze, placement, replaceGhLanguages, forceRefresh, silentUntilSuccess, gen });
}

function _createCardDom(grid, placement) {
  const host = document.createElement('div');
  host.dataset.octocountCard = '1';
  host.className = 'BorderGrid-row';

  const cell = document.createElement('div');
  cell.className = 'BorderGrid-cell';
  host.appendChild(cell);

  const shadow = cell.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${cardCss}</style><div class="oc-inner"></div>`;

  const syncTheme = () => shadow.host.setAttribute('data-theme', getTheme());
  shadow.host.setAttribute('data-theme', getTheme());
  new MutationObserver(syncTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-color-mode', 'data-dark-theme', 'data-light-theme'],
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);

  if (placement === 'bottom') {
    grid.append(host);
  } else {
    grid.prepend(host);
  }

  const root = shadow.querySelector('.oc-inner');
  return { host, root, shadow };
}

function _doMount(grid, { owner, repo, ref, autoAnalyze, placement, replaceGhLanguages, forceRefresh, silentUntilSuccess, gen }) {
  // Silent mode: don't insert a card until the API returns success
  if (silentUntilSuccess) {
    if (autoAnalyze || forceRefresh) {
      _analyzing = true;
      _launchSilentAnalysis(grid, { owner, repo, ref, placement, replaceGhLanguages, forceRefresh, gen });
    } else {
      // Idle card with button; on click remove it and run silently
      const { host, root } = _createCardDom(grid, placement);
      renderIdle(root, () => {
        host.remove();
        _analyzing = true;
        _launchSilentAnalysis(grid, { owner, repo, ref, placement, replaceGhLanguages, forceRefresh: false, gen });
      });
    }
    return true;
  }

  // Default mode: insert card immediately with loading/idle UI
  const { host, root, shadow } = _createCardDom(grid, placement);
  const ctx = { owner, repo, ref, shadow, replaceGhLanguages };

  function runAnalysis(force) {
    startAnalysis({
      owner, repo, ref, forceRefresh: force,
      onCompleted: (report, cachedAt) => {
        if (_generation !== gen) return;
        chrome.storage.local.remove('lastError').catch(() => {});
        renderCompleted(root, report, cachedAt, ctx, () => {
          renderLoading(root, 'queued');
          runAnalysis(true);
        });
      },
      onError: (error) => {
        if (_generation !== gen) return;
        _disabled = true;
        saveError(error, owner, repo);
        host.remove();
        restoreGhLanguagesSection();
      },
    });
  }

  if (autoAnalyze || forceRefresh) {
    renderLoading(root, 'queued');
    runAnalysis(forceRefresh);
  } else {
    renderIdle(root, () => {
      renderLoading(root, 'queued');
      runAnalysis(false);
    });
  }

  return true;
}

// Silent path: no card inserted until API succeeds
function _launchSilentAnalysis(grid, { owner, repo, ref, placement, replaceGhLanguages, forceRefresh, gen }) {
  startAnalysis({
    owner, repo, ref, forceRefresh,
    onCompleted: (report, cachedAt) => {
      if (_generation !== gen) return;
      _analyzing = false;
      chrome.storage.local.remove('lastError').catch(() => {});
      _insertCompletedCard(grid, { owner, repo, ref, placement, replaceGhLanguages, report, cachedAt });
    },
    onError: (error) => {
      if (_generation !== gen) return;
      _analyzing = false;
      _disabled = true;
      saveError(error, owner, repo);
    },
  });
}

function _insertCompletedCard(grid, { owner, repo, ref, placement, replaceGhLanguages, report, cachedAt }) {
  const { host, root, shadow } = _createCardDom(grid, placement);
  const ctx = { owner, repo, ref, shadow, replaceGhLanguages };

  function onRefresh() {
    const refreshBtn = root.querySelector('.oc-refresh-btn');
    if (refreshBtn) refreshBtn.disabled = true;

    startAnalysis({
      owner, repo, ref, forceRefresh: true,
      onCompleted: (newReport, newCachedAt) => {
        chrome.storage.local.remove('lastError').catch(() => {});
        renderCompleted(root, newReport, newCachedAt, ctx, onRefresh);
      },
      onError: (error) => {
        _disabled = true;
        saveError(error, owner, repo);
        host.remove();
        restoreGhLanguagesSection();
      },
    });
  }

  renderCompleted(root, report, cachedAt, ctx, onRefresh);
}

export function isDisabled() {
  return _disabled || _analyzing;
}

function getTheme() {
  const mode = document.documentElement.dataset.colorMode;
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function header(rightHTML = '') {
  return `
    <div class="oc-header">
      <div class="oc-title">${t('card.title')}</div>
      <div class="oc-header-right">${rightHTML}</div>
    </div>`;
}

function renderIdle(root, onCount) {
  root.innerHTML = `<div class="oc-wrap">
    ${header(`<button class="oc-count-btn">${t('card.countSloc')}</button>`)}
  </div>`;
  root.querySelector('.oc-count-btn').addEventListener('click', onCount);
}

function skelLangRow(nameWidth) {
  return `<div class="oc-lang-row">
    <div class="oc-skel oc-skel--dot"></div>
    <div class="oc-skel oc-skel--lang-name" style="max-width:${nameWidth}%"></div>
    <div class="oc-skel oc-skel--lang-num"></div>
    <div class="oc-skel oc-skel--lang-num"></div>
  </div>`;
}

function renderLoading(root) {
  root.innerHTML = `<div class="oc-wrap">
    ${header('<div class="oc-skel oc-skel--icon"></div>')}
    <div class="oc-stats-grid">
      <div class="oc-sg-cell">
        <div class="oc-skel oc-skel--val" style="width:70%"></div>
        <div class="oc-skel oc-skel--label" style="width:55%"></div>
      </div>
      <div class="oc-sg-cell">
        <div class="oc-skel oc-skel--val" style="width:55%"></div>
        <div class="oc-skel oc-skel--label" style="width:40%"></div>
      </div>
      <div class="oc-sg-cell">
        <div class="oc-skel oc-skel--val" style="width:65%"></div>
        <div class="oc-skel oc-skel--label" style="width:50%"></div>
      </div>
      <div class="oc-sg-cell">
        <div class="oc-skel oc-skel--val" style="width:48%"></div>
        <div class="oc-skel oc-skel--label" style="width:36%"></div>
      </div>
    </div>
    <div class="oc-skel oc-skel--bar"></div>
    <div class="oc-lang-list">
      ${skelLangRow(78)}
      ${skelLangRow(60)}
      ${skelLangRow(70)}
      ${skelLangRow(52)}
      ${skelLangRow(65)}
    </div>
  </div>`;
}

function renderCompleted(root, report, cachedAt, ctx, onRefresh) {
  const { owner, repo, ref, shadow, replaceGhLanguages } = ctx;
  const theme = getTheme();
  const total = report.total;

  const cachedBadge = report.cached ? `<span class="oc-badge">${t('card.cached')}</span>` : '';
  const headerRight = `${cachedBadge}<button class="oc-icon-btn oc-refresh-btn" title="${t('card.refreshTitle')}">↺</button>`;

  const statsHTML = `
    <div class="oc-stats-grid">
      <div class="oc-sg-cell">
        <span class="oc-sg-val accent">${formatCompact(total.code)}</span>
        <span class="oc-sg-label">${t('card.code')}</span>
      </div>
      <div class="oc-sg-cell">
        <span class="oc-sg-val">${formatCompact(total.files)}</span>
        <span class="oc-sg-label">${t('card.files')}</span>
      </div>
      <div class="oc-sg-cell">
        <span class="oc-sg-val">${formatCompact(total.lines)}</span>
        <span class="oc-sg-label">${t('card.lines')}</span>
      </div>
      <div class="oc-sg-cell">
        <span class="oc-sg-val">${formatCompact(total.comments)}</span>
        <span class="oc-sg-label">${t('card.comments')}</span>
      </div>
    </div>`;

  const langListHTML = buildLangListHTML(report, theme, total.code);

  root.innerHTML = `<div class="oc-wrap">
    ${header(headerRight)}
    ${statsHTML}
    ${buildStackedBarHTML(report, theme)}
    ${langListHTML}
  </div>`;

  root.querySelector('.oc-refresh-btn').addEventListener('click', e => {
    e.stopPropagation();
    onRefresh();
  });

  root.querySelectorAll('.oc-lang-clickable').forEach(row => {
    row.addEventListener('click', e => {
      e.stopPropagation();
      triggerGhLanguageFilter(row.dataset.lang);
    });
  });

  const onForceRefresh = () => {
    unmountPanel();
    onRefresh();
  };

  root.querySelector('.oc-lang-more')?.addEventListener('click', e => {
    e.stopPropagation();
    mountPanel({ report, owner, repo, theme: getTheme(), onForceRefresh });
  });

  const cardHost = shadow.host.closest('[data-octocount-card]');
  cardHost.setAttribute('data-state', 'completed');
  cardHost.style.cursor = 'pointer';
  if (cardHost._ocListener) cardHost.removeEventListener('click', cardHost._ocListener);
  const openPanel = () => mountPanel({ report, owner, repo, theme: getTheme(), onForceRefresh });
  cardHost._ocListener = openPanel;
  cardHost.addEventListener('click', openPanel);

  if (replaceGhLanguages) hideGhLanguagesSection();
}

function buildStackedBarHTML(report, theme) {
  const items = buildBarItems(report, theme);
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) {
    return `<div class="oc-bar"><div class="oc-bar-seg" style="flex:1;background:var(--border)"></div></div>`;
  }
  const segs = items.map(item => {
    const tip = `${item.label}: ${formatPercent(item.value, total)} (${formatNumber(item.value)} code lines)`;
    return `<div class="oc-bar-seg" style="flex:${item.value};background:${item.color}" title="${escapeHtml(tip)}"></div>`;
  }).join('');
  return `<div class="oc-bar">${segs}</div>`;
}

function buildLangListHTML(report, theme, totalCode) {
  const sorted = [...report.languages].sort((a, b) => b.stats.code - a.stats.code);
  const top5 = sorted.slice(0, 5);
  const extraCount = Math.max(0, sorted.length - 5);

  const rows = top5.map(lang => {
    const color = languageColor(lang.name, theme);
    const pct = formatPercent(lang.stats.code, totalCode);
    return `<div class="oc-lang-row oc-lang-clickable" data-lang="${escapeHtml(lang.name)}">
      <span class="oc-lang-dot" style="background:${color}"></span>
      <span class="oc-lang-name">${escapeHtml(lang.name)}</span>
      <span class="oc-lang-pct">${pct}</span>
      <span class="oc-lang-code">${formatCompact(lang.stats.code)}</span>
    </div>`;
  }).join('');

  const moreRow = extraCount > 0
    ? `<div class="oc-lang-row oc-lang-more">${t('card.moreLanguages', { count: extraCount })}</div>`
    : '';

  return `<div class="oc-lang-list">${rows}${moreRow}</div>`;
}

function triggerGhLanguageFilter(langName) {
  const links = document.querySelectorAll('a[href*="?l="]');
  for (const a of links) {
    try {
      const url = new URL(a.href, location.href);
      const l = url.searchParams.get('l');
      if (l && l.toLowerCase() === langName.toLowerCase()) {
        a.click();
        return;
      }
    } catch (_) { }
  }
  const url = new URL(location.href);
  url.searchParams.set('l', langName);
  history.pushState({}, '', url.toString());
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function hideGhLanguagesSection() {
  const languageHeadings = ['Languages', '语言'];
  document.querySelectorAll('.BorderGrid-row').forEach(row => {
    if (row.dataset.octocountCard) return;
    const h = row.querySelector('h2, h3');
    if (h && languageHeadings.includes(h.textContent.trim())) {
      row.style.display = 'none';
      row.dataset.octocountHidden = '1';
    }
  });
}

function restoreGhLanguagesSection() {
  document.querySelectorAll('[data-octocount-hidden]').forEach(row => {
    row.style.display = '';
    delete row.dataset.octocountHidden;
  });
}

async function saveError(error, owner, repo) {
  const errorInfo = {
    owner,
    repo,
    code: error?.code || 'unknown',
    message: error?.message || t('card.error.title'),
    status: error?.status || null,
    detail: error?.detail || '',
    timestamp: Date.now(),
    retryCount: _retryCount,
  };
  try {
    await chrome.storage.local.set({ lastError: errorInfo });
  } catch (_) {}
}

function stopPolling() {
  if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
  _pollStart = null;
}

function pollingInterval(elapsedMs) {
  if (elapsedMs < 5_000) return 1_200;
  if (elapsedMs < 30_000) return 2_500;
  return 5_000;
}

async function startAnalysis({ owner, repo, ref, forceRefresh, onCompleted, onError, _retryEntry = false }) {
  if (!_retryEntry) _retryCount = 0;
  stopPolling();

  async function handleError(error) {
    if (!NON_RETRYABLE.has(error?.code) && _retryCount < MAX_RETRIES) {
      _retryCount++;
      const delay = Math.min(1000 * (2 ** (_retryCount - 1)), 8000);
      _pollTimer = setTimeout(
        () => startAnalysis({ owner, repo, ref, forceRefresh: false, onCompleted, onError, _retryEntry: true }),
        delay,
      );
      return;
    }
    onError(error);
  }

  try {
    const res = await chrome.runtime.sendMessage({ type: 'ANALYZE', owner, repo, ref, forceRefresh });

    if (res?.error) {
      await handleError(res.error);
      return;
    }

    if (res.type === 'CACHED') {
      onCompleted(res.report, res.cachedAt);
      return;
    }

    const { jobId } = res;
    _pollStart = Date.now();

    const pollUntilDone = async () => {
      const elapsed = Date.now() - _pollStart;
      if (elapsed > POLL_TIMEOUT_MS) {
        await handleError({ code: 'timeout', message: t('card.error.timedOut') });
        return;
      }

      let poll;
      try {
        poll = await chrome.runtime.sendMessage({ type: 'POLL', jobId, owner, repo, ref });
      } catch (_) {
        _pollTimer = setTimeout(pollUntilDone, pollingInterval(elapsed));
        return;
      }

      if (!poll || poll.error) {
        await handleError(poll?.error || { code: 'unknown', message: t('card.error.title') });
        return;
      }

      if (poll.type === 'PENDING') {
        _pollTimer = setTimeout(pollUntilDone, pollingInterval(Date.now() - _pollStart));
        return;
      }

      if (poll.type === 'FAILED') {
        await handleError(poll.error || { code: 'unknown', message: t('card.error.title') });
        return;
      }

      if (poll.type === 'COMPLETED') {
        stopPolling();
        onCompleted(poll.report, null);
      }
    };

    _pollTimer = setTimeout(pollUntilDone, pollingInterval(0));

  } catch (err) {
    await handleError({ code: 'unknown', message: err.message || t('card.error.title') });
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
