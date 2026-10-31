import { expect, test } from "@playwright/test";

const commit = "abcdef1234567890abcdef1234567890abcdef1234";
const totals = { files: 5, lines: 123, code: 123, comments: 0, blanks: 0 };

for (const robots of ["noindex,follow", "index,follow"]) {
  test(`unavailable reports preserve the server indexing decision: ${robots}`, async ({ page }) => {
    await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { code: "not_found", message: "Report unavailable" } }));
    await page.route("**/github/example/unavailable", async (route) => {
      const response = await page.request.get("/");
      const html = (await response.text()).replace(/<meta name="robots"[^>]*>/, `<meta name="robots" content="${robots}">`);
      await route.fulfill({ response, status: robots.startsWith("noindex") ? 404 : 503, body: html });
    });
    await page.goto("/github/example/unavailable");
    await expect(page.locator(".error-state")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", new RegExp(`^${robots}`));
    await expect(page.locator('head script[type="application/ld+json"]')).toHaveCount(0);
  });
}

for (const suffix of ["", "/tree/deadbee", `/commit/${commit}`, "/tree/tiny"]) {
  test(`report seed preserves canonical and Dataset identity for ${suffix || "the default branch"}`, async ({ page, baseURL }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const path = `/github/example/repository${suffix}`;
    const canonical = new URL(path, baseURL).href;
    const summary = {
      reportId: "seed-report",
      repository: { owner: "example", repo: "repository", htmlUrl: "https://github.com/example/repository", provider: "github" },
      // A cached commit can carry the branch name used when originally counted.
      refName: suffix.startsWith("/tree/") ? "deadbee" : "main",
      commitSha: commit,
      generatedAt: "2026-09-08T01:02:03.000Z",
      tokeiVersion: "tokei-13.0.0",
      analysisKey: "seed-analysis",
      totals: { ...totals, files: suffix === "/tree/tiny" ? 4 : totals.files },
      languages: [{ name: "TypeScript", stats: totals }],
    };
    let analyses = 0;
    await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { error: "No additional report data in this fixture" } }));
    await page.route("**/api/repo-info?**", (route) => route.fulfill({ json: {} }));
    await page.route("**/api/analyze", async (route) => {
      analyses += 1;
      await route.fulfill({ status: 500, json: { error: "seed must not trigger analysis" } });
    });
    await page.route(`**${path}`, async (route) => {
      const response = await page.request.get("/");
      const html = (await response.text()).replace("</head>", `
        <script type="application/json" id="octocounts-report-summary">${JSON.stringify(summary)}</script>
        <script type="application/ld+json">{"@type":"Dataset","identifier":"server-marker","url":"${canonical}"}</script>
        <link rel="alternate" type="text/markdown" href="/github/old/repository.md">
      </head>`);
      await route.fulfill({ response, body: html });
    });
    await page.goto(path);
    await expect(page.locator(".runner-repo"), errors.join("\n")).toHaveText("example/repository");
    // Wait for the client to replace the server marker, so an unchanged SSR
    // canonical cannot make this test pass before the metadata effect runs.
    await expect.poll(() => page.locator('script[type="application/ld+json"]').evaluateAll((nodes) => {
      const values = nodes.flatMap((node) => {
        const data = JSON.parse(node.textContent || "{}");
        return data["@graph"] || [data];
      });
      return values.find((value) => value["@type"] === "Dataset");
    })).toMatchObject({ identifier: "seed-analysis", url: canonical, "@id": `${canonical}#dataset` });
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonical);
    const image = suffix === "/tree/tiny" ? `${baseURL}/og-image.jpg` : "https://api.octocounts.com/og/github/example/repository";
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", image);
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", image);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", suffix === "/tree/tiny" ? "noindex,follow" : /^index,follow/);
    await expect(page.locator('link[type="text/markdown"]')).toHaveAttribute("href", `${canonical}.md`);
    expect(new URL(page.url()).pathname).toBe(path);
    expect(analyses).toBe(0);
    expect(errors).toEqual([]);

    if (!suffix) {
      await page.route("**/api/analyze", (route) => route.fulfill({ json: {
        kind: "cached", reportId: "next-report", report: {
          ...summary,
          id: "next-report",
          repository: { owner: "other", name: "project", htmlUrl: "https://github.com/other/project", provider: "github" },
          total: totals,
          cached: true,
          durationMs: 12,
          analysisOptions: { ignoredDirs: [], ignoredLanguages: [], profile: "default", includeDocs: false, includeTests: false, includeGenerated: false },
          languages: summary.languages.map((language) => ({ ...language, children: [] })),
        },
      } }));
      await page.locator(".report-search > summary").click();
      await page.locator("#repo-url").fill("https://github.com/other/project");
      await page.getByRole("button", { name: "Analyze", exact: true }).click();
      const nextCanonical = new URL("/github/other/project/tree/main", baseURL).href;
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", nextCanonical);
      await expect(page.locator('link[type="text/markdown"]')).toHaveAttribute("href", `${nextCanonical}.md`);
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://api.octocounts.com/og/github/other/project");
      expect(errors).toEqual([]);
    }
  });
}
