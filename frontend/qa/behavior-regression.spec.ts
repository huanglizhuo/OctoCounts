import { expect, test } from "@playwright/test";

// Overridable so the suite runs against any local dev-server port
// (5173 is not always free); playwright.config baseURL stays the default.
const BASE_URL = process.env.QA_BASE_URL ?? "http://127.0.0.1:5173";

function reportFor(repoUrl: string, code: number, options = { ignoredDirs: [], ignoredLanguages: [], profile: "default", includeDocs: false, includeTests: false, includeGenerated: false }) {
  const [, owner = "owner", repo = "repo"] = new URL(repoUrl).pathname.split("/");
  return {
    id: `${owner}-${repo}-${code}`,
    repository: { owner, name: repo, htmlUrl: repoUrl, provider: "github" },
    refName: "main",
    commitSha: "abcdef1234567890abcdef1234567890abcdef12",
    generatedAt: "2026-09-08T01:02:03.000Z",
    durationMs: 12,
    cached: true,
    tokeiVersion: "tokei-12.1",
    analysisKey: `key-${code}`,
    analysisOptions: options,
    languages: [{ name: "TypeScript", stats: { files: 1, lines: code, code, comments: 0, blanks: 0 }, children: [] }],
    total: { files: 1, lines: code, code, comments: 0, blanks: 0 },
  };
}

