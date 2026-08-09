import { getRepoVisibility, isRepoPage, isPrivateRepo, parseRepoInfo } from './detect.js';
import { resolveSidebar, collectDomFingerprint, fingerprintHash } from './github-dom.js';
import { mountCard, unmountCard, getCardActivity } from './card.js';
import { unmountPanel } from './panel.js';

/*
 * Why there is no card on screen. The popup needs this to tell "GitHub changed
 * its DOM and we could not find a mount point" (worth reporting) apart from the
 * six perfectly normal reasons a repo page has no card (not worth reporting).
 */
const STATE = {
  NOT_REPO: 'not_repo',
  PRIVATE: 'private',
  VISIBILITY_UNKNOWN: 'visibility_unknown',
  SKIPPED_FORK: 'skipped_fork',
  DISABLED_BY_USER: 'disabled_by_user',
  PENDING: 'pending',
  ANALYZING: 'analyzing',
  API_ERROR: 'api_error',
  MOUNTED: 'mounted',
  MOUNT_FAILED: 'mount_failed',
};

// The sidebar is React-rendered and lands after document_end, so "no mount
// point" is only a failure once the page has had a fair chance to render.
const MOUNT_ATTEMPT_CAP = 10;
const MOUNT_DEADLINE_MS = 6000;
const ROUTE_DEBOUNCE_MS = 150;
// A page that genuinely has no sidebar (GitHub removed it, or an experiment we
// cannot read) would otherwise re-resolve forever on every mutation burst.
const MOUNT_ATTEMPT_HARD_CAP = 40;

let routeObserver = null;
let routeDebounce = null;
let deadlineTimer = null;

// Resolved once per repo context: everything that needs async IO lives here so
// that DOM activity can retry mounting without re-reading settings or storage.
let plan = null;
let mountState = STATE.NOT_REPO;
let mountAttempts = 0;
let contextStartedAt = 0;
let lastResolution = null;

let running = false;
let scheduled = false;

/* ── async pass: decide whether this page should get a card ───────────────── */

async function run() {
  if (running) {
    scheduleRun();
    return;
  }

  running = true;
  try {
    if (!isRepoPage()) {
      resetContext(STATE.NOT_REPO);
      return;
    }

    const visibility = getRepoVisibility();
    if (visibility === 'private') {
      resetContext(STATE.PRIVATE);
      return;
    }
    if (visibility !== 'public') {
      resetContext(STATE.VISIBILITY_UNKNOWN);
      return;
    }

    const info = parseRepoInfo();
    const contextKey = `${info.owner}/${info.repo}@${info.ref}`;

    // Same repo, same ref: nothing async to redo, just make sure a card exists.
    if (plan?.contextKey === contextKey) {
      ensureMounted();
      return;
    }

    unmountCard();
    unmountPanel();

    let settings;
    try {
      settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    } catch (_) {
      settings = { skipForks: true, cardPlacement: 'top' };
    }

    if (settings.skipForks && info.isFork) {
      setContext(contextKey, info, settings, false, STATE.SKIPPED_FORK);
      return;
    }

    let disabled = false;
    try {
      const key = `disabled::${info.owner}/${info.repo}`;
      disabled = (await chrome.storage.local.get(key))[key] === true;
    } catch (_) {}

    if (disabled) {
      setContext(contextKey, info, settings, false, STATE.DISABLED_BY_USER);
      return;
    }

    setContext(contextKey, info, settings, true, STATE.PENDING);
    ensureMounted();
    armDeadline();
  } finally {
    running = false;
  }
}

/* ── sync pass: get a card onto the page ─────────────────────────────────── */

/**
 * Idempotent, synchronous, no IO — safe to call from a MutationObserver.
 * This is the extension's only mount retry path; card.js does not retry.
 */
function ensureMounted() {
  if (!plan?.shouldMount) return;
  if (mountState === STATE.MOUNT_FAILED && mountAttempts >= MOUNT_ATTEMPT_HARD_CAP) return;

  if (document.querySelector('[data-octocount-card]')) {
    mountState = STATE.MOUNTED;
    return;
  }

  // Silent mode deliberately shows nothing until the API answers, and a failed
  // analysis deliberately leaves the sidebar untouched. Neither is a mount
  // failure, and re-mounting here would restart the analysis on every mutation.
  const activity = getCardActivity();
  if (activity.analyzing) {
    mountState = STATE.ANALYZING;
    return;
  }
  if (activity.errored) {
    mountState = STATE.API_ERROR;
    return;
  }

  const { owner, repo, ref, settings } = plan;
  const resolution = resolveSidebar({ owner, repo });
  lastResolution = resolution;

  if (!resolution.grid) {
    mountAttempts++;
    mountState = mountExhausted() ? STATE.MOUNT_FAILED : STATE.PENDING;
    return;
  }

  const mounted = mountCard({
    mount: resolution,
    owner,
    repo,
    ref,
    autoAnalyze: true,
    placement: settings.cardPlacement === 'bottom' ? 'bottom' : 'top',
    replaceGhLanguages: settings.replaceGhLanguages !== false,
    silentUntilSuccess: settings.silentUntilSuccess === true,
    cardTitle: settings.cardTitle || '',
  });

  if (!mounted) {
    mountAttempts++;
    mountState = mountExhausted() ? STATE.MOUNT_FAILED : STATE.PENDING;
    return;
  }

  mountState = settings.silentUntilSuccess === true ? STATE.ANALYZING : STATE.MOUNTED;
}

