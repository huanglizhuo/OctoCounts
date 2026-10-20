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
  await page.route("https://api.octocounts.com/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="20"><rect width="180" height="20" fill="#245c38"/><text x="10" y="14" fill="white" font-size="12">OctoCounts · test badge</text></svg>' }));
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
  await page.getByRole("button", { name: "Change rules" }).click();
  await expect(page.locator('input[name="ignoredDirs"]')).toHaveValue("examples");
  await expect(page.locator('input[name="respectGitattributes"]')).toBeChecked();
  await page.locator(".counting-policy summary").click();
  await expect(page.locator(".counting-policy")).toContainText("2");
  await page.getByRole("link", { name: "Add README badge" }).click();
  await page.getByLabel("Badge behavior", { exact: true }).selectOption("snapshot");
  await page.locator("#readme-badge button").click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedText)).toContain("/api/reports/saved/badge.svg");
  await page.getByRole("button", { name: "embed iframe" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedText)).toContain("reportId=saved");
  await page.locator(".report-actions details").first().locator("summary").click();
  await page.locator(".report-actions details").first().getByRole("button").first().click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedText)).toContain("tokei-14.0.0");
  expect(posts).toBe(0);
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toBe("noindex,follow");
  const schema = JSON.parse(await page.locator('head script[type="application/ld+json"]').innerText())["@graph"];
  const dataset = schema.find((node: any) => node["@type"] === "Dataset");
  expect(new URL(dataset.url).searchParams.get("reportId")).toBe(report.id);
  expect(new URL(dataset.url).pathname).toContain(`/commit/${report.commitSha}`);
  expect(dataset.url).toBe(await page.locator('link[rel="canonical"]').getAttribute("href"));
  expect(dataset.distribution.contentUrl).toBe("https://api.octocounts.com/api/reports/saved");
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
  await expect(page.locator('head script[type="application/ld+json"]')).toHaveCount(0);
  await page.goto(`${baseURL}/embed/github/example/repo?reportId=expired`);
  await expect(page.locator(".embed-card")).toContainText("saved");
  expect(posts).toBe(0);
});

test("report schema follows home analysis, repository switches and recounts with unchanged totals", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/analyze", (route) => {
    const request = route.request().postDataJSON();
    const report = savedReport(`analysis-${++requestCount}`);
    report.repository.name = new URL(request.repoUrl).pathname.split("/")[2];
    report.repository.htmlUrl = request.repoUrl;
    report.commitSha = String(requestCount).repeat(40);
    return route.fulfill({ json: { kind: "cached", reportId: report.id, report } });
  });
  await page.goto(`${baseURL}/`);
  expect(await page.locator('head script[type="application/ld+json"]').first().textContent()).toContain("WebApplication");
  for (const [index, repo] of ["first", "second", "second"].entries()) {
    if (index) await page.locator(".report-search > summary").click();
    await page.locator("#repo-url").fill(`https://github.com/example/${repo}`);
    await page.locator("#repo-url").press("Enter");
    await expect(page.locator(".summary .cell.accent .val")).toContainText("17");
    const markup = page.locator('head script[type="application/ld+json"]');
    await expect(markup).toHaveCount(1);
    await expect.poll(() => markup.textContent()).toContain(`/api/reports/analysis-${index + 1}`);
    const graph = JSON.parse(await markup.innerText())["@graph"];
    const dataset = graph.find((node: any) => node["@type"] === "Dataset");
    const source = graph.find((node: any) => node["@type"] === "SoftwareSourceCode");
    expect(dataset.name).toBe(`example/${repo} source line count`);
    expect(dataset.variableMeasured.find((v: any) => v.name === "code").value).toBe(17);
    expect(source.version).toBe(String(index + 1).repeat(40));
    expect(source.dateModified).toBeUndefined();
    expect(graph.some((node: any) => ["WebApplication", "FAQPage"].includes(node["@type"]))).toBe(false);
    expect(dataset.url).toBe(await page.locator('link[rel="canonical"]').getAttribute("href"));
  }
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

