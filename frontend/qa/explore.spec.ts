import { expect, test } from "@playwright/test";

const repository = (index: number) => ({
  owner: "octo", repo: `repository-${index}`, repoFullName: `octo/repository-${index}`,
  publicPath: `/github/octo/repository-${index}`, generatedAt: "2026-11-03T00:00:00Z",
  total: { code: index ? 48059 : 0, files: 257, lines: 57119 }, languageCount: 21,
  topLanguage: { name: "Rust", code: 20729, percent: 43.1 },
  languages: [{ name: "Rust", stats: { code: index ? 20729 : 0 } }, { name: "JSON", stats: { code: index ? 12947 : 0 } }, { name: "Dart", stats: { code: index ? 6054 : 0 } }],
});
const reports = Array.from({ length: 8 }, (_, index) => repository(index));
const stats = {
  totals: { reportsGenerated: 500, repositoriesAnalyzed: 200, linesCounted: 10000000, codeLinesCounted: 8000000, languagesDetected: 21 },
  windows: { reportsToday: 10, reports7d: 70, reports30d: 100, repositoriesToday: 2, repositories7d: 15, repositories30d: 20 },
  sources: [{ source: "sloc_backfill", reports: 499 }, { source: "web", reports: 1 }],
  languages: [{ language: "Rust", code: 8000000, lines: 10000000, reports: 500 }],
  topRepositories: reports, recentRepositories: reports,
};

test("server content survives delayed page code and mounts without a loading flash", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route("**/src/pages/marketing.tsx*", async (route) => { requested = true; await gate; await route.continue(); });
  await page.route("**/popular", async (route) => {
    const response = await page.request.get("/");
    const seed = { kind: "popular", payload: { page: 1, limit: 36, hasNext: false, reports } };
    const html = (await response.text()).replace('<div id="root"></div>', '<div id="root" data-oc-ssr="explore"><h1>Server reports</h1><a href="/github/octo/repository-1">Saved repository</a></div>')
      .replace("</head>", `<script id="octocounts-list-data" type="application/json">${JSON.stringify(seed)}</script></head>`);
    await route.fulfill({ response, body: html });
  });
  await page.addInitScript(() => {
    (window as any).loadingFlashes = [];
    new MutationObserver(() => {
      if (document.querySelector(".growth-state, .explore-skeleton")) (window as any).loadingFlashes.push(true);
    }).observe(document, { childList: true, subtree: true });
  });
  try {
    await page.goto("/popular", { waitUntil: "commit" });
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByRole("heading", { name: "Server reports" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Saved repository" })).toBeVisible();
    release();
    await expect(page.locator(".explore-repo")).toHaveCount(8);
    expect(await page.evaluate(() => (window as any).loadingFlashes)).toEqual([]);
  } finally { release(); }
});

test("unseeded page code and data share a stable skeleton and header", async ({ page }) => {
  let releaseCode!: () => void;
  let releaseData!: () => void;
  const code = new Promise<void>((resolve) => { releaseCode = resolve; });
  const data = new Promise<void>((resolve) => { releaseData = resolve; });
  await page.route("**/src/pages/marketing.tsx*", async (route) => { await code; await route.continue(); });
  await page.route("**/api/seo/popular?**", async (route) => { await data; await route.fulfill({ json: { page: 1, limit: 36, hasNext: false, reports } }); });
  try {
    await page.goto("/popular", { waitUntil: "commit" });
    await expect(page.locator(".explore-skeleton")).toBeVisible();
    await expect(page.locator(".topbar")).toBeVisible();
    const heading = page.locator("h1");
    const before = await heading.boundingBox();
    releaseCode();
    await expect(page.locator(".explore-data[aria-busy=true]")).toBeVisible();
    await expect(page.locator(".explore-skeleton")).toBeVisible();
    releaseData();
    await expect(page.locator(".explore-repo")).toHaveCount(8);
    await expect(page.locator(".explore-skeleton")).toHaveCount(0);
    expect(await heading.boundingBox()).toEqual(before);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(heading).toHaveCount(1);
  } finally { releaseCode(); releaseData(); }
});

test("page module failure keeps navigation and offers a reload", async ({ page }) => {
  await page.route("**/src/pages/marketing.tsx*", (route) => route.abort("failed"));
  await page.goto("/popular");
  await expect(page.getByRole("button", { name: "Reload page" })).toBeVisible();
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".explore-skeleton")).toHaveCount(0);
});

