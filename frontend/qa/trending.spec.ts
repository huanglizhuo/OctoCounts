import { expect, test } from "@playwright/test";

const BASE_URL = process.env.QA_BASE_URL ?? "http://127.0.0.1:5173";
const snapshot = {
  source: "https://github.com/trending", period: "daily", generatedAt: "2026-11-02T02:17:00Z", date: "2026-11-02",
  repositories: [248000, 0, null].map((code, index) => ({
    rank: index + 1, owner: "octo", name: `repo-${index}`, fullName: `octo/repo-${index}`,
    description: "A useful project with a description long enough to wrap naturally across smaller screens.",
    language: "TypeScript", starsToday: 1234, totalStars: 34567, publicPath: `/github/octo/repo-${index}`,
    sloc: code === null ? null : { code, generatedAt: "2026-11-01T12:00:00Z" },
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
  await expect(rows.nth(0).locator("time")).toHaveText("2026-11-01");
  await expect(page.locator(".growth-hero")).toContainText("2026-11-02");
  await expect(rows.nth(0)).toHaveAttribute("href", "/github/octo/repo-0");
  await rows.nth(0).focus();
  await expect(rows.nth(0)).toBeFocused();
  expect(analyses).toEqual([]);
});

test("trending stays readable on desktop and mobile in both locales and themes", async ({ page }) => {
  await page.route("**/github-trending.json", (route) => route.fulfill({ json: {
    ...snapshot,
    repositories: snapshot.repositories.map((repo) => ({ ...repo, fullName: `a-very-long-organization/${"repository-name-".repeat(5)}${repo.name}` })),
  } }));
  await page.goto(`${BASE_URL}/trending`);
  for (const language of ["en", "zh"]) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: language === "en" ? "EN" : "中文", exact: true }).click();
    for (const width of [1280, 800, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator(".trending-row")).toHaveCount(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
