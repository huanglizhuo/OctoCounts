import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { onRequest } from '../functions/[[path]].js';

// Exercise the built HTML, Pages routing and actual hydration without a live API.
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api/')) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      return;
    }
    const asset = async (request: Request) => {
      const path = new URL(request.url).pathname;
      const file = /^\/(?:zh\/)?docs\/[a-z-]+$/.test(path) ? `${path}.html` : path;
      const contentType = file.endsWith('.js') ? 'application/javascript'
        : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html'
        : file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.webp') ? 'image/webp'
        : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
      try {
        return new Response(await readFile(new URL(`../dist${file}`, import.meta.url)), { headers: { 'content-type': contentType } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    };
    const request = new Request(url);
    const response = await onRequest({ request, env: { ASSETS: { fetch: asset } } });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
});

for (const locale of ['en', 'zh']) {
  test(`${locale} homepage keeps URL language through hydration and switches by link`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (/hydration|hydrated|Minified React error/i.test(message.text())) errors.push(message.text());
    });
    await page.addInitScript((stored) => localStorage.setItem('i18nextLng', stored), locale === 'zh' ? 'en' : 'zh');
    const path = locale === 'zh' ? '/zh' : '/';
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `http://127.0.0.1:5173${path}`);
    await expect(page.locator('link[hreflang]')).toHaveCount(3);
    await page.locator('#repo-url').fill('https://github.com/facebook/react');
    await expect(page.locator('#repo-url')).toHaveValue('https://github.com/facebook/react');
    const toggle = page.locator('.topbar-controls .theme-toggle');
    const wasPressed = await toggle.getAttribute('aria-pressed');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', wasPressed === 'true' ? 'false' : 'true');
    await page.locator('.topbar-controls').getByRole('link', { name: locale === 'zh' ? 'EN' : '中文', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(locale === 'zh' ? 'http://127.0.0.1:5173/' : 'http://127.0.0.1:5173/zh');
    await expect(page.locator('html')).toHaveAttribute('lang', locale === 'zh' ? 'en' : 'zh');
    expect(errors).toEqual([]);
  });
}

test('Chinese guides are readable on mobile and link to their English counterparts', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const slug of ['github-sloc-counter', 'methodology']) {
    await page.goto(`/zh/docs/${slug}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('navigation').getByRole('link', { name: 'English', exact: true })).toHaveAttribute('href', `/docs/${slug}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('main')).toContainText('reportId');
  }
});
