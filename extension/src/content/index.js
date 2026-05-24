import { isPublicRepoRoot, parseRepoInfo, isConfirmedPrivateRepo } from './detect.js';
import { mountCard, unmountCard, isDisabled } from './card.js';
import { unmountPanel } from './panel.js';

let guardObserver = null;
let routeObserver = null;
let lastContextKey = '';
let scheduled = false;
let running = false;

async function run(forceRefresh = false) {
  if (running) {
    scheduleRun();
    return;
  }

  running = true;
  try {
    if (!isPublicRepoRoot()) {
      unmountCard();
      unmountPanel();
      if (guardObserver) { guardObserver.disconnect(); guardObserver = null; }
      lastContextKey = '';
      return;
    }

    const { owner, repo, ref, isFork } = parseRepoInfo();
    const contextKey = `${owner}/${repo}@${ref}`;
    if (contextKey === lastContextKey && document.querySelector('[data-octocount-card]')) {
      return;
    }

    unmountCard();
    unmountPanel();
    if (guardObserver) { guardObserver.disconnect(); guardObserver = null; }

    let settings;
    try {
      settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    } catch (_) {
      settings = { autoAnalyze: true, skipForks: true, cardPlacement: 'top' };
    }

    if (settings.skipForks && isFork) {
      lastContextKey = contextKey;
      return;
    }

    const disabledResult = await chrome.storage.local.get(`disabled::${owner}/${repo}`);
    if (disabledResult[`disabled::${owner}/${repo}`] === true) {
      unmountCard();
      unmountPanel();
      lastContextKey = contextKey;
      return;
    }

    const placement = settings.cardPlacement === 'bottom' ? 'bottom' : 'top';
    const replaceGhLanguages = settings.replaceGhLanguages !== false;
    const silentUntilSuccess = settings.silentUntilSuccess === true;
    const cardTitle = settings.cardTitle || '';
    const injected = mountCard({ owner, repo, ref, autoAnalyze: true, placement, replaceGhLanguages, silentUntilSuccess, cardTitle, forceRefresh });
    if (!injected) return;

    lastContextKey = contextKey;

    const borderGrid = document.querySelector('.BorderGrid');
    if (borderGrid) {
      guardObserver = new MutationObserver(() => {
        if (running || isDisabled()) return;
        if (!document.querySelector('[data-octocount-card]')) {
          mountCard({ owner, repo, ref, autoAnalyze: true, placement, replaceGhLanguages, silentUntilSuccess, cardTitle });
        }
      });
      guardObserver.observe(borderGrid, { childList: true });
    }
  } finally {
    running = false;
  }
}

function scheduleRun() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    run();
  }, 100);
}

function maybeRerunForContextChange() {
  if (running) return;

  if (!isPublicRepoRoot()) {
    if (lastContextKey) scheduleRun();
    return;
  }

  const { owner, repo, ref } = parseRepoInfo();
  const contextKey = `${owner}/${repo}@${ref}`;
  if (contextKey !== lastContextKey || !document.querySelector('[data-octocount-card]')) {
    scheduleRun();
  }
}

function observeRouteChanges() {
  if (routeObserver) return;
  routeObserver = new MutationObserver(maybeRerunForContextChange);
  routeObserver.observe(document.body, { childList: true, subtree: true });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    lastContextKey = '';
    scheduleRun();
  }
  if (area === 'local' && Object.keys(changes).some(k => k.startsWith('disabled::'))) {
    lastContextKey = '';
    scheduleRun();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_PAGE_STATUS') {
    const parts = window.location.pathname.replace(/^\//, '').split('/').filter(Boolean);
    const isRepoPage = window.location.hostname === 'github.com'
      && (parts.length === 2 || (parts.length >= 4 && parts[2] === 'tree'))
      && !!document.querySelector('.BorderGrid');
    const owner = isRepoPage ? (parts[0] || null) : null;
    const repo  = isRepoPage ? (parts[1] || null) : null;
    sendResponse({ isRepoPage, isPrivateRepo: isRepoPage && isConfirmedPrivateRepo(), owner, repo });
    return false;
  }
});

run();
observeRouteChanges();
document.addEventListener('turbo:load', scheduleRun);
document.addEventListener('turbo:render', scheduleRun);
