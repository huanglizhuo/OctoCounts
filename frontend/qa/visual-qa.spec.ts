import { test, expect, Page } from '@playwright/test';

// Overridable so the suite runs against any local dev-server port
// (5173 is not always free); playwright.config baseURL stays the default.
const BASE_URL = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5173';

async function waitForReport(page: Page) {
  await page.goto(BASE_URL);
  await scrollUntilVisible(page, 'table.report tbody tr');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }));
  // Let IntersectionObserver-driven UI (sticky bar) settle back at the top.
  await page.waitForTimeout(500);
}

// Below-fold sections render lazily when they near the viewport; scroll like
// a user until the target appears.
async function scrollUntilVisible(page: Page, selector: string) {
  await page.mouse.move(640, 400);
  for (let i = 0; i < 14; i++) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return;
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(120);
  }
  await page.waitForSelector(selector, { timeout: 10000 });
}

// Minimal cached analyze response for tests that need a finished run without
// the live API. `code` and `lines` are independent so assertions can tell a
// code-line number from a total-lines number.
function cachedReportFixture(repoUrl: string, code: number, lines: number) {
  const [, owner = 'owner', repo = 'repo'] = new URL(repoUrl).pathname.split('/');
  return {
    id: `${owner}-${repo}-${code}`,
    repository: { owner, name: repo, htmlUrl: repoUrl, provider: 'github' },
    refName: 'main',
    commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
    generatedAt: '2026-09-08T01:02:03.000Z',
    durationMs: 12,
    cached: true,
    tokeiVersion: 'tokei-12.1',
    analysisKey: `key-${code}`,
    analysisOptions: { ignoredDirs: [], ignoredLanguages: [], profile: 'default', includeDocs: false, includeTests: false, includeGenerated: false },
    languages: [{ name: 'TypeScript', stats: { files: 1, lines, code, comments: 0, blanks: lines - code }, children: [] }],
    total: { files: 1, lines, code, comments: 0, blanks: lines - code },
  };
}

