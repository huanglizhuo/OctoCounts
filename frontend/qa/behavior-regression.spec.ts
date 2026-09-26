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
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
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
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    // An empty form falls back to the demo seed repo (facebook/react) while
    // keeping the homepage's "main" suggestion.
    await expect.poll(() => requests.some((request) => request.repoUrl.includes("facebook/react") && request.refName === "main")).toBe(true);
    await ref.fill("release");
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await expect.poll(() => requests.some((request) => request.repoUrl.includes("facebook/react") && request.refName === "release")).toBe(true);

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
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await expect.poll(() => (received?.options as { ignoredDirs?: string[] } | undefined)?.ignoredDirs).toEqual(["examples", "fixtures"]);
    // The copy-link action lives in the report action bar under the runner
    // head now; clipboard denial must still surface a manual copy containing
    // the pinned analysis options.
    await page.getByRole("button", { name: "Copy link" }).click();
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
    await page.route("**/api/analyze", (route) => {
      const request = route.request().postDataJSON() as { repoUrl: string };
      route.fulfill({ json: { kind: "cached", reportId: "manual", report: reportFor(request.repoUrl, 321) } });
    });
    await page.goto(BASE_URL);
    // The share actions live in the full runner now — the homepage opens on
    // the read-only example report — so finish a (mocked) run first.
    await page.locator("#repo-url").fill("https://github.com/example/manual");
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await expect(page.locator(".runner-repo")).toHaveText("example/manual");
    await page.getByRole("button", { name: "Copy link" }).click();
    const manual = page.locator(".manual-copy");
    await expect(manual).toBeVisible();
    await expect(manual).toHaveValue(/\/github\/example\/manual\/commit\//);
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
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await expect(page.getByRole("heading", { name: "The analysis is taking too long." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyze", exact: true })).toBeEnabled();
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

  test("the compact extension guide immediately follows the example report without deferred blank space", async ({ page }) => {
    await page.goto(BASE_URL);
    const extension = page.locator("#extension");
    // First load shows the demo seed, so the runner section's heading is
    // "Example report" (it reads "Runner" again once a real run starts).
    const runner = page.getByRole("heading", { name: "Example report" }).locator("..").locator("..");
    await expect(extension).toBeVisible();
    expect(await runner.evaluate((node) => node.nextElementSibling?.id)).toBe("extension");
    const intrinsicSize = await page.locator(".deferred-slot").first().evaluate((node) => getComputedStyle(node).containIntrinsicBlockSize);
    expect(intrinsicSize).not.toContain("640px");
  });

  test("history endpoint provides keyboard-readable chart data", async ({ page }) => {
    await page.route("**/api/seo/repo-history?*", (route) => route.fulfill({ json: {
      provider: "github", owner: "huanglizhuo", repo: "OctoCounts", currentStars: 0, starPoints: [], slocPoints: [{ date: "2026-01-01", totalLines: 100 }, { date: "2026-09-08", totalLines: 200 }], slocBackfillInProgress: false, starBackfillAvailable: false, starBackfillInProgress: false,
    } }));
    await page.route("**/api/analyze", (route) => {
      const request = route.request().postDataJSON() as { repoUrl: string };
      route.fulfill({ json: { kind: "cached", reportId: "hist", report: reportFor(request.repoUrl, 200) } });
    });
    await page.goto(BASE_URL);
    // The history chart is part of the full runner; the homepage's example
    // report does not include it, so run a (mocked) analysis first. The
    // mocked report counts 200 code lines on 2026-09-08, which merges as the
    // series' last point — the value "End" must land on.
    await page.locator("#repo-url").fill("https://github.com/huanglizhuo/OctoCounts");
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
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
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    // The donut is opt-in now: open the chart view before asserting ring math.
    await page.getByRole("button", { name: "Chart", exact: true }).click();
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

// Report-route structure and the report-aware history chart (T23). Deterministic:
// both the analyze and the repo-history endpoints are route-mocked, and the
// auxiliary report-page endpoints (live stars, similar repos) fail closed.
test.describe("report page structure and history chart (T23)", () => {
  const SAMPLES = [
    { date: "2026-01-01", totalLines: 1000 },
    { date: "2026-04-01", totalLines: 300 }, // suspect dip: under half of both neighbours
    { date: "2026-07-01", totalLines: 1200 },
    { date: "2026-09-07", totalLines: 1400 },
  ];

  function historyFixture(points: Array<{ date: string; totalLines: number }>) {
    return {
      provider: "github", owner: "example", repo: "widgets", currentStars: 0, starPoints: [],
      slocPoints: points, slocBackfillInProgress: false, starBackfillAvailable: false, starBackfillInProgress: false,
    };
  }

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/repo-info*", (route) => route.fulfill({ json: { stars: null } }));
    await page.route("**/api/seo/related*", (route) => route.fulfill({ json: { reports: [] } }));
  });

  test("the report route renders exactly one h1 naming owner/repo", async ({ page }) => {
    await page.goto(`${BASE_URL}/github/example/widgets`);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText("example/widgets");
    // The TopActions status pill is gone; the hero subtitle is the report line.
    await expect(page.locator(".report-route-sub")).toContainText(/SLOC report/);
  });

  test("the history chart draws Y-axis gridlines and ticks, dots every point, and flags suspect samples", async ({ page }) => {
    await page.route("**/api/seo/repo-history?*", (route) => route.fulfill({ json: historyFixture(SAMPLES) }));
    await page.route("**/api/analyze", (route) => route.fulfill({ json: { kind: "cached", reportId: "axis", report: reportFor("https://github.com/example/widgets", 1500) } }));
    await page.goto(`${BASE_URL}/github/example/widgets`);
    await expect(page.locator(".repo-history")).toBeVisible();

    // Y axis: [0, max/2, max] gridlines with compact tick labels.
    await expect(page.locator(".repo-history-gridline")).toHaveCount(3);
    await expect(page.locator(".repo-history-axis-tick")).toHaveCount(3);
    // A dot on every point: 4 samples plus the merged report point (below).
    await expect(page.locator(".repo-history-point")).toHaveCount(5);
    // The partial-backfill dip renders hollow and dashes the segments hugging it.
    await expect(page.locator(".repo-history-point-suspect")).toHaveCount(1);
    const dashedSegments = await page.locator(".repo-history-sloc-line").evaluateAll(
      (nodes) => nodes.filter((node) => node.getAttribute("stroke-dasharray")).length,
    );
    expect(dashedSegments).toBeGreaterThanOrEqual(2);
  });

  test("a pinned-ref report shows the this-report marker instead of merging", async ({ page }) => {
    await page.route("**/api/seo/repo-history?*", (route) => route.fulfill({ json: historyFixture(SAMPLES) }));
    await page.route("**/api/analyze", (route) => route.fulfill({ json: { kind: "cached", reportId: "pinned", report: { ...reportFor("https://github.com/example/widgets", 2500), refName: "v1.0.0" } } }));
    await page.goto(`${BASE_URL}/github/example/widgets/tree/v1.0.0`);
    await expect(page.locator(".report-route-sub")).toContainText("SLOC report · v1.0.0");
    await expect(page.locator(".repo-history")).toBeVisible();

    // Dashed vertical + labelled dot at the report's commit date…
    await expect(page.locator(".repo-history-report-line")).toHaveCount(1);
    await expect(page.locator(".repo-history-report-label")).toHaveText("this report · v1.0.0");
    await expect(page.locator(".repo-history-report-count")).toContainText("2,500");
    // …and nothing merged: the series stays the endpoint's four samples.
    await expect(page.locator(".repo-history-point")).toHaveCount(4);
  });

  test("a default-branch report merges its code count as the chart's last point", async ({ page }) => {
    await page.route("**/api/seo/repo-history?*", (route) => route.fulfill({ json: historyFixture(SAMPLES) }));
    await page.route("**/api/analyze", (route) => route.fulfill({ json: { kind: "cached", reportId: "merged", report: reportFor("https://github.com/example/widgets", 2500) } }));
    await page.goto(`${BASE_URL}/github/example/widgets`);
    await expect(page.locator(".repo-history")).toBeVisible();

    // No marker for an unpinned report…
    await expect(page.locator(".repo-history-report-line")).toHaveCount(0);
    // …its count becomes the series' final point, so the chart header number
    // equals the mocked report's code lines (after the 1.4s count-up).
    await expect(page.locator(".repo-history-count")).toContainText("2,500", { timeout: 6000 });
    await expect(page.locator(".summary .cell.accent .val")).toContainText("2,500");
    await expect(page.locator(".repo-history-point")).toHaveCount(5);
    await page.locator(".repo-history-data summary").click();
    await expect(page.locator(".repo-history-data tbody tr").last()).toContainText("2,500");
  });
});

// Touch/mobile floors (T23): coarse-pointer phones hide the install CTAs and
// every interactive element stays >=44px tall, every text >=12px.
test.describe("responsive tap and type floors (T23)", () => {
  test("mobile 390x844 swaps install CTAs for the desktop-only note and keeps tap/type floors", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(BASE_URL);
    await page.waitForSelector("#repo-url", { timeout: 10000 });

    // First screen: no Chrome install primary button; the coarse-pointer note replaces the CTAs.
    await expect(page.locator(".mobile-install-note").first()).toBeVisible();
    const renderedInstalls = await page.locator("a.install-btn").evaluateAll(
      (nodes) => nodes.filter((node) => node.getClientRects().length > 0).length,
    );
    expect(renderedInstalls).toBe(0);

    // Materialize the deferred below-fold sections, then audit the whole page.
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" as ScrollBehavior }));
    await page.waitForSelector(".tools-grid .developer-tool", { timeout: 10000 });
    await page.waitForTimeout(400);

    const audit = await page.evaluate(() => {
      const issues: Array<{ kind: string; selector: string; detail: string }> = [];
      const describe = (element: Element) => {
        const tag = element.tagName.toLowerCase();
        const cls = typeof element.className === "string" && element.className ? `.${element.className.trim().split(/\s+/).join(".")}` : "";
        const text = element.textContent?.trim().replace(/\s+/g, " ").slice(0, 30);
        return `${tag}${cls}${text ? ` "${text}"` : ""}`;
      };
      const rendered = (element: Element) => {
        if (element.closest(".visually-hidden, .skip-link")) return false;
        if (element.closest("[aria-hidden='true']")) return false;
        // Collapsed disclosures only expose their summary; the hidden panel
        // content still lays out in Chromium, so skip it explicitly.
        const collapsed = element.closest("details:not([open])");
        if (collapsed && !(element.tagName === "SUMMARY" && element.closest("details") === collapsed)) return false;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        return element.getClientRects().length > 0;
      };
      for (const element of document.querySelectorAll("a, button, summary, select, input")) {
        if (!rendered(element)) continue;
        const height = element.getBoundingClientRect().height;
        if (height < 44 - 0.5) issues.push({ kind: "tap", selector: describe(element), detail: `height ${height.toFixed(1)}px` });
      }
      const seen = new Set<Element>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const element = node.parentElement;
        if (!element || seen.has(element)) continue;
        seen.add(element);
        if (!rendered(element)) continue;
        if (element.closest("svg")) continue; // decorative SVG text (chart ticks)
        const fontSize = parseFloat(getComputedStyle(element).fontSize);
        if (fontSize < 12 - 0.25) {
          issues.push({ kind: "type", selector: describe(element), detail: `font-size ${fontSize.toFixed(1)}px: ${element.textContent?.trim().slice(0, 40)}` });
        }
      }
      return issues;
    });
    expect(audit, JSON.stringify(audit, null, 2)).toEqual([]);
    await context.close();
  });

  test("desktop 1440 keeps exactly one primary button in the first viewport of the homepage", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(BASE_URL);
    await page.waitForSelector("#repo-url", { timeout: 10000 });
    const primaries = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".btn"))
        .filter((element) => {
          const style = getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const rect = element.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
        })
        .map((element) => element.textContent?.trim()),
    );
    expect(primaries).toEqual(["Analyze"]);
    await context.close();
  });
});
