export function isPublicRepoRoot() {
  if (window.self !== window.top) return false;
  if (window.location.hostname !== 'github.com') return false;

  const parts = window.location.pathname.replace(/^\//, '').split('/').filter(Boolean);
  const isRepoHome = parts.length === 2;
  const isTreeView = parts.length >= 4 && parts[2] === 'tree';
  if (!isRepoHome && !isTreeView) return false;

  if (!document.querySelector('.BorderGrid')) return false;

  if (document.querySelector('[aria-label="Private repository"]')) return false;
  for (const label of document.querySelectorAll('.Label')) {
    if (label.textContent.trim() === 'Private') return false;
  }

  return true;
}

export function parseRepoInfo() {
  const parts = window.location.pathname.replace(/^\//, '').split('/').filter(Boolean);
  const [owner, repo] = parts;
  const treePath = parts[2] === 'tree'
    ? parts.slice(3).map(part => decodeURIComponent(part)).join('/')
    : '';

  const embeddedRef = embeddedRepoRef();
  const refEl =
    document.querySelector('[data-hotkey="w"] .css-truncate-target') ??
    document.querySelector('summary[data-hotkey="w"] span');
  const buttonRef = refEl?.textContent?.trim() || '';

  const metaRef = document.querySelector(
    'meta[name="octolytics-dimension-repository_default_branch"]'
  )?.content;

  const ref = resolveRefFromPage(treePath, embeddedRef, buttonRef, metaRef);

  const isFork =
    !!document.querySelector('.fork-flag') ||
    document.querySelector('.pagehead-heading-text')?.textContent?.includes('forked from') ||
    false;

  return { owner, repo, ref, isFork };
}

function resolveRefFromPage(treePath, embeddedRef, buttonRef, metaRef) {
  if (!treePath) return embeddedRef || buttonRef || metaRef || 'HEAD';

  // GitHub encodes refs with slashes as /tree/feature/name, which is ambiguous
  // with /tree/<ref>/<folder>. The branch/tag button has the full resolved ref.
  if (embeddedRef && treePath.startsWith(embeddedRef)) return embeddedRef;
  if (buttonRef && treePath.startsWith(buttonRef)) return buttonRef;

  return treePath || embeddedRef || buttonRef || metaRef || 'HEAD';
}

function embeddedRepoRef() {
  const data = document.querySelector('script[data-target="react-app.embeddedData"]')?.textContent;
  if (!data) return '';

  try {
    const parsed = JSON.parse(data);
    return parsed?.payload?.codeViewRepoRoute?.refInfo?.name?.trim() || '';
  } catch (_) {
    return '';
  }
}
