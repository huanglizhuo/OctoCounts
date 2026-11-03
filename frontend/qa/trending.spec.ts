import { expect, test } from "@playwright/test";

const BASE_URL = process.env.QA_BASE_URL ?? "http://127.0.0.1:5173";
const snapshot = {
  source: "https://github.com/trending", period: "daily", generatedAt: "2026-11-02T02:17:00Z", date: "2026-11-02",
  repositories: [248000, 0, null].map((code, index) => ({
    rank: index + 1, owner: "octo", name: `repo-${index}`, fullName: `octo/repo-${index}`,
    description: "A useful project with a description long enough to wrap naturally across smaller screens.",
    language: "TypeScript", starsToday: 1234, totalStars: 34567, publicPath: `/github/octo/repo-${index}`,
    sloc: code === null ? null : { code, generatedAt: "2026-11-01T12:00:00Z", reportId: "a".repeat(64) },
  })),
};

test("trending displays cached SLOC, zero and missing results without starting analyses", async ({ page }) => {
  const analyses: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/analyze")) analyses.push(request.url()); });
  await page.route("**/github-trending.json", (route) => route.fulfill({ json: snapshot }));
  await page.goto(`${BASE_URL}/trending`);
  const rows = page.locator(".trending-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator(".trending-sloc > strong")).toHaveAttribute("title", "248,000");
  await expect(rows.nth(1).locator(".trending-sloc > strong > [aria-hidden]")).toHaveText("0");
  await expect(rows.nth(0).locator(".trending-sloc .visually-hidden")).toHaveText("248,000");
  await expect(rows.nth(2).locator(".trending-sloc")).toContainText("No count available");
  await expect(rows.nth(2).locator(".trending-action")).toHaveText("View and analyze");
  await expect(rows.nth(2)).toHaveAttribute("href", "/github/octo/repo-2");
  await expect(rows.nth(0).locator("time")).toHaveText("2026-11-01");
  await expect(page.locator(".explore-trending-meta")).toContainText("2026-11-02");
  await expect(rows.nth(0)).toHaveAttribute("href", `/github/octo/repo-0?reportId=${"a".repeat(64)}`);
  await rows.nth(0).focus();
  await expect(rows.nth(0)).toBeFocused();
  expect(analyses).toEqual([]);
});

test("trending stays readable on desktop and mobile in both locales and themes", async ({ page }) => {
  await page.route("**/github-trending.json", (route) => route.fulfill({ json: {
    ...snapshot,
    repositories: snapshot.repositories.map((repo) => ({ ...repo, fullName: `a-very-long-organization/${"repository-name-".repeat(5)}${repo.name}` })),
  } }));
  await page.clock.setFixedTime(new Date("2026-11-04T00:00:00Z"));
  await page.goto(`${BASE_URL}/trending`);
  for (const language of ["en", "zh"]) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: language === "en" ? "EN" : "中文", exact: true }).click();
    for (const width of [1280, 800, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator(".trending-row")).toHaveCount(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page.locator(".trending-stale")).toContainText(language === "en" ? "update delayed" : "更新延迟");
      await expect(page.locator(".trending-action")).toHaveText(language === "en" ? "View and analyze" : "查看并分析");
      await expect(page.locator(".trending-missing")).toHaveText(language === "en" ? "No count available" : "暂无统计");
      if (width === 1280 || width === 390) await page.screenshot({ path: `/tmp/octocounts-trending-${language}-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator(".topbar-controls .theme-toggle").click();
  }
});

test("an empty trending snapshot retains the empty state", async ({ page }) => {
  await page.route("**/github-trending.json", (route) => route.fulfill({ json: { ...snapshot, repositories: [] } }));
  await page.goto(`${BASE_URL}/trending`);
  await expect(page.locator(".growth-empty")).toBeVisible();
  await expect(page.locator(".trending-row")).toHaveCount(0);
});


test("server snapshot renders immediately without another snapshot request", async ({ page }) => {
  let requests = 0;
  await page.route("**/trending", async (route) => {
    const response = await route.fetch();
    const data = JSON.stringify(snapshot).replace(/</g, "\\u003c");
    await route.fulfill({ response, body: (await response.text()).replace("</head>", `<script type="application/json" id="octocounts-trending-data">${data}</script></head>`) });
  });
  await page.route("**/github-trending.json", (route) => { requests++; return route.fulfill({ status: 503 }); });
  await page.clock.setFixedTime(new Date("2026-11-02T08:00:00Z"));
  await page.goto(`${BASE_URL}/trending`);
  await expect(page.locator(".trending-row")).toHaveCount(3);
  await expect(page.locator(".growth-state")).toHaveCount(0);
  await expect(page.locator(".trending-stale")).toHaveCount(0);
  expect(requests).toBe(0);
});

test("invalid server data falls back to the snapshot endpoint", async ({ page }) => {
  await page.route("**/trending", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("</head>", '<script type="application/json" id="octocounts-trending-data">{"source":"javascript:alert(1)"}</script></head>') });
  });
  await page.route("**/github-trending.json", (route) => route.fulfill({ json: snapshot }));
  await page.goto(`${BASE_URL}/trending`);
  await expect(page.locator(".trending-row")).toHaveCount(3);
});

function reportFor(name: string, code: number) {
  return {
    id: "a".repeat(64), repository: { provider: "github", owner: "octo", name, htmlUrl: `https://github.com/octo/${name}` },
    commitSha: "b".repeat(40), refName: "main", generatedAt: "2026-11-01T12:00:00Z", durationMs: 1, cached: true, tokeiVersion: "tokei-15.0.0", analysisKey: "saved",
    analysisOptions: { ignoredDirs: [], ignoredLanguages: [], profile: "default", includeDocs: false, includeTests: false, includeGenerated: false },
    total: { files: 1, code, lines: code, comments: 0, blanks: 0 },
    languages: [{ name: "Rust", stats: { files: 1, code, lines: code, comments: 0, blanks: 0 }, children: [] }],
  };
}

test("opening a count uses its saved report and missing counts analyze only after a click", async ({ page }) => {
  let analyses = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { message: "not available" } }));
  await page.route(`**/api/reports/${"a".repeat(64)}`, (route) => route.fulfill({ json: reportFor("repo-0", 248000) }));
  await page.route("**/api/analyze", (route) => {
    analyses++;
    return route.fulfill({ json: { kind: "cached", report: reportFor("repo-2", 999999) } });
  });
  await page.route("**/github-trending.json", (route) => route.fulfill({ json: snapshot }));
  await page.goto(`${BASE_URL}/trending`);
  await page.locator(".trending-row").first().click();
  await expect(page.locator(".summary .cell.accent .val")).toHaveAttribute("title", "248,000");
  expect(analyses).toBe(0);
  await page.goto(`${BASE_URL}/trending`);
  await expect(page.locator(".trending-row")).toHaveCount(3);
  expect(analyses).toBe(0);
  await page.locator(".trending-action").click();
  await expect(page.locator(".summary .cell.accent .val")).toHaveAttribute("title", "999,999");
  expect(analyses).toBe(1);
  expect(errors).toEqual([]);
});