for (const failure of ["failed", "timed out"]) test(`${failure} page code preserves marked server content and its links`, async ({ page }) => {
  if (failure === "timed out") await page.addInitScript(() => {
    const native = window.setTimeout.bind(window);
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: any[]) => native(callback, delay === 15000 ? 200 : delay, ...args)) as typeof window.setTimeout;
  });
  await page.route("**/src/pages/marketing.tsx*", (route) => failure === "failed" ? route.abort("failed") : undefined);
  await page.route("**/popular", async (route) => {
    const response = await page.request.get("/");
    await route.fulfill({ response, body: (await response.text()).replace('<div id="root"></div>', '<div id="root" data-oc-ssr="explore"><h1>Saved reports</h1><a href="/recent">Browse recent</a></div>') });
  });
  await page.goto("/popular");
  await expect(page.getByRole("button", { name: "Reload page" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saved reports" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse recent" })).toBeVisible();
});

test("data timeout ends the skeleton within its deadline and retry recovers", async ({ page }) => {
  let hanging = 0;
  await page.route("**/api/seo/recent?**", () => { hanging++; });
  await page.goto("/recent");
  await expect(page.locator(".explore-skeleton")).toBeVisible();
  await expect.poll(() => hanging).toBe(1);
  await expect(page.getByRole("button", { name: "retry", exact: true })).toBeVisible({ timeout: 18000 });
  await expect(page.locator(".explore-skeleton")).toHaveCount(0);
  expect(hanging).toBe(1);
  await page.route("**/api/seo/recent?**", (route) => route.fulfill({ json: { page: 1, limit: 36, hasNext: false, reports } }));
  await page.getByRole("button", { name: "retry", exact: true }).click();
  await expect(page.locator(".explore-repo")).toHaveCount(8);
});

