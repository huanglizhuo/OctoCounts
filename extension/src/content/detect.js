import { isRepoRoute, parseRoute, hasRepoPageSignal, readEmbeddedPayload } from './github-dom.js';

// Legacy Primer class names. They still work on pages GitHub has not migrated,
// but they are checked last: a class rename must never be able to turn a private
// repository into an apparently public one, because that decides whether the
// owner/repo pair is sent to the API.
const LEGACY_PRIVATE_SELECTORS = [
  '[aria-label="Private repository"]',
  '[aria-label*="private repository" i]',
  '[aria-label="Internal repository"]',
  '[aria-label*="internal repository" i]',
  '[data-testid="private-repo-label"]',
];

const NON_PUBLIC_LABELS = new Set(['private', 'internal']);

export function isRepoPage(root = document) {
  if (window.self !== window.top) return false;
  if (window.location.hostname !== 'github.com') return false;
  if (!isRepoRoute(window.location.pathname)) return false;
  return hasRepoPageSignal(root);
}

export function isPublicRepoPage(root = document) {
  return isRepoPage(root) && !isPrivateRepo(root);
}

/**
 * Single private/internal check for the whole extension.
 *
 * Order matters: the embedded React payload and the octolytics meta tag are
 * data GitHub ships with the page regardless of styling, so they decide first.
 * The DOM-label checks below them can only ever add a positive — they are a
 * safety net for pages without embedded data, not the primary signal.
 */
export function isPrivateRepo(root = document) {
  const payload = readEmbeddedPayload(root);
  if (payload) {
    const repo = repoFromPayload(payload);
    if (repo) {
      if (repo.isPrivate === true || repo.private === true) return true;
      const visibility = String(repo.visibility || '').toUpperCase();
      if (visibility === 'PRIVATE' || visibility === 'INTERNAL') return true;
      if (repo.isPrivate === false || visibility === 'PUBLIC') return false;
    }
  }

  const meta = root.querySelector(
    'meta[name="octolytics-dimension-repository_is_private"]'
  )?.content;
  if (meta === 'true') return true;
  if (meta === 'false') return false;

  if (LEGACY_PRIVATE_SELECTORS.some(selector => root.querySelector(selector))) return true;

  // Visibility badge next to the repo name, text-guarded so unrelated
  // secondary labels elsewhere on the page cannot trigger it.
  for (const label of root.querySelectorAll('.Label--secondary, [data-testid="visibility-badge"]')) {
    if (NON_PUBLIC_LABELS.has(label.textContent.trim().toLowerCase())) return true;
  }

  // Lock icon, scoped to the repo header so nav items cannot match.
  const header = repoHeader(root);
  if (header?.querySelector('.octicon-lock')) return true;
  if (header) {
    for (const label of header.querySelectorAll('.Label, [data-view-component="true"]')) {
      if (NON_PUBLIC_LABELS.has(label.textContent.trim().toLowerCase())) return true;
    }
  }

  return false;
}

export function parseRepoInfo() {
  const route = parseRoute(window.location.pathname);
  if (!route) return { owner: undefined, repo: undefined, ref: 'HEAD', isFork: false };

  const { owner, repo, treePath } = route;
  const payload = readEmbeddedPayload(document);

  const embeddedRef = payload?.codeViewRepoRoute?.refInfo?.name?.trim()
    || payload?.refInfo?.name?.trim()
    || '';

  const refEl =
    document.querySelector('[data-hotkey="w"] .css-truncate-target') ??
    document.querySelector('summary[data-hotkey="w"] span');
  const buttonRef = refEl?.textContent?.trim() || '';

  const metaRef = document.querySelector(
    'meta[name="octolytics-dimension-repository_default_branch"]'
  )?.content;

  return {
    owner,
    repo,
    ref: resolveRefFromPage(treePath, embeddedRef, buttonRef, metaRef),
    isFork: detectFork(payload),
  };
}

function resolveRefFromPage(treePath, embeddedRef, buttonRef, metaRef) {
  if (!treePath) return embeddedRef || buttonRef || metaRef || 'HEAD';

  // GitHub encodes refs with slashes as /tree/feature/name, which is ambiguous
  // with /tree/<ref>/<folder>. The branch/tag button has the full resolved ref.
  if (embeddedRef && treePath.startsWith(embeddedRef)) return embeddedRef;
  if (buttonRef && treePath.startsWith(buttonRef)) return buttonRef;

  return treePath || embeddedRef || buttonRef || metaRef || 'HEAD';
}

// The skipForks setting fails silently when this returns a wrong answer, so the
// embedded payload comes first here too — `.fork-flag` and `.pagehead-heading-text`
// no longer exist on the React repo header.
function detectFork(payload) {
  const repo = repoFromPayload(payload);
  if (repo) {
    if (repo.isFork === true || repo.fork === true) return true;
    if (repo.parent || repo.parentRepository) return true;
    if (repo.isFork === false || repo.fork === false) return false;
  }

  if (document.querySelector('.fork-flag')) return true;
  if (document.querySelector('[data-testid="fork-flag"]')) return true;

  const header = repoHeader(document);
  if (header?.textContent?.includes('forked from')) return true;

  return false;
}

function repoFromPayload(payload) {
  if (!payload) return null;
  return payload.repository
    || payload.repo
    || payload.codeViewRepoRoute?.repository
    || payload.codeViewRepoRoute?.repo
    || null;
}

function repoHeader(root) {
  return root.querySelector('#repository-container-header')
    || root.querySelector('[data-testid="repository-container-header"]')
    || root.querySelector('.AppHeader-context')
    || root.querySelector('.pagehead');
}
