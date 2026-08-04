/*
 * The single place that knows what GitHub's DOM looks like.
 *
 * GitHub moved the repository sidebar from Primer's `.BorderGrid` to CSS
 * Modules (`CodeViewSidebar-module__borderGrid__<hash>`), and the hash changes
 * on every GitHub release. So class names are only ever *candidates* here — the
 * accept/reject decision is made by validateGrid(), which looks at structure
 * (repo-scoped section links, sibling sections) instead of styling.
 *
 * Deliberate constraints, so this module stays unit-testable under linkedom and
 * safe to call on every mutation burst:
 *   - pure: every entry point takes an explicit root, nothing reads `location`
 *   - no layout: never getComputedStyle / getBoundingClientRect / offsetWidth
 *   - no side effects: never mutates the page
 */

// First path segments that are GitHub features rather than an owner. This is
// only a cheap fast path — hasRepoPageSignal() is the real gate, so the list
// stays conservative: wrongly reserving a real org name (`actions`, `apps` in
// `github.com/actions/checkout`) would break the extension, whereas a missing
// entry costs one rejected candidate.
const RESERVED_FIRST_SEGMENTS = new Set([
  'about', 'account', 'apps', 'collections', 'contact', 'codespaces',
  'customer-stories', 'dashboard', 'enterprise', 'explore', 'features',
  'followers', 'following', 'git-lfs', 'home', 'issues', 'join', 'login',
  'logout', 'marketplace', 'new', 'nonprofit', 'notifications',
  'organizations', 'orgs', 'premium-support', 'pricing', 'pulls', 'readme',
  'search', 'security', 'sessions', 'settings', 'sponsors', 'stars', 'topics',
  'trending', 'users', 'watching', 'work-with-us',
  'favicon.ico', 'manifest.json', 'opensearch.xml', 'robots.txt', 'sitemap.xml',
]);

// GitHub serves its UI in these languages; the sidebar heading is the only
// place we still fall back to text matching, so all of them have to be here.
// Normalized: lower-cased, trailing colon stripped.
export const LANGUAGE_HEADINGS = new Set([
  'languages',   // en
  'sprachen',    // de
  'idiomas',     // es
  'langues',     // fr
  '言語',         // ja
  '언어',         // ko
  'linguagens',  // pt-BR
  'языки',       // ru
  '语言',         // zh-CN
  '語言',         // zh-TW
]);

// Repo-scoped links that only ever appear in the sidebar. Deliberately excludes
// stargazers/forks/watchers: those also live in the repo header, which would
// drag the common ancestor up to the whole page.
const SECTION_KINDS = [
  ['releases',     (href, base) => href.startsWith(`${base}/releases`) || href.startsWith(`${base}/tags`)],
  ['contributors', (href, base) => href.startsWith(`${base}/graphs/contributors`)],
  ['languages',    (href, base) => href.startsWith(`${base}/search?l=`)],
  ['deployments',  (href, base) => href.startsWith(`${base}/deployments`)],
  ['dependents',   (href, base) => href.startsWith(`${base}/network/dependents`)],
  ['about',        (href, base) => href.startsWith(`${base}?tab=`)],
  // The sidebar Packages link points at the owner's package index, not the repo
  ['packages',     (href, base, repo) =>
    href.startsWith(`${base}/packages`) ||
    (/^\/(orgs|users)\/[^/]+\/packages\?/.test(href) && href.includes(`repo_name=${repo}`))],
];

// Anchors inside these are not sidebar navigation: READMEs routinely link to
// /owner/repo/releases, which would otherwise pull the resolver into main.
const ANCHOR_EXCLUDE_SELECTOR =
  'article, .markdown-body, [data-octocount-card], nav, [role="navigation"], table';

// If a candidate contains any of these it is the main column, not the sidebar.
const MAIN_CONTENT_SELECTOR = [
  'article.markdown-body',
  '.markdown-body',
  '#readme',
  '[data-testid="readme"]',
  '[aria-labelledby="folders-and-files"]',
  '.react-directory-filename-column',
  '.js-navigation-container',
].join(',');