test.describe("analysis behavior regressions", () => {
  test("a late analysis result cannot replace the newer request", async ({ page }) => {
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => nativeFetch(input, init ? { ...init, signal: undefined } : init)) as typeof window.fetch;
    });
    await page.route("**/api/analyze", async (route) => {
      const request = route.request().postDataJSON() as { repoUrl: string };
      const isOld = request.repoUrl.includes("old-repo");
      if (isOld) await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({ json: { kind: "cached", reportId: isOld ? "old" : "new", report: reportFor(request.repoUrl, isOld ? 111 : 222) } });
    });
    await page.goto(BASE_URL);
    const repo = page.locator("#repo-url");
    await repo.fill("https://github.com/example/old-repo");
    await page.getByRole("button", { name: "Analyze" }).click();
    await repo.fill("https://github.com/example/new-repo");
    // The regular button is correctly disabled while the first request is in
    // flight. Submit the same form programmatically to model a second caller
    // (sample/recent/retry) and exercise the operation-id guard.
    await page.locator(".input-row").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(page.locator(".runner-repo")).toHaveText("example/new-repo");
    await page.waitForTimeout(350);
    await expect(page.locator(".runner-repo")).toHaveText("example/new-repo");
    await expect(page.locator(".summary .cell.accent .val")).toContainText("222");
  });

  test("homepage suggests main while explicit and blank ref choices survive URL edits", async ({ page }) => {
    const requests: Array<{ repoUrl: string; refName?: string }> = [];
    await page.route("**/api/analyze", async (route) => {
      const request = route.request().postDataJSON() as { repoUrl: string; refName?: string };
      requests.push(request);
      await route.fulfill({ json: { kind: "cached", reportId: "main", report: reportFor(request.repoUrl, 100) } });
    });
    await page.goto(BASE_URL);
    const repo = page.locator("#repo-url");
    const ref = page.locator("#repo-ref");
    await expect(ref).toHaveValue("main");
    await page.getByRole("button", { name: "Analyze" }).click();
    await expect.poll(() => requests.some((request) => request.repoUrl.includes("huanglizhuo/OctoCounts") && request.refName === "main")).toBe(true);
    await ref.fill("release");
    await page.getByRole("button", { name: "Analyze" }).click();
    await expect.poll(() => requests.some((request) => request.repoUrl.includes("huanglizhuo/OctoCounts") && request.refName === "release")).toBe(true);

    await repo.fill("https://github.com/example/plain-repo");
    await expect(ref).toHaveValue("release");
    await ref.fill("develop");
    await repo.fill("https://github.com/example/tree-repo/tree/release");
    await expect(ref).toHaveValue("develop");
    await repo.fill("https://github.com/example/tree-repo/tree/develop/src");
    await expect(ref).toHaveValue("develop");
    await ref.fill("");
    await repo.fill("https://github.com/example/default-branch-repo/tree/release");
    await expect(ref).toHaveValue("");
    await repo.fill("https://github.com/example/default-branch-repo/tree/develop/src");
    await expect(ref).toHaveValue("");

    await page.goto(BASE_URL);
    await page.locator("#repo-url").fill("https://github.com/example/tree-repo/tree/release");
    await expect(page.locator("#repo-ref")).toHaveValue("release");
  });

  test("CSV draft is preserved and the completed share URL pins custom options", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } });
      document.execCommand = () => false;
    });
    let received: Record<string, unknown> | null = null;
    await page.route("**/api/analyze", async (route) => {
      received = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { kind: "cached", reportId: "custom", report: reportFor("https://github.com/example/custom", 333, (received!.options as any)) } });
    });
    await page.goto(BASE_URL);
    await page.locator(".analysis-options summary").click();
    const ignored = page.locator('input[name="ignoredDirs"]');
    await ignored.fill("");
    await ignored.pressSequentially("examples, fixtures");
    await expect(ignored).toHaveValue("examples, fixtures");
    await page.locator("#repo-url").fill("https://github.com/example/custom");
    await page.getByRole("button", { name: "Analyze" }).click();
    await expect.poll(() => (received?.options as { ignoredDirs?: string[] } | undefined)?.ignoredDirs).toEqual(["examples", "fixtures"]);
    await page.locator("button").filter({ hasText: "report URL" }).click();
    await expect(page.locator(".manual-copy")).toHaveValue(/analysis=/);
  });

  test("a snapshot URL restores its analysis options before the first request", async ({ page }) => {
    let received: Record<string, unknown> | null = null;
    await page.route("**/api/analyze", async (route) => {
      received = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { kind: "cached", reportId: "snapshot", report: reportFor("https://github.com/example/snapshot", 444, received!.options as any) } });
    });
    const options = encodeURIComponent(JSON.stringify({ ignoredDirs: ["generated"], ignoredLanguages: ["Markdown"], profile: "source-only", includeDocs: false, includeTests: true, includeGenerated: false }));
    await page.goto(`${BASE_URL}/github/example/snapshot/commit/abcdef1234567890abcdef1234567890abcdef12?analysis=${options}`);
    await expect(page.locator("#repo-ref")).toHaveValue("abcdef1234567890abcdef1234567890abcdef12");
    await expect.poll(() => received?.options).toMatchObject({ ignoredDirs: ["generated"], ignoredLanguages: ["Markdown"], profile: "source-only", includeTests: true });
  });

  test("clipboard denial leaves a real manually selectable URL", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } });
      document.execCommand = () => false;
    });
    await page.goto(BASE_URL);
    await page.locator("button").filter({ hasText: "report URL" }).click();
    const manual = page.locator(".manual-copy");
    await expect(manual).toBeVisible();
    await expect(manual).toHaveValue(/\/github\/huanglizhuo\/OctoCounts\/commit\//);
  });

  test("a timed-out POST releases the UI and ignores its late response", async ({ page }) => {
    await page.addInitScript(() => {
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = ((callback: TimerHandler, timeout?: number, ...args: any[]) => nativeSetTimeout(callback, timeout === 120_000 ? 25 : timeout, ...args)) as typeof window.setTimeout;
      const nativeFetch = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => nativeFetch(input, init ? { ...init, signal: undefined } : init)) as typeof window.fetch;
    });
    await page.route("**/api/analyze", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await route.fulfill({ json: { kind: "cached", reportId: "late", report: reportFor("https://github.com/example/late", 999) } });
    });
    await page.goto(BASE_URL);
    await page.locator("#repo-url").fill("https://github.com/example/late");
    await page.getByRole("button", { name: "Analyze" }).click();
    await expect(page.getByRole("heading", { name: "The analysis is taking too long." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyze" })).toBeEnabled();
    await page.waitForTimeout(130);
    await expect(page.locator(".runner-repo")).toHaveCount(0);
  });

  test("the final short public-report page does not expose a next link", async ({ page }) => {
    await page.route("**/api/seo/popular?limit=36&page=2", (route) => route.fulfill({ json: {
      page: 2, limit: 36, reports: [{ provider: "github", owner: "example", repo: "last", repoFullName: "example/last", htmlUrl: "https://github.com/example/last", publicPath: "/github/example/last", generatedAt: "2026-09-08", refName: "main", total: { code: 2 } }],
    } }));
    await page.goto(`${BASE_URL}/popular?page=2`);
    await expect(page.locator(".growth-repo-card")).toHaveCount(1);
    await expect(page.locator('.list-pagination a[href="?page=3"]')).toHaveCount(0);
  });

  test("topbar menus are mutually exclusive and restore focus after Escape", async ({ page }) => {
    await page.goto(BASE_URL);
    const explore = page.locator("details.topbar-menu").filter({ hasText: "Explore" });
    const tools = page.locator("details.topbar-menu").filter({ hasText: "Tools" });
    await explore.locator("summary").click();
    await expect(explore).toHaveAttribute("open", "");
    await tools.locator("summary").click();
    await expect(tools).toHaveAttribute("open", "");
    await expect(explore).not.toHaveAttribute("open", "");
    const pathnameBeforeOutsideClick = new URL(page.url()).pathname;
    await page.locator(".lang-btn").first().click();
    await expect(tools).not.toHaveAttribute("open", "");
    expect(new URL(page.url()).pathname).toBe(pathnameBeforeOutsideClick);
    await explore.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(explore).toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
    await expect(explore).not.toHaveAttribute("open", "");
    await expect(explore.locator("summary")).toBeFocused();
  });

  test("landing anchors reveal the extension guide and its install action", async ({ page }) => {
    await page.goto(`${BASE_URL}/#extension`);
    const heading = page.locator("#extension .section-h");
    await expect.poll(() => heading.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
    })).toBe(true);
    const install = page.locator("#extension a.btn.install-btn");
    await expect(install).toBeVisible();
    await expect(install).toHaveAttribute("href", /chromewebstore\.google\.com/);
  });

  test("the compact extension guide immediately follows Runner without deferred blank space", async ({ page }) => {
    await page.goto(BASE_URL);
    const extension = page.locator("#extension");
    const runner = page.getByRole("heading", { name: "Runner" }).locator("..").locator("..");
    await expect(extension).toBeVisible();
    expect(await runner.evaluate((node) => node.nextElementSibling?.id)).toBe("extension");
    const intrinsicSize = await page.locator(".deferred-slot").first().evaluate((node) => getComputedStyle(node).containIntrinsicBlockSize);
    expect(intrinsicSize).not.toContain("640px");
  });

  test("history endpoint provides keyboard-readable chart data", async ({ page }) => {
    await page.route("**/api/seo/repo-history?*", (route) => route.fulfill({ json: {
      provider: "github", owner: "huanglizhuo", repo: "OctoCounts", currentStars: 0, starPoints: [], slocPoints: [{ date: "2026-01-01", totalLines: 100 }, { date: "2026-09-08", totalLines: 200 }], slocBackfillInProgress: false, starBackfillAvailable: false, starBackfillInProgress: false,
    } }));
    await page.goto(BASE_URL);
    await expect(page.locator(".repo-history")).toBeVisible();
    await page.locator(".repo-history-chart svg").focus();
    await page.keyboard.press("End");
    await expect(page.locator(".repo-history-tooltip")).toContainText("200");
    await page.locator(".repo-history-data summary").click();
    await expect(page.locator(".repo-history-data tbody tr")).toHaveCount(2);
  });
});

