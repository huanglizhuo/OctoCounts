import cardCss from '../styles/card.css?inline';
import { t } from '../i18n/index.js';
import { formatNumber, formatCompact, formatPercent } from '../shared/format.js';
import { buildBarItems, languageColor } from '../shared/chart.js';
import { mountPanel, unmountPanel } from './panel.js';
import { getAuthState } from '../shared/github-auth.js';
import { buildStarHistoryHTML } from './star-chart.js';

const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RETRIES = 4;
// Retrying cannot change any of these answers, so the four retries below only
// spend ~15s (1s + 2s + 4s + 8s) producing the same failure a fifth time.
//
// `not_found` is deliberately NOT here even though it sounds terminal: the API
// returns it for the archive download 404ing as well as for a missing
// repository, and the card only ever runs on a page GitHub has already rendered
// as a public repo — so on this surface a 404 is far more likely transient than
// a repository that does not exist. The backend retries 5xx and 429 but never a
// 404, so the client retry is the only one that case gets.
const NON_RETRYABLE = new Set([
  'too_large', 'private_repo', 'forbidden', 'auth_error',
  'ref_not_found', 'invalid_url',
]);
const STAR_SUCCESS_COUNT_KEY = 'starPromptSuccessCount';

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
  // Clearing _disabled matters: the entry point consults getCardActivity()
  // *before* mounting, so an error left over from the previous repo would
  // otherwise block the next one from ever getting a card.
  _disabled = false;
  restoreGhLanguagesSection();
  // querySelectorAll, not querySelector: if a re-render ever leaves a duplicate
  // behind, a single-element teardown could never clean it up again.
  document.querySelectorAll('[data-octocount-card]').forEach(teardownCardHost);
}

/**
 * Insert the card at an already-resolved mount point.
 *
 * `mount` comes from resolveSidebar() in github-dom.js — this module no longer
 * looks for the sidebar itself, and no longer retries on its own. Retrying is
 * the content entry point's job so there is exactly one retry mechanism.
 */
export function mountCard({ mount, owner, repo, ref, autoAnalyze, placement = 'top', replaceGhLanguages = true, forceRefresh = false, silentUntilSuccess = false, cardTitle = '' }) {
  if (!mount?.grid) return false;

  _disabled = false;
  _generation++;
  const gen = _generation;

  return _doMount(mount, { owner, repo, ref, autoAnalyze, placement, replaceGhLanguages, forceRefresh, silentUntilSuccess, cardTitle, gen });
}

function _createCardDom(mount, placement) {
  // Own element and own shadow root: no Primer class names, so nothing here
  // depends on GitHub still shipping CSS for `.BorderGrid-row`/`-cell`.
  const host = document.createElement('section');
  host.dataset.octocountCard = '1';
  host.dataset.strategy = mount.strategy || 'unknown';

  const shadow = host.attachShadow({ mode: 'open' });
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

  if (mount.insertBefore?.parentElement === mount.grid) {
    mount.grid.insertBefore(host, mount.insertBefore);
  } else if (placement === 'bottom') {
    mount.grid.append(host);
  } else {
    mount.grid.prepend(host);
  }

  const root = shadow.querySelector('.oc-inner');
  return { host, root, shadow };
}

function _doMount(mount, { owner, repo, ref, autoAnalyze, placement, replaceGhLanguages, forceRefresh, silentUntilSuccess, cardTitle = '', gen }) {
  const languagesSection = mount.languagesSection || null;

  // Silent mode: don't insert a card until the API returns success
  if (silentUntilSuccess) {
    if (autoAnalyze || forceRefresh) {
      _analyzing = true;
      _launchSilentAnalysis(mount, { owner, repo, ref, placement, replaceGhLanguages, forceRefresh, cardTitle, gen });
    } else {
      // Idle card with button; on click remove it and run silently
      const { host, root } = _createCardDom(mount, placement);
      renderIdle(root, () => {
        teardownCardHost(host);
        _analyzing = true;
        _launchSilentAnalysis(mount, { owner, repo, ref, placement, replaceGhLanguages, forceRefresh: false, cardTitle, gen });
      }, cardTitle);
    }
    return true;
  }

  // Default mode: insert card immediately with loading/idle UI
  const { root, shadow } = _createCardDom(mount, placement);
  const ctx = { owner, repo, ref, shadow, replaceGhLanguages, cardTitle, languagesSection };

  function runAnalysis(force) {
    startAnalysis({
      owner, repo, ref, forceRefresh: force,
      onStatus: (status) => {
        if (_generation !== gen) return;
        const el = root.querySelector('.oc-status');
        if (el) el.textContent = t('card.' + status);
      },
      onCompleted: (report, cachedAt) => {
        if (_generation !== gen) return;
        chrome.storage.local.remove('lastError').catch(() => {});
        renderCompleted(root, report, cachedAt, ctx, () => {
          renderLoading(root, ctx, 'analyzing');
          runAnalysis(true);
        });
      },
      onError: (error) => {
        if (_generation !== gen) return;
        _disabled = true;
        saveError(error, owner, repo);
        renderError(root, error, ctx, () => {
          if (_generation !== gen) return;
          _disabled = false;
          renderLoading(root, ctx, 'analyzing');
          runAnalysis(false);
        });
      },
    });
  }

  if (autoAnalyze || forceRefresh) {
    renderLoading(root, ctx);
    runAnalysis(forceRefresh);
  } else {
    renderIdle(root, () => {
      renderLoading(root, ctx);
      runAnalysis(false);
    }, cardTitle);
  }

  return true;
}

