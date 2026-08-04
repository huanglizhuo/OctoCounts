import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { parseHTML } from 'linkedom';

import {
  parseRoute,
  isRepoRoute,
  hasRepoPageSignal,
  resolveSidebar,
  findLanguagesSection,
  validateGrid,
  collectDomFingerprint,
  fingerprintHash,
  LANGUAGE_HEADINGS,
} from '../src/content/github-dom.js';
import { isPrivateRepo } from '../src/content/detect.js';

const FIXTURES = new URL('./fixtures/', import.meta.url);

// Every fixture writes CSS-module classes as `...__HASH`. Substituting a fresh
// random hash per run is what proves the resolver never keys off a literal
// build hash such as the `Lpx5q` that broke it in the first place.
async function loadFixture(name) {
  const raw = await readFile(new URL(name, FIXTURES), 'utf8');
  const hash = randomBytes(4).toString('hex');
  const { document } = parseHTML(raw.replaceAll('__HASH', `__${hash}`));
  return { document, hash };
}

/* ── route identity ──────────────────────────────────────────────────────── */

test('parseRoute accepts repo homes and tree views', () => {
  assert.deepEqual(parseRoute('/octo/demo'), {
    owner: 'octo', repo: 'demo', treePath: '', isTreeView: false,
  });
  assert.equal(parseRoute('/octo/demo/tree/main/src')?.treePath, 'main/src');
  assert.equal(parseRoute('/octo/demo/tree/feature%2Fx')?.treePath, 'feature/x');
});

test('parseRoute rejects non-repo shapes and GitHub feature paths', () => {
  for (const path of ['/', '/octo', '/octo/demo/issues', '/octo/demo/blob/main/a.js']) {
    assert.equal(parseRoute(path), null, path);
  }
  // The old `.BorderGrid` gate used to filter these out incidentally.
  for (const path of ['/settings/profile', '/orgs/acme', '/topics/rust', '/marketplace/x', '/sponsors/octo']) {
    assert.equal(isRepoRoute(path), false, path);
  }
  // Real orgs whose names look like features must keep working.
  for (const path of ['/actions/checkout', '/features/copilot-x']) {
    assert.equal(isRepoRoute(path), path === '/actions/checkout', path);
  }
});

/* ── sidebar resolution ──────────────────────────────────────────────────── */

test('markup captured from live github.com resolves without any class name', async () => {
  const { document, hash } = await loadFixture('github-sidebar-live-capture.html');

  const resolution = resolveSidebar({ root: document, owner: 'huanglizhuo', repo: 'OctoCounts' });

  // The links inside the real sidebar are hydrated client-side, so this is
  // resolved purely from sibling sections carrying their own headings.
  assert.equal(resolution.strategy, 'sibling-sections');
  assert.match(resolution.grid.className, new RegExp(`borderGrid__${hash}`));
  assert.equal(resolution.languagesSection?.querySelector('h2')?.textContent, 'Languages');
  assert.equal(resolution.languagesSection.parentElement, resolution.grid);
  // The README also links to /releases and the file table is right next to it.
  assert.equal(resolution.grid.closest('[class*="__main__"]'), null);
});

test('CSS-module sidebar resolves semantically, independent of the build hash', async () => {
  const { document, hash } = await loadFixture('github-sidebar-css-module.html');

  const resolution = resolveSidebar({ root: document, owner: 'octo', repo: 'demo' });

  assert.equal(resolution.strategy, 'semantic-anchor');
  assert.ok(resolution.grid, 'expected a grid');
  assert.match(resolution.grid.className, new RegExp(`borderGrid__${hash}`));
  assert.ok(resolution.languagesSection, 'expected a Languages section');
  assert.equal(resolution.languagesSection.parentElement, resolution.grid);
  assert.equal(resolution.languagesSection.querySelectorAll('li').length, 3);
});

