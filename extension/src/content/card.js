import cardCss from '../styles/card.css?inline';
import { formatNumber, formatPercent } from '../shared/format.js';
import { languageColor } from '../shared/chart.js';
import { mountPanel } from './panel.js';

const POLL_INTERVAL_MS = 1200;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

let _pollTimer = null;
let _pollStart = null;
let _shadowRoot = null;

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
  _shadowRoot = null;
  document.querySelector('[data-octocount-card]')?.remove();
}

export function mountCard({ owner, repo, ref, autoAnalyze, placement = 'top' }) {
  const grid = findBorderGrid();
  if (!grid) {
    let tries = 0;
    const retry = setInterval(() => {
      tries++;
      const g = findBorderGrid();
      if (g) { clearInterval(retry); _doMount(g, { owner, repo, ref, autoAnalyze, placement }); }
      else if (tries >= 5) clearInterval(retry);
    }, 200);
    return false;
  }
  return _doMount(grid, { owner, repo, ref, autoAnalyze, placement });
}

function _doMount(grid, { owner, repo, ref, autoAnalyze, placement }) {
  const host = document.createElement('div');
  host.dataset.octocountCard = '1';
  host.className = 'BorderGrid-row';

  const cell = document.createElement('div');
  cell.className = 'BorderGrid-cell';
  host.appendChild(cell);

  const shadow = cell.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${cardCss}</style><div class="oc-inner"></div>`;
  _shadowRoot = shadow;

  const theme = getTheme();
  shadow.host.setAttribute('data-theme', theme);

  new MutationObserver(() => {
    shadow.host.setAttribute('data-theme', getTheme());
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-color-mode', 'data-dark-theme', 'data-light-theme'],
  });

  if (placement === 'bottom') {
    grid.append(host);
  } else {
    grid.prepend(host);
  }

  const root = shadow.querySelector('.oc-inner');

  if (autoAnalyze) {
    renderLoading(root, 'queued');
    startAnalysis({ owner, repo, ref, shadow, root, forceRefresh: false });
  } else {
    renderIdle(root, () => {
      renderLoading(root, 'queued');
      startAnalysis({ owner, repo, ref, shadow, root, forceRefresh: false });
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
  const { owner, repo, shadow } = ctx;
  const theme = getTheme();
  const total = report.total;
  const sorted = [...report.languages].sort((a, b) => b.stats.lines - a.stats.lines);
  const totalLines = total.lines;


  // Language bar — all languages proportional, top 4 named, rest grey
  const allSegments = sorted.map((l, i) => {
    const pct = totalLines > 0 ? (l.stats.lines / totalLines * 100).toFixed(2) : 0;
    const color = i < 6 ? languageColor(l.name, theme) : '#57606a';
    return `<div class="oc-bar-seg" style="flex:${pct};background:${color}" title="${l.name} ${pct}%"></div>`;
  }).join('');

  root.innerHTML = `<div class="oc-wrap">
    ${header()}
    <div class="oc-stats">
      <div class="oc-stat">
        <span>Total lines</span>
        <span class="oc-stat-val">${formatNumber(total.lines)}</span>
      </div>
      <div class="oc-stat">
        <span>Code lines</span>
        <span class="oc-stat-val accent">${formatNumber(total.code)}</span>
      </div>
      <div class="oc-stat">
        <span>Languages</span>
        <span class="oc-stat-val">${report.languages.length}</span>
      </div>
    </div>
    <div class="oc-more-hint">more detail →</div>
  </div>`;

  const cardHost = shadow.host.closest('[data-octocount-card]');
  cardHost.setAttribute('data-state', 'completed');
  cardHost.style.cursor = 'pointer';

  // Remove any prior click listener before attaching the new one
  if (cardHost._ocListener) {
    cardHost.removeEventListener('click', cardHost._ocListener);
  }
  const openPanel = () => mountPanel({
    report, owner, repo,
    theme: getTheme(),
  });
  cardHost._ocListener = openPanel;
  cardHost.addEventListener('click', openPanel);
}

function renderError(root, code, message, onRetry) {
  const isRateLimit = code === 'rate_limited';
  const cls = isRateLimit ? 'oc-warn-text' : 'oc-err-text';
  const icon = isRateLimit ? '⚠' : '✕';

  root.innerHTML = `<div class="oc-wrap">
    ${header()}
    <div class="${cls}">${icon} ${message}</div>
    ${isRateLimit
      ? `<div style="margin-top:6px"><button class="oc-link-btn oc-settings-link">Add a GitHub token in settings →</button></div>`
      : `<div style="margin-top:8px"><button class="oc-count-btn oc-retry-btn">Try again</button></div>`
    }
  </div>`;

  root.querySelector('.oc-retry-btn')?.addEventListener('click', onRetry);
  root.querySelector('.oc-settings-link')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage?.();
  });
}

function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  _pollStart = null;
}

async function startAnalysis({ owner, repo, ref, shadow, root, forceRefresh }) {
  stopPolling();
  try {
    const res = await chrome.runtime.sendMessage({ type: 'ANALYZE', owner, repo, ref, forceRefresh });

    if (res?.error) {
      renderError(root, res.error.code, res.error.message,
        () => startAnalysis({ owner, repo, ref, shadow, root, forceRefresh: false }));
      return;
    }

    if (res.type === 'CACHED') {
      renderCompleted(root, res.report, res.cachedAt, { owner, repo, ref, shadow, forceRefresh: false });
      return;
    }

    // JOB — poll until done
    const { jobId } = res;
    _pollStart = Date.now();

    _pollTimer = setInterval(async () => {
      if (Date.now() - _pollStart > POLL_TIMEOUT_MS) {
        stopPolling();
        renderError(root, 'timeout', 'Analysis timed out',
          () => startAnalysis({ owner, repo, ref, shadow, root, forceRefresh: false }));
        return;
      }

      let poll;
      try {
        poll = await chrome.runtime.sendMessage({ type: 'POLL', jobId, owner, repo, ref });
      } catch (_) {
        return; // SW restarting, try next tick
      }

      if (!poll || poll.error) {
        stopPolling();
        renderError(root, poll?.error?.code || 'unknown', poll?.error?.message || 'Analysis failed',
          () => startAnalysis({ owner, repo, ref, shadow, root, forceRefresh: false }));
        return;
      }

      if (poll.type === 'PENDING') { renderLoading(root, poll.status); return; }

      if (poll.type === 'FAILED') {
        stopPolling();
        renderError(root, poll.error?.code || 'unknown', poll.error?.message || 'Analysis failed',
          () => startAnalysis({ owner, repo, ref, shadow, root, forceRefresh: false }));
        return;
      }

      if (poll.type === 'COMPLETED') {
        stopPolling();
        renderCompleted(root, poll.report, null, { owner, repo, ref, shadow, forceRefresh: false });
      }
    }, POLL_INTERVAL_MS);

  } catch (err) {
    renderError(root, 'unknown', err.message || 'Failed to start analysis',
      () => startAnalysis({ owner, repo, ref, shadow, root, forceRefresh: false }));
  }
}

function relativeTime(ms) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
