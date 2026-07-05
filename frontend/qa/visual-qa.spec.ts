import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:5173';

async function waitForReport(page: Page) {
  await page.goto(BASE_URL);
  await page.waitForSelector('table.report tbody tr', { timeout: 10000 });
  await page.waitForTimeout(500);
}

test.describe('OctoCounts visual QA', () => {
  test('1. desktop: demo report loads with donut and table rows', async ({ page }) => {
    await waitForReport(page);
    await expect(page.locator('table.report tbody tr').first()).toBeVisible();
    await expect(page.locator('svg').first()).toBeVisible();
  });

  test('2. table sorting updates URL and reload restores it', async ({ page }) => {
    await waitForReport(page);
    const filesHeader = page.locator('table.report thead th').nth(1);
    await filesHeader.click();
    await page.waitForTimeout(200);
    expect(page.url()).toMatch(/\?sort=.*dir=/);

    await page.reload();
    await page.waitForTimeout(500);
    expect(page.url()).toMatch(/\?sort=.*dir=/);

    const codeHeader = page.locator('table.report thead th').nth(3);
    await codeHeader.click();
    await page.waitForTimeout(200);
    expect(page.url()).not.toMatch(/sort=/);
  });

  test('3. theme buttons cycle matrix/paper/amber', async ({ page }) => {
    await waitForReport(page);
    for (const label of ['matrix', 'paper', 'amber']) {
      const btn = page.locator('button.theme-btn').filter({ hasText: new RegExp(`^${label}$`, 'i') }).first();
      await btn.click();
      await page.waitForTimeout(200);
      await expect(btn).toHaveClass(/active/);
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
    }
  });

  test('4. language switcher to Chinese renders new strings', async ({ page }) => {
    await waitForReport(page);
    await page.locator('button').filter({ hasText: /^EN$/ }).first().click();
    await page.locator('button').filter({ hasText: /^中文$/ }).first().click();
    await page.waitForTimeout(300);

    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toContain('主题');
    expect(bodyText).toContain('github 链接');
    expect(bodyText).toContain('缓存报告');
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

  test('6. sticky bar appears after scrolling past runner header', async ({ page }) => {
    await waitForReport(page);
    const hasSticky = async () => page.evaluate(() => !!document.querySelector('.sticky-bar'));
    expect(await hasSticky()).toBe(false);

    await page.mouse.move(640, 400);
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(400);

    expect(await hasSticky()).toBe(true);
  });

  test('7. pipeline section is present in How It Works', async ({ page }) => {
    await waitForReport(page);
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
    await page.waitForSelector('table.report tbody tr', { timeout: 10000 });
    await page.waitForTimeout(300);

    const recentChip = page.locator('.recent-chip').filter({ hasText: 'axum' }).first();
    await expect(recentChip).toBeVisible();
  });
});