test('a link-less sidebar resolves structurally, with no class names at all', async () => {
  // GitHub server-renders the sections and their headings but hydrates the links
  // inside them on the client, so this is what the very first mount attempt on a
  // real page actually sees.
  const { document, hash } = await loadFixture('github-sidebar-css-module.html');
  for (const anchor of document.querySelectorAll('a[href]')) anchor.remove();

  const resolution = resolveSidebar({ root: document, owner: 'octo', repo: 'demo' });

  assert.equal(resolution.strategy, 'sibling-sections');
  assert.match(resolution.grid.className, new RegExp(`borderGrid__${hash}`));
  // Heading text is the last resort, and it has to survive a link-less sidebar.
  assert.equal(resolution.languagesSection?.querySelector('h2').textContent, 'Languages');
});

test('a class match with no confirmable structure is refused, not guessed at', async () => {
  // Both the CSS-module and legacy selectors match here, but with no links and
  // no headings nothing proves this is the sidebar. Refusing is the point: a
  // wrong guess puts the card in the middle of the file list or the README.
  const { document } = await loadFixture('github-sidebar-css-module.html');
  for (const node of document.querySelectorAll('a[href], h2, h3')) node.remove();

  const resolution = resolveSidebar({ root: document, owner: 'octo', repo: 'demo' });

  assert.equal(resolution.grid, null);
  assert.equal(resolution.strategy, null);
  const cssModule = resolution.trace.find(entry => entry.strategy === 'css-module-grid');
  assert.equal(cssModule.ok, false);
  assert.match(cssModule.reason, /too-few-sections/);
});

test('legacy .BorderGrid pages keep working', async () => {
  const { document } = await loadFixture('github-sidebar-border-grid.html');

  const resolution = resolveSidebar({ root: document, owner: 'octo', repo: 'demo' });

  // Resolved without touching the Primer class name, but it still lands on it.
  assert.equal(resolution.strategy, 'sibling-sections');
  assert.ok(resolution.grid.classList.contains('BorderGrid'));
  assert.equal(resolution.languagesSection?.querySelector('h2').textContent, 'Languages');
});

test('the selector strategies stay in the ladder behind the structural ones', async () => {
  const { document } = await loadFixture('github-sidebar-border-grid.html');
  const resolution = resolveSidebar({ root: document, owner: 'octo', repo: 'demo' });

  const order = resolution.trace.map(entry => entry.strategy);
  assert.deepEqual(order.slice(0, 2), ['semantic-anchor', 'sibling-sections']);
  // Reached only if both structural strategies fail, and still last-resort ordered.
  const bare = resolveSidebar({ root: parseHTML('<html><body><p>x</p></body></html>').document, owner: 'o', repo: 'r' });
  assert.deepEqual(bare.trace.map(entry => entry.strategy), [
    'semantic-anchor',
    'sibling-sections',
    'css-module-grid',
    'css-module-sidebar',
    'legacy-border-grid',
    'aria-complementary',
    'aside-labelled',
    'layout-sidebar',
    'before-languages',
  ]);
});

test('README links are never mistaken for sidebar navigation', async () => {
  const { document } = await loadFixture('github-sidebar-border-grid.html');

  const resolution = resolveSidebar({ root: document, owner: 'octo', repo: 'demo' });
  const semantic = resolution.trace.find(entry => entry.strategy === 'semantic-anchor');

  assert.equal(semantic.ok, false);
  assert.equal(semantic.reason, 'no-section-anchor');
  assert.equal(resolution.grid.closest('.Layout-main'), null);
});

test('a repo with no Languages section still gets a mount point', async () => {
  const { document } = await loadFixture('github-sidebar-no-languages.html');

  const resolution = resolveSidebar({ root: document, owner: 'octo', repo: 'empty' });

  assert.ok(resolution.grid);
  assert.equal(resolution.languagesSection, null);
});

test('the main content column is never accepted as a mount point', async () => {
  const { document } = await loadFixture('github-sidebar-css-module.html');
  const main = document.querySelector('.Layout-module__main__1a2b3c');

  assert.equal(validateGrid(main, { base: '/octo/demo', repo: 'demo' }), 'contains-main-content');
  assert.match(validateGrid(document.body, { base: '/octo/demo', repo: 'demo' }), /^too-broad/);
});

