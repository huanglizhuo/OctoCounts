import cardCss from '../styles/card.css?inline';
import { formatNumber, formatCompact, formatPercent } from '../shared/format.js';
import { buildBarItems, languageColor } from '../shared/chart.js';
import { mountPanel, unmountPanel } from './panel.js';

const POLL_TIMEOUT_MS = 5 * 60 * 1000;

let _pollTimer = null;
let _pollStart = null;

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
  stopPolling();
  restoreGhLanguagesSection();
  document.querySelector('[data-octocount-card]')?.remove();
}

export function mountCard({ owner, repo, ref, autoAnalyze, placement = 'top', replaceGhLanguages = true, forceRefresh = false }) {
  const grid = findBorderGrid();
  if (!grid) {
    let tries = 0;
    const retry = setInterval(() => {
      tries++;
      const g = findBorderGrid();
      if (g) { clearInterval(retry); _doMount(g, { owner, repo, ref, autoAnalyze, placement, replaceGhLanguages, forceRefresh }); }
      else if (tries >= 5) clearInterval(retry);
    }, 200);
    return false;
  }
  return _doMount(grid, { owner, repo, ref, autoAnalyze, placement, replaceGhLanguages, forceRefresh });
}

function _doMount(grid, { owner, repo, ref, autoAnalyze, placement, replaceGhLanguages, forceRefresh }) {
  const host = document.createElement('div');
  host.dataset.octocountCard = '1';
  host.className = 'BorderGrid-row';

  const cell = document.createElement('div');
  cell.className = 'BorderGrid-cell';
  host.appendChild(cell);

  const shadow = cell.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${cardCss}</style><div class="oc-inner"></div>`;

  const theme = getTheme();
  shadow.host.setAttribute('data-theme', theme);

  const syncTheme = () => shadow.host.setAttribute('data-theme', getTheme());

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
  const ctx = { owner, repo, ref, shadow, replaceGhLanguages };

  if (autoAnalyze || forceRefresh) {
    renderLoading(root, 'queued');
    startAnalysis({ ...ctx, root, forceRefresh });
  } else {
    renderIdle(root, () => {
      renderLoading(root, 'queued');
      startAnalysis({ ...ctx, root, forceRefresh: false });
    });
  }

  return true;
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
      <div class="oc-title">OctoCounts</div>
      <div class="oc-header-right">${rightHTML}</div>
    </div>`;
}

function renderIdle(root, onCount) {
  root.innerHTML = `<div class="oc-wrap">
    ${header('<button class="oc-count-btn">Count SLOC</button>')}
  </div>`;
  root.querySelector('.oc-count-btn').addEventListener('click', onCount);
}

const LOADING_LABELS = { queued: 'Queued…', running: 'Counting lines…' };

function renderLoading(root, status) {
  root.innerHTML = `<div class="oc-wrap">
    ${header()}
    <div class="oc-progress"><div class="oc-progress-bar"></div></div>
    <div class="oc-status-text">${LOADING_LABELS[status] || 'Analyzing…'}</div>
  </div>`;
}

