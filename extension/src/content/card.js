import cardCss from '../styles/card.css?inline';
import { t } from '../i18n/index.js';
import { formatNumber, formatCompact, formatPercent } from '../shared/format.js';
import { buildBarItems, languageColor } from '../shared/chart.js';
import { mountPanel, unmountPanel } from './panel.js';

const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RETRIES = 4;
const NON_RETRYABLE = new Set(['too_large', 'private_repo', 'forbidden', 'auth_error']);

// Value-moment star nudge: after this many successful card renders, show a
// one-time, dismissible "star the repo" line at the bottom of the card.
const STAR_PROMPT_THRESHOLD = 4;
const STAR_REPO_URL = 'https://github.com/huanglizhuo/OctoCount';
// Guard so a single mount (including its refreshes) counts as one success.
let _starCountedThisMount = false;

const SKEL_WIDTHS  = [78, 60, 70, 52, 65, 74, 58, 68];
const SKEL_DEFAULT = 4;
const SKEL_MIN     = 2;
const SKEL_MAX     = 5;

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

// Remove a card host, running any theme-listener cleanup registered on it.
function teardownCardHost(host) {
  if (!host) return;
  host._ocThemeCleanup?.();
  host.remove();
}

export function unmountCard() {
  _generation++;
  stopPolling();
  _analyzing = false;
  _starCountedThisMount = false;
  restoreGhLanguagesSection();
  teardownCardHost(document.querySelector('[data-octocount-card]'));
}

export function mountCard({ owner, repo, ref, autoAnalyze, placement = 'top', replaceGhLanguages = true, forceRefresh = false, silentUntilSuccess = false, cardTitle = '' }) {
  _disabled = false;
  _generation++;
  _starCountedThisMount = false;
  const gen = _generation;

  const grid = findBorderGrid();
  if (!grid) {
    let tries = 0;
    const retry = setInterval(() => {
      tries++;
      const g = findBorderGrid();
      if (g) {
        clearInterval(retry);
        _doMount(g, { owner, repo, ref, autoAnalyze, placement, replaceGhLanguages, forceRefresh, silentUntilSuccess, cardTitle, gen });
      } else if (tries >= 5) {
        clearInterval(retry);
      }
    }, 200);
    return false;
  }
  return _doMount(grid, { owner, repo, ref, autoAnalyze, placement, replaceGhLanguages, forceRefresh, silentUntilSuccess, cardTitle, gen });
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
  const themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-color-mode', 'data-dark-theme', 'data-light-theme'],
  });
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', syncTheme);
  // Store teardown on the host so remounts (SPA navigation) don't leak the
  // documentElement observer and matchMedia listener onto detached shadow roots.
  host._ocThemeCleanup = () => {
    themeObserver.disconnect();
    mql.removeEventListener('change', syncTheme);
  };

  if (placement === 'bottom') {
    grid.append(host);
  } else {
    grid.prepend(host);
  }

  const root = shadow.querySelector('.oc-inner');
  return { host, root, shadow };
}

function _doMount(grid, { owner, repo, ref, autoAnalyze, placement, replaceGhLanguages, forceRefresh, silentUntilSuccess, cardTitle = '', gen }) {
  // Silent mode: don't insert a card until the API returns success
  if (silentUntilSuccess) {
    if (autoAnalyze || forceRefresh) {
      _analyzing = true;
      _launchSilentAnalysis(grid, { owner, repo, ref, placement, replaceGhLanguages, forceRefresh, cardTitle, gen });
    } else {
      // Idle card with button; on click remove it and run silently
      const { host, root } = _createCardDom(grid, placement);
      renderIdle(root, () => {
        teardownCardHost(host);
        _analyzing = true;
        _launchSilentAnalysis(grid, { owner, repo, ref, placement, replaceGhLanguages, forceRefresh: false, cardTitle, gen });
      }, cardTitle);
    }
    return true;
  }

  // Default mode: insert card immediately with loading/idle UI
  const { host, root, shadow } = _createCardDom(grid, placement);
  const ctx = { owner, repo, ref, shadow, replaceGhLanguages, cardTitle };

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
        teardownCardHost(host);
        restoreGhLanguagesSection();
      },
    });
  }

  if (autoAnalyze || forceRefresh) {
    renderLoading(root, cardTitle);
    runAnalysis(forceRefresh);
  } else {
    renderIdle(root, () => {
      renderLoading(root, cardTitle);
      runAnalysis(false);
    }, cardTitle);
  }

  return true;
}

// Silent path: no card inserted until API succeeds
function _launchSilentAnalysis(grid, { owner, repo, ref, placement, replaceGhLanguages, forceRefresh, cardTitle, gen }) {
  startAnalysis({
    owner, repo, ref, forceRefresh,
    onCompleted: (report, cachedAt) => {
      if (_generation !== gen) return;
      _analyzing = false;
      chrome.storage.local.remove('lastError').catch(() => {});
      _insertCompletedCard(grid, { owner, repo, ref, placement, replaceGhLanguages, cardTitle, report, cachedAt });
    },
    onError: (error) => {
      if (_generation !== gen) return;
      _analyzing = false;
      _disabled = true;
      saveError(error, owner, repo);
    },
  });
}