// Ordered candidate selectors. Semantic resolution runs before all of these;
// they exist for pages where no section link is present yet (or at all).
const SIDEBAR_SELECTORS = [
  // Matches CodeViewSidebar-module__borderGrid__<hash> without depending on
  // either the module prefix or the hash — only on the `borderGrid` part name.
  { strategy: 'css-module-grid', selector: '[class*="-module__borderGrid"]', descend: false },
  { strategy: 'css-module-sidebar', selector: '[class*="Sidebar-module__"]', descend: true },
  { strategy: 'legacy-border-grid', selector: '.BorderGrid', descend: false },
  { strategy: 'aria-complementary', selector: '[role="complementary"]', descend: true },
  { strategy: 'aside-labelled', selector: 'aside[aria-label]', descend: true },
  { strategy: 'layout-sidebar', selector: '.Layout-sidebar', descend: true },
];

const DESCEND_MAX_DEPTH = 4;
const MAX_CANDIDATES_PER_SELECTOR = 8;

/* ── Route identity ──────────────────────────────────────────────────────── */

// URL shape only. Says nothing about whether the sidebar has rendered — that is
// resolveSidebar()'s job, and conflating the two is what broke the extension on
// the new DOM in the first place.
export function parseRoute(pathname) {
  const parts = String(pathname || '').replace(/^\//, '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo] = parts;
  if (RESERVED_FIRST_SEGMENTS.has(owner.toLowerCase())) return null;

  const isRepoHome = parts.length === 2;
  const isTreeView = parts.length >= 4 && parts[2] === 'tree';
  if (!isRepoHome && !isTreeView) return null;

  const treePath = isTreeView
    ? parts.slice(3).map(part => safeDecode(part)).join('/')
    : '';

  return { owner, repo, treePath, isTreeView };
}

export function isRepoRoute(pathname) {
  return parseRoute(pathname) !== null;
}

// Positive proof that this really is a repository page, independent of any
// styling class. Used by the popup, where a false positive is user-visible.
export function hasRepoPageSignal(root = document) {
  if (
    root.querySelector('meta[name="octolytics-dimension-repository_id"]') ||
    root.querySelector('meta[name="octolytics-dimension-repository_nwo"]') ||
    root.querySelector('#repository-container-header') ||
    root.querySelector('[data-testid="repository-container-header"]')
  ) return true;

  const payload = readEmbeddedPayload(root);
  return !!(payload && (payload.repo || payload.repository || payload.codeViewRepoRoute));
}

/* ── embeddedData ────────────────────────────────────────────────────────── */

// GitHub's React payload is large and this runs on every mutation burst, so
// parse results are memoized per script node + content length.
const embeddedCache = new WeakMap();

export function readEmbeddedPayload(root = document) {
  const script = root.querySelector('script[data-target="react-app.embeddedData"]');
  if (!script) return null;

  const text = script.textContent || '';
  const cached = embeddedCache.get(script);
  if (cached && cached.length === text.length) return cached.payload;

  let payload = null;
  try {
    payload = JSON.parse(text)?.payload ?? null;
  } catch (_) {
    payload = null;
  }
  embeddedCache.set(script, { length: text.length, payload });
  return payload;
}

/* ── Sidebar resolution ──────────────────────────────────────────────────── */

/**
 * Find where the OctoCounts card should go.
 *
 * @returns {{
 *   grid: Element|null,
 *   languagesSection: Element|null,
 *   insertBefore: Element|null,
 *   strategy: string|null,
 *   trace: Array<{strategy: string, ok: boolean, reason?: string}>,
 * }}
 */
export function resolveSidebar({ root = document, owner, repo } = {}) {
  const ctx = { base: `/${owner}/${repo}`, repo };
  const trace = [];

  const semantic = resolveBySemanticAnchors(root, ctx);
  trace.push({ strategy: 'semantic-anchor', ok: !!semantic.grid, reason: semantic.reason });
  if (semantic.grid) return withLanguages(semantic.grid, 'semantic-anchor', ctx, trace);

  const sections = resolveBySiblingSections(root, ctx);
  trace.push({ strategy: 'sibling-sections', ok: !!sections.grid, reason: sections.reason });
  if (sections.grid) return withLanguages(sections.grid, 'sibling-sections', ctx, trace);

  for (const { strategy, selector, descend } of SIDEBAR_SELECTORS) {
    const found = resolveBySelector(root, selector, descend, ctx);
    trace.push({ strategy, ok: !!found.grid, reason: found.reason });
    if (found.grid) return withLanguages(found.grid, strategy, ctx, trace);
  }

  // Last resort: we could not identify the sidebar as a whole, but we did find
  // the native Languages section. Sit directly above it.
  const loose = findLanguagesSectionLoose(root, ctx);
  trace.push({ strategy: 'before-languages', ok: !!loose, reason: loose ? undefined : 'no-languages-section' });
  if (loose) {
    return {
      grid: loose.parentElement,
      languagesSection: loose,
      insertBefore: loose,
      strategy: 'before-languages',
      trace,
    };
  }

  return { grid: null, languagesSection: null, insertBefore: null, strategy: null, trace };
}

function withLanguages(grid, strategy, ctx, trace) {
  return {
    grid,
    languagesSection: findLanguagesSection(grid, ctx),
    insertBefore: null,
    strategy,
    trace,
  };
}

// Climb from every repo-scoped section link to the deepest ancestor that covers
// two or more *different* kinds of section. That element is the sidebar grid.
// This replaces an explicit least-common-ancestor computation: walking up and
// tallying kinds is equivalent, and it hands us section boundaries for free.
function resolveBySemanticAnchors(root, ctx) {
  const anchors = collectSectionAnchors(root, ctx);
  if (anchors.length === 0) return { grid: null, reason: 'no-section-anchor' };

  const tally = new Map();
  for (const { el, kind } of anchors) {
    let node = el.parentElement;
    while (node && !isRootish(node)) {
      let record = tally.get(node);
      if (!record) {
        record = { kinds: new Set(), depth: ancestorDepth(node) };
        tally.set(node, record);
      }
      record.kinds.add(kind);
      node = node.parentElement;
    }
  }

  const candidates = [...tally.entries()]
    .filter(([, record]) => record.kinds.size >= 2)
    .sort((a, b) => b[1].depth - a[1].depth)
    .map(([el]) => el);

  if (candidates.length === 0) return { grid: null, reason: 'no-shared-ancestor' };

  let lastReason = 'candidates-rejected';
  for (const candidate of candidates) {
    const reason = validateGrid(candidate, ctx);
    if (!reason) return { grid: candidate };
    lastReason = reason;
  }
  return { grid: null, reason: lastReason };
}

/*
 * Class-free fallback: find the element that has two or more sibling children
 * each carrying their own heading. That is what a sidebar *is*, structurally.
 *
 * This matters more than it looks: GitHub server-renders the sidebar sections
 * with their headings but hydrates the links inside them on the client, so on
 * first paint there are no section links for resolveBySemanticAnchors() to use.
 * Without this strategy the very first mount attempt would depend on a class
 * name, which is the thing we are trying to stop depending on.
 */
function resolveBySiblingSections(root, ctx) {
  const tally = new Map();

  for (const heading of root.querySelectorAll('h2, h3')) {
    if (heading.closest?.(ANCHOR_EXCLUDE_SELECTOR)) continue;

    let child = heading;
    let parent = heading.parentElement;
    while (parent && !isRootish(parent)) {
      let branches = tally.get(parent);
      if (!branches) { branches = { children: new Set(), depth: ancestorDepth(parent) }; tally.set(parent, branches); }
      branches.children.add(child);
      child = parent;
      parent = parent.parentElement;
    }
  }

  const candidates = [...tally.entries()]
    .filter(([, branches]) => branches.children.size >= 2)
    .sort((a, b) => b[1].depth - a[1].depth)
    .map(([el]) => el);

  if (candidates.length === 0) return { grid: null, reason: 'no-sibling-sections' };

  let lastReason = 'candidates-rejected';
  for (const candidate of candidates) {
    const reason = validateGrid(candidate, ctx);
    if (!reason) return { grid: candidate };
    lastReason = reason;
  }
  return { grid: null, reason: lastReason };
}

function resolveBySelector(root, selector, descend, ctx) {
  let matches;
  try {
    matches = root.querySelectorAll(selector);
  } catch (_) {
    return { grid: null, reason: 'bad-selector' };
  }
  if (matches.length === 0) return { grid: null, reason: 'no-match' };

  let lastReason = 'rejected';
  let index = 0;
  for (const candidate of matches) {
    if (index++ >= MAX_CANDIDATES_PER_SELECTOR) break;
    const reason = validateGrid(candidate, ctx);
    if (!reason) return { grid: candidate };
    lastReason = reason;

    if (descend) {
      const inner = findGridWithin(candidate, ctx);
      if (inner) return { grid: inner };
    }
  }
  return { grid: null, reason: lastReason };
}

// Outer containers (aside, [role=complementary], .Layout-sidebar) hold the grid
// a few levels down. Breadth-first so we prefer the shallowest valid container.
function findGridWithin(element, ctx) {
  let frontier = [...childElements(element)];
  for (let depth = 0; depth < DESCEND_MAX_DEPTH && frontier.length > 0; depth++) {
    const next = [];
    for (const node of frontier) {
      if (!validateGrid(node, ctx)) return node;
      next.push(...childElements(node));
    }
    frontier = next;
  }
  return null;
}

/**
 * Structural trust check for a mount-point candidate.
 * Returns null when the candidate is acceptable, otherwise a short reason
 * string that is good enough to paste into a bug report.
 *
 * Intentionally makes no geometry calls: at document_end layout is not settled,
 * width heuristics are flaky in headless CI, and they would make this module
 * impossible to unit test.
 */
export function validateGrid(element, ctx) {
  if (!element || element.nodeType !== 1) return 'not-an-element';
  if (element.isConnected === false) return 'detached';

  const tag = (element.tagName || '').toLowerCase();
  if (tag === 'body' || tag === 'html' || tag === 'main' || tag === 'article') return `too-broad:${tag}`;
  if (element.closest?.('[data-octocount-card]')) return 'inside-own-card';
  if (element.querySelector(MAIN_CONTENT_SELECTOR)) return 'contains-main-content';

  const kinds = new Set();
  let sectionsWithHeading = 0;
  for (const child of childElements(element)) {
    if (child.dataset?.octocountCard) continue;
    const kind = firstSectionKindWithin(child, ctx);
    if (kind) kinds.add(kind);
    if (child.querySelector('h2, h3')) sectionsWithHeading++;
  }

  if (kinds.size < 2 && sectionsWithHeading < 2) {
    return `too-few-sections(kinds=${kinds.size},headed=${sectionsWithHeading})`;
  }
  return null;
}

/* ── Languages section ───────────────────────────────────────────────────── */

// Always a *direct child* of the grid, so the insert point, the hide target and
// the skeleton row count all agree with each other by construction.
export function findLanguagesSection(grid, ctx) {
  if (!grid) return null;

  for (const child of childElements(grid)) {
    if (child.dataset?.octocountCard) continue;
    if (firstSectionKindWithin(child, ctx) === 'languages') return child;
  }

  for (const child of childElements(grid)) {
    if (child.dataset?.octocountCard) continue;
    const heading = child.querySelector('h2, h3');
    if (heading && LANGUAGE_HEADINGS.has(normalizeHeading(heading.textContent))) return child;
  }

  return null;
}

// Used only by the before-languages fallback: no grid was identified, so climb
// from the language link to the node that encloses the whole Languages block —
// the first ancestor that also contains its heading.
function findLanguagesSectionLoose(root, ctx) {
  let start = null;
  for (const { el, kind } of collectSectionAnchors(root, ctx)) {
    if (kind === 'languages') { start = el; break; }
  }
  if (!start) {
    for (const heading of root.querySelectorAll('h2, h3')) {
      if (LANGUAGE_HEADINGS.has(normalizeHeading(heading.textContent))) {
        start = heading.parentElement;
        break;
      }
    }
  }
  if (!start) return null;

  let node = start;
  let previous = null;
  while (node.parentElement && !isRootish(node.parentElement)) {
    if (node.querySelector('h2, h3')) break;
    if (node.parentElement.querySelector(MAIN_CONTENT_SELECTOR)) break;
    previous = node;
    node = node.parentElement;
  }

  // Overshot into a container holding several sections: back off one level so we
  // return the Languages section itself rather than the whole sidebar.
  if (countChildrenWithHeading(node) >= 2 && previous) node = previous;

  const parent = node.parentElement;
  if (!parent || isRootish(parent)) return null;
  return node;
}

function countChildrenWithHeading(element) {
  let count = 0;
  for (const child of childElements(element)) {
    if (child.querySelector('h2, h3')) count++;
  }
  return count;
}

/* ── Diagnostics ─────────────────────────────────────────────────────────── */

const FINGERPRINT_MAX_CLASSES = 60;
const FINGERPRINT_MAX_HEADINGS = 24;
const FINGERPRINT_MAX_TEXT = 60;

/**
 * A structural snapshot of the page, for the popup's "card did not appear"
 * report and for the scheduled smoke test. Both use this same function so the
 * two data sources can be diffed directly.
 *
 * Only class names and section headings — never README content, file names or
 * any other page text.
 */
export function collectDomFingerprint({ root = document, owner, repo, resolution } = {}) {
  const moduleClasses = new Set();
  for (const element of root.querySelectorAll('[class]')) {
    const classList = typeof element.className === 'string' ? element.className.split(/\s+/) : [];
    for (const name of classList) {
      if (name.includes('-module__')) moduleClasses.add(name);
    }
    if (moduleClasses.size > FINGERPRINT_MAX_CLASSES * 4) break;
  }

  const headings = [];
  for (const heading of root.querySelectorAll('h2, h3')) {
    const text = (heading.textContent || '').trim().slice(0, FINGERPRINT_MAX_TEXT);
    if (text) headings.push(text);
    if (headings.length >= FINGERPRINT_MAX_HEADINGS) break;
  }

  const ctx = { base: `/${owner}/${repo}`, repo };
  const anchorKinds = {};
  for (const { kind } of collectSectionAnchors(root, ctx)) {
    anchorKinds[kind] = (anchorKinds[kind] || 0) + 1;
  }

  return {
    schema: 1,
    htmlLang: root.documentElement?.getAttribute?.('lang') || null,
    hasLegacyGrid: !!root.querySelector('.BorderGrid'),
    hasModuleGrid: !!root.querySelector('[class*="-module__borderGrid"]'),
    hasRepoSignal: hasRepoPageSignal(root),
    hasCard: !!root.querySelector('[data-octocount-card]'),
    moduleClasses: [...moduleClasses].sort().slice(0, FINGERPRINT_MAX_CLASSES),
    headings,
    anchorKinds,
    strategy: resolution?.strategy ?? null,
    trace: resolution?.trace ?? [],
  };
}

// Stable short id for a fingerprint, used to de-duplicate user reports and to
// tag issue titles. FNV-1a: no crypto, no async, same answer everywhere.
export function fingerprintHash(fingerprint) {
  const source = JSON.stringify({
    moduleClasses: fingerprint?.moduleClasses ?? [],
    strategy: fingerprint?.strategy ?? null,
    trace: (fingerprint?.trace ?? []).map(entry => `${entry.strategy}:${entry.reason ?? 'ok'}`),
  });
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(6, '0').slice(-6);
}

/* ── internals ───────────────────────────────────────────────────────────── */

function collectSectionAnchors(root, ctx) {
  const anchors = [];
  for (const anchor of root.querySelectorAll('a[href]')) {
    if (anchor.closest?.(ANCHOR_EXCLUDE_SELECTOR)) continue;
    const kind = sectionKindOf(anchor.getAttribute('href'), ctx);
    if (kind) anchors.push({ el: anchor, kind });
  }
  return anchors;
}

function firstSectionKindWithin(element, ctx) {
  if (!element.querySelectorAll) return null;
  for (const anchor of element.querySelectorAll('a[href]')) {
    if (anchor.closest?.(ANCHOR_EXCLUDE_SELECTOR)) continue;
    const kind = sectionKindOf(anchor.getAttribute('href'), ctx);
    if (kind) return kind;
  }
  return null;
}

function sectionKindOf(rawHref, ctx) {
  const href = normalizeHref(rawHref);
  if (!href) return null;
  for (const [kind, match] of SECTION_KINDS) {
    if (match(href, ctx.base, ctx.repo)) return kind;
  }
  return null;
}

function normalizeHref(rawHref) {
  if (!rawHref) return '';
  let href = String(rawHref).trim();
  if (href.startsWith('https://github.com')) href = href.slice('https://github.com'.length);
  if (!href.startsWith('/')) return '';
  return href;
}

function normalizeHeading(text) {
  return String(text || '').trim().replace(/[:：]\s*$/, '').toLowerCase();
}

function childElements(element) {
  const children = element?.children;
  return children ? [...children] : [];
}

function isRootish(node) {
  const tag = (node?.tagName || '').toLowerCase();
  return tag === 'body' || tag === 'html' || !tag;
}

function ancestorDepth(node) {
  let depth = 0;
  let current = node.parentElement;
  while (current) {
    depth++;
    current = current.parentElement;
  }
  return depth;
}

function safeDecode(part) {
  try {
    return decodeURIComponent(part);
  } catch (_) {
    return part;
  }
}