test.describe("curated comparison pages (SG-01)", () => {
  // The dev/preview server cannot run Pages Functions, so the SSR payloads the
  // edge injects (#octocounts-compare-data / #octocounts-compare-prefill) are
  // installed before the app boots; the node SEO tests cover the server side
  // and assert the injected model equals the SSR body.
  const COMPARE_MODEL = {
    state: "ready",
    slug: "react-vs-vue",
    name: "React vs Vue",
    canonical: "https://octocounts.com/compare/react-vs-vue",
    heading: "React vs Vue: source lines of code compared",
    interactiveHref: "/compare?left=https%3A%2F%2Fgithub.com%2Ffacebook%2Freact&right=https%3A%2F%2Fgithub.com%2Fvuejs%2Fcore",
    left: { repoFullName: "facebook/react", publicPath: "/github/facebook/react", refName: "main", commitSha: "aaaaaa1111112222bbbbbb333333cccccc444444", generatedAt: "2026-07-20T00:00:00Z" },
    right: { repoFullName: "vuejs/core", publicPath: "/github/vuejs/core", refName: "main", commitSha: "dddddd5555556666eeeeee777777ffffff888888", generatedAt: "2026-07-21T00:00:00Z" },
    rows: [
      { label: "Files", left: "4,821", right: "2,311" },
      { label: "Total lines", left: "210,301", right: "120,114" },
      { label: "Code lines", left: "152,488", right: "89,302" },
      { label: "Comment lines", left: "31,220", right: "15,220" },
      { label: "Blank lines", left: "26,593", right: "15,592" },
      { label: "Languages counted", left: "5", right: "5" },
    ],
    definitionText: "This page compares the source lines of code (SLOC) of facebook/react and vuejs/core using cached OctoCounts reports. Code size is not code quality: a larger count only means more source material, not a better or worse project.",
    summaryText: "As of 2026-07-20, facebook/react contains 210,301 total lines (152,488 code) across 4,821 files, while vuejs/core contains 120,114 total lines (89,302 code) across 2,311 files as of 2026-07-21. facebook/react is about 1.7x the size of vuejs/core by code lines. Code size is not code quality: a larger count only means more source material, not a better or worse project.",
    languageMixText: "Top languages in facebook/react: JavaScript (54.2% of code), TypeScript (23.1% of code), HTML (7.9% of code).",
    methodologyText: "Methodology: both counts come from cached OctoCounts reports generated with tokei. facebook/react was counted at ref main (commit aaaaaa111111) on 2026-07-20; vuejs/core was counted at ref main (commit dddddd555555) on 2026-07-21. See the counting methodology for ignored directories and analysis options.",
    disclaimerText: "Note: code size is not code quality. OctoCounts only reports reproducible line counts and makes no claim that either project is better.",
    faq: [
      { question: "Which has more lines of code, facebook/react or vuejs/core?", answer: "facebook/react has more code: 152,488 code lines versus 89,302 for vuejs/core, about 1.7x as much, based on cached OctoCounts reports as of 2026-07-21." },
    ],
    relatedLinks: [
      { href: "/compare", label: "Interactive repository comparison" },
      { href: "/docs/methodology", label: "Counting methodology" },
    ],
  };

  const PREFILL = { left: "https://github.com/facebook/react", right: "https://github.com/vuejs/core" };

  // Deterministic injection: intercept the document request and insert the
  // SSR payload scripts into the served HTML, exactly where the Pages
  // Function puts them. (addInitScript + head append races the app boot.)
  async function serveComparePage(page: import("@playwright/test").Page, pathname: string, payloads: Record<string, unknown>) {
    await page.route(`${BASE_URL}${pathname}`, async (route) => {
      const response = await route.fetch();
      const scripts = Object.entries(payloads)
        .map(([id, payload]) => `<script type="application/json" id="${id}">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>`)
        .join("\n");
      await route.fulfill({ response, body: (await response.text()).replace("</head>", `${scripts}\n</head>`) });
    });
  }

  test("the cached comparison stays visible after JS boots, without clicking Compare", async ({ page }) => {
    await serveComparePage(page, "/compare/react-vs-vue", { "octocounts-compare-data": COMPARE_MODEL, "octocounts-compare-prefill": PREFILL });
    await page.goto(`${BASE_URL}/compare/react-vs-vue`);
    await expect(page.getByRole("heading", { level: 1, name: "React vs Vue: source lines of code compared" })).toBeVisible();
    const body = page.locator(".curated-compare-body");
    await expect(body).toBeVisible();
    // Core numbers from the view model, immediately readable.
    await expect(body).toContainText("152,488");
    await expect(body).toContainText("89,302");
    await expect(body.getByRole("table")).toContainText("Code lines");
    await expect(body).toContainText("Which has more lines of code, facebook/react or vuejs/core?");
    await expect(body.getByRole("link", { name: "counting methodology", exact: true })).toHaveAttribute("href", "/docs/methodology");
    await expect(body.getByRole("link", { name: "facebook/react SLOC report" })).toHaveAttribute("href", "/github/facebook/react");
  });

  test("the interactive tool stays available and prefilled with the same pair", async ({ page }) => {
    await serveComparePage(page, "/compare/react-vs-vue", { "octocounts-compare-data": COMPARE_MODEL, "octocounts-compare-prefill": PREFILL });
    await page.goto(`${BASE_URL}/compare/react-vs-vue`);
    const tool = page.locator(".curated-compare-tool");
    await expect(tool).toBeVisible();
    await expect(tool.locator("input").first()).toHaveValue("https://github.com/facebook/react");
    await expect(tool.locator("input").nth(2)).toHaveValue("https://github.com/vuejs/core");
  });

  test("the missing-report state keeps the page identity and explains itself", async ({ page }) => {
    await serveComparePage(page, "/compare/react-vs-vue", { "octocounts-compare-data": { state: "missing", slug: "react-vs-vue", name: "React vs Vue", canonical: "https://octocounts.com/compare/react-vs-vue", heading: "React vs Vue: source lines of code compared", interactiveHref: "/compare/react-vs-vue" } });
    await page.goto(`${BASE_URL}/compare/react-vs-vue`);
    await expect(page.getByRole("heading", { level: 1, name: "React vs Vue: source lines of code compared" })).toBeVisible();
    await expect(page.locator(".curated-compare-body")).toHaveCount(0);
    await expect(page.locator(".curated-compare-tool")).toBeVisible();
  });

  test("unknown compare slugs without SSR data degrade to the generic tool", async ({ page }) => {
    await page.goto(`${BASE_URL}/compare/not-a-real-pair`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".curated-compare-body")).toHaveCount(0);
    await expect(page.locator("form.compare-form")).toBeVisible();
  });
});

