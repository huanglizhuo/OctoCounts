import { expect, test } from "@playwright/test";
import { reportCapsuleText, reportFaq } from "../functions/report-copy.js";
import { COMPARE_REGISTRY } from "../functions/compare-registry.js";

// createRoot() replaces the edge's server markup and Google indexes the
// rendered DOM, so the client must render the server's citable text and links.

const canonicalOptions = { ignoredDirs: [], ignoredLanguages: [], profile: "default", includeDocs: false, includeTests: false, includeGenerated: false };

test("a rendered report page keeps the server's capsule, FAQ and comparison links", async ({ page }) => {
  const totals = { files: 25, lines: 2000, code: 1234, comments: 500, blanks: 266 };
  const summary = {
    reportId: "seed-report",
    repository: { owner: "react", repo: "react", htmlUrl: "https://github.com/react/react", provider: "github" },
    refName: "main",
    commitSha: "abcdef1234567890abcdef1234567890abcdef12",
    generatedAt: "2026-09-08T01:02:03.000Z",
    tokeiVersion: "tokei-15.0.0",
    analysisKey: "seed-analysis",
    analysisOptions: canonicalOptions,
    totals,
    languages: [{ name: "JavaScript", stats: totals }],
  };
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { error: "not in this fixture" } }));
  await page.route("**/github/react/react", async (route) => {
    const response = await page.request.get("/");
    const html = (await response.text()).replace("</head>", `<script type="application/json" id="octocounts-report-summary">${JSON.stringify(summary)}</script></head>`);
    await route.fulfill({ response, body: html });
  });
  await page.goto("/github/react/react");
  const about = page.locator(".report-about");
  const copy = { ...summary, repoFullName: "react/react", total: totals };
  await expect(about).toContainText(reportCapsuleText(copy));
  for (const item of reportFaq(copy)) await expect(about).toContainText(item.answer);
  await expect(about.locator('a[href="/compare/react-vs-vue"]')).toHaveCount(1);
});

test("rendered hub lists keep the rotating report links and skip sub-floor reports", async ({ page }) => {
  const rotating = ["https://octocounts.com/github/octo/alpha", "https://octocounts.com/github/octo/beta"];
  const listed = (name: string, files: number) => ({ provider: "github", owner: "octo", repo: name, repoFullName: `octo/${name}`, htmlUrl: `https://github.com/octo/${name}`, publicPath: `/github/octo/${name}`, generatedAt: "2026-10-01T00:00:00Z", refName: "main", total: { code: 900, files } });
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { error: "not in this fixture" } }));
  await page.route("**/api/seo/recent?**", (route) => route.fulfill({ json: { page: 1, limit: 36, reports: [listed("tiny", 4), listed("listed", 40)] } }));
  await page.route("**/recent", async (route) => {
    const response = await page.request.get("/");
    const html = (await response.text()).replace("</head>", `<script type="application/json" id="octocounts-more-reports">${JSON.stringify(rotating)}</script></head>`);
    await route.fulfill({ response, body: html });
  });
  await page.goto("/recent");
  await expect(page.locator('a[href="/github/octo/listed"]')).toHaveCount(1);
  await expect(page.locator('a[href="/github/octo/tiny"]')).toHaveCount(0);
  for (const loc of rotating) await expect(page.locator(`a[href="${loc}"]`)).toHaveCount(1);
});

test("rendered /compare lists every curated comparison and /extension shows its FAQ", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { error: "not in this fixture" } }));
  await page.goto("/compare");
  await expect(page.locator('.link-columns a[href^="/compare/"]')).toHaveCount(COMPARE_REGISTRY.length);
  await page.goto("/extension");
  await expect(page.getByRole("heading", { name: "Why does the SLOC card not appear on a repository page?" })).toBeVisible();
});