function renderCompleted(root, report, cachedAt, ctx) {
  const { owner, repo, ref, shadow, replaceGhLanguages } = ctx;
  const theme = getTheme();
  const t = report.total;

  const cachedBadge = report.cached ? '<span class="oc-badge">cached</span>' : '';
  const headerRight = `${cachedBadge}<button class="oc-icon-btn oc-refresh-btn" title="Refresh">↺</button>`;

  const statsHTML = `
    <div class="oc-stats-grid">
      <div class="oc-sg-cell">
        <span class="oc-sg-val accent">${formatCompact(t.code)}</span>
        <span class="oc-sg-label">code</span>
      </div>
      <div class="oc-sg-cell">
        <span class="oc-sg-val">${formatCompact(t.files)}</span>
        <span class="oc-sg-label">files</span>
      </div>
      <div class="oc-sg-cell">
        <span class="oc-sg-val">${formatCompact(t.lines)}</span>
        <span class="oc-sg-label">lines</span>
      </div>
      <div class="oc-sg-cell">
        <span class="oc-sg-val">${formatCompact(t.comments)}</span>
        <span class="oc-sg-label">comments</span>
      </div>
    </div>`;

  const langListHTML = buildLangListHTML(report, theme, t.code);

  root.innerHTML = `<div class="oc-wrap">
    ${header(headerRight)}
    ${statsHTML}
    ${buildStackedBarHTML(report, theme)}
    ${langListHTML}
  </div>`;

  root.querySelector('.oc-refresh-btn').addEventListener('click', e => {
    e.stopPropagation();
    renderLoading(root, 'queued');
    startAnalysis({ owner, repo, ref, shadow, root, forceRefresh: true, replaceGhLanguages });
  });

  root.querySelectorAll('.oc-lang-clickable').forEach(row => {
    row.addEventListener('click', e => {
      e.stopPropagation();
      triggerGhLanguageFilter(row.dataset.lang);
    });
  });

  const onForceRefresh = () => {
    unmountPanel();
    renderLoading(root, 'queued');
    startAnalysis({ owner, repo, ref, shadow, root, forceRefresh: true, replaceGhLanguages });
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
    ? `<div class="oc-lang-row oc-lang-more">+ ${extraCount} more →</div>`
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
  document.querySelectorAll('.BorderGrid-row').forEach(row => {
    if (row.dataset.octocountCard) return;
    const h = row.querySelector('h2, h3');
    if (h && h.textContent.trim() === 'Languages') {
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

function renderError(root, error, onRetry) {
  const code = error?.code || 'unknown';
  const message = error?.message || 'Analysis failed';
  const detail = formatErrorDetail(error);
  const isRateLimit = code === 'rate_limited';
  const canRetry = code !== 'rate_limited' && code !== 'private_repo';
  const cls = isRateLimit ? 'oc-warn-text' : 'oc-err-text';
  const icon = isRateLimit ? '!' : 'x';

  root.innerHTML = `<div class="oc-wrap">
    ${header()}
    <div class="${cls}">${icon} ${message}</div>
    <div class="oc-more-hint">click for error details</div>
    <pre class="oc-error-detail" hidden>${escapeHtml(detail)}</pre>
    ${canRetry ? `<div style="margin-top:8px"><button class="oc-count-btn oc-retry-btn">Try again</button></div>` : ''}
  </div>`;

  root.querySelector('.oc-retry-btn')?.addEventListener('click', event => {
    event.stopPropagation();
    onRetry();
  });
  const cardHost = root.getRootNode().host.closest('[data-octocount-card]');
  if (!cardHost) return;
  cardHost.setAttribute('data-state', 'error');
  cardHost.style.cursor = 'pointer';
  if (cardHost._ocListener) {
    cardHost.removeEventListener('click', cardHost._ocListener);
  }
  cardHost._ocListener = event => {
    if (event.target.closest('button')) return;
    const detailEl = root.querySelector('.oc-error-detail');
    detailEl.hidden = !detailEl.hidden;
  };
  cardHost.addEventListener('click', cardHost._ocListener);
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

async function startAnalysis({ owner, repo, ref, shadow, root, forceRefresh, replaceGhLanguages }) {
  stopPolling();
  const ctx = { owner, repo, ref, shadow, replaceGhLanguages };
  try {
    const res = await chrome.runtime.sendMessage({ type: 'ANALYZE', owner, repo, ref, forceRefresh });

    if (res?.error) {
      renderError(root, res.error, () => startAnalysis({ ...ctx, root, forceRefresh: false }));
      return;
    }

    if (res.type === 'CACHED') {
      renderCompleted(root, res.report, res.cachedAt, ctx);
      return;
    }

    const { jobId } = res;
    _pollStart = Date.now();

    const pollUntilDone = async () => {
      const elapsed = Date.now() - _pollStart;
      if (elapsed > POLL_TIMEOUT_MS) {
        stopPolling();
        renderError(root, { code: 'timeout', message: 'Analysis timed out' }, () => startAnalysis({ ...ctx, root, forceRefresh: false }));
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
        stopPolling();
        renderError(root, poll?.error || { code: 'unknown', message: 'Analysis failed' }, () => startAnalysis({ ...ctx, root, forceRefresh: false }));
        return;
      }

      if (poll.type === 'PENDING') {
        renderLoading(root, poll.status);
        _pollTimer = setTimeout(pollUntilDone, pollingInterval(Date.now() - _pollStart));
        return;
      }

      if (poll.type === 'FAILED') {
        stopPolling();
        renderError(root, poll.error || { code: 'unknown', message: 'Analysis failed' }, () => startAnalysis({ ...ctx, root, forceRefresh: false }));
        return;
      }

      if (poll.type === 'COMPLETED') {
        stopPolling();
        renderCompleted(root, poll.report, null, ctx);
      }
    };

    _pollTimer = setTimeout(pollUntilDone, pollingInterval(0));

  } catch (err) {
    renderError(root, { code: 'unknown', message: err.message || 'Failed to start analysis' }, () => startAnalysis({ ...ctx, root, forceRefresh: false }));
  }
}

function formatErrorDetail(error) {
  const lines = [];
  if (error?.status) lines.push(`HTTP status: ${error.status}`);
  if (error?.code) lines.push(`Code: ${error.code}`);
  if (error?.message) lines.push(`Message: ${error.message}`);
  if (error?.detail) lines.push('', String(error.detail).trim());
  return lines.join('\n') || 'No additional details were returned.';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
