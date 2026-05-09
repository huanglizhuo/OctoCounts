import { isPublicRepoRoot, parseRepoInfo } from './detect.js';
import { mountCard, unmountCard } from './card.js';
import { unmountPanel } from './panel.js';

let guardObserver = null;
let routeObserver = null;
let lastContextKey = '';
let scheduled = false;
let running = false;

function matchesIgnoreList(owner, repo, list) {
  if (!list) return false;
  const patterns = list.split('\n').map(p => p.trim()).filter(Boolean);
  const full = `${owner}/${repo}`;
  return patterns.some(pat => {
    if (pat.endsWith('/*')) return owner === pat.slice(0, -2);
    if (pat.includes('/')) return full === pat;
    return false;
  });
}

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
      settings = { autoAnalyze: true, skipForks: true, cardPlacement: 'top', ignoreList: '' };
    }

    if (settings.skipForks && isFork) {
      lastContextKey = contextKey;
      return;
    }
    if (matchesIgnoreList(owner, repo, settings.ignoreList)) {
      lastContextKey = contextKey;
      return;
    }

    const placement = settings.cardPlacement === 'bottom' ? 'bottom' : 'top';
    const replaceGhLanguages = settings.replaceGhLanguages !== false;
    const injected = mountCard({ owner, repo, ref, autoAnalyze: settings.autoAnalyze, placement, replaceGhLanguages, forceRefresh });
    if (!injected) return;

    lastContextKey = contextKey;

    const borderGrid = document.querySelector('.BorderGrid');
    if (borderGrid) {
      guardObserver = new MutationObserver(() => {
        if (running) return;
        if (!document.querySelector('[data-octocount-card]')) {
          mountCard({ owner, repo, ref, autoAnalyze: settings.autoAnalyze, placement, replaceGhLanguages });
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
});

run();
observeRouteChanges();
document.addEventListener('turbo:load', scheduleRun);
document.addEventListener('turbo:render', scheduleRun);