// Silent path: no card inserted until API succeeds
function _launchSilentAnalysis(mount, { owner, repo, ref, placement, replaceGhLanguages, forceRefresh, cardTitle, gen }) {
  startAnalysis({
    owner, repo, ref, forceRefresh,
    onCompleted: (report, cachedAt) => {
      if (_generation !== gen) return;
      _analyzing = false;
      chrome.storage.local.remove('lastError').catch(() => {});
      _insertCompletedCard(mount, { owner, repo, ref, placement, replaceGhLanguages, cardTitle, report, cachedAt });
    },
    onError: (error) => {
      if (_generation !== gen) return;
      _analyzing = false;
      _disabled = true;
      saveError(error, owner, repo);
    },
  });
}

function _insertCompletedCard(mount, { owner, repo, ref, placement, replaceGhLanguages, cardTitle, report, cachedAt }) {
  const { root, shadow } = _createCardDom(mount, placement);
  const ctx = { owner, repo, ref, shadow, replaceGhLanguages, cardTitle, languagesSection: mount.languagesSection || null };

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
        renderError(root, error, ctx, () => {
          _disabled = false;
          onRefresh();
        });
      },
    });
  }

  renderCompleted(root, report, cachedAt, ctx, onRefresh);
}

// Why there is legitimately no card on screen right now, so the entry point can
// tell "still working" apart from "we failed to find a mount point".
export function getCardActivity() {
  return { analyzing: _analyzing, errored: _disabled };
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
      <h2 class="oc-title">${escapeHtml(title)}</h2>
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

// Skeleton row count, taken from the native Languages section that
// resolveSidebar() already identified — no second, divergent DOM lookup.
function readGhLanguageCount(languagesSection) {
  if (!languagesSection) return null;
  try {
    const n = languagesSection.querySelectorAll('li').length;
    if (n > 0) return Math.min(Math.max(n, SKEL_MIN), SKEL_MAX);
  } catch (_) {}
  return null;
}

function renderLoading(root, ctx = {}, status = 'analyzing') {
  const cardTitle = ctx.cardTitle || '';
  const rawCount = readGhLanguageCount(ctx.languagesSection) ?? SKEL_DEFAULT;
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
    <div class="oc-status" role="status" aria-live="polite">${t('card.' + status)}</div>
  </div>`;
}

function renderCompleted(root, report, cachedAt, ctx, onRefresh) {
  const { owner, repo, ref, shadow, replaceGhLanguages, cardTitle = '' } = ctx;
  const theme = getTheme();
  const total = report.total;
  recordSuccessfulRender();
  maybeTriggerStarHistoryBackfill(owner, repo);

  const cachedBadge = report.cached
    ? `<span class="oc-badge" title="${cachedAt ? escapeHtml(t('card.cachedAt', { time: new Date(cachedAt).toLocaleString() })) : t('card.cached')}">${t('card.cached')}</span>`
    : '';
  const headerRight = `${cachedBadge}<button class="oc-icon-btn oc-open-panel-btn" title="${t('card.openPanel')}" aria-label="${t('card.openPanel')}">↗</button><button class="oc-icon-btn oc-refresh-btn" title="${t('card.refreshTitle')}" aria-label="${t('card.refreshTitle')}">↺</button>`;

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
      <div class="oc-sg-cell" title="${t('card.comments')}: ${formatNumber(total.comments)} · ${formatPercent(total.comments, total.lines)}">
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
  </div>
  <div class="oc-star-history-wrap"></div>`;

  maybeRenderStarHistory(root, owner, repo);

  const onForceRefresh = () => {
    unmountPanel();
    onRefresh();
  };
  const openPanel = () => mountPanel({ report, owner, repo, theme: getTheme(), onForceRefresh });

  root.querySelector('.oc-open-panel-btn').addEventListener('click', e => {
    e.stopPropagation();
    openPanel();
  });

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

  root.querySelector('.oc-lang-more')?.addEventListener('click', e => {
    e.stopPropagation();
    mountPanel({ report, owner, repo, theme: getTheme(), onForceRefresh });
  });

  const cardHost = shadow.host.closest('[data-octocount-card]');
  cardHost.setAttribute('data-state', 'completed');
  cardHost.style.cursor = 'pointer';
  cardHost.setAttribute('role', 'region');
  cardHost.setAttribute('aria-label', t('card.openPanel'));
  cardHost.removeAttribute('tabindex');
  if (cardHost._ocListener) cardHost.removeEventListener('click', cardHost._ocListener);
  if (cardHost._ocKeyListener) cardHost.removeEventListener('keydown', cardHost._ocKeyListener);
  const onCardClick = e => {
    const origin = e.composedPath()[0];
    if (origin?.closest?.('button, a, input, select, textarea')) return;
    openPanel();
  };
  cardHost._ocListener = onCardClick;
  cardHost._ocKeyListener = null;
  cardHost.addEventListener('click', onCardClick);

  if (replaceGhLanguages) hideGhLanguagesSection(ctx.languagesSection);
}

// Maps background error codes to localized, user-readable one-liners.
// (classifyError returns {code, status, detail} without a message.)
function errorMessage(error) {
  const codeMap = {
    rate_limited: t('error.rateLimited'),
    github_unavailable: t('error.githubUnavailable'),
    private_repo: t('error.privateRepo'),
    forbidden:    t('error.forbidden'),
    too_large:    t('error.tooLarge'),
    not_found:    t('error.notFound'),
    auth_error:   t('error.authError'),
    offline:      t('error.offline'),
    timeout:      t('card.error.timedOut'),
    // Every code in NON_RETRYABLE needs an entry here, because there is no
    // second line of defence: `classifyError` in `background/index.js` returns
    // `{ code, status, detail }` and drops the API's `message`, so the
    // `error?.message` term below is always `undefined`. An unmapped code
    // therefore renders as "Analysis failed" — and, being non-retryable, with no
    // retry button either. No explanation and no action. `ref_not_found` also
    // covers a repository with no commits, which the API reports under this same
    // code.
    ref_not_found: t('error.refNotFound'),
    invalid_url:   t('error.invalidUrl'),
  };
  return codeMap[error?.code] || error?.message || t('error.unknown');
}

// Inline error state: the card stays in place with a retry action instead of
// silently disappearing from the sidebar.
function renderError(root, error, ctx, onRetry) {
  const { cardTitle = '', shadow } = ctx;
  const code = error?.code || 'unknown';
  const message = errorMessage(error);
  const retryable = !NON_RETRYABLE.has(code);

  const detailLines = [];
  if (error?.status)  detailLines.push(`HTTP status: ${error.status}`);
  if (code)           detailLines.push(`Code: ${code}`);
  if (error?.message) detailLines.push(`Message: ${error.message}`);
  if (error?.detail)  detailLines.push('', String(error.detail).trim());
  const detailText = detailLines.join('\n').trim() || t('card.error.noDetails');

  // Refresh errors can replace a completed card. Clear the previous report
  // opener so the error surface cannot navigate to stale data.
  // `root` is the .oc-inner div, so the host has to come from the shadow root.
  const cardHost = shadow.host.closest('[data-octocount-card]');
  cardHost.setAttribute('data-state', 'error');
  cardHost.style.cursor = '';
  cardHost.setAttribute('role', 'region');
  cardHost.setAttribute('aria-label', t('card.error.title'));
  cardHost.removeAttribute('tabindex');
  if (cardHost._ocListener) cardHost.removeEventListener('click', cardHost._ocListener);
  if (cardHost._ocKeyListener) cardHost.removeEventListener('keydown', cardHost._ocKeyListener);
  cardHost._ocListener = null;
  cardHost._ocKeyListener = null;

  root.innerHTML = `<div class="oc-wrap">
    ${header('', cardTitle)}
    <div class="oc-err-text" role="alert">${escapeHtml(t('card.error.title'))}</div>
    <div class="oc-err-msg" title="${escapeHtml(message)}">${escapeHtml(message)}</div>
    ${retryable ? `<button type="button" class="oc-link-btn oc-err-retry">${t('card.error.tryAgain')}</button>` : ''}
    <button type="button" class="oc-link-btn oc-err-details" aria-expanded="false" aria-controls="oc-error-detail">${t('card.error.clickDetails')}</button>
    <pre id="oc-error-detail" class="oc-error-detail" hidden>${escapeHtml(detailText)}</pre>
  </div>`;

  root.querySelector('.oc-err-retry')?.addEventListener('click', e => {
    e.stopPropagation();
    onRetry();
  });
  const detailsBtn = root.querySelector('.oc-err-details');
  const detailEl = root.querySelector('.oc-error-detail');
  detailsBtn.addEventListener('click', e => {
    e.stopPropagation();
    const show = detailEl.hidden;
    detailEl.hidden = !show;
    detailsBtn.setAttribute('aria-expanded', String(show));
  });
}

async function recordSuccessfulRender() {
  try {
    const state = await chrome.storage.local.get({ [STAR_SUCCESS_COUNT_KEY]: 0 });
    const next = Math.min(Number(state[STAR_SUCCESS_COUNT_KEY] || 0) + 1, 1000);
    await chrome.storage.local.set({ [STAR_SUCCESS_COUNT_KEY]: next });
  } catch (_) {}
}

// Shared gate for both the backfill trigger and the star-history render
// below: only ever for the logged-in GitHub account's own repos, and only
// while the setting is on.
async function isStarHistoryEnabledFor(owner) {
  const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  if (settings?.showStarHistory === false) return false;
  const { loggedIn, login } = await getAuthState();
  return Boolean(loggedIn && login && login.toLowerCase() === String(owner).toLowerCase());
}

// Fire-and-forget: once per repo, if the logged-in GitHub account owns it and
// the setting is on, ask the backend to verify+backfill its real star
// history. The backend's own claim-then-spawn logic already makes a repeat
// call for an already-backfilled repo a cheap no-op, but this local flag
// avoids re-sending the request on every single card render regardless.
async function maybeTriggerStarHistoryBackfill(owner, repo) {
  try {
    if (!(await isStarHistoryEnabledFor(owner))) return;

    const key = `starBackfillTriggered::${owner}/${repo}`;
    const stored = await chrome.storage.local.get(key);
    if (stored[key]) return;
    await chrome.storage.local.set({ [key]: true });
    await chrome.runtime.sendMessage({ type: 'CONNECT_STAR_HISTORY', owner, repo });
  } catch (_) {}
}

// Renders the star-history block directly under the OctoCounts card on the
// GitHub page itself (not gated behind opening the panel) — styled with the
// same GitHub-native tokens as the rest of the card via the shared shadow
// root, so light/dark mode is inherited automatically.
async function maybeRenderStarHistory(root, owner, repo) {
  try {
    if (!(await isStarHistoryEnabledFor(owner))) return;

    const history = await chrome.runtime.sendMessage({ type: 'FETCH_STAR_HISTORY', owner, repo });
    const points = history?.starPoints ?? [];
    if (points.length < 2) return;

    const wrap = root.querySelector('.oc-star-history-wrap');
    if (wrap) wrap.innerHTML = buildStarHistoryHTML(points);
  } catch (_) {
    // Best-effort: the card already rendered everything else successfully,
    // so a star-history failure should not surface as a visible error.
  }
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
    return `<button type="button" class="oc-lang-row oc-lang-clickable" data-lang="${escapeHtml(lang.name)}" title="${escapeHtml(tip)}">
      <span class="oc-lang-dot" style="background:${color}"></span>
      <span class="oc-lang-name">${escapeHtml(lang.name)}</span>
      <span class="oc-lang-pct">${pct}</span>
      <span class="oc-lang-code">${formatCompact(lang.stats.code)}</span>
    </button>`;
  }).join('');

  const moreRow = extraCount > 0
    ? `<button type="button" class="oc-lang-row oc-lang-more">${t('card.moreLanguages', { count: extraCount })}</button>`
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

// display:none rather than remove(): triggerGhLanguageFilter() clicks GitHub's
// own `?l=` links to apply the language filter, and those links have to stay in
// the document for that to work.
function hideGhLanguagesSection(languagesSection) {
  if (!languagesSection || languagesSection.dataset.octocountCard) return;
  languagesSection.style.display = 'none';
  languagesSection.dataset.octocountHidden = '1';
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

async function startAnalysis({ owner, repo, ref, forceRefresh, onCompleted, onError, onStatus, _retryEntry = false }) {
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
    onStatus?.('queued');

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
        onStatus?.('running');
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
