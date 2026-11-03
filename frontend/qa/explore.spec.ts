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
