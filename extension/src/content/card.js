import cardCss from '../styles/card.css?inline';
import { formatNumber } from '../shared/format.js';
import { mountPanel } from './panel.js';

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

async function startAnalysis({ owner, repo, ref, shadow, root, forceRefresh }) {
  stopPolling();
  try {
    const res = await chrome.runtime.sendMessage({ type: 'ANALYZE', owner, repo, ref, forceRefresh });

    if (res?.error) {
      renderError(root, res.error, () => startAnalysis({ owner, repo, ref, shadow, root, forceRefresh: false }));
      return;
    }

    if (res.type === 'CACHED') {
      renderCompleted(root, res.report, res.cachedAt, { owner, repo, ref, shadow, forceRefresh: false });
      return;
    }

    // JOB — poll until done
    const { jobId } = res;
    _pollStart = Date.now();

    const pollUntilDone = async () => {
      const elapsed = Date.now() - _pollStart;
      if (elapsed > POLL_TIMEOUT_MS) {
        stopPolling();
        renderError(root, { code: 'timeout', message: 'Analysis timed out' }, () => startAnalysis({ owner, repo, ref, shadow, root, forceRefresh: false }));
        return;
      }

      let poll;
      try {
        poll = await chrome.runtime.sendMessage({ type: 'POLL', jobId, owner, repo, ref });
      } catch (_) {
        _pollTimer = setTimeout(pollUntilDone, pollingInterval(elapsed));
        return; // SW restarting, try next tick
      }

      if (!poll || poll.error) {
        stopPolling();
        renderError(root, poll?.error || { code: 'unknown', message: 'Analysis failed' }, () => startAnalysis({ owner, repo, ref, shadow, root, forceRefresh: false }));
        return;
      }

      if (poll.type === 'PENDING') {
        renderLoading(root, poll.status);
        _pollTimer = setTimeout(pollUntilDone, pollingInterval(Date.now() - _pollStart));
        return;
      }

      if (poll.type === 'FAILED') {
        stopPolling();
        renderError(root, poll.error || { code: 'unknown', message: 'Analysis failed' }, () => startAnalysis({ owner, repo, ref, shadow, root, forceRefresh: false }));
        return;
      }

      if (poll.type === 'COMPLETED') {
        stopPolling();
        renderCompleted(root, poll.report, null, { owner, repo, ref, shadow, forceRefresh: false });
      }
    };

    _pollTimer = setTimeout(pollUntilDone, pollingInterval(0));

  } catch (err) {
    renderError(root, { code: 'unknown', message: err.message || 'Failed to start analysis' }, () => startAnalysis({ owner, repo, ref, shadow, root, forceRefresh: false }));
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