test.describe('OctoCounts visual QA', () => {
  test('1. desktop: demo report loads with the table as the default language view', async ({ page }) => {
    await waitForReport(page);
    await expect(page.locator('table.report tbody tr').first()).toBeVisible();
    // The donut is opt-in: absent until the chart view is toggled on, then the
    // ring renders at its fixed container-query size.
    await expect(page.locator('.donut-wrap svg')).toHaveCount(0);
    await page.getByRole('button', { name: 'Chart', exact: true }).click();
    await expect(page.locator('.donut-wrap svg')).toBeVisible();
  });

  test('2. table sorting updates URL and reload restores it', async ({ page }) => {
    await waitForReport(page);
    // Header-name-based access: column order is a presentation choice.
    const filesHeader = page.locator('table.report thead th').filter({ hasText: 'files' }).first();
    await filesHeader.click();
    await page.waitForTimeout(200);
    expect(page.url()).toMatch(/\?sort=.*dir=/);

    await page.reload();
    await page.waitForTimeout(500);
    expect(page.url()).toMatch(/\?sort=.*dir=/);

    const codeHeader = page.locator('table.report thead th').filter({ hasText: 'code' }).first();
    await codeHeader.click();
    await page.waitForTimeout(200);
    expect(page.url()).not.toMatch(/sort=/);
  });

  test('3. theme toggle switches matrix/paper and persists across reload', async ({ page }) => {
    await waitForReport(page);
    // Two toggles exist in the DOM (desktop controls + the <=720px site menu
    // panel); scope to the desktop one this viewport actually shows.
    const toggle = page.locator('.topbar-controls .theme-toggle');
    await expect(toggle).toBeVisible();

    const readScheme = () => page.evaluate(() => document.documentElement.dataset.scheme);
    const initial = await readScheme();
    expect(['matrix', 'paper']).toContain(initial);
    const expected = initial === 'matrix' ? 'paper' : 'matrix';

    await toggle.click();
    await page.waitForTimeout(200);
    expect(await readScheme()).toBe(expected);
    await expect(toggle).toHaveAttribute('aria-pressed', String(expected === 'matrix'));

    await page.reload();
    // Theme restores before first paint via localStorage; wait for React to mount.
    await page.waitForSelector('.topbar-controls .theme-toggle', { timeout: 10000 });
    expect(await readScheme()).toBe(expected);
    await expect(page.locator('.topbar-controls .theme-toggle')).toHaveAttribute('aria-pressed', String(expected === 'matrix'));
  });

  test('4. language switcher to Chinese renders new strings', async ({ page }) => {
    await waitForReport(page);
    await page.locator('button').filter({ hasText: /^EN$/ }).first().click();
    await page.locator('button').filter({ hasText: /^中文$/ }).first().click();
    await page.waitForTimeout(300);

    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toContain('分析');
    expect(bodyText).toContain('Chrome 应用商店');
    // The theme toggle's stable accessible label (label + aria-pressed pair).
    expect(bodyText).toContain('切换深色');
  });

  test('5. mobile 375px: summary tiles and table render', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const page = await context.newPage();
    await waitForReport(page);
    await expect(page.locator('.summary .cell').first()).toBeVisible();
    await expect(page.locator('table.report')).toBeVisible();
    await expect(page.locator('.summary .cell')).toHaveCount(5);
    await context.close();
  });

  test('6. sticky bar appears after scrolling past runner header and shows code lines', async ({ page }) => {
    // The homepage now opens on the read-only example report (demo mode has
    // no sticky bar); run a real — mocked, cached — analysis to get the full
    // runner. Total lines differ from code lines so the assertion can tell
    // the sticky bar reports CODE.
    await page.route('**/api/analyze', (route) => route.fulfill({ json: {
      kind: 'cached',
      reportId: 'sticky-demo',
      report: cachedReportFixture('https://github.com/example/sticky', 4321, 5555),
    } }));
    await page.goto(BASE_URL);
    await page.locator('#repo-url').fill('https://github.com/example/sticky');
    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page.locator('.runner-repo')).toHaveText('example/sticky');

    const hasSticky = async () => page.evaluate(() => !!document.querySelector('.sticky-bar'));
    expect(await hasSticky()).toBe(false);

    await page.mouse.move(640, 400);
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(400);

    expect(await hasSticky()).toBe(true);
    await expect(page.locator('.sticky-bar .sticky-stats')).toContainText('4,321 code');
    await expect(page.locator('.sticky-bar .sticky-stats')).not.toContainText('5,555');
  });

  test('7. pipeline section is present in How It Works', async ({ page }) => {
    await waitForReport(page);
    await scrollUntilVisible(page, '.pipeline');
    const pipeline = page.locator('.pipeline').first();
    await expect(pipeline).toBeVisible();
    const text = await pipeline.textContent();
    expect(text).toMatch(/github\s*url/i);
    expect(text).toContain('tokei');
  });

  test('8. recent chips render from localStorage seed', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.evaluate(() => {
      localStorage.setItem('octocounts.recentRepos', JSON.stringify([{ repoUrl: 'https://github.com/tokio-rs/axum', refName: '', label: 'axum' }]));
    });
    await page.reload();
    // Recent chips live in the hero (not deferred); no report wait needed.
    await page.waitForSelector('.recent-chip', { timeout: 10000 });
    await page.waitForTimeout(300);

    const recentChip = page.locator('.recent-chip').filter({ hasText: 'axum' }).first();
    await expect(recentChip).toBeVisible();
  });

  test('9. responsive header and report index have no overflow or empty trailing cells in either theme', async ({ browser }) => {
    for (const scheme of ['matrix', 'paper'] as const) {
      for (const viewport of [
        { width: 1054, height: 700 },
        { width: 768, height: 700 },
        { width: 375, height: 667 },
      ]) {
        const context = await browser.newContext({ viewport });
        await context.addInitScript((value) => localStorage.setItem('octocounts.theme', value), scheme);
        const page = await context.newPage();
        await page.goto(BASE_URL);
        await page.waitForSelector('.topbar', { timeout: 10000 });
        await scrollUntilVisible(page, '.report-index-grid');

        const layout = await page.evaluate(() => {
          const topbar = document.querySelector('.topbar')!.getBoundingClientRect();
          const grid = document.querySelector('.report-index-grid')!.getBoundingClientRect();
          const cards = Array.from(document.querySelectorAll('.report-index-link')).map((element) => element.getBoundingClientRect());
          const rowRights = new Map<number, number>();
          for (const card of cards) {
            const row = Math.round(card.top);
            rowRights.set(row, Math.max(rowRights.get(row) ?? 0, card.right));
          }
          const trailingGap = Math.max(0, ...Array.from(rowRights.values(), (right) => grid.right - right));
          return {
            scheme: document.documentElement.dataset.scheme,
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            topbarLeft: topbar.left,
            topbarRight: topbar.right,
            viewportWidth: window.innerWidth,
            trailingGap,
          };
        });

        expect(layout.scheme).toBe(scheme);
        expect(layout.documentOverflow).toBeLessThanOrEqual(1);
        expect(layout.topbarLeft).toBeGreaterThanOrEqual(-1);
        expect(layout.topbarRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
        expect(layout.trailingGap).toBeLessThanOrEqual(2);
        await context.close();
      }
    }
  });
});