function mountExhausted() {
  return mountAttempts >= MOUNT_ATTEMPT_CAP
    || Date.now() - contextStartedAt >= MOUNT_DEADLINE_MS;
}

// A single timer per context, so a page that simply stops mutating still reaches
// a final verdict instead of sitting in `pending` forever.
function armDeadline() {
  clearTimeout(deadlineTimer);
  deadlineTimer = setTimeout(() => {
    if (!plan?.shouldMount) return;
    ensureMounted();
    if (mountState === STATE.PENDING) mountState = STATE.MOUNT_FAILED;
  }, MOUNT_DEADLINE_MS);
}

function setContext(contextKey, info, settings, shouldMount, state) {
  plan = { contextKey, owner: info.owner, repo: info.repo, ref: info.ref, settings, shouldMount };
  mountState = state;
  mountAttempts = 0;
  contextStartedAt = Date.now();
  lastResolution = null;
}

function resetContext(state) {
  unmountCard();
  unmountPanel();
  clearTimeout(deadlineTimer);
  plan = null;
  mountState = state;
  mountAttempts = 0;
  lastResolution = null;
}

/* ── scheduling ──────────────────────────────────────────────────────────── */

function scheduleRun() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    run();
  }, 100);
}

// GitHub mutates the DOM constantly. Cheap path first: if the repo context has
// not changed, only ensureMounted() runs — no settings read, no storage read.
function onDomActivity() {
  if (running) return;

  if (!isRepoPage()) {
    if (plan) scheduleRun();
    return;
  }

  const info = parseRepoInfo();
  const contextKey = `${info.owner}/${info.repo}@${info.ref}`;
  if (plan?.contextKey !== contextKey) {
    scheduleRun();
    return;
  }

  ensureMounted();
}

function scheduleContextCheck() {
  clearTimeout(routeDebounce);
  routeDebounce = setTimeout(onDomActivity, ROUTE_DEBOUNCE_MS);
}

// One observer for the whole page. It already fires when GitHub re-renders the
// sidebar and drops our card, which is why there is no separate guard observer.
function observeRouteChanges() {
  if (routeObserver) return;
  routeObserver = new MutationObserver(scheduleContextCheck);
  routeObserver.observe(document.body, { childList: true, subtree: true });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    plan = null;
    scheduleRun();
  }
  if (area === 'local' && Object.keys(changes).some(k => k.startsWith('disabled::'))) {
    plan = null;
    scheduleRun();
  }
});

/* ── popup messaging ─────────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_PAGE_STATUS') {
    const onRepoPage = isRepoPage();
    const info = onRepoPage ? parseRepoInfo() : {};
    sendResponse({
      isRepoPage: onRepoPage,
      isPrivateRepo: onRepoPage && isPrivateRepo(),
      visibility: onRepoPage ? getRepoVisibility() : 'unknown',
      owner: info.owner ?? null,
      repo: info.repo ?? null,
      mountState: onRepoPage ? mountState : STATE.NOT_REPO,
      strategy: document.querySelector('[data-octocount-card]')?.dataset.strategy ?? null,
    });
    return false;
  }

  if (msg.type === 'GET_MOUNT_DIAGNOSTICS') {
    const info = parseRepoInfo();
    // Resolve once more so the report describes the page as it is right now,
    // including a fresh per-strategy rejection trace.
    const resolution = info.owner
      ? resolveSidebar({ owner: info.owner, repo: info.repo })
      : lastResolution;
    const fingerprint = collectDomFingerprint({
      owner: info.owner,
      repo: info.repo,
      resolution: resolution || lastResolution,
    });
    sendResponse({
      fingerprint,
      hash: fingerprintHash(fingerprint),
      owner: info.owner ?? null,
      repo: info.repo ?? null,
      mountState,
    });
    return false;
  }
});

run();
observeRouteChanges();
document.addEventListener('turbo:load', scheduleRun);
document.addEventListener('turbo:render', scheduleRun);
