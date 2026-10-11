import { expect, test } from "@playwright/test";

const baseURL = process.env.QA_BASE_URL ?? "http://127.0.0.1:5173";
const options = { ignoredDirs: ["examples"], ignoredLanguages: ["JSON"], profile: "default", includeDocs: false, includeTests: false, includeGenerated: false, respectGitattributes: true };
function savedReport(id: string, code = 17, rules = options) {
  return {
    id, repository: { owner: "example", name: "repo", provider: "github", htmlUrl: "https://github.com/example/repo" },
    commitSha: (id === "right" ? "b" : "a").repeat(40), refName: "main", generatedAt: "2026-10-11T01:02:03Z", durationMs: 1, cached: true,
    tokeiVersion: "tokei-14.0.0", analysisKey: `key-${id}`, analysisOptions: rules,
    countingPolicy: { version: "attributes-v1", includeDocs: rules.includeDocs, includeTests: rules.includeTests, includeGenerated: rules.includeGenerated, ignoredDirs: rules.ignoredDirs, ignoredLanguages: rules.ignoredLanguages, repositoryAttributes: { status: "applied", excludedFiles: 2, generatedFiles: 1, vendoredFiles: 1 } },
    total: { files: code ? 1 : 0, code, lines: code, comments: 0, blanks: 0 }, languages: code ? [{ name: "Rust", stats: { files: 1, code, lines: code, comments: 0, blanks: 0 }, children: [] }] : [],
  };
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { code: "not_found", message: "not available" } }));
});

test("fixed report, badge, iframe and export text use the saved result and policy", async ({ page }) => {
  const report = savedReport("saved");
  let posts = 0;
  await page.route("**/api/analyze", (route) => { posts++; return route.fulfill({ status: 500 }); });
  await page.route("**/api/reports/saved", (route) => route.fulfill({ json: report }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { (window as any).copiedText = value; } } });
  });
  await page.goto(`${baseURL}/github/example/repo/commit/${report.commitSha}?reportId=saved`);
  await expect(page.locator(".summary .cell.accent .val")).toContainText("17");
  await expect(page.locator(".counting-policy")).toContainText("Counting policy");
  await page.locator(".analysis-options summary").click();
  await expect(page.locator('input[name="ignoredDirs"]')).toHaveValue("examples");
  await expect(page.locator('input[name="respectGitattributes"]')).toBeChecked();
  await page.locator(".counting-policy summary").click();
  await expect(page.locator(".counting-policy")).toContainText("2");
  await page.getByRole("button", { name: "README badge" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedText)).toContain("/api/reports/saved/badge.svg");
  await page.getByRole("button", { name: "embed iframe" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedText)).toContain("reportId=saved");
  await page.locator(".report-actions details").first().locator("summary").click();
  await page.locator(".report-actions details").first().getByRole("button").first().click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedText)).toContain("tokei-14.0.0");
  expect(posts).toBe(0);
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toBe("noindex,follow");
  const download = page.waitForEvent("download");
  await page.locator(".report-actions details").first().locator("summary").click();
  await page.locator(".report-actions details").first().getByRole("button").nth(2).click();
  await (await download).saveAs("/tmp/octocounts-policy-export.png");
});

test("expired fixed reports and embeds fail without submitting analyses", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/analyze", (route) => { posts++; return route.fulfill({ status: 500 }); });
  await page.goto(`${baseURL}/github/example/repo?reportId=expired`);
  await expect(page.locator(".error-state")).toContainText("saved");
  await page.goto(`${baseURL}/embed/github/example/repo?reportId=expired`);
  await expect(page.locator(".embed-card")).toContainText("saved");
  expect(posts).toBe(0);
});

test("compare submits common rules, pins both results and handles zero baselines", async ({ page }) => {
  const requests: any[] = [];
  await page.route("**/api/analyze", (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const report = savedReport(requests.length === 1 ? "left" : "right", requests.length === 1 ? 0 : 20, body.options);
    return route.fulfill({ json: { kind: "cached", reportId: report.id, report } });
  });
  await page.goto(`${baseURL}/compare?left=https://github.com/example/repo&right=https://github.com/example/repo`);
  await page.locator(".analysis-options summary").click();
  await page.locator('input[name="respectGitattributes"]').check();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.locator(".compare-policy")).toContainText("match");
  await expect(page.locator(".compare-table")).toContainText("New");
  expect(requests).toHaveLength(2);
  expect(requests[0].options).toEqual(requests[1].options);
  expect(requests[0].options.includeGenerated).toBe(false);
  const share = new URL(await page.locator(".compare-share-row code").innerText());
  expect(share.searchParams.get("leftReportId")).toBe("left");
  expect(share.searchParams.get("rightReportId")).toBe("right");
  expect(share.searchParams.get("rightRef")).toBe("b".repeat(40));
});

test("shared comparisons expose policy differences and align both analyses", async ({ page }) => {
  const left = savedReport("left");
  const right = savedReport("right", 30, { ...options, includeDocs: true });
  await page.route("**/api/reports/left", (route) => route.fulfill({ json: left }));
  await page.route("**/api/reports/right", (route) => route.fulfill({ json: right }));
  const requests: any[] = [];
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/analyze", async (route) => {
    const body = route.request().postDataJSON(); requests.push(body);
    const report = savedReport(requests.length === 1 ? "aligned-left" : "aligned-right", 17, body.options);
    await pending;
    return route.fulfill({ json: { kind: "cached", reportId: report.id, report } });
  });
  await page.goto(`${baseURL}/compare?left=https://github.com/example/repo&right=https://github.com/example/repo&leftReportId=left&rightReportId=right`);
  await expect(page.locator(".compare-policy.different")).toContainText("false");
  expect(requests).toHaveLength(0);
  await page.locator(".compare-policy button").click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.locator(".compare-policy button")).toBeDisabled();
  finish();
  await expect(page.locator(".compare-policy.same")).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0].options).toEqual(left.analysisOptions);
  expect(requests[1].options).toEqual(left.analysisOptions);
});

test("legacy reports display unknown policy", async ({ page }) => {
  const { countingPolicy, ...legacy } = savedReport("legacy");
  await page.route("**/api/reports/legacy", (route) => route.fulfill({ json: legacy }));
  await page.goto(`${baseURL}/github/example/repo?reportId=legacy`);
  await expect(page.locator(".counting-policy")).toContainText("does not record");
});