test.describe("extension landing page (SG-03)", () => {
  test("renders install entry points and steps client-side", async ({ page }) => {
    await page.goto(`${BASE_URL}/extension`);
    await expect(page.getByRole("heading", { level: 1, name: "See GitHub code statistics in your browser" })).toBeVisible();
    const install = page.locator(".hero-paths a.install-btn");
    await expect(install).toHaveCount(3);
    await expect(install.nth(0)).toHaveAttribute("href", /chromewebstore\.google\.com/);
    await expect(install.nth(1)).toHaveAttribute("href", /microsoftedge\.microsoft\.com/);
    await expect(install.nth(2)).toHaveAttribute("href", /addons\.mozilla\.org/);
    await expect(page.getByRole("heading", { name: "Install in three steps" })).toBeVisible();
  });
});

test.describe("language share donut", () => {
  test("the center code-line number stays inside the ring hole", async ({ page }) => {
    // 99,999 is the widest non-compact value ("99,999" = 6 mono glyphs); with
    // the old viewport-keyed font size it rendered wider than the SVG hole
    // (r=0.58) and overlapped the ring segments.
    await page.route("**/api/analyze", async (route) => {
      const request = route.request().postDataJSON() as { repoUrl: string };
      await route.fulfill({ json: { kind: "cached", reportId: "donut", report: reportFor(request.repoUrl, 99_999) } });
    });
    await page.goto(BASE_URL);
    await page.locator("#repo-url").fill("https://github.com/example/wide-count");
    await page.getByRole("button", { name: "Analyze" }).click();
    const donut = page.locator(".donut-wrap");
    await expect(donut).toBeVisible();
    await expect(page.locator(".donut-center strong")).toHaveText("99,999");
    const inside = await page.evaluate(() => {
      const wrap = document.querySelector(".donut-wrap");
      const strong = document.querySelector(".donut-center strong");
      if (!wrap || !strong) return null;
      return { ring: wrap.getBoundingClientRect().width, number: strong.getBoundingClientRect().width };
    });
    expect(inside).not.toBeNull();
    expect(inside!.number).toBeLessThanOrEqual(inside!.ring * 0.58 + 0.5);
  });
});
