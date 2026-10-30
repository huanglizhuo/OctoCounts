import { test, expect, chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/*
 * Behavioural smoke test: loads the real extension into a real browser and
 * visits real GitHub pages.
 *
 * It asserts on *behaviour* (a card exists, exactly one, it comes back when
 * removed) rather than on class names, because a class-name monitor both cries
 * wolf when a prefix changes harmlessly and stays silent when the structure
 * changes underneath a prefix that survived.
 */

const EXTENSION_PATH = process.env.EXTENSION_PATH
  ?? path.resolve(import.meta.dirname, '../../dist/chrome');

const DIAGNOSTICS_DIR = process.env.DIAGNOSTICS_DIR
  ?? path.resolve(import.meta.dirname, 'results');

const CARD = '[data-octocount-card]';

// A handful of stable, non-forked public repositories. Deliberately small: the
// point is to notice a GitHub change, not to crawl.
const CARD_PAGES = [
  { name: 'repo home', url: 'https://github.com/huanglizhuo/OctoCounts' },
  { name: 'no-releases repo', url: 'https://github.com/jgm/pandoc' },
];

// GitHub serves subfolder tree views without the About sidebar, so the
// extension deliberately mounts nothing there (STATE.TREE_VIEW in
// src/content/index.js). Before that rule existed, the resolver's structural
// fallback eventually misidentified the main column and stretched a
// sidebar-sized card across the top of the file listing — this is the
// regression guard for exactly that.
const NO_CARD_PAGES = [
  { name: 'subfolder tree view', url: 'https://github.com/rust-lang/rust/tree/master/library' },
];

/*
 * The two class-free strategies. Which one wins is a race with React: mount
 * before the sidebar links hydrate and only the section headings are there
 * (sibling-sections); mount after and the repo-scoped links are available
 * (semantic-anchor). Both are healthy — the first run of this monitor showed
 * the same page resolving either way depending on load timing.
 *
 * Falling back to a class-based strategy (css-module-*, legacy-border-grid,
 * aria/aside/layout) or to before-languages is the real early warning: the card
 * still appears, but it is now riding on a class name GitHub can rename.
 */
const HEALTHY_STRATEGIES = new Set(['semantic-anchor', 'sibling-sections']);

let context;

test.beforeAll(async () => {
  // Extensions require a persistent context, and the headless shell does not
  // support them — hence `channel: 'chromium'`, and headed under xvfb in CI.
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: process.env.PLAYWRIGHT_HEADED !== '1',
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
});

test.afterAll(async () => {
  await context?.close();
});

for (const { name, url } of CARD_PAGES) {
  test(`card mounts on ${name}`, async ({}, testInfo) => {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

      const card = page.locator(CARD);
      await expect(card).toHaveCount(1);
      await expect(card).toBeVisible();

      const strategy = await card.getAttribute('data-strategy');
      expect.soft(
        HEALTHY_STRATEGIES.has(strategy),
        `resolved via "${strategy}" instead of semantic resolution — GitHub's sidebar structure may have changed`,
      ).toBe(true);

      // GitHub's React tree re-renders and throws our node away; the extension
      // has to put it back without a full page reload.
      await card.first().evaluate(element => element.remove());
      await expect(card).toHaveCount(1);

      // Navigating into a subfolder must take the card with it: no sidebar
      // there, so a card that survives is mounted somewhere it was never
      // designed to be. Coming back must restore it — repo root and subfolder
      // share owner/repo@ref but are different mount contexts.
      // `:visible`: GitHub renders a hidden small-screen copy of every file
      // row first, and clicking it timed out while the swallowed error made
      // the untouched card look like a mount regression.
      const folderLink = page.locator('a[href*="/tree/"]:visible').first();
      if (await folderLink.count() > 0) {
        await folderLink.click({ timeout: 15_000 });
        await page.waitForTimeout(3_000);
        await expect(card).toHaveCount(0);

        await page.goBack({ timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(3_000);
        await expect(card).toHaveCount(1);
      }
    } catch (error) {
      await saveDiagnostics(page, testInfo, { url, consoleErrors });
      throw error;
    } finally {
      await page.close();
    }
  });
}

for (const { name, url } of NO_CARD_PAGES) {
  test(`no card on ${name}`, async ({}, testInfo) => {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

      // Longer than the mount deadline in src/content/index.js: the old
      // misbehavior mounted within it, so this window is what makes the
      // assertion a real guard rather than a head start.
      await page.waitForTimeout(8_000);
      await expect(page.locator(CARD)).toHaveCount(0);
    } catch (error) {
      await saveDiagnostics(page, testInfo, { url, consoleErrors });
      throw error;
    } finally {
      await page.close();
    }
  });
}

/**
 * Field names deliberately mirror collectDomFingerprint() in
 * src/content/github-dom.js so a monitor failure and a user-submitted report
 * can be diffed directly. Class names and headings only — no page prose.
 */
async function saveDiagnostics(page, testInfo, { url, consoleErrors }) {
  let fingerprint = { error: 'page evaluation failed' };
  try {
    fingerprint = await page.evaluate(() => ({
      schema: 1,
      htmlLang: document.documentElement.getAttribute('lang'),
      url: location.href,
      title: document.title,
      hasLegacyGrid: !!document.querySelector('.BorderGrid'),
      hasModuleGrid: !!document.querySelector('[class*="-module__borderGrid"]'),
      hasCard: !!document.querySelector('[data-octocount-card]'),
      cardCount: document.querySelectorAll('[data-octocount-card]').length,
      strategy: document.querySelector('[data-octocount-card]')?.dataset.strategy ?? null,
      moduleClasses: [...new Set(
        [...document.querySelectorAll('[class]')]
          .flatMap(element => [...element.classList])
          .filter(name => name.includes('-module__')),
      )].sort().slice(0, 60),
      headings: [...document.querySelectorAll('h2, h3')]
        .map(element => element.textContent?.trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, 24),
    }));
  } catch (_) {}

  const payload = {
    checkedAt: new Date().toISOString(),
    testTitle: testInfo.title,
    requestedUrl: url,
    consoleErrors: consoleErrors.slice(0, 20),
    fingerprint,
  };

  await mkdir(DIAGNOSTICS_DIR, { recursive: true });
  const slug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const file = path.join(DIAGNOSTICS_DIR, `diagnostics-${slug}.json`);
  await writeFile(file, JSON.stringify(payload, null, 2));
  await testInfo.attach('dom-fingerprint', { path: file, contentType: 'application/json' });
}