function _insertCompletedCard(grid, { owner, repo, ref, placement, replaceGhLanguages, cardTitle, report, cachedAt }) {
  const { host, root, shadow } = _createCardDom(grid, placement);
  const ctx = { owner, repo, ref, shadow, replaceGhLanguages, cardTitle };

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
        teardownCardHost(host);
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

function header(rightHTML = '', cardTitle = '') {
  const title = cardTitle.trim() || t('card.title');
  return `
    <div class="oc-header">
      <div class="oc-title">${escapeHtml(title)}</div>
      <div class="oc-header-right">${rightHTML}</div>
    </div>`;
}

function renderIdle(root, onCount, cardTitle = '') {
  root.innerHTML = `<div class="oc-wrap">
    ${header(`<button class="oc-count-btn">${t('card.countSloc')}</button>`, cardTitle)}
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

function skelMoreRow() {
  return `<div class="oc-lang-row oc-lang-more">
    <div class="oc-skel oc-skel--lang-name" style="max-width:45%"></div>
  </div>`;
}

function readGhLanguageCount() {
  try {
    const headings = ['Languages', '语言', '言語', 'Langues', 'Idiomas'];
    for (const row of document.querySelectorAll('.BorderGrid-row')) {
      if (row.dataset.octocountCard) continue;
      const h = row.querySelector('h2, h3');
      if (h && headings.includes(h.textContent.trim())) {
        const n = row.querySelectorAll('li').length;
        if (n > 0) return Math.min(Math.max(n, SKEL_MIN), SKEL_MAX);
        break;
      }
    }
  } catch (_) {}
  return null;
}

function renderLoading(root, cardTitle = '') {
  const rawCount = readGhLanguageCount() ?? SKEL_DEFAULT;
  const count    = Math.min(rawCount, SKEL_MAX);
  const hasMore  = rawCount > SKEL_MAX;
  const langRows = Array.from({ length: count }, (_, i) =>
    skelLangRow(SKEL_WIDTHS[i % SKEL_WIDTHS.length])
  ).join('') + (hasMore ? skelMoreRow() : '');

  root.innerHTML = `<div class="oc-wrap">
    ${header('<div class="oc-skel oc-skel--icon"></div>', cardTitle)}
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
    <div class="oc-lang-list">${langRows}</div>
  </div>`;
}

function renderCompleted(root, report, cachedAt, ctx, onRefresh) {
  const { owner, repo, ref, shadow, replaceGhLanguages, cardTitle = '' } = ctx;
  const theme = getTheme();
  const total = report.total;

  const cachedBadge = report.cached
    ? `<span class="oc-badge" title="${cachedAt ? 'Cached ' + new Date(cachedAt).toLocaleString() : t('card.cached')}">${t('card.cached')}</span>`
    : '';
  const headerRight = `${cachedBadge}<button class="oc-icon-btn oc-refresh-btn" title="${t('card.refreshTitle')}" aria-label="${t('card.refreshTitle')}">↺</button>`;

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
    ${header(headerRight, cardTitle)}
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
  cardHost.setAttribute('role', 'button');
  cardHost.setAttribute('tabindex', '0');
  cardHost.setAttribute('aria-label', t('card.openPanel'));
  if (cardHost._ocListener) cardHost.removeEventListener('click', cardHost._ocListener);
  if (cardHost._ocKeyListener) cardHost.removeEventListener('keydown', cardHost._ocKeyListener);
  const openPanel = () => mountPanel({ report, owner, repo, theme: getTheme(), onForceRefresh });
  const onKey = e => {
    // Only when the card itself is focused — keydowns from inner controls
    // (refresh, language rows, star link) retarget to the shadow host, not this.
    if (e.target !== cardHost) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPanel();
    }
  };
  cardHost._ocListener = openPanel;
  cardHost._ocKeyListener = onKey;
  cardHost.addEventListener('click', openPanel);
  cardHost.addEventListener('keydown', onKey);

  if (replaceGhLanguages) hideGhLanguagesSection();

  recordSuccessAndMaybePrompt(root);
}

// Count this successful render (once per mount) and, once the threshold is
// reached, append a one-time dismissible star nudge to the card.
async function recordSuccessAndMaybePrompt(root) {
  const increment = !_starCountedThisMount;
  _starCountedThisMount = true;

  let state;
  try {
    state = await chrome.storage.local.get({ starPromptCount: 0, starPromptDismissed: false });
  } catch (_) {
    return;
  }
  if (state.starPromptDismissed) return;

  let count = state.starPromptCount;
  if (increment) {
    count += 1;
    try { await chrome.storage.local.set({ starPromptCount: count }); } catch (_) {}
  }
  if (count < STAR_PROMPT_THRESHOLD) return;

  appendStarPrompt(root);
}

function appendStarPrompt(root) {
  const wrap = root.querySelector('.oc-wrap');
  if (!wrap || wrap.querySelector('.oc-star-prompt')) return;

  const el = document.createElement('div');
  el.className = 'oc-star-prompt';
  // Clicks inside the prompt must not bubble to the card's open-panel handler.
  el.addEventListener('click', e => e.stopPropagation());

  const link = document.createElement('a');
  link.className = 'oc-star-link';
  link.href = STAR_REPO_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = t('card.starPrompt');
  link.addEventListener('click', () => {
    chrome.storage.local.set({ starPromptDismissed: true }).catch(() => {});
  });

  const close = document.createElement('button');
  close.className = 'oc-star-close';
  close.type = 'button';
  close.setAttribute('aria-label', t('card.starDismiss'));
  close.textContent = '×';
  close.addEventListener('click', () => {
    chrome.storage.local.set({ starPromptDismissed: true }).catch(() => {});
    el.remove();
  });

  el.appendChild(link);
  el.appendChild(close);
  wrap.appendChild(el);
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
    const tip = `${lang.name}: ${formatNumber(lang.stats.code)} code, ${formatNumber(lang.stats.lines)} lines, ${formatNumber(lang.stats.files)} files`;
    return `<div class="oc-lang-row oc-lang-clickable" data-lang="${escapeHtml(lang.name)}" title="${escapeHtml(tip)}">
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
  const languageHeadings = ['Languages', '语言', '言語', 'Langues', 'Idiomas'];
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
