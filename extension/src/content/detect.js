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
const PUBLIC_LABELS = new Set(['public']);
const VISIBILITY_BADGE_SELECTOR = [
  '[data-testid="repo-visibility-label"]',
  '[data-testid="visibility-badge"]',
  '.Label--secondary',
].join(', ');

export function isRepoPage(root = document) {
  if (window.self !== window.top) return false;
  if (window.location.hostname !== 'github.com') return false;
  if (!isRepoRoute(window.location.pathname)) return false;
  return hasRepoPageSignal(root);
}

export function isPublicRepoPage(root = document) {
  return isRepoPage(root) && getRepoVisibility(root) === 'public';
}

/**
 * Single private/internal check for the whole extension.
 *
 * The embedded React payload and octolytics meta tag are independent of CSS,
 * while DOM labels cover pages where those data signals are absent. The shared
 * tri-state resolver gives private evidence precedence across every source.
 */
export function isPrivateRepo(root = document) {
  return getRepoVisibility(root) === 'private';
}

/**
 * Return a tri-state result so callers can fail closed when GitHub changes its
 * DOM or embedded payload again. A positive private/internal signal always
 * wins over public data, which may be stale during React hydration.
 */
export function getRepoVisibility(root = document) {
  let publicSignal = false;
  const payload = readEmbeddedPayload(root);
  if (payload) {
    const nwo = root.querySelector(
      'meta[name="octolytics-dimension-repository_nwo"]'
    )?.content?.trim().toLowerCase() || '';
    for (const { repo, canProvePublic } of repoCandidatesFromPayload(payload, nwo)) {
      if (repo.isPrivate === true || repo.private === true) return 'private';
      const visibility = String(repo.visibility || '').toUpperCase();
      if (visibility === 'PRIVATE' || visibility === 'INTERNAL') return 'private';
      if (canProvePublic && (
        repo.isPrivate === false || repo.private === false || visibility === 'PUBLIC'
      )) {
        publicSignal = true;
      }
    }
  }

  const meta = root.querySelector(
    'meta[name="octolytics-dimension-repository_is_private"]'
  )?.content;
  if (meta === 'true') return 'private';
  if (meta === 'false') publicSignal = true;

  if (LEGACY_PRIVATE_SELECTORS.some(selector => root.querySelector(selector))) return 'private';

  // Visibility badge next to the repo name, text-guarded so unrelated
  // secondary labels elsewhere on the page cannot trigger it.
  for (const label of root.querySelectorAll(VISIBILITY_BADGE_SELECTOR)) {
    const text = label.textContent.trim().toLowerCase();
    if (NON_PUBLIC_LABELS.has(text)) return 'private';
    if (PUBLIC_LABELS.has(text)) publicSignal = true;
  }

  // Lock icon, scoped to the repo header so nav items cannot match.
  const header = repoHeader(root);
  if (header?.querySelector('.octicon-lock')) return 'private';
  if (header) {
    for (const label of header.querySelectorAll('.Label, [data-view-component="true"]')) {
      if (NON_PUBLIC_LABELS.has(label.textContent.trim().toLowerCase())) return 'private';
    }
  }

  return publicSignal ? 'public' : 'unknown';
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
  return repoCandidatesFromPayload(payload)[0]?.repo || null;
}

function repoCandidatesFromPayload(payload, expectedNwo = '') {
  if (!payload) return [];

  const candidates = [];
  const seen = new Map();
  const add = (repo, canProvePublic = false) => {
    if (!repo || typeof repo !== 'object') return;
    const previous = seen.get(repo);
    if (previous) {
      if (canProvePublic) previous.canProvePublic = true;
      return;
    }
    const candidate = { repo, canProvePublic };
    seen.set(repo, candidate);
    candidates.push(candidate);
  };

  // Known locations are kept explicit for readability and deterministic
  // precedence. GitHub moved these from codeViewRepoRoute in August 2026.
  add(payload.repository, true);
  add(payload.repo, true);
  add(payload.codeViewRepoRoute?.repository, true);
  add(payload.codeViewRepoRoute?.repo, true);
  add(payload.codeViewLayoutRoute?.repository, true);
  add(payload.codeViewLayoutRoute?.repo, true);
  add(payload.sidebarAbout?.repository, true);
  add(payload.sidebarAbout?.repo, true);

  // Bounded structural fallback: future route wrappers may move, but GitHub's
  // repository objects still sit under a repo/repository key. This intentionally
  // does not treat arbitrary nested objects as repository visibility signals.
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 8) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 100)) visit(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'repo' || key === 'repository') {
        add(child, repoMatchesNwo(child, expectedNwo));
      }
      visit(child, depth + 1);
    }
  };
  visit(payload);

  return candidates;
}

function repoMatchesNwo(repo, expectedNwo) {
  if (!repo || !expectedNwo) return false;
  const direct = repo.nameWithOwner || repo.nwo || repo.fullName || repo.full_name;
  if (direct) return String(direct).toLowerCase() === expectedNwo;

  const name = repo.name;
  const owner = repo.ownerLogin || repo.owner?.login || repo.owner?.name;
  return !!(name && owner && `${owner}/${name}`.toLowerCase() === expectedNwo);
}

function repoHeader(root) {
  return root.querySelector('#repository-container-header')
    || root.querySelector('[data-testid="repository-container-header"]')
    || root.querySelector('.AppHeader-context')
    || root.querySelector('.pagehead');
}