test("all skeletons fit both themes and locales and respect reduced motion", async ({ page }) => {
  await page.route("**/api/**", () => {});
  await page.route("**/github-trending.json", () => {});
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const path of ["stats", "recent", "popular", "trending", "hall-of-monoliths"]) {
    await page.goto(`/${path}`);
    await expect(page.locator(".explore-skeleton")).toBeVisible();
    for (const language of ["en", "zh"]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator(".topbar-controls .lang-btn").filter({ hasText: language === "en" ? /^EN$/ : "中文" }).click();
      for (const scheme of ["matrix", "paper"]) {
        await page.evaluate((scheme) => { document.documentElement.dataset.scheme = scheme; }, scheme);
        for (const width of [1440, 390, 320]) {
          await page.setViewportSize({ width, height: 900 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await expect(page.locator(".explore-skeleton > [aria-hidden]")).toHaveCSS("animation-name", "none");
          await expect(page.locator(".explore-skeleton a, .explore-skeleton button")).toHaveCount(0);
          if (language === "en" && scheme === "matrix" && width !== 320) await page.screenshot({ path: `/tmp/octocounts-skeleton-${path}-${width}.png`, fullPage: true });
        }
      }
    }
  }
});

test("all collections keep server data, page ranks and dates without fetching it again", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/**", (route) => { if (/\/api\/(seo\/|stats)/.test(route.request().url())) requests++; return route.fulfill({ status: 503 }); });
  for (const [path, kind] of [["recent", "recent"], ["popular", "popular"], ["hall-of-monoliths", "monoliths"]]) {
    await page.route(`**/${path}?page=2`, async (route) => {
      const shell = await page.request.get("/");
      const seed = { kind, payload: { page: 2, limit: 36, hasNext: false, reports } };
      await route.fulfill({ response: shell, body: (await shell.text()).replace("</head>", `<script type="application/json" id="octocounts-list-data">${JSON.stringify(seed)}</script></head>`) });
    });
    await page.goto(`/${path}?page=2`);
    await expect(page.locator(".explore-repo")).toHaveCount(8);
    await expect(page.locator(".explore-nav a[aria-current=page]")).toHaveAttribute("href", `/${path}`);
    await expect(page.locator(".explore-repo").nth(1)).toContainText("257 files");
    await expect(page.locator(".explore-repo").nth(1)).toContainText("21 languages");
    await expect(page.locator(".explore-repo").nth(1)).toContainText("Rust 43.1%");
    await expect(page.locator(".explore-repo time").first()).toHaveAttribute("datetime", reports[0].generatedAt);
    await expect(page.locator(".explore-size").first()).toContainText("0");
    if (kind !== "recent") await expect(page.locator(".explore-rank").first()).toHaveText("37");
    await expect(page.locator(".list-pagination")).not.toContainText("Next");
    await expect(page.locator(".growth-state")).toHaveCount(0);
  }
  expect(requests).toBe(0);
});

test("stats reuses its seed, labels backfills and keeps the overview compact", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/**", (route) => { if (/\/api\/(seo\/|stats)/.test(route.request().url())) requests++; return route.fulfill({ status: 503 }); });
  await page.route("**/stats", async (route) => {
    const shell = await page.request.get("/");
    await route.fulfill({ response: shell, body: (await shell.text()).replace("</head>", `<script type="application/json" id="octocounts-stats-data">${JSON.stringify(stats)}</script></head>`) });
  });
  await page.goto("/stats");
  await expect(page.locator(".growth-metric")).toHaveCount(8);
  await expect(page.locator(".growth-metric").first().locator("em")).toHaveCount(0);
  await expect(page.locator(".growth-metrics.compact")).toContainText("repos analyzed 30d");
  await expect(page.locator(".ranked-bars").first()).toContainText("History backfill");
  await expect(page.locator(".explore-repos--compact").first().locator("li")).toHaveCount(6);
  await expect(page.locator(".ranked-row").nth(1).locator("b")).toHaveAttribute("style", /width: 0\./);
  expect(requests).toBe(0);
});

test("background refresh failure preserves data and retries without skeletons", async ({ page }) => {
  await page.route("**/stats", async (route) => {
    const response = await page.request.get("/");
    await route.fulfill({ response, body: (await response.text()).replace("</head>", `<script type="application/json" id="octocounts-stats-data">${JSON.stringify(stats)}</script></head>`) });
  });
  await page.route("**/api/stats", (route) => route.fulfill({ status: 400, json: { message: "Unavailable" } }));
  await page.goto("/stats");
  await expect(page.locator(".growth-metric").first()).toContainText("500");
  await page.evaluate(() => {
    const future = Date.now() + 301000;
    Date.now = () => future;
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.locator(".explore-refresh-error")).toBeVisible();
  await expect(page.locator(".growth-metric").first()).toContainText("500");
  await expect(page.locator(".explore-skeleton")).toHaveCount(0);
  await page.route("**/api/stats", (route) => route.fulfill({ json: { ...stats, totals: { ...stats.totals, reportsGenerated: 501 } } }));
  await page.locator(".explore-refresh-error button").click();
  await expect(page.locator(".growth-metric").first()).toContainText("501");
  await expect(page.locator(".explore-refresh-error")).toHaveCount(0);
});

test("failed and empty lists do not advertise an unknown next page", async ({ page }) => {
  await page.route("**/api/seo/popular?**", (route) => route.fulfill({ status: 503, json: { message: "Unavailable" } }));
  await page.goto("/popular");
  await expect(page.getByRole("button", { name: "retry", exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".list-pagination")).toHaveCount(0);
  await page.route("**/api/seo/popular?**", (route) => route.fulfill({ json: { page: 1, limit: 36, hasNext: false, reports: [] } }));
  await page.getByRole("button", { name: "retry", exact: true }).click();
  await expect(page.locator(".growth-empty")).toBeVisible();
  await expect(page.locator(".list-pagination")).not.toContainText("Next");
});

test("Explore layouts handle long names in both locales and themes at mobile and desktop sizes", async ({ page }) => {
  const longReports = reports.map((repo) => ({ ...repo, owner: "a-long-organization-name", repo: `a-long-repository-name-with-many-parts-${repo.repo}` }));
  await page.route("**/api/seo/**", (route) => route.fulfill({ json: { page: 1, limit: 36, hasNext: false, reports: longReports } }));
  await page.route("**/api/stats", (route) => route.fulfill({ json: stats }));
  for (const path of ["stats", "recent", "popular", "hall-of-monoliths"]) {
    await page.goto(`/${path}`);
    await expect(page.locator(".explore-repo").first()).toBeVisible();
    for (const language of ["en", "zh"]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator(".topbar-controls .lang-btn").filter({ hasText: language === "en" ? /^EN$/ : "中文" }).click();
      for (const scheme of ["matrix", "paper"]) {
        await page.evaluate((scheme) => { document.documentElement.dataset.scheme = scheme; }, scheme);
        for (const width of [1440, 390, 320]) {
          await page.setViewportSize({ width, height: 900 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await page.locator(".explore-repo").first().focus();
          await expect(page.locator(".explore-repo").first()).toBeFocused();
          if (language === "en" && scheme === "matrix" && width !== 320) await page.screenshot({ path: `/tmp/octocounts-explore-${path}-${width}.png`, fullPage: true });
        }
      }
    }
  }
});