test('before-languages fallback inserts above the Languages section', () => {
  const { document } = parseHTML(`
    <html><body><div id="wrap">
      <div id="langs"><h2>Languages</h2>
        <ul><li><a href="/octo/demo/search?l=rust">Rust</a></li></ul>
      </div>
    </div></body></html>
  `);

  const resolution = resolveSidebar({ root: document, owner: 'octo', repo: 'demo' });

  assert.equal(resolution.strategy, 'before-languages');
  assert.equal(resolution.insertBefore, document.getElementById('langs'));
  assert.equal(resolution.grid, document.getElementById('wrap'));
});

test('resolution fails cleanly, with a trace, when there is no sidebar', async () => {
  const { document } = await loadFixture('github-non-repo.html');
  // A marketplace page has no repo signal, so nothing should be mounted even
  // though its sidebar-shaped container would satisfy the structural checks.
  assert.equal(hasRepoPageSignal(document), false);

  const { document: bare } = parseHTML('<html><body><main><h1>Hi</h1></main></body></html>');
  const resolution = resolveSidebar({ root: bare, owner: 'octo', repo: 'demo' });

  assert.equal(resolution.grid, null);
  assert.equal(resolution.strategy, null);
  assert.ok(resolution.trace.length >= 7);
  assert.ok(resolution.trace.every(entry => entry.ok === false));
});

/* ── page identity signals ───────────────────────────────────────────────── */

test('repo pages are recognised without any styling class', async () => {
  for (const name of ['github-sidebar-css-module.html', 'github-sidebar-border-grid.html', 'github-private-repo.html']) {
    const { document } = await loadFixture(name);
    assert.equal(hasRepoPageSignal(document), true, name);
  }
});

test('private repositories are detected from embedded data alone', async () => {
  const { document } = await loadFixture('github-private-repo.html');
  assert.equal(document.querySelector('.Label--secondary'), null, 'fixture must not rely on the badge');
  assert.equal(isPrivateRepo(document), true);
});

test('public repositories are not reported as private', async () => {
  const { document } = await loadFixture('github-sidebar-css-module.html');
  assert.equal(isPrivateRepo(document), false);
});

test('the legacy visibility badge is still honoured without embedded data', () => {
  const { document } = parseHTML(`
    <html><body><div id="repository-container-header">
      <a href="/octo/demo">demo</a><span class="Label Label--secondary">Private</span>
    </div></body></html>
  `);
  assert.equal(isPrivateRepo(document), true);
});

/* ── diagnostics ─────────────────────────────────────────────────────────── */

test('the fingerprint captures structure and no page prose', async () => {
  const { document, hash } = await loadFixture('github-sidebar-css-module.html');
  const resolution = resolveSidebar({ root: document, owner: 'octo', repo: 'demo' });

  const fingerprint = collectDomFingerprint({
    root: document, owner: 'octo', repo: 'demo', resolution,
  });

  assert.equal(fingerprint.htmlLang, 'en');
  assert.equal(fingerprint.hasModuleGrid, true);
  assert.equal(fingerprint.hasLegacyGrid, false);
  assert.equal(fingerprint.strategy, 'semantic-anchor');
  assert.ok(fingerprint.moduleClasses.some(name => name.includes(hash)));
  assert.ok(fingerprint.headings.includes('Languages'));
  assert.deepEqual(fingerprint.anchorKinds, {
    about: 2, releases: 1, contributors: 1, languages: 3,
  });
  // README prose must never travel with a bug report.
  const serialized = JSON.stringify(fingerprint);
  assert.ok(!serialized.includes('See the'), 'fingerprint leaked README text');
});

test('fingerprint hashes are stable and layout-sensitive', () => {
  const base = { moduleClasses: ['A-module__x__aaa'], strategy: null, trace: [] };
  assert.equal(fingerprintHash(base), fingerprintHash({ ...base }));
  assert.notEqual(fingerprintHash(base), fingerprintHash({ ...base, moduleClasses: ['B-module__y__bbb'] }));
  assert.match(fingerprintHash(base), /^[0-9a-z]{6}$/);
});

test('every GitHub UI language has a Languages heading', () => {
  // GitHub ships its UI in de, es, fr, ja, ko, pt-BR, ru, zh-CN and zh-TW.
  for (const heading of ['languages', 'sprachen', 'idiomas', 'langues', '言語', '언어', 'linguagens', 'языки', '语言', '語言']) {
    assert.ok(LANGUAGE_HEADINGS.has(heading), heading);
  }
});
