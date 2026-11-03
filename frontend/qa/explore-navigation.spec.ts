import { expect, test, type Page } from "@playwright/test";
import { renderExplore } from "../.generated/explore-ssr.js";

const report = {
  owner: "octo", repo: "example", publicPath: "/github/octo/example", generatedAt: "2026-11-03T01:02:03.000Z",
  total: { code: 480059, files: 257 }, languageCount: 2,
  languages: [{ name: "Rust", stats: { code: 400000 } }, { name: "JSON", stats: { code: 80059 } }],
};
const stats = {
  totals: { reportsGenerated: 500, repositoriesAnalyzed: 200, linesCounted: 10000000, codeLinesCounted: 8000000, languagesDetected: 21 },
  windows: { reportsToday: 10, reports7d: 70, reports30d: 100, repositoriesToday: 2, repositories7d: 15, repositories30d: 20 },
  sources: [{ source: "web", reports: 500 }], languages: [{ language: "Rust", code: 8000000, reports: 500 }],
  topRepositories: [report], recentRepositories: [report],
};
const trending = {
  source: "https://github.com/trending", generatedAt: "2026-11-03T00:00:00.000Z", date: "2026-11-03",
  repositories: [{ fullName: "octo/example", publicPath: "/github/octo/example", description: "Example repository", language: "Rust", rank: 1, starsToday: 123, totalStars: 456, sloc: null }],
};
const list = (page = 1) => ({ page, limit: 36, hasNext: page === 1, reports: [{ ...report, repo: `example-${page}` }] });
const paths = ["stats", "recent", "popular", "trending", "hall-of-monoliths"];

async function mockApi(page: Page) {
  await page.route("**/api/stats", (route) => route.fulfill({ json: stats }));
  await page.route("**/api/seo/**", (route) => route.fulfill({ json: list(Number(new URL(route.request().url()).searchParams.get("page")) || 1) }));
  await page.route("**/github-trending.json", (route) => route.fulfill({ json: trending }));
}

async function serveSsr(page: Page, pathname: string, locale: "en" | "zh", theme: string) {
  const kind = pathname === "hall-of-monoliths" ? "monoliths" : pathname;
  const search = `?lng=${locale}&theme=${theme}`;
  const bootstrap = { pathname: `/${pathname}`, search, locale, now: Date.now(), seeds: {
    "octocounts-list-data": { kind, payload: list() }, "octocounts-stats-data": stats,
    "octocounts-trending-data": trending, "octocounts-more-reports": [],
  } };
  const body = await renderExplore(bootstrap);
  expect(body).not.toContain("explore-skeleton");
  await page.route(`**/${pathname}?*`, async (route) => {
    const response = await page.request.get("/");
    const html = (await response.text())
      .replace('<div id="root"></div>', `<div id="root" data-oc-ssr="explore" data-oc-hydrate="explore">${body}</div>`)
      .replace("</head>", `<script id="octocounts-explore-bootstrap" type="application/json">${JSON.stringify(bootstrap).replace(/</g, "\\u003c")}</script></head>`);
    await route.fulfill({ response, body: html });
  });
  return `/${pathname}${search}`;
}

for (const locale of ["en", "zh"] as const) for (const theme of ["matrix", "paper"]) {
  test(`all Explore SSR trees hydrate without replacement: ${locale}/${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: theme === "paper" ? 390 : 1440, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      // Fulfilled HTML fixtures can trip Chromium's local-network HMR websocket check.
      if (message.type() === "error" && !/WebSocket|\[vite\]|Failed to send error to Vite server/.test(message.text())) errors.push(message.text());
    });
    for (const path of paths) {
      const url = await serveSsr(page, path, locale, theme);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/src/growth/ExploreApp.tsx*", async (route) => { await gate; await route.continue(); });
      await page.goto(url, { waitUntil: "commit" });
      await expect(page.locator(".explore-nav")).toBeVisible();
      await page.waitForLoadState("domcontentloaded");
      const before = await page.locator("h1").boundingBox();
      await page.evaluate(() => {
        (window as any).originalHeading = document.querySelector("h1");
        (window as any).originalNav = document.querySelector(".explore-nav");
        (window as any).originalRow = document.querySelector(".explore-repo, .trending-row");
      });
      release();
      await expect(page.locator("#root")).toHaveAttribute("data-oc-ready", "explore");
      expect(await page.evaluate(() => [(window as any).originalHeading, (window as any).originalNav, (window as any).originalRow].map((node) => !!node?.isConnected)), JSON.stringify({ path, errors })).toEqual([true, true, true]);
      expect(await page.locator("h1").boundingBox()).toEqual(before);
      await expect(page.locator("html")).toHaveAttribute("data-scheme", theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator(".explore-skeleton")).toHaveCount(0);
      await page.unroute("**/src/growth/ExploreApp.tsx*");
    }
    expect(errors).toEqual([]);
  });
}

test("Explore clicks, pagination and history reuse the document, shell and query cache", async ({ page }) => {
  await mockApi(page);
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/seo/popular")) requests.push(request.url()); });
  await page.goto("/popular");
  await expect(page.locator(".explore-repo")).toHaveCount(1);
  await page.evaluate(() => {
    (window as any).documentMarker = true;
    (window as any).shell = document.querySelector(".topbar");
    (window as any).nav = document.querySelector(".explore-nav");
  });
  for (const path of ["recent", "trending", "hall-of-monoliths", "stats", "popular"]) {
    await page.locator(`.explore-nav a[href="/${path}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${path}$`));
    await expect(page.locator(".explore-skeleton")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).documentMarker && (window as any).shell === document.querySelector(".topbar") && (window as any).nav === document.querySelector(".explore-nav"))).toBe(true);
    await expect(page.locator("h1")).toBeFocused();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://octocounts.com/${path}`);
  }
  expect(requests).toHaveLength(1);
  await page.getByRole("link", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/popular\?page=2$/);
  await expect(page.locator(".explore-identity strong")).toHaveText("example-2");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow");
  await page.goBack();
  await expect(page.locator(".explore-identity strong")).toHaveText("example-1");
  await page.goForward();
  await expect(page.locator(".explore-identity strong")).toHaveText("example-2");
  expect(requests).toHaveLength(2);
});

test("language selection is preserved in Explore URLs and client navigation", async ({ page }) => {
  await mockApi(page);
  await page.goto("/popular");
  await page.locator('.topbar-controls .lang-btn').filter({ hasText: "中文" }).click();
  await expect(page).toHaveURL(/lng=zh/);
  await expect(page.locator("h1")).toHaveText("热门代码库报告");
  await page.locator('.explore-nav a[href="/recent?lng=zh"]').click();
  await expect(page).toHaveURL(/recent\?lng=zh$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh");
});

test("a slow destination keeps the navigation interactive and cannot overwrite a later route", async ({ page }) => {
  await mockApi(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/seo/recent?**", async (route) => { await gate; await route.fulfill({ json: list() }).catch(() => {}); });
  await page.goto("/popular");
  await expect(page.locator(".explore-repo")).toHaveCount(1);
  await page.locator('.explore-nav a[href="/recent"]').click();
  await expect(page.locator(".explore-skeleton")).toBeVisible();
  await expect(page.locator(".topbar")).toBeVisible();
  await page.locator('.explore-nav a[href="/popular"]').click();
  await expect(page.locator(".explore-repo")).toHaveCount(1);
  await expect(page.locator(".explore-skeleton")).toHaveCount(0);
  release();
  await expect(page.locator("h1")).toHaveText("Popular codebase reports");
  await expect(page).toHaveURL(/\/popular$/);
});