test("mobile reports lead with counts and let users reopen their saved rules", async ({ page }) => {
  const report = savedReport("mobile", 48566);
  report.repository.owner = "huanglizhuo";
  report.repository.name = "OctoCounts";
  report.repository.htmlUrl = "https://github.com/huanglizhuo/OctoCounts";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/reports/mobile", (route) => route.fulfill({ json: report }));
  await page.goto(`${baseURL}/github/huanglizhuo/OctoCounts?reportId=mobile`);
  const code = page.locator(".summary .cell.accent");
  await expect(code).toContainText("48,566");
  await expect(page.locator("#repo-url")).toBeHidden();
  const countBox = await code.boundingBox();
  const actionsBox = await page.locator(".report-actions").boundingBox();
  expect(countBox!.y + countBox!.height).toBeLessThan(500);
  expect(countBox!.y).toBeLessThan(actionsBox!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "/tmp/octocounts-report-mobile.png" });

  await page.getByRole("button", { name: "Change rules" }).click();
  await expect(page.locator("#repo-url")).toBeVisible();
  await expect(page.locator('select[name="analysisProfile"]')).toBeFocused();
  await expect(page.locator('input[name="ignoredDirs"]')).toHaveValue("examples");
  await expect(page.locator('input[name="respectGitattributes"]')).toBeChecked();
  await page.locator(".report-search > summary").click();
  await page.locator(".topbar-site-menu > summary").click();
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await expect(code).toContainText("代码行");
  await page.locator(".topbar-site-menu > summary").click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole("link", { name: "添加 README 徽章" })).toBeVisible();
  await page.screenshot({ path: "/tmp/octocounts-report-mobile-zh.png" });
});

test("README badges default to a live ref without changing the fixed report link", async ({ page }) => {
  const report = savedReport("badge");
  await page.route("**/api/reports/badge", (route) => route.fulfill({ json: report }));
  await page.addInitScript(() => {
    (window as any).events = [];
    window.plausible = (name) => { (window as any).events.push(name); };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { (window as any).copiedText = value; } } });
  });
  await page.goto(`${baseURL}/github/example/repo?reportId=badge`);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).events)).toContain("report_url_copied");
  await expect.poll(() => page.evaluate(() => (window as any).copiedText)).toContain("reportId=badge");
  await page.getByRole("link", { name: "Add README badge" }).click();
  await expect(page.getByLabel("Badge behavior", { exact: true })).toHaveValue("live");
  await expect(page.locator("#readme-badge code")).toContainText("/branch/main");
  await expect(page.locator("#readme-badge code")).not.toContainText("examples");
  await expect(page.locator("#readme-badge img")).toHaveAttribute("src", /\/branch\/main/);
  await page.locator("#readme-badge button").click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedText)).toContain("/branch/main");
  await expect(page.getByLabel("Report & embed behavior", { exact: true })).toHaveValue("snapshot");
  await page.getByLabel("Badge behavior", { exact: true }).selectOption("snapshot");
  await page.locator("#readme-badge button").click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedText)).toContain("/api/reports/badge/badge.svg");
  await expect.poll(() => page.evaluate(() => (window as any).copiedText)).toContain("reportId=badge");
  await expect(page.locator("#readme-badge img")).toHaveJSProperty("naturalWidth", 180);
  await page.screenshot({ path: "/tmp/octocounts-readme-badge.png" });
});

test("denied report and badge copies preserve manual content without counting a conversion", async ({ page }) => {
  await page.route("**/api/reports/denied", (route) => route.fulfill({ json: savedReport("denied") }));
  await page.addInitScript(() => {
    (window as any).events = [];
    window.plausible = (name) => { (window as any).events.push(name); };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } });
    document.execCommand = () => false;
  });
  await page.goto(`${baseURL}/github/example/repo?reportId=denied`);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.locator(".report-actions .manual-copy")).toHaveValue(/reportId=denied/);
  expect(await page.evaluate(() => (window as any).events)).not.toContain("report_url_copied");
  await page.getByRole("link", { name: "Add README badge" }).click();
  await page.locator("#readme-badge button").click();
  await expect(page.locator(".utility-manual-copy")).toHaveValue(/\[!\[OctoCounts\]/);
  expect(await page.evaluate(() => (window as any).events)).not.toContain("badge_markdown_copied");
});
