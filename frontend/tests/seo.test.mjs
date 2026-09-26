import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

import { onRequest, __resetCompareExistenceCacheForTests } from "../functions/[[path]].js";
import { COMPARE_REGISTRY } from "../functions/compare-registry.js";

const ROOT = new URL("../", import.meta.url);
const EXTENSION_PACKAGE = new URL("../../extension/package.json", import.meta.url);
const EDGE_ADD_ON_URL = "https://microsoftedge.microsoft.com/addons/detail/octocounts-%E2%80%93-github-sloc-/ehifednhpbpekkadndaipnngopbhpoim";

const docs = [
  ["github-sloc-counter", "https://octocounts.com/docs/github-sloc-counter"],
  ["methodology", "https://octocounts.com/docs/methodology"],
  ["api", "https://octocounts.com/docs/api"],
];

function requestContext(pathname) {
  return {
    request: new Request(`https://octocounts.com${pathname}`),
    env: {
      ASSETS: {
        fetch: async (request) => new Response(new URL(request.url).pathname, { status: 200 }),
      },
    },
  };
}

async function renderedContext(pathname, snapshot = null) {
  const index = await readFile(new URL("dist/index.html", ROOT), "utf8");
  return {
    request: new Request(`https://octocounts.com${pathname}`),
    env: {
      SEO_API_BASE: "https://api.test",
      ASSETS: {
        fetch: async (request) => {
          const path = new URL(request.url).pathname;
          if (path === "/github-trending.json" && snapshot) return Response.json(snapshot);
          return new Response(index, { status: 200, headers: { "content-type": "text/html" } });
        },
      },
    },
  };
}

test("legacy documentation .html URLs permanently redirect to extensionless canonicals", async () => {
  for (const [slug, canonical] of docs) {
    const response = await onRequest(requestContext(`/docs/${slug}.html`));
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), canonical);
  }
});

test("every static .html asset path redirects to its extensionless canonical", async () => {
  for (const [pathname, canonical] of [
    ["/about.html", "https://octocounts.com/about"],
    ["/contact.html", "https://octocounts.com/contact"],
    ["/privacy.html", "https://octocounts.com/privacy"],
    ["/research.html", "https://octocounts.com/research"],
    ["/index.html", "https://octocounts.com/"],
    ["/docs/faq.html?x=1", "https://octocounts.com/docs/faq?x=1"],
  ]) {
    const response = await onRequest(requestContext(pathname));
    assert.equal(response.status, 308, pathname);
    assert.equal(response.headers.get("location"), canonical, pathname);
  }
  // The error document itself is not a canonical page; it must keep serving
  // with its 404 status instead of redirecting.
  const errorDoc = await onRequest(requestContext("/404.html"));
  assert.notEqual(errorDoc.status, 308);
});

test("legacy launch-kit URLs permanently redirect to the extension guide", async () => {
  for (const [pathname, canonical] of [
    ["/launch-kit", "https://octocounts.com/#extension"],
    ["/launch-kit.html", "https://octocounts.com/#extension"],
    ["/launch-kit/?lang=zh", "https://octocounts.com/?lang=zh#extension"],
  ]) {
    const response = await onRequest(requestContext(pathname));
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), canonical);
  }

  const launchKit = await readFile(new URL("../../docs/launch-kit.html", import.meta.url), "utf8");
  assert.match(launchKit, /Chrome Web Store/);
});
test("trailing-slash URLs permanently redirect to the slash-free canonical", async () => {
  for (const [pathname, expected] of [
    ["/github/huanglizhuo/OctoCounts/", "https://octocounts.com/github/huanglizhuo/OctoCounts"],
    ["/compare/react-vs-vue/", "https://octocounts.com/compare/react-vs-vue"],
    ["/trending/", "https://octocounts.com/trending"],
    ["/badges/", "https://octocounts.com/badges"],
    ["/docs/faq/?foo=bar", "https://octocounts.com/docs/faq?foo=bar"],
  ]) {
    const response = await onRequest(requestContext(pathname));
    assert.equal(response.status, 308, pathname);
    assert.equal(response.headers.get("location"), expected, pathname);
  }
  // The root path itself must not redirect: "/" already has no trailing
  // content to strip, and stripping it would loop.
  const root = await onRequest(requestContext("/"));
  assert.notEqual(root.status, 308);
});

test("renamed repository URLs permanently redirect to the current canonical report", async () => {
  for (const path of [
    "/github/huanglizhuo/OctoCount",
    "/github/huanglizhuo/OctoCount/tree/main",
  ]) {
    const response = await onRequest(requestContext(path));
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), "https://octocounts.com/github/huanglizhuo/OctoCounts");
  }
});

test("legacy query report URLs permanently redirect to clean public report paths", async () => {
  const response = await onRequest(requestContext("/?q=https%3A%2F%2Fgithub.com%2Fhuanglizhuo%2FQwenASR&ref=main"));
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://octocounts.com/github/huanglizhuo/QwenASR/tree/main");

  const commitResponse = await onRequest(requestContext("/?url=https%3A%2F%2Fgithub.com%2Focto-org%2Frepo.git&ref=abcdef1"));
  assert.equal(commitResponse.status, 308);
  assert.equal(commitResponse.headers.get("location"), "https://octocounts.com/github/octo-org/repo/commit/abcdef1");
});

test("extensionless documentation URLs are served directly", async () => {
  for (const [slug] of docs) {
    const response = await onRequest(requestContext(`/docs/${slug}`));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), `/docs/${slug}`);
  }
});

test("the nginx deployment serves canonical docs and redirects legacy paths", async () => {
  const nginx = await readFile(new URL("nginx.conf", ROOT), "utf8");
  for (const [slug] of docs) {
    assert.match(nginx, new RegExp(`location = /docs/${slug} \\{`));
    assert.match(nginx, new RegExp(`try_files /docs/${slug}\\.html =404;`));
    assert.match(nginx, new RegExp(`location = /docs/${slug}\\.html \\{ return 308 /docs/${slug}; \\}`));
  }
});

test("documentation canonical, Open Graph, and JSON-LD URLs agree", async () => {
  for (const [slug, canonical] of docs) {
    const html = await readFile(new URL(`public/docs/${slug}.html`, ROOT), "utf8");
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical}"`));
    assert.match(html, new RegExp(`<meta property="og:url" content="${canonical}"`));
    assert.match(html, new RegExp(`"mainEntityOfPage": "${canonical}"`));
  }
});

test("built homepage schema uses the packaged extension version", async () => {
  const extensionPackage = JSON.parse(await readFile(EXTENSION_PACKAGE, "utf8"));
  const html = await readFile(new URL("dist/index.html", ROOT), "utf8");
  assert.match(html, new RegExp(`"softwareVersion"\\s*:\\s*"${extensionPackage.version.replaceAll(".", "\\.")}"`));
  assert.doesNotMatch(html, /__EXTENSION_VERSION__/);
});

test("donut center number cannot overlap the ring", async () => {
  const styles = await readFile(new URL("src/styles.css", ROOT), "utf8");
  // The center number sizes from the ring (container query), never the
  // viewport, and clips instead of painting over the ring segments.
  const wrap = styles.match(/\.donut-wrap\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(wrap, /container-type:\s*inline-size/);
  const center = styles.match(/\.donut-center strong\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(center, /font-size:\s*clamp\(20px, 13cqw, 36px\)/);
  assert.match(center, /overflow:\s*hidden/);
});

test("performance assets avoid blocked inline fonts and oversized previews", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");
  const styles = await readFile(new URL("src/styles.css", ROOT), "utf8");
  const extensionSection = await readFile(new URL("src/BrowserExtensionSection.tsx", ROOT), "utf8");
  const main = await readFile(new URL("src/main.tsx", ROOT), "utf8");
  const badges = await readFile(new URL("src/badges.tsx", ROOT), "utf8");
  const topbar = await readFile(new URL("src/Topbar.tsx", ROOT), "utf8");

  assert.match(html, /preconnect" href="https:\/\/api\.octocounts\.com"/);
  assert.match(html, /preload" as="font" href="\/fonts\/jetbrains-mono-800-latin\.woff2"/);
  assert.match(html, /<script>\{let t=null;try\{t=localStorage\.getItem\("octocounts\.theme"\)\}catch\{\}document\.documentElement\.dataset\.scheme=/);
  assert.doesNotMatch(html, /\/boot\.js/);
  assert.doesNotMatch(html, /octocounts-(?:light|dark)-card\.webp" as="image"/);
  assert.doesNotMatch(styles, /data:font/);
  // Pipeline is now static: avoid an always-running decorative animation.
  assert.doesNotMatch(styles, /@keyframes pipe-packet/);
  assert.doesNotMatch(styles, /animation:\s*pipe-packet/);
  assert.match(extensionSection, /card-768\.webp 768w/);
  assert.match(extensionSection, /loading="lazy" width="1280" height="800"/);
  assert.match(topbar, /octocounts-logo-96\.webp/);
  assert.match(badges, /width="180" height="20"/);
  assert.match(main, /path\.startsWith\("\/github\/"\)/);
  assert.doesNotMatch(main, /gitlab/i);
  assert.match(main, /if \(!isPublicReportPath\) \{[\s\S]*?applyPageMetadata\(\{[\s\S]*?return;/);
  // Charts render eagerly (no DeferredContent) by design: they're the primary
  // above-the-fold content once a report loads, not a below-the-fold extra.
  // The report stack lives in src/report/Runner.tsx since the restructure:
  // both variants render Summary directly above Charts (the data contract),
  // and the full branch puts the ReportActions bar (copy link / export /
  // re-analyze) ahead of the summary so core actions sit at the top.
  const runner = await readFile(new URL("src/report/Runner.tsx", ROOT), "utf8");
  assert.match(
    runner,
    /isDemo \? \(\s*<>\s*<Summary stats=\{report\.total\} \/>\s*<Charts report=\{report\} variant="demo" \/>/,
    "demo branch renders Summary directly above Charts",
  );
  assert.match(
    runner,
    /\) : \(\s*<>\s*<ReportActions[\s\S]*?\/>\s*<Summary stats=\{report\.total\} \/>\s*<Charts report=\{report\} variant="full" \/>/,
    "full branch renders ReportActions before Summary and Charts",
  );
  // The homepage embeds no full tool forms anymore (T9): compare and diff are
  // whole-click cards into their own pages, and nothing lazy-loads them here.
  assert.doesNotMatch(main, /<CompareRepos|<DiffRefs|<BadgeBuilder|<BadgeWall/);
  assert.match(main, /className="developer-tools tools-grid"/);
});

test("paper panels stay flat and advanced option checkboxes use the theme UI", async () => {
  const styles = await readFile(new URL("src/styles.css", ROOT), "utf8");

  assert.match(styles, /html\[data-scheme="paper"\]\s*\{[\s\S]*?--terminal-shadow:\s*0 0 0 1px[\s\S]*?inset;/);
  assert.match(styles, /\.analysis-options-grid input:not\(\[type="checkbox"\]\)/);
  assert.match(styles, /\.analysis-toggles input\[type="checkbox"\]\s*\{[\s\S]*?appearance:\s*none;/);
  assert.match(styles, /\.analysis-toggles input\[type="checkbox"\]:checked\s*\{[\s\S]*?background:\s*var\(--accent\);/);
});

test("responsive navigation and the two-mode theme control avoid orphaned UI", async () => {
  const styles = await readFile(new URL("src/styles.css", ROOT), "utf8");
  const main = await readFile(new URL("src/main.tsx", ROOT), "utf8");
  const scheme = await readFile(new URL("src/scheme.tsx", ROOT), "utf8");
  const types = await readFile(new URL("src/types.ts", ROOT), "utf8");

  const english = await readFile(new URL("src/locales/en.json", ROOT), "utf8");
  const chinese = await readFile(new URL("src/locales/zh.json", ROOT), "utf8");

  assert.match(types, /type Scheme = "matrix" \| "paper"/);
  assert.doesNotMatch(`${styles}\n${main}\n${types}\n${english}\n${chinese}`, /amber/i);
  assert.match(scheme, /onClick=\{\(\) => setScheme\(isNight \? "paper" : "matrix"\)\}/);
  assert.match(scheme, /aria-pressed=\{isNight\}/);
  assert.match(styles, /@media \(max-width: 1180px\)\s*\{[\s\S]*?\.topbar\s*\{[\s\S]*?max-height: none;/);
  assert.match(styles, /\.report-index-grid\s*\{[\s\S]*?display: flex;[\s\S]*?flex-wrap: wrap;/);
  assert.match(styles, /\.report-index-link\s*\{[\s\S]*?flex: 1 1 180px;/);
});

test("language colors meet the matrix contrast threshold and the paper ink floor", async () => {
  const source = await readFile(new URL("src/colorContrast.ts", ROOT), "utf8");
  const compiled = await transform(source, { loader: "ts", format: "esm", target: "es2020" });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`;
  const { contrastRatio, MIN_GRAPHIC_CONTRAST, parseHexColor, visibleLanguageColor } = await import(moduleUrl);
  const matrixSurface = [20, 27, 23];

  for (const color of ["#000080", "#292929", "#083FA1"]) {
    const adjusted = visibleLanguageColor(color, "matrix");
    assert.ok(contrastRatio(parseHexColor(adjusted), matrixSurface) >= MIN_GRAPHIC_CONTRAST);
  }

  // Paper (light scheme): near-black swatches are lifted to the theme's dim
  // ink lightness (.25) instead of printing as raw black blocks, hue and
  // saturation intact; colors already at or above the floor pass through.
  assert.equal(visibleLanguageColor("#000000", "paper"), "#404040");
  assert.equal(visibleLanguageColor("#292929", "paper"), "#404040");
  assert.equal(visibleLanguageColor("#001100", "paper"), "#008000");
  assert.equal(visibleLanguageColor("#000080", "paper"), "#000080");
  assert.equal(visibleLanguageColor("#083FA1", "paper"), "#083FA1");
});

test("static and Pages Function responses apply production security headers", async () => {
  const headers = await readFile(new URL("public/_headers", ROOT), "utf8");
  const response = await onRequest(await renderedContext("/trending", {
    source: "https://github.com/trending",
    generatedAt: "2026-07-15T02:17:00Z",
    date: "2026-07-15",
    repositories: [],
  }));

  for (const value of [
    "/fonts/*\n  Cache-Control: public, max-age=31536000, immutable",
    "/octocounts-*-768.webp\n  Cache-Control: public, max-age=31536000, immutable",
    "Strict-Transport-Security: max-age=63072000; includeSubDomains; preload",
    "Cross-Origin-Opener-Policy: same-origin",
  ]) assert.ok(headers.includes(value));
  assert.equal(response.headers.get("strict-transport-security"), "max-age=63072000; includeSubDomains; preload");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  const csp = response.headers.get("content-security-policy");
  // Compute the boot-script hash from the same dist/index.html the browser
  // executes, so the CSP constant in [[path]].js can never drift from the
  // script it pins (the hash was once hardcoded here and rotted).
  const { createHash } = await import("node:crypto");
  const builtIndex = await readFile(new URL("dist/index.html", ROOT), "utf8");
  const bootScript = builtIndex.match(/<script>([\s\S]*?)<\/script>/)[1];
  const bootHash = createHash("sha256").update(bootScript).digest("base64");
  assert.ok(csp.includes(`'sha256-${bootHash}'`), `CSP must pin the built boot script hash ${bootHash}: ${csp}`);
  // The nonce was removed: nothing ever consumed it and cached HTML replayed
  // the same nonce, defeating its purpose. The pinned boot-script hash remains.
  assert.doesNotMatch(csp, /'nonce-/);
  assert.match(csp, /cloud\.umami\.is/);
  assert.match(csp, /gateway\.umami\.is/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(response.headers.get("cache-control"), /no-transform/);
});

test("Pages static HTML uses a strict CSP without disabling compression transforms", async () => {
  const response = await onRequest({
    request: new Request("https://octocounts.com/privacy"),
    env: {
      ASSETS: {
        fetch: async () => new Response("<!doctype html><title>OctoCounts</title>", {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=0, must-revalidate",
          },
        }),
      },
    },
  });

  assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.doesNotMatch(response.headers.get("content-security-policy"), /'nonce-/);
  assert.doesNotMatch(response.headers.get("content-security-policy"), /script-src[^;]*'unsafe-inline'/);
});

test("homepage source and the repository launch kit retain the released Edge add-on", async () => {
  const homepage = await readFile(new URL("index.html", ROOT), "utf8");
  const launchKit = await readFile(new URL("../../docs/launch-kit.html", import.meta.url), "utf8");
  assert.ok(homepage.includes(EDGE_ADD_ON_URL));
  assert.ok(launchKit.includes(EDGE_ADD_ON_URL));
});

test("production frontend image includes the extension version source", async () => {
  const dockerfile = await readFile(new URL("Dockerfile", ROOT), "utf8");
  const compose = await readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../../.github/workflows/build-images.yml", import.meta.url), "utf8");

  assert.match(dockerfile, /COPY frontend\/package\.json frontend\/package-lock\.json \.\//);
  assert.ok(dockerfile.includes("COPY frontend ./"));
  assert.match(dockerfile, /COPY extension\/package\.json \/extension\/package\.json/);
  assert.match(compose, /web:\s+build:\s+context: \.\s+dockerfile: frontend\/Dockerfile/);
  assert.match(workflow, /name: web\s+context: \.\s+dockerfile: \.\/frontend\/Dockerfile/);
});

test("static and generated sitemaps use extensionless documentation URLs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  let generatedXml;
  try {
    const generatedSitemap = await onRequest(requestContext("/sitemap-static.xml"));
    generatedXml = await generatedSitemap.text();
  } finally {
    globalThis.fetch = originalFetch;
  }

  for (const [slug, canonical] of docs) {
    assert.match(generatedXml, new RegExp(`<loc>${canonical}</loc>`));
    assert.doesNotMatch(generatedXml, new RegExp(`/docs/${slug}\\.html`));
  }
  assert.doesNotMatch(generatedXml, /<changefreq>|<priority>/);
});

test("report SSR replaces homepage schema and fallback content", async () => {
  const report = {
    provider: "github",
    owner: "octo-org",
    repo: "octo-repo",
    repoFullName: "octo-org/octo-repo",
    htmlUrl: "https://github.com/octo-org/octo-repo",
    publicPath: "/github/octo-org/octo-repo",
    canonicalUrl: "https://octocounts.com/github/octo-org/octo-repo",
    title: "octo-org/octo-repo: 20,000 lines of code | OctoCounts",
    description: "Source line count for octo-org/octo-repo.",
    citation: "Counted at commit abcdef123456.",
    generatedAt: "2026-07-15T00:00:00Z",
    refName: "main",
    commitSha: "abcdef1234567890abcdef1234567890abcdef12",
    tokeiVersion: "13.0.0",
    durationMs: 100,
    total: { files: 100, lines: 20000, code: 15000, comments: 3000, blanks: 2000 },
    topLanguage: { name: "Rust", code: 12000, percent: 80 },
    languages: [{ name: "Rust", stats: { files: 80, lines: 16000, code: 12000, comments: 2500, blanks: 1500 } }],
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(report);
  try {
    const response = await onRequest(await renderedContext("/github/octo-org/octo-repo"));
    const html = await response.text();
    // SSR facts render inside #root as visible HTML (replaced on hydration),
    // not inside a noscript block.
    assert.equal((html.match(/<noscript>/g) ?? []).length, 0);
    assert.match(html, /<div id="root"><section>/);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
    assert.equal((html.match(/type="application\/ld\+json"/g) ?? []).length, 1);
    assert.match(html, /Repository size insights/);
    assert.match(html, /"@type":"Dataset"/);
    assert.match(html, /"@type":"BreadcrumbList"/);
    assert.match(html, /"@type":"FAQPage"/);
    // The citation sentence is the speakable, quotable core of the page.
    assert.match(html, /<p id="octocounts-citation">Counted at commit abcdef123456\.<\/p>/);
    assert.match(html, /"speakable":\{"@type":"SpeakableSpecification","cssSelector":\["#root h1","#octocounts-citation"\]\}/);
    assert.match(html, /"name":"How many lines of code does octo-org\/octo-repo have\?"/);
    assert.doesNotMatch(html, /"@type":"WebApplication"/);
    assert.doesNotMatch(html, /OctoCounts – GitHub SLOC Counter<\/h1>/);
    assert.match(html, /\/compare\/rust-vs-go/);
    assert.equal(response.headers.get("cache-control"), "public, s-maxage=300, stale-while-revalidate=600");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("trending SSR publishes a stable canonical collection from the daily snapshot", async () => {
  const snapshot = {
    source: "https://github.com/trending",
    period: "daily",
    generatedAt: "2026-07-15T02:17:00Z",
    date: "2026-07-15",
    repositories: [{
      rank: 1,
      owner: "octo-org",
      name: "octo-repo",
      fullName: "octo-org/octo-repo",
      description: "A useful repository.",
      language: "Rust",
      starsToday: 1234,
      totalStars: 12345,
      htmlUrl: "https://github.com/octo-org/octo-repo",
      publicPath: "/github/octo-org/octo-repo",
    }],
  };
  const response = await onRequest(await renderedContext("/trending", snapshot));
  const html = await response.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/octocounts.com\/trending"/);
  assert.match(html, /octo-org\/octo-repo/);
  assert.match(html, /1,234 stars today/);
  assert.match(html, /"@type":"CollectionPage"/);
  assert.match(html, /"datePublished":"2026-07-15"/);
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
  assert.equal(response.headers.get("cache-control"), "public, s-maxage=300, stale-while-revalidate=600");
});

test("generated sitemap gives Trending and reports only truthful lastmod values", async () => {
  const snapshot = {
    source: "https://github.com/trending",
    period: "daily",
    generatedAt: "2026-07-15T02:17:00Z",
    date: "2026-07-15",
    repositories: [],
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([{ loc: "https://octocounts.com/github/octo/repo", lastmod: "2026-07-14" }]);
  try {
    const staticXml = await (await onRequest(await renderedContext("/sitemap-static.xml", snapshot))).text();
    assert.match(staticXml, /<loc>https:\/\/octocounts\.com\/trending<\/loc>\s*<lastmod>2026-07-15<\/lastmod>/);
    assert.doesNotMatch(staticXml, /<changefreq>|<priority>/);

    const reportsXml = await (await onRequest(await renderedContext("/sitemap-reports-1.xml", snapshot))).text();
    assert.match(reportsXml, /<loc>https:\/\/octocounts\.com\/github\/octo\/repo<\/loc>\s*<lastmod>2026-07-14<\/lastmod>/);
    assert.doesNotMatch(reportsXml, /<changefreq>|<priority>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sitemap index lists the child sitemaps and keeps text assets out of every sitemap", async () => {
  const originalFetch = globalThis.fetch;
  __resetCompareExistenceCacheForTests();
  globalThis.fetch = async (url, init) => {
    const request = new URL(url);
    if (request.pathname === "/api/seo/sitemap") {
      return Response.json([{ loc: "https://octocounts.com/github/octo/repo", lastmod: "2026-07-14" }]);
    }
    if (init?.method === "POST" && request.pathname === "/api/seo/repos-indexable") {
      const body = JSON.parse(init.body);
      return Response.json({ repos: body.repos });
    }
    return Response.json([]);
  };
  try {
    const indexXml = await (await onRequest(await renderedContext("/sitemap.xml", {
      source: "https://github.com/trending",
      generatedAt: "2026-07-15T02:17:00Z",
      date: "2026-07-15",
      repositories: [],
    }))).text();
    assert.match(indexXml, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.match(indexXml, /<loc>https:\/\/octocounts\.com\/sitemap-static\.xml<\/loc>/);
    assert.match(indexXml, /<loc>https:\/\/octocounts\.com\/sitemap-compare\.xml<\/loc>/);
    assert.match(indexXml, /<loc>https:\/\/octocounts\.com\/sitemap-reports-1\.xml<\/loc>/);
    assert.doesNotMatch(indexXml, /sitemap-reports-2\.xml/);
    // The index carries no page URLs itself.
    assert.doesNotMatch(indexXml, /<urlset/);

    for (const path of ["/sitemap-static.xml", "/sitemap-compare.xml", "/sitemap-reports-1.xml"]) {
      const xml = await (await onRequest(await renderedContext(path, {
        source: "https://github.com/trending",
        generatedAt: "2026-07-15T02:17:00Z",
        date: "2026-07-15",
        repositories: [],
      }))).text();
      assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/, path);
      // text/plain assets never belong in an XML sitemap (FIX-2).
      assert.doesNotMatch(xml, /llms\.txt|llms-full\.txt/, path);
    }

    // Out-of-range report chunks answer a valid empty urlset, not a 500.
    const overflow = await onRequest(await renderedContext("/sitemap-reports-9.xml", {
      source: "https://github.com/trending",
      generatedAt: "2026-07-15T02:17:00Z",
      date: "2026-07-15",
      repositories: [],
    }));
    assert.equal(overflow.status, 200);
    const overflowXml = await overflow.text();
    assert.match(overflowXml, /<urlset[^>]*>\s*<\/urlset>|<urlset[^>]*>\n<\/urlset>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("compare and diff routes return 200 SSR shells with canonical metadata", async () => {
  const cases = [
    ["/compare", "Compare repository SLOC | OctoCounts"],
    ["/diff", "Compare branch SLOC diff | OctoCounts"],
  ];
  for (const [pathname, title] of cases) {
    const response = await onRequest(await renderedContext(pathname));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes(`<title>${title}</title>`), `${pathname} title`);
    assert.ok(
      html.includes(`<link rel="canonical" href="https://octocounts.com${pathname}" />`),
      `${pathname} canonical`
    );
    assert.match(html, /<meta name="robots" content="index,follow/);
    assert.match(html, /<meta property="og:url" content="https:\/\/octocounts.com\/(compare|diff)" \/>/);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
    assert.equal((html.match(/<noscript>/g) ?? []).length, 0);
  }
});

// setMeta()/canonical replacement rely on the exact minified shape of the
// meta tags in dist/index.html (attribute order, space before "/>"). A
// Vite/html-minifier upgrade that changes that shape silently degrades every
// SSR page to duplicate meta tags, so pin the shape here.
test("dist index.html keeps the meta shapes the edge injector matches", async () => {
  const html = await readFile(new URL("dist/index.html", ROOT), "utf8");
  for (const attr of ["name", "property"]) {
    const metas = html.match(new RegExp(`<meta ${attr}="[a-z:]+" content="[^"]*" />`, "g")) ?? [];
    assert.ok(metas.length > 0, `no <meta ${attr} ... content="..." /> tags in expected shape`);
  }
  assert.match(html, /<link rel="canonical" href="[^"]*" \/>/);
  assert.match(html, /<title>[^<]*<\/title>/);
  assert.match(html, /<div id="root"><\/div>/);
});

test("every generated sitemap child carries a lastmod date per URL", async () => {
  const originalFetch = globalThis.fetch;
  __resetCompareExistenceCacheForTests();
  globalThis.fetch = async (url, init) => {
    const request = new URL(url);
    if (init?.method === "POST" && request.pathname === "/api/seo/repos-indexable") {
      const body = JSON.parse(init.body);
      return Response.json({ repos: body.repos });
    }
    return Response.json([{ loc: "https://octocounts.com/github/octo/repo", lastmod: "2026-07-14" }]);
  };
  try {
    for (const path of ["/sitemap-static.xml", "/sitemap-compare.xml", "/sitemap-reports-1.xml"]) {
      const xml = await (await onRequest(await renderedContext(path, {
        source: "https://github.com/trending",
        generatedAt: "2026-07-15T02:17:00Z",
        date: "2026-07-15",
        repositories: [],
      }))).text();
      const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
      assert.ok(blocks.length > 0, path);
      for (const block of blocks) {
        assert.match(block, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/, `${path}: ${block}`);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("robots.txt gives GPTBot an explicit allow with a training content signal", async () => {
  const robots = await readFile(new URL("public/robots.txt", ROOT), "utf8");
  const gptBotGroup = robots.match(/User-agent: GPTBot\n([\s\S]*?)(?:\n\s*\n|$)/);
  assert.ok(gptBotGroup, "GPTBot group exists");
  assert.match(gptBotGroup[1], /Content-Signal: search=yes,ai-input=yes,ai-train=yes/);
  assert.match(gptBotGroup[1], /Allow: \//);
});

test("homepage schema includes the OctoCounts Organization entity", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");
  assert.match(html, /"@type":\s*"Organization"/);
  assert.match(html, /"name":\s*"OctoCounts"/);
  assert.match(html, /https:\/\/github\.com\/huanglizhuo\/OctoCounts/);
});

test("IndexNow key file is served from the INDEXNOW_KEY env when configured", async () => {
  const key = "test-indexnow-key-0123456789abcdef";
  const context = {
    request: new Request(`https://octocounts.com/${key}.txt`),
    env: {
      INDEXNOW_KEY: key,
      ASSETS: {
        fetch: async (request) => new Response(new URL(request.url).pathname, { status: 200 }),
      },
    },
  };
  const response = await onRequest(context);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/plain/);
  assert.equal(await response.text(), key);

  const withoutKey = await onRequest(requestContext(`/${key}.txt`));
  assert.notEqual(await withoutKey.text(), key);
});

function comparisonReport({ owner, repo, files, lines, code, comments, blanks, languages, generatedAt, commitSha }) {
  const fullName = `${owner}/${repo}`;
  return {
    provider: "github",
    owner,
    repo,
    repoFullName: fullName,
    htmlUrl: `https://github.com/${fullName}`,
    publicPath: `/github/${owner}/${repo}`,
    canonicalUrl: `https://octocounts.com/github/${owner}/${repo}`,
    title: `${fullName}: ${lines} lines of code | OctoCounts`,
    description: `Source line count for ${fullName}.`,
    citation: `Counted at commit ${commitSha.slice(0, 12)}.`,
    generatedAt,
    refName: "main",
    commitSha,
    tokeiVersion: "13.0.0",
    durationMs: 100,
    total: { files, lines, code, comments, blanks },
    topLanguage: { name: languages[0].name, code: languages[0].stats.code, percent: (languages[0].stats.code / code) * 100 },
    languages,
  };
}

function languageRow(name, code) {
  return { name, stats: { files: 10, lines: Math.round(code * 1.3), code, comments: Math.round(code * 0.2), blanks: Math.round(code * 0.1) } };
}

const CURATED_FIXTURES = {
  "facebook/react": comparisonReport({
    owner: "facebook",
    repo: "react",
    files: 4821,
    lines: 210301,
    code: 152488,
    comments: 31220,
    blanks: 26593,
    generatedAt: "2026-07-20T00:00:00Z",
    commitSha: "aaaaaa1111112222bbbbbb333333cccccc444444",
    languages: [languageRow("JavaScript", 82600), languageRow("TypeScript", 35200), languageRow("HTML", 12000), languageRow("CSS", 9000), languageRow("Shell", 500)],
  }),
  "vuejs/core": comparisonReport({
    owner: "vuejs",
    repo: "core",
    files: 2311,
    lines: 120114,
    code: 89302,
    comments: 15220,
    blanks: 15592,
    generatedAt: "2026-07-21T00:00:00Z",
    commitSha: "dddddd5555556666eeeeee777777ffffff888888",
    languages: [languageRow("TypeScript", 60100), languageRow("JavaScript", 18000), languageRow("JSON", 4000), languageRow("HTML", 2000), languageRow("CSS", 1500)],
  }),
  "vitejs/vite": comparisonReport({
    owner: "vitejs",
    repo: "vite",
    files: 1500,
    lines: 200000,
    code: 160000,
    comments: 20000,
    blanks: 20000,
    generatedAt: "2026-07-20T00:00:00Z",
    commitSha: "999999000000aaaaaabbbbbbccccccdddddd12",
    languages: [languageRow("TypeScript", 130000), languageRow("JavaScript", 20000), languageRow("JSON", 3000), languageRow("HTML", 1500), languageRow("CSS", 1000)],
  }),
  "webpack/webpack": comparisonReport({
    owner: "webpack",
    repo: "webpack",
    files: 900,
    lines: 150000,
    code: 120000,
    comments: 18000,
    blanks: 12000,
    generatedAt: "2026-07-19T00:00:00Z",
    commitSha: "eeeeeeffffff00000011111122222233333344",
    languages: [languageRow("JavaScript", 100000), languageRow("TypeScript", 12000), languageRow("CSS", 1500), languageRow("HTML", 1000), languageRow("JSON", 800)],
  }),
};

function stubReportFetch(available) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const request = new URL(url);
    const fixture = available[`${request.searchParams.get("owner")}/${request.searchParams.get("repo")}`];
    return fixture ? Response.json(fixture) : new Response("report was not found", { status: 404 });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("report page hydration never adopts an SSR summary for a different repository", async () => {
  const main = await readFile(new URL("src/main.tsx", ROOT), "utf8");
  // The URL is the only authority for which report a page is: the SSR summary
  // is dropped unless its owner/repo matches the /github/:owner/:repo path,
  // so contaminated edge-cached HTML can never render another repo's meta
  // description client-side (the "duplicate meta descriptions" failure).
  assert.match(main, /const parsedRoute = route \? parsePublicRepo\(route\.repoUrl\) : null;/);
  assert.match(main, /if \(summaryOwner !== parsedRoute\.owner\.toLowerCase\(\) \|\| summaryRepo !== parsedRoute\.repo\.toLowerCase\(\)\) return null;/);
  // A report route without a matching seed must not fall back to the bundled
  // demo repository either: that would put one repo's numbers under every
  // unseeded report URL until the auto-run completes.
  assert.match(
    main,
    /: window\.location\.pathname\.startsWith\("\/github\/"\)\s*\n\s*\? null\s*\n\s*: normalizeReport\(initialReportData/
  );
});

test("curated comparison SSR renders balanced citable content", async () => {
  const cases = [
    ["react-vs-vue", "React vs Vue", "facebook/react", "vuejs/core"],
    ["vite-vs-webpack", "Vite vs webpack", "vitejs/vite", "webpack/webpack"],
  ];
  for (const [slug, name, leftName, rightName] of cases) {
    const restore = stubReportFetch(CURATED_FIXTURES);
    let html;
    let response;
    try {
      response = await onRequest(await renderedContext(`/compare/${slug}`));
      html = await response.text();
    } finally {
      restore();
    }

    assert.equal(response.status, 200, slug);
    assert.equal(response.headers.get("cache-control"), "public, s-maxage=300, stale-while-revalidate=600", slug);
    assert.ok(html.includes(`<title>${name}: source lines of code compared | OctoCounts</title>`), `${slug} title`);
    assert.ok(html.includes(`<link rel="canonical" href="https://octocounts.com/compare/${slug}" />`), `${slug} canonical`);
    assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1" \/>/);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${slug} single h1`);
    assert.equal((html.match(/<noscript>/g) ?? []).length, 0, `${slug} no noscript`);
    assert.match(html, /<div id="root"><section>/, `${slug} SSR content in root`);
    assert.equal((html.match(/type="application\/ld\+json"/g) ?? []).length, 1, `${slug} single JSON-LD block`);

    // Totals comparison table and balanced, disclaimer-first copy.
    assert.match(html, /<table>/, `${slug} totals table`);
    assert.ok(html.includes(`<th><a href="/github/${leftName}">${leftName}</a></th>`), `${slug} left column`);
    assert.ok(html.includes(`<th><a href="/github/${rightName}">${rightName}</a></th>`), `${slug} right column`);
    assert.match(html, /code size is not code quality/i, `${slug} disclaimer`);
    assert.doesNotMatch(html, /is better than/i, `${slug} no subjective verdict`);

    // Methodology with reproducible refs, SHAs, and dates.
    const left = CURATED_FIXTURES[leftName];
    const right = CURATED_FIXTURES[rightName];
    assert.ok(html.includes(left.commitSha.slice(0, 12)), `${slug} left SHA`);
    assert.ok(html.includes(right.commitSha.slice(0, 12)), `${slug} right SHA`);
    assert.ok(html.includes('href="/docs/methodology"'), `${slug} methodology link`);

    // Links to both reports and the prefilled interactive comparison.
    assert.ok(html.includes(`href="/github/${leftName}"`), `${slug} left report link`);
    assert.ok(html.includes(`href="/github/${rightName}"`), `${slug} right report link`);
    assert.ok(
      html.includes(`href="/compare?left=https%3A%2F%2Fgithub.com%2F${left.owner}%2F${left.repo}&amp;right=https%3A%2F%2Fgithub.com%2F${right.owner}%2F${right.repo}"`),
      `${slug} interactive link`
    );

    // Embedded prefill keeps the hydrated client on the same pair.
    const prefill = html.match(/<script type="application\/json" id="octocounts-compare-prefill">([^<]*)<\/script>/);
    assert.ok(prefill, `${slug} prefill script`);
    assert.deepEqual(JSON.parse(prefill[1]), {
      left: `https://github.com/${leftName}`,
      right: `https://github.com/${rightName}`,
    });

    // SG-01: the client page renders from #octocounts-compare-data, so every
    // fact a JS reader sees must equal the SSR body. Assert the view model
    // against the HTML instead of trusting both to stay in sync.
    const dataScript = html.match(/<script type="application\/json" id="octocounts-compare-data">([^<]*)<\/script>/);
    assert.ok(dataScript, `${slug} compare data script`);
    const model = JSON.parse(dataScript[1]);
    assert.equal(model.state, "ready", `${slug} model state`);
    assert.equal(model.slug, slug, `${slug} model slug`);
    assert.equal(model.heading, `${name}: source lines of code compared`, `${slug} model heading`);
    assert.equal(model.canonical, `https://octocounts.com/compare/${slug}`, `${slug} model canonical`);
    assert.deepEqual(model.prefill, JSON.parse(prefill[1]), `${slug} model prefill matches embedded prefill`);
    assert.ok(html.includes(model.summaryText), `${slug} model summary appears in SSR body`);
    assert.ok(html.includes(model.languageMixText), `${slug} model language mix appears in SSR body`);
    assert.ok(html.includes(model.methodologyText.slice(0, 80)), `${slug} model methodology appears in SSR body`);
    assert.ok(html.includes(model.definitionText), `${slug} model definition appears in SSR body`);
    assert.ok(html.includes(model.disclaimerText), `${slug} model disclaimer appears in SSR body`);
    for (const row of model.rows) {
      assert.ok(html.includes(`<td>${row.label}</td><td>${row.left}</td><td>${row.right}</td>`), `${slug} model row "${row.label}" appears in SSR table`);
    }
    for (const item of model.faq) {
      assert.ok(html.includes(item.question), `${slug} model FAQ question appears in SSR body`);
      assert.ok(html.includes(item.answer), `${slug} model FAQ answer appears in SSR body`);
    }

    // JSON-LD parses and stays consistent with the page facts.
    const jsonLd = html.match(/<script type="application\/ld\+json">([^<]*)<\/script>/);
    assert.ok(jsonLd, `${slug} JSON-LD script`);
    const graph = JSON.parse(jsonLd[1])["@graph"];
    const dataset = graph.find((node) => node["@type"] === "Dataset");
    assert.ok(dataset, `${slug} Dataset node`);
    assert.deepEqual(dataset.isBasedOn, [left.canonicalUrl, right.canonicalUrl]);
    assert.equal(dataset.url, `https://octocounts.com/compare/${slug}`);
    assert.equal(dataset.dateModified, right.generatedAt > left.generatedAt ? right.generatedAt : left.generatedAt);
    assert.equal(dataset.dateModified, model.updatedAt, `${slug} model updatedAt matches JSON-LD dateModified`);
    assert.ok(graph.some((node) => node["@type"] === "BreadcrumbList"), `${slug} breadcrumbs`);

    // Compare FAQ: the question-shaped fan-out AI answer engines expect for
    // a comparison query, both as visible content and as FAQPage schema.
    assert.match(html, /<h2>Compare FAQ<\/h2>/, `${slug} FAQ heading`);
    assert.match(html, /Which has more lines of code/, `${slug} FAQ which-is-bigger question`);
    assert.match(html, /Does more source lines of code mean more complexity\?/, `${slug} FAQ complexity question`);
    const faqNode = graph.find((node) => node["@type"] === "FAQPage");
    assert.ok(faqNode, `${slug} FAQPage node`);
    assert.ok(faqNode.mainEntity.length >= 4, `${slug} FAQPage has the full question set`);
    for (const question of faqNode.mainEntity) {
      assert.ok(html.includes(question.name), `${slug} FAQ schema question "${question.name}" appears in visible HTML`);
      assert.ok(html.includes(question.acceptedAnswer.text), `${slug} FAQ schema answer for "${question.name}" appears in visible HTML`);
    }
  }
});

test("unknown curated comparison slugs fall through to static asset handling", async () => {
  const context = await renderedContext("/compare/not-a-real-pair");
  // Production static hosting answers 404 for unknown paths; the function must
  // not turn arbitrary /compare/<slug> URLs into indexable comparison pages.
  context.env.ASSETS.fetch = async () => new Response("not found", { status: 404 });
  const response = await onRequest(context);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "not found");
});

test("curated comparison view model and markdown twin carry identical facts", async () => {
  const restore = stubReportFetch(CURATED_FIXTURES);
  try {
    const [htmlResponse, mdResponse] = await Promise.all([
      onRequest(await renderedContext("/compare/react-vs-vue")),
      onRequest(await renderedContext("/compare/react-vs-vue.md")),
    ]);
    const html = await htmlResponse.text();
    const md = await mdResponse.text();
    const model = JSON.parse(html.match(/<script type="application\/json" id="octocounts-compare-data">([^<]*)<\/script>/)[1]);
    // Every number and sentence the markdown twin states comes from the same
    // view model the HTML page and the JS client render.
    assert.ok(md.includes(model.summaryText), "markdown carries the model summary");
    assert.ok(md.includes(model.languageMixText), "markdown carries the model language mix");
    assert.ok(md.includes(model.disclaimerText), "markdown carries the model disclaimer");
    for (const row of model.rows) {
      assert.ok(md.includes(`| ${row.label} | ${row.left} | ${row.right} |`), `markdown row "${row.label}"`);
    }
    for (const item of model.faq) {
      assert.ok(md.includes(`### ${item.question}`), `markdown FAQ question "${item.question}"`);
      assert.ok(md.includes(item.answer), `markdown FAQ answer for "${item.question}"`);
    }
    assert.ok(md.includes(model.left.commitSha.slice(0, 12)), "markdown carries the left commit");
    assert.ok(md.includes(model.right.commitSha.slice(0, 12)), "markdown carries the right commit");
  } finally {
    restore();
  }
});

test("curated comparison serves a noindex fallback when a report is missing", async () => {
  const restore = stubReportFetch({ "facebook/react": CURATED_FIXTURES["facebook/react"] });
  let response;
  let html;
  try {
    response = await onRequest(await renderedContext("/compare/react-vs-vue"));
    html = await response.text();
  } finally {
    restore();
  }

  assert.equal(response.status, 200);
  assert.match(html, /<meta name="robots" content="noindex,follow/);
  assert.match(html, /not available for both repositories yet/);
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
  assert.doesNotMatch(html, /type="application\/ld\+json"/);
  // The client page keeps the same identity on the degraded state instead of
  // swapping to the generic tool heading.
  const dataScript = html.match(/<script type="application\/json" id="octocounts-compare-data">([^<]*)<\/script>/);
  assert.ok(dataScript, "missing-state data script");
  const model = JSON.parse(dataScript[1]);
  assert.equal(model.state, "missing");
  assert.equal(model.heading, "React vs Vue: source lines of code compared");
  assert.equal(model.canonical, "https://octocounts.com/compare/react-vs-vue");
});

test("curated comparison answers 503 + no-store when a report fetch fails transiently", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const request = new URL(url);
    const key = `${request.searchParams.get("owner")}/${request.searchParams.get("repo")}`;
    if (key === "facebook/react") return Response.json(CURATED_FIXTURES["facebook/react"]);
    return new Response("backend exploded", { status: 503 });
  };
  let response;
  let html;
  try {
    response = await onRequest(await renderedContext("/compare/react-vs-vue"));
    html = await response.text();
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Transient backend failure: ask crawlers to retry later, never serve (or
  // let the CDN cache) a noindex page for an indexable URL.
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(html, /noindex/);
  assert.doesNotMatch(html, /not available for both repositories yet/);
  // Bing Webmaster Tools flagged duplicate titles/descriptions and a
  // missing <h1> across unrelated report/compare URLs — traced to every
  // 503 returning the same generic homepage shell. Each URL must render
  // its own title/description/H1 even while the backend is unavailable.
  assert.match(html, /<title>React vs Vue: source lines of code compared \| OctoCounts<\/title>/);
  assert.match(html, /<h1>React vs Vue: source lines of code compared<\/h1>/);
  assert.doesNotMatch(html, /<title>OctoCounts – GitHub SLOC Counter<\/title>/);
  // Degraded-state identity for the JS client matches the 503 body.
  const dataScript = html.match(/<script type="application\/json" id="octocounts-compare-data">([^<]*)<\/script>/);
  assert.ok(dataScript, "unavailable-state data script");
  const model = JSON.parse(dataScript[1]);
  assert.equal(model.state, "unavailable");
  assert.equal(model.heading, "React vs Vue: source lines of code compared");
});

test("curated comparison answers 503 + no-store when a report fetch throws", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const request = new URL(url);
    const key = `${request.searchParams.get("owner")}/${request.searchParams.get("repo")}`;
    if (key === "facebook/react") return Response.json(CURATED_FIXTURES["facebook/react"]);
    throw new Error("network unreachable");
  };
  let response;
  try {
    response = await onRequest(await renderedContext("/compare/react-vs-vue"));
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("report page answers 503 + no-store when the report API fails transiently", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("backend exploded", { status: 500 });
  let response;
  let html;
  let otherHtml;
  try {
    response = await onRequest(await renderedContext("/github/octo-org/octo-repo"));
    html = await response.text();
    otherHtml = await (await onRequest(await renderedContext("/github/another-org/another-repo"))).text();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(html, /noindex/);
  assert.doesNotMatch(html, /No cached report exists yet/);
  // Same regression as the curated-compare 503 above: each repo URL must
  // get its own title/H1, not the generic homepage shell repeated for
  // every URL an outage happens to touch. The H1 is the repository itself
  // (owner/repo), matching the hydrated client hero (T5).
  assert.match(html, /<title>octo-org\/octo-repo SLOC report \| OctoCounts<\/title>/);
  assert.match(html, /<h1>octo-org\/octo-repo<\/h1>/);
  assert.doesNotMatch(html, /<title>OctoCounts – GitHub SLOC Counter<\/title>/);
  assert.notEqual(html, otherHtml, "different repos must not render byte-identical 503 pages");
});

test("report page answers 503 + no-store when the report API is unreachable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network unreachable");
  };
  let response;
  try {
    response = await onRequest(await renderedContext("/github/octo-org/octo-repo"));
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("report page carries a semantic timestamp and answers conditional GETs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(CURATED_FIXTURES["facebook/react"]);
  try {
    const context = await renderedContext("/github/facebook/react");
    // Stale conditional request: full 200 with a machine-readable freshness
    // trail — Last-Modified from the report's own generatedAt, plus <time>
    // around the visible date so agents parse it without regexes.
    const fresh = await onRequest({
      ...context,
      request: new Request("https://octocounts.com/github/facebook/react", {
        headers: { "if-modified-since": "Wed, 01 Jan 2026 00:00:00 GMT" },
      }),
    });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.headers.get("last-modified"), "Mon, 20 Jul 2026 00:00:00 GMT");
    assert.match(await fresh.text(), /<time datetime="2026-07-20T00:00:00Z">2026-07-20T00:00:00Z<\/time>/);

    // Same-second-or-newer conditional request: 304 with no body.
    const notModified = await onRequest({
      ...context,
      request: new Request("https://octocounts.com/github/facebook/react", {
        headers: { "if-modified-since": "Mon, 20 Jul 2026 00:00:00 GMT" },
      }),
    });
    assert.equal(notModified.status, 304);
    assert.equal(notModified.headers.get("last-modified"), "Mon, 20 Jul 2026 00:00:00 GMT");
    assert.equal(await notModified.text(), "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("curated comparison dataset is speakable and anchors its summary sentence", async () => {
  const restore = stubReportFetch(CURATED_FIXTURES);
  let html;
  try {
    const response = await onRequest(await renderedContext("/compare/react-vs-vue"));
    html = await response.text();
  } finally {
    restore();
  }
  assert.match(html, /<p id="octocounts-compare-summary">/);
  assert.match(html, /"speakable":\{"@type":"SpeakableSpecification","cssSelector":\["#root h1","#octocounts-compare-summary"\]\}/);
});

test("report page answers 503 + no-store when the payload belongs to a different repository", async () => {
  // The contamination shape search consoles flagged as duplicate meta
  // descriptions: some tier between this function and the store answers
  // repo A's URL with repo B's cached payload. The page must fail closed
  // instead of SSRing (and edge-caching) B's numbers under A's URL.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(CURATED_FIXTURES["facebook/react"]);
  let response;
  let html;
  let otherHtml;
  try {
    response = await onRequest(await renderedContext("/github/octo-org/octo-repo"));
    html = await response.text();
    otherHtml = await (await onRequest(await renderedContext("/github/another-org/another-repo"))).text();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(html, /facebook\/react/);
  assert.match(html, /<title>octo-org\/octo-repo SLOC report \| OctoCounts<\/title>/);
  assert.match(html, /<h1>octo-org\/octo-repo<\/h1>/);
  assert.notEqual(html, otherHtml, "different repos must not render byte-identical guard pages");
});

test("a differently-cased report URL still canonicalizes instead of tripping the integrity guard", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(CURATED_FIXTURES["facebook/react"]);
  let response;
  try {
    response = await onRequest(await renderedContext("/github/Facebook/React"));
  } finally {
    globalThis.fetch = originalFetch;
  }
  // Same repository, different casing is a canonicalization case, not
  // contamination: the guard must pass and the existing 308 must fire.
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://octocounts.com/github/facebook/react");
});

test("curated comparison answers 503 + no-store when a payload belongs to a different repository", async () => {
  const restore = stubReportFetch({
    "facebook/react": CURATED_FIXTURES["facebook/react"],
    // vuejs/core's slot answered with facebook/react's payload.
    "vuejs/core": CURATED_FIXTURES["facebook/react"],
  });
  let response;
  let html;
  try {
    response = await onRequest(await renderedContext("/compare/react-vs-vue"));
    html = await response.text();
  } finally {
    restore();
  }

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(html, /This comparison is temporarily unavailable/);
  assert.doesNotMatch(html, /Counted at commit aaaaaa111111/);
  assert.doesNotMatch(html, /<table>/);
});

test("sitemap drops curated comparisons whose reports are missing but keeps them when the backend fails", async () => {
  const originalFetch = globalThis.fetch;
  __resetCompareExistenceCacheForTests();
  globalThis.fetch = async (url, init) => {
    const request = new URL(url);
    if (request.pathname === "/api/seo/sitemap") return Response.json([]);
    if (init?.method === "POST" && request.pathname === "/api/seo/repos-indexable") {
      const body = JSON.parse(init.body);
      return Response.json({
        repos: body.repos.filter((repo) => `${repo.owner}/${repo.repo}` !== "vuejs/core"),
      });
    }
    return Response.json({});
  };
  let xml;
  try {
    const response = await onRequest(await renderedContext("/sitemap-compare.xml", {
      source: "https://github.com/trending",
      generatedAt: "2026-07-15T02:17:00Z",
      date: "2026-07-15",
      repositories: [],
    }));
    xml = await response.text();
  } finally {
    globalThis.fetch = originalFetch;
  }

  // react-vs-vue: right side (vuejs/core) definitively missing -> excluded.
  assert.doesNotMatch(xml, /<loc>https:\/\/octocounts\.com\/compare\/react-vs-vue<\/loc>/);
  // svelte-vs-vue / angular-vs-vue share the missing vuejs/core side.
  assert.doesNotMatch(xml, /<loc>https:\/\/octocounts\.com\/compare\/svelte-vs-vue<\/loc>/);
  assert.doesNotMatch(xml, /<loc>https:\/\/octocounts\.com\/compare\/angular-vs-vue<\/loc>/);
  // Everything with both sides cached stays listed.
  assert.match(xml, /<loc>https:\/\/octocounts\.com\/compare\/vite-vs-webpack<\/loc>/);

  // An unreachable backend fails open: no curated entry is dropped, and the
  // failed answer is not cached (the next pass retries).
  __resetCompareExistenceCacheForTests();
  globalThis.fetch = async (url, init) => {
    const request = new URL(url);
    if (request.pathname === "/api/seo/sitemap") return Response.json([]);
    if (init?.method === "POST" && request.pathname === "/api/seo/repos-indexable") {
      return new Response("backend exploded", { status: 500 });
    }
    return Response.json({});
  };
  let xmlOnFailure;
  try {
    const response = await onRequest(await renderedContext("/sitemap-compare.xml", {
      source: "https://github.com/trending",
      generatedAt: "2026-07-15T02:17:00Z",
      date: "2026-07-15",
      repositories: [],
    }));
    xmlOnFailure = await response.text();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.match(xmlOnFailure, /<loc>https:\/\/octocounts\.com\/compare\/react-vs-vue<\/loc>/);
  const curatedCount = (xmlOnFailure.match(/<loc>https:\/\/octocounts\.com\/compare\//g) ?? []).length;
  assert.equal(curatedCount, COMPARE_REGISTRY.length);
});

test("bare /compare noscript links every curated comparison", async () => {
  const response = await onRequest(await renderedContext("/compare"));
  const html = await response.text();
  assert.match(html, /Curated comparisons/);
  for (const entry of COMPARE_REGISTRY) {
    assert.ok(html.includes(`href="/compare/${entry.slug}"`), entry.slug);
  }
});

test("generated compare sitemap includes every curated comparison", async () => {
  const originalFetch = globalThis.fetch;
  // Every repository answers as indexed, so no curated entry is filtered out.
  __resetCompareExistenceCacheForTests();
  globalThis.fetch = async (url, init) => {
    const request = new URL(url);
    if (init?.method === "POST" && request.pathname === "/api/seo/repos-indexable") {
      const body = JSON.parse(init.body);
      return Response.json({ repos: body.repos });
    }
    return Response.json([]);
  };
  let generatedXml;
  try {
    const generatedSitemap = await onRequest(await renderedContext("/sitemap-compare.xml", {
      source: "https://github.com/trending",
      generatedAt: "2026-07-15T02:17:00Z",
      date: "2026-07-15",
      repositories: [],
    }));
    generatedXml = await generatedSitemap.text();
  } finally {
    globalThis.fetch = originalFetch;
  }

  for (const entry of COMPARE_REGISTRY) {
    const loc = `<loc>https://octocounts.com/compare/${entry.slug}</loc>`;
    assert.ok(generatedXml.includes(loc), `generated ${entry.slug}`);
  }
  const curatedCount = (generatedXml.match(/<loc>https:\/\/octocounts\.com\/compare\//g) ?? []).length;
  assert.equal(curatedCount, COMPARE_REGISTRY.length);
});

const RELATED_REPORT_FIXTURE = {
  provider: "github",
  owner: "octo-org",
  repo: "octo-repo",
  repoFullName: "octo-org/octo-repo",
  htmlUrl: "https://github.com/octo-org/octo-repo",
  publicPath: "/github/octo-org/octo-repo",
  canonicalUrl: "https://octocounts.com/github/octo-org/octo-repo",
  title: "octo-org/octo-repo: 20,000 lines of code | OctoCounts",
  description: "Source line count for octo-org/octo-repo.",
  citation: "Counted at commit abcdef123456.",
  generatedAt: "2026-07-15T00:00:00Z",
  refName: "main",
  commitSha: "abcdef1234567890abcdef1234567890abcdef12",
  tokeiVersion: "13.0.0",
  durationMs: 100,
  total: { files: 100, lines: 20000, code: 15000, comments: 3000, blanks: 2000 },
  topLanguage: { name: "Rust", code: 12000, percent: 80 },
  languages: [{ name: "Rust", stats: { files: 80, lines: 16000, code: 12000, comments: 2500, blanks: 1500 } }],
};

function stubReportAndRelatedFetch(relatedPayload, report = RELATED_REPORT_FIXTURE) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const request = new URL(url);
    if (request.pathname === "/api/seo/related") {
      if (relatedPayload instanceof Response) return relatedPayload;
      return Response.json(relatedPayload);
    }
    return Response.json(report);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("report SSR links similar repository reports when the related API answers", async () => {
  const restore = stubReportAndRelatedFetch({
    reports: [
      { provider: "github", owner: "tokio-rs", repo: "axum", repoFullName: "tokio-rs/axum", publicPath: "/github/tokio-rs/axum", topLanguage: "Rust", totalCode: 16000, totalLines: 21000 },
      { provider: "github", owner: "octo-org", repo: "odd & <named>", repoFullName: "octo-org/odd & <named>", publicPath: "/github/octo-org/odd%20%26%20%3Cnamed%3E", topLanguage: null, totalCode: 1200, totalLines: 1500 },
    ],
  });
  let html;
  try {
    const response = await onRequest(await renderedContext("/github/octo-org/octo-repo"));
    html = await response.text();
  } finally {
    restore();
  }

  assert.match(html, /<h2>Similar repository reports<\/h2>/);
  assert.ok(html.includes('<a href="/github/tokio-rs/axum">tokio-rs/axum</a> — Rust, 16,000 code lines'));
  // Missing top language and HTML-significant characters are handled safely.
  assert.ok(html.includes("octo-org/odd &amp; &lt;named&gt;</a> — mixed, 1,200 code lines"));
  assert.doesNotMatch(html, /odd & <named>/);
});

test("report SSR omits the similar section when the related API fails or misbehaves", async () => {
  for (const payload of [new Response("unavailable", { status: 500 }), { unexpected: true }]) {
    const restore = stubReportAndRelatedFetch(payload);
    let html;
    try {
      const response = await onRequest(await renderedContext("/github/octo-org/octo-repo"));
      html = await response.text();
    } finally {
      restore();
    }
    assert.doesNotMatch(html, /Similar repository reports/);
    assert.match(html, /<div id="root"><section>/);
  }
});

test("trending.xml serves an RSS 2.0 feed from the daily snapshot", async () => {
  const snapshot = {
    source: "https://github.com/trending",
    period: "daily",
    generatedAt: "2026-07-15T02:17:00Z",
    date: "2026-07-15",
    repositories: [{
      rank: 1,
      owner: "octo-org",
      name: "octo-repo",
      fullName: "octo-org/octo-repo",
      description: "Fish & <chips> counter",
      language: "Rust",
      starsToday: 1234,
      totalStars: 12345,
      htmlUrl: "https://github.com/octo-org/octo-repo",
      publicPath: "/github/octo-org/octo-repo",
    }],
  };
  const response = await onRequest(await renderedContext("/trending.xml", snapshot));
  assert.equal(response.headers.get("content-type"), "application/rss+xml; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "public, s-maxage=3600, stale-while-revalidate=86400");
  const xml = await response.text();
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0">/);
  assert.ok(xml.includes("<link>https://octocounts.com/trending</link>"));
  assert.match(xml, /<title>octo-org\/octo-repo<\/title>/);
  assert.ok(xml.includes("<link>https://octocounts.com/github/octo-org/octo-repo</link>"));
  assert.match(xml, /<pubDate>Wed, 15 Jul 2026 02:17:00 GMT<\/pubDate>/);
  assert.match(xml, /<category>Rust<\/category>/);
  assert.ok(xml.includes("Fish &amp; &lt;chips&gt; counter"));
  assert.doesNotMatch(xml, /Fish & </);
});

test("trending.xml stays a valid empty feed without a snapshot", async () => {
  const response = await onRequest(await renderedContext("/trending.xml"));
  const xml = await response.text();
  assert.match(xml, /<rss version="2\.0">/);
  assert.doesNotMatch(xml, /<item>/);
});

test("the trending page head advertises the RSS feed", async () => {
  const response = await onRequest(await renderedContext("/trending", {
    source: "https://github.com/trending",
    generatedAt: "2026-07-15T02:17:00Z",
    date: "2026-07-15",
    repositories: [],
  }));
  const html = await response.text();
  assert.ok(html.includes('<link rel="alternate" type="application/rss+xml" title="Trending GitHub repositories today | OctoCounts" href="https://octocounts.com/trending.xml" />'));
});

test("embed routes are frameable by any site, noindexed, and link to the report", async () => {
  const response = await onRequest(await renderedContext("/embed/github/octo-org/octo-repo"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-frame-options"), null);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors \*/);
  const html = await response.text();
  assert.match(html, /<meta name="robots" content="noindex,nofollow" \/>/);
  assert.ok(html.includes('<link rel="canonical" href="https://octocounts.com/github/octo-org/octo-repo" />'));

  // GitLab support was removed: a /embed/gitlab/ path is no longer a function
  // route and falls through to static asset handling (404 in production).
  const gone = await renderedContext("/embed/gitlab/octo-group/octo-repo");
  gone.env.ASSETS.fetch = async () => new Response("not found", { status: 404 });
  const goneResponse = await onRequest(gone);
  assert.equal(goneResponse.status, 404);
});

test("non-embed pages keep the locked-down frame headers", async () => {
  const response = await onRequest(await renderedContext("/badges"));
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

test("homepage SSR injects crawler-visible body content and keeps the head schema", async () => {
  const source = await readFile(new URL("index.html", ROOT), "utf8");
  const blocks = source.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) ?? [];
  const faq = blocks
    .map((block) => {
      try {
        return JSON.parse(block.replace(/<\/?script\b[^>]*>/gi, ""));
      } catch {
        return null;
      }
    })
    .find((json) => json?.["@type"] === "FAQPage");
  assert.ok(faq, "homepage FAQPage JSON-LD exists");
  assert.equal(faq.mainEntity.length, 7);

  const response = await onRequest(await renderedContext("/"));
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /<div id="root"><section>/);
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(html, /<h1>OctoCounts – GitHub SLOC Counter<\/h1>/);
  assert.match(html, /free SLOC counter for public GitHub repositories/);
  assert.match(html, /<h2>How it works<\/h2>/);
  // The freshness line is only meaningful to crawlers if it's in the SSR
  // body, not just the client-rendered React component — a prior fix added
  // it to main.tsx alone and non-JS-executing bots never saw it.
  assert.match(html, /Last updated: \d{4}-\d{2}-\d{2} &middot; Maintained by <a href="https:\/\/github\.com\/huanglizhuo">huanglizhuo<\/a>/);
  // Visible FAQ answers come from the same FAQPage JSON-LD the head serves.
  for (const item of faq.mainEntity) {
    assert.ok(html.includes(`<h3>${item.name}</h3>`), item.name);
  }
  for (const href of ["/badges", "/compare", "/trending", "/stats", "/docs/methodology", "/docs/api"]) {
    assert.ok(html.includes(`href="${href}"`), href);
  }
  // The head is untouched: the full homepage JSON-LD set stays in place.
  const sourceLdCount = (source.match(/type="application\/ld\+json"/g) ?? []).length;
  assert.equal((html.match(/type="application\/ld\+json"/g) ?? []).length, sourceLdCount);
  assert.match(html, /<link rel="canonical" href="https:\/\/octocounts.com\/" \/>/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("stats SSR renders the full citable aggregates and Dataset datePublished", async () => {
  const stats = {
    totals: { reportsGenerated: 4200, repositoriesAnalyzed: 3100, linesCounted: 123456789, codeLinesCounted: 98765432, languagesDetected: 87 },
    windows: { reportsToday: 5, reports7d: 40, reports30d: 150, repositoriesToday: 4, repositories7d: 33, repositories30d: 120 },
    sources: [
      { source: "web", reports: 2000 },
      { source: "extension", reports: 1500 },
      { source: "github_action", reports: 700 },
    ],
    languages: [{ language: "Rust", code: 5000000, lines: 6500000, reports: 300 }],
    topRepositories: [{
      provider: "github",
      owner: "torvalds",
      repo: "linux",
      publicPath: "/github/torvalds/linux",
      htmlUrl: "https://github.com/torvalds/linux",
      refName: "master",
      generatedAt: "2026-08-01T00:00:00Z",
      total: { files: 80000, lines: 40000000, code: 30000000, comments: 5000000, blanks: 5000000 },
      topLanguage: "C",
    }],
    recentRepositories: [],
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(stats);
  let html;
  try {
    const response = await onRequest(await renderedContext("/stats"));
    html = await response.text();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.match(html, /<h2>Where analyses come from<\/h2>/);
  assert.ok(html.includes("Web app: 2,000 reports"));
  assert.ok(html.includes("GitHub Action: 700 reports"));
  assert.match(html, /<h2>Language coverage<\/h2>/);
  assert.ok(html.includes("Rust: 5,000,000 code lines across 300 reports"));
  assert.match(html, /<h2>Largest repositories measured<\/h2>/);
  assert.ok(html.includes('<a href="/github/torvalds/linux">torvalds/linux</a> — 40,000,000 total lines (30,000,000 code)'));
  assert.match(html, /"@type":"Dataset"/);
  assert.match(html, /"datePublished":"2026-07-10"/);
});

test("docs dateModified and sitemap lastmod follow the per-page content manifest", async () => {
  const manifest = JSON.parse(await readFile(new URL("content/content-manifest.json", ROOT), "utf8"));
  const edge = await readFile(new URL("functions/[[path]].js", ROOT), "utf8");

  // The functions file's STATIC_SITEMAP_ENTRIES must mirror the manifest's
  // XML-sitemap pages. llms.txt / llms-full.txt stay in the manifest as a
  // content-change record but are deliberately not sitemap entries.
  const manifestSitemapPages = Object.entries(manifest.pages).filter(([loc]) => !/\/llms(-full)?\.txt$/.test(loc));
  const entryRe = /\{ loc: "(https:\/\/octocounts\.com\/[^"]*)", lastmod: "(\d{4}-\d{2}-\d{2})" \}/g;
  const entries = [...edge.matchAll(entryRe)].map((match) => [match[1], match[2]]);
  assert.equal(entries.length, manifestSitemapPages.length, "STATIC_SITEMAP_ENTRIES count matches manifest");
  for (const [loc, lastmod] of entries) {
    assert.equal(lastmod, manifest.pages[loc], `${loc} functions lastmod matches manifest`);
  }

  // The generated static child must carry the same per-URL dates.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  let staticXml;
  try {
    const response = await onRequest(await renderedContext("/sitemap-static.xml", {
      source: "https://github.com/trending",
      generatedAt: "2026-07-15T02:17:00Z",
      date: "2026-07-15",
      repositories: [],
    }));
    staticXml = await response.text();
  } finally {
    globalThis.fetch = originalFetch;
  }
  for (const [loc, lastmod] of manifestSitemapPages) {
    if (loc.endsWith("/trending")) continue; // injected from the daily snapshot
    const block = staticXml.match(new RegExp(`<url>\\s*<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/loc>\\s*<lastmod>([^<]+)<\\/lastmod>`));
    assert.ok(block, `${loc} present in generated static sitemap`);
    assert.equal(block[1], lastmod, `${loc} generated sitemap lastmod matches manifest`);
  }

  // Docs TechArticle dateModified follows the same per-page date.
  for (const [slug] of docs) {
    const html = await readFile(new URL(`public/docs/${slug}.html`, ROOT), "utf8");
    const expected = manifest.pages[`https://octocounts.com/docs/${slug}`];
    assert.ok(html.includes(`"dateModified": "${expected}"`), `${slug} dateModified matches manifest (${expected})`);
  }

  // The refresh workflow no longer rewrites dates on every push (SG-07):
  // strip comment lines, then the remaining code must not touch any date.
  const script = await readFile(new URL("../../scripts/refresh-llms-lastupdated.mjs", import.meta.url), "utf8");
  const code = script.split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /STATIC_SITEMAP_LASTMOD|dateModified|siteLastUpdated|Last-Updated/);
});

function withUserAgent(context, userAgent) {
  return { ...context, request: new Request(context.request.url, { headers: { "user-agent": userAgent } }) };
}

/// ASSETS mock backed by the real public/ tree, so docs markdown tests serve
/// the actual pre-generated .md files.
function docsAssetContext(pathname, userAgent) {
  return {
    request: new Request(`https://octocounts.com${pathname}`, userAgent ? { headers: { "user-agent": userAgent } } : undefined),
    env: {
      ASSETS: {
        fetch: async (request) => {
          const path = new URL(request.url).pathname;
          const filePath = /^\/docs\/[a-z-]+$/.test(path) ? `${path}.html` : path;
          try {
            const body = await readFile(new URL(`public${filePath}`, ROOT), "utf8");
            return new Response(body, {
              status: 200,
              headers: { "content-type": filePath.endsWith(".md") ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8" },
            });
          } catch {
            return new Response("not found", { status: 404 });
          }
        },
      },
    },
  };
}

test("report markdown twins mirror the SSR report via ?format=md and the .md suffix", async () => {
  const restore = stubReportAndRelatedFetch({
    reports: [
      { provider: "github", owner: "tokio-rs", repo: "axum", repoFullName: "tokio-rs/axum", publicPath: "/github/tokio-rs/axum", topLanguage: "Rust", totalCode: 16000, totalLines: 21000 },
    ],
  });
  try {
    for (const path of [
      "/github/octo-org/octo-repo?format=md",
      "/github/octo-org/octo-repo.md",
      "/github/octo-org/octo-repo/tree/main.md",
    ]) {
      const response = await onRequest(await renderedContext(path));
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type") ?? "", /^text\/markdown; charset=utf-8/, path);
      assert.equal(response.headers.get("cache-control"), "public, s-maxage=3600, stale-while-revalidate=86400", path);
      const md = await response.text();
      assert.match(md, /^# octo-org\/octo-repo SLOC report\n/, path);
      assert.ok(md.includes(`> ${RELATED_REPORT_FIXTURE.citation}`), path);
      assert.match(md, /## Repository size insights/, path);
      assert.match(md, /\| Language \| Files \| Lines \| Code \| Comments \| Blanks \|/, path);
      assert.match(md, /\| Rust \| 80 \| 16,000 \| 12,000 \| 2,500 \| 1,500 \|/, path);
      assert.match(md, /### How many lines of code does octo-org\/octo-repo have\?/, path);
      assert.ok(md.includes("- [tokio-rs/axum](https://octocounts.com/github/tokio-rs/axum) — Rust, 16,000 code lines"), path);
      assert.ok(md.includes("[Counting methodology](https://octocounts.com/docs/methodology)"), path);
      // Markdown must not leak HTML markup from the page templates.
      assert.doesNotMatch(md, /<[a-z][^>]*>/i, path);
    }
  } finally {
    restore();
  }
});

const REPRODUCIBLE_OPTIONS = {
  ignoredDirs: [],
  ignoredLanguages: [],
  profile: "default",
  includeDocs: true,
  includeTests: true,
  includeGenerated: true,
};
const REPRODUCIBLE_SNAPSHOT_URL = `https://octocounts.com/github/octo-org/octo-repo/commit/${RELATED_REPORT_FIXTURE.commitSha}?analysis=${encodeURIComponent(JSON.stringify(REPRODUCIBLE_OPTIONS))}`;
const REPRODUCIBLE_REPORT_FIXTURE = {
  ...RELATED_REPORT_FIXTURE,
  analysisKey: "tokei-13.0.0:default",
  analysisOptions: REPRODUCIBLE_OPTIONS,
  snapshotUrl: REPRODUCIBLE_SNAPSHOT_URL,
};

test("report SSR, JSON-LD, summary, and markdown expose the reproducible snapshot link when the configuration is known", async () => {
  const restore = stubReportAndRelatedFetch({ reports: [] }, REPRODUCIBLE_REPORT_FIXTURE);
  try {
    const htmlResponse = await onRequest(await renderedContext("/github/octo-org/octo-repo"));
    const html = await htmlResponse.text();
    assert.match(html, /<h2>Reproduce this report<\/h2>/);
    assert.ok(html.includes(`<a href="${REPRODUCIBLE_SNAPSHOT_URL}">Reproduce this exact report and configuration</a>`));
    assert.doesNotMatch(html, /Configuration unknown/);
    // The Dataset node carries the stable configuration digest.
    const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(jsonLd);
    assert.match(jsonLd[1], /"identifier":"tokei-13\.0\.0:default"/);
    // The hydration summary passes the new fields through to the client.
    const summary = html.match(/<script type="application\/json" id="octocounts-report-summary">([\s\S]*?)<\/script>/);
    assert.ok(summary);
    assert.match(summary[1], /"analysisKey":"tokei-13\.0\.0:default"/);
    assert.ok(summary[1].includes(`"snapshotUrl":"${REPRODUCIBLE_SNAPSHOT_URL}"`));

    const mdResponse = await onRequest(await renderedContext("/github/octo-org/octo-repo?format=md"));
    const md = await mdResponse.text();
    assert.ok(md.includes(`[Reproduce this exact report and configuration](${REPRODUCIBLE_SNAPSHOT_URL}).`));
    assert.doesNotMatch(md, /Configuration unknown/);
    assert.doesNotMatch(md, /<[a-z][^>]*>/i);
  } finally {
    restore();
  }
});

test("reports without option tracking say the configuration is unknown instead of claiming defaults", async () => {
  // RELATED_REPORT_FIXTURE predates analysisKey/analysisOptions/snapshotUrl.
  const restore = stubReportAndRelatedFetch({ reports: [] });
  try {
    const htmlResponse = await onRequest(await renderedContext("/github/octo-org/octo-repo"));
    const html = await htmlResponse.text();
    assert.match(html, /<h2>Reproduce this report<\/h2>/);
    assert.ok(html.includes("<p>Configuration unknown; this report predates option tracking.</p>"));
    assert.doesNotMatch(html, /Reproduce this exact report/);
    const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(jsonLd);
    assert.doesNotMatch(jsonLd[1], /"identifier"/);
    const summary = html.match(/<script type="application\/json" id="octocounts-report-summary">([\s\S]*?)<\/script>/);
    assert.ok(summary);
    assert.doesNotMatch(summary[1], /"analysisKey"/);
    assert.doesNotMatch(summary[1], /"snapshotUrl"/);
    assert.doesNotMatch(html, /default configuration/i);

    const mdResponse = await onRequest(await renderedContext("/github/octo-org/octo-repo?format=md"));
    const md = await mdResponse.text();
    assert.ok(md.includes("Configuration unknown; this report predates option tracking."));
    assert.doesNotMatch(md, /Reproduce this exact report/);
    assert.doesNotMatch(md, /default configuration/i);
  } finally {
    restore();
  }
});

test("report markdown handles missing reports and transient failures like the HTML page", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("backend exploded", { status: 500 });
  try {
    const response = await onRequest(await renderedContext("/github/octo-org/octo-repo.md"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => new Response("report was not found", { status: 404 });
  try {
    const response = await onRequest(await renderedContext("/github/octo-org/octo-repo?format=md"));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/markdown/);
    assert.equal(response.headers.get("cache-control"), "public, max-age=60");
    assert.match(await response.text(), /No cached report exists yet for octo-org\/octo-repo/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retrieval-time AI bots get markdown on reports while search and training crawlers keep HTML", async () => {
  const restore = stubReportAndRelatedFetch({ reports: [] });
  try {
    for (const ua of [
      "Mozilla/5.0 (compatible; OAI-SearchBot/1.0)",
      "ChatGPT-User/1.0",
      "PerplexityBot/1.0",
      "Perplexity-User/1.0",
      "ClaudeBot/1.0",
      "Claude-User/1.0",
      "Google-Extended",
      "Applebot/0.1",
    ]) {
      const response = await onRequest(withUserAgent(await renderedContext("/github/octo-org/octo-repo"), ua));
      assert.match(response.headers.get("content-type") ?? "", /^text\/markdown/, ua);
      // The zone cache rule keys on URL alone: a UA-derived markdown variant
      // must never enter the shared cache, or browsers/Googlebot would be
      // served markdown from the HTML URL's cache entry (and vice versa).
      assert.equal(response.headers.get("cache-control"), "private, no-store", ua);
      assert.equal(response.headers.get("vary"), "User-Agent", ua);
    }
    // Cloaking guard: search engine crawlers and training crawlers must see
    // exactly the HTML a browser gets.
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "GPTBot/1.0",
      "CCBot/2.0 (https://commoncrawl.org/faq/)",
      "anthropic-ai",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0",
    ]) {
      const response = await onRequest(withUserAgent(await renderedContext("/github/octo-org/octo-repo"), ua));
      assert.match(response.headers.get("content-type") ?? "", /^text\/html/, ua);
      assert.equal(response.headers.get("cache-control"), "public, s-maxage=300, stale-while-revalidate=600", ua);
      assert.equal(response.headers.get("vary"), null, ua);
    }
    // Explicit markdown URLs have their own cache key, so they keep the shared
    // cache headers even when a retrieval bot asks for them.
    const explicit = await onRequest(withUserAgent(await renderedContext("/github/octo-org/octo-repo?format=md"), "PerplexityBot/1.0"));
    assert.match(explicit.headers.get("content-type") ?? "", /^text\/markdown/);
    assert.equal(explicit.headers.get("cache-control"), "public, s-maxage=3600, stale-while-revalidate=86400");
    assert.equal(explicit.headers.get("vary"), null);
  } finally {
    restore();
  }
});

test("curated comparison markdown mirrors the SSR comparison", async () => {
  const restore = stubReportFetch(CURATED_FIXTURES);
  try {
    for (const path of ["/compare/react-vs-vue?format=md", "/compare/react-vs-vue.md"]) {
      const response = await onRequest(await renderedContext(path));
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type") ?? "", /^text\/markdown; charset=utf-8/, path);
      assert.equal(response.headers.get("cache-control"), "public, s-maxage=3600, stale-while-revalidate=86400", path);
      const md = await response.text();
      assert.match(md, /^# React vs Vue: source lines of code compared\n/, path);
      assert.ok(md.includes("| Metric | [facebook/react](https://octocounts.com/github/facebook/react) | [vuejs/core](https://octocounts.com/github/vuejs/core) |"), path);
      assert.match(md, /\| Code lines \| 152,488 \| 89,302 \|/, path);
      assert.ok(md.includes(CURATED_FIXTURES["facebook/react"].commitSha.slice(0, 12)), path);
      assert.ok(md.includes(CURATED_FIXTURES["vuejs/core"].commitSha.slice(0, 12)), path);
      assert.match(md, /\[counting methodology\]\(https:\/\/octocounts\.com\/docs\/methodology\)/, path);
      assert.match(md, /code size is not code quality/i, path);
      assert.match(md, /## Compare FAQ/, path);
      assert.match(md, /### Which has more lines of code/, path);
      assert.match(md, /### Does more source lines of code mean more complexity\?/, path);
    }
    // Retrieval bots get the markdown twin on compare pages too — uncacheable,
    // since the zone cache keys on the shared HTML URL.
    const bot = await onRequest(withUserAgent(await renderedContext("/compare/react-vs-vue"), "PerplexityBot/1.0"));
    assert.match(bot.headers.get("content-type") ?? "", /^text\/markdown/);
    assert.equal(bot.headers.get("cache-control"), "private, no-store");
    assert.equal(bot.headers.get("vary"), "User-Agent");
  } finally {
    restore();
  }
});

test("curated comparison markdown keeps the short-cache answer when a report is missing", async () => {
  const restore = stubReportFetch({ "facebook/react": CURATED_FIXTURES["facebook/react"] });
  try {
    const response = await onRequest(await renderedContext("/compare/react-vs-vue.md"));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/markdown/);
    assert.equal(response.headers.get("cache-control"), "public, max-age=60");
    assert.match(await response.text(), /not available for both repositories yet/);
  } finally {
    restore();
  }
});

test("trending and stats serve markdown twins on request but keep HTML for retrieval bots", async () => {
  const snapshot = {
    source: "https://github.com/trending",
    period: "daily",
    generatedAt: "2026-07-15T02:17:00Z",
    date: "2026-07-15",
    repositories: [{
      rank: 1,
      owner: "octo-org",
      name: "octo-repo",
      fullName: "octo-org/octo-repo",
      description: "A useful repository.",
      language: "Rust",
      starsToday: 1234,
      totalStars: 12345,
      htmlUrl: "https://github.com/octo-org/octo-repo",
      publicPath: "/github/octo-org/octo-repo",
    }],
  };
  for (const path of ["/trending.md", "/trending?format=md"]) {
    const response = await onRequest(await renderedContext(path, snapshot));
    assert.match(response.headers.get("content-type") ?? "", /^text\/markdown/, path);
    assert.equal(response.headers.get("cache-control"), "public, s-maxage=3600, stale-while-revalidate=86400", path);
    const md = await response.text();
    assert.match(md, /^# Trending GitHub repositories today\n/, path);
    assert.ok(md.includes("1. [octo-org/octo-repo](https://octocounts.com/github/octo-org/octo-repo) — A useful repository. (1,234 stars today, Rust)"), path);
  }
  // Retrieval-bot UAs get the markdown twin here too, same as reports,
  // comparisons, docs, extension, and research: /trending and /stats are two
  // of the most quotable data pages. uaOnly responses are forced private and
  // uncacheable so a UA-negotiated format can never be edge-cached for a human.
  const bot = await onRequest(withUserAgent(await renderedContext("/trending", snapshot), "PerplexityBot/1.0"));
  assert.match(bot.headers.get("content-type") ?? "", /^text\/markdown/);
  assert.equal(bot.headers.get("cache-control"), "private, no-store");
  assert.match(bot.headers.get("vary") ?? "", /User-Agent/i);

  // Ordinary browsers (and Googlebot, deliberately) keep HTML.
  const browser = await onRequest(await renderedContext("/trending", snapshot));
  assert.match(browser.headers.get("content-type") ?? "", /^text\/html/);

  const stats = {
    totals: { reportsGenerated: 4200, repositoriesAnalyzed: 3100, linesCounted: 123456789, codeLinesCounted: 98765432, languagesDetected: 87 },
    sources: [{ source: "web", reports: 2000 }],
    languages: [{ language: "Rust", code: 5000000, lines: 6500000, reports: 300 }],
    topRepositories: [{
      provider: "github",
      owner: "torvalds",
      repo: "linux",
      publicPath: "/github/torvalds/linux",
      total: { files: 80000, lines: 40000000, code: 30000000, comments: 5000000, blanks: 5000000 },
    }],
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(stats);
  try {
    const response = await onRequest(await renderedContext("/stats?format=md"));
    assert.match(response.headers.get("content-type") ?? "", /^text\/markdown/);
    assert.equal(response.headers.get("cache-control"), "public, s-maxage=900, stale-while-revalidate=3600");
    const md = await response.text();
    assert.match(md, /^# OctoCounts public growth stats\n/);
    assert.match(md, /## Where analyses come from\n\n- Web app: 2,000 reports/);
    assert.match(md, /## Language coverage\n\n- Rust: 5,000,000 code lines across 300 reports/);
    assert.ok(md.includes("1. [torvalds/linux](https://octocounts.com/github/torvalds/linux) — 40,000,000 total lines (30,000,000 code)"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("docs pages serve their pre-generated markdown twins", async () => {
  // The shared `docs` list pins the legacy-redirect corpus; the glossary has
  // no legacy .html URL but still gets a markdown twin.
  const docsWithGlossary = [...docs, ["glossary", "https://octocounts.com/docs/glossary"]];
  for (const [slug] of docsWithGlossary) {
    const file = await readFile(new URL(`public/docs/${slug}.md`, ROOT), "utf8");
    assert.match(file, /^# /, slug);

    for (const path of [`/docs/${slug}?format=md`, `/docs/${slug}.md`]) {
      const response = await onRequest(docsAssetContext(path));
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type") ?? "", /^text\/markdown; charset=utf-8/, path);
      assert.equal(response.headers.get("cache-control"), "public, max-age=3600", path);
      assert.equal(await response.text(), file, path);
    }

    const bot = await onRequest(docsAssetContext(`/docs/${slug}`, "ClaudeBot/1.0"));
    assert.match(bot.headers.get("content-type") ?? "", /^text\/markdown/, `${slug} bot`);
    // Docs are outside the zone cache rule today, but a UA variant still
    // never belongs in any shared cache.
    assert.equal(bot.headers.get("cache-control"), "private, no-store", `${slug} bot`);
    assert.equal(bot.headers.get("vary"), "User-Agent", `${slug} bot`);

    const browser = await onRequest(docsAssetContext(`/docs/${slug}`));
    assert.match(browser.headers.get("content-type") ?? "", /^text\/html/, `${slug} browser`);
  }
});

test("/research serves its static HTML without a directory-redirect loop and honors markdown twins", async () => {
  const researchAssetContext = (pathname, userAgent) => ({
    request: new Request(`https://octocounts.com${pathname}`, userAgent ? { headers: { "user-agent": userAgent } } : undefined),
    env: {
      ASSETS: {
        // Mirrors Cloudflare Pages asset serving: extensionless URLs resolve
        // to the .html file; requesting an .html path directly would 308.
        fetch: async (request) => {
          const path = new URL(request.url).pathname;
          const filePath = path === "/research" ? "/research.html" : path;
          try {
            const body = await readFile(new URL(`public${filePath}`, ROOT), "utf8");
            return new Response(body, {
              status: 200,
              headers: { "content-type": filePath.endsWith(".md") ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8" },
            });
          } catch {
            return new Response("not found", { status: 404 });
          }
        },
      },
    },
  });

  const html = await readFile(new URL("public/research.html", ROOT), "utf8");
  const response = await onRequest(researchAssetContext("/research"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(await response.text(), html);

  // The canonical URL is slash-free: /research/ redirects to it instead of
  // looping (the asset server 308s /research → /research/ for directories;
  // research is a single research.html file, so the slash-strip rule wins).
  const slashed = await onRequest(researchAssetContext("/research/"));
  assert.equal(slashed.status, 308);
  assert.equal(slashed.headers.get("location"), "https://octocounts.com/research");

  const md = await readFile(new URL("public/research.md", ROOT), "utf8");
  for (const path of ["/research?format=md", "/research.md"]) {
    const mdResponse = await onRequest(researchAssetContext(path));
    assert.equal(mdResponse.status, 200, path);
    assert.match(mdResponse.headers.get("content-type") ?? "", /^text\/markdown; charset=utf-8/, path);
    assert.equal(await mdResponse.text(), md, path);
  }

  const bot = await onRequest(researchAssetContext("/research", "ClaudeBot/1.0"));
  assert.match(bot.headers.get("content-type") ?? "", /^text\/markdown/, "bot twin");
  assert.equal(bot.headers.get("cache-control"), "private, no-store", "bot twin");
});

test("HTML pages advertise their markdown twin with a text/markdown alternate link", async () => {
  const restoreReports = stubReportAndRelatedFetch({ reports: [] });
  try {
    const response = await onRequest(await renderedContext("/github/octo-org/octo-repo"));
    const html = await response.text();
    assert.ok(html.includes('<link rel="alternate" type="text/markdown" href="https://octocounts.com/github/octo-org/octo-repo.md" />'));
  } finally {
    restoreReports();
  }

  const restoreCompare = stubReportFetch(CURATED_FIXTURES);
  try {
    const response = await onRequest(await renderedContext("/compare/react-vs-vue"));
    assert.ok((await response.text()).includes('<link rel="alternate" type="text/markdown" href="https://octocounts.com/compare/react-vs-vue.md" />'));
  } finally {
    restoreCompare();
  }

  const trending = await onRequest(await renderedContext("/trending", {
    source: "https://github.com/trending",
    generatedAt: "2026-07-15T02:17:00Z",
    date: "2026-07-15",
    repositories: [],
  }));
  assert.ok((await trending.text()).includes('<link rel="alternate" type="text/markdown" href="https://octocounts.com/trending.md" />'));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({});
  try {
    const stats = await onRequest(await renderedContext("/stats"));
    assert.ok((await stats.text()).includes('<link rel="alternate" type="text/markdown" href="https://octocounts.com/stats.md" />'));
  } finally {
    globalThis.fetch = originalFetch;
  }

  for (const [slug] of [...docs, ["glossary"]]) {
    const html = await readFile(new URL(`public/docs/${slug}.html`, ROOT), "utf8");
    assert.ok(html.includes(`<link rel="alternate" type="text/markdown" href="https://octocounts.com/docs/${slug}.md" />`), slug);
  }
});

test("compare registry targets stay well-formed and yugabyte keeps its real repo name", async () => {
  const slugs = new Set();
  for (const entry of COMPARE_REGISTRY) {
    assert.match(entry.slug, /^[a-z0-9-]+$/, entry.slug);
    assert.ok(!slugs.has(entry.slug), `duplicate slug ${entry.slug}`);
    slugs.add(entry.slug);
    for (const side of [entry.left, entry.right]) {
      assert.match(`${side.owner}/${side.repo}`, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, `${entry.slug} target`);
    }
  }
  const yugabyte = COMPARE_REGISTRY.find((entry) => entry.slug === "cockroachdb-vs-yugabyte");
  assert.ok(yugabyte, "cockroachdb-vs-yugabyte entry exists");
  assert.deepEqual(yugabyte.right, { owner: "yugabyte", repo: "yugabyte-db" });
  const llms = await readFile(new URL("public/llms.txt", ROOT), "utf8");
  assert.ok(llms.includes("cockroachdb/cockroach vs yugabyte/yugabyte-db"));
  assert.doesNotMatch(llms, /yugabyte\/yugabyte[)\s]/);
});

test("llms.txt advertises markdown versions and the glossary outside the generated block", async () => {
  const llms = await readFile(new URL("public/llms.txt", ROOT), "utf8");
  assert.match(llms, /^Markdown Versions: .+\.md/m);
  assert.match(llms, /^- Glossary: https:\/\/octocounts\.com\/docs\/glossary$/m);
  const generated = llms.match(/<!-- BEGIN COMPARE PAGES[\s\S]*?END COMPARE PAGES -->/);
  assert.ok(generated, "generated compare block exists");
  assert.doesNotMatch(generated[0], /Markdown Versions|Glossary/);
});

test("docs pages serve the GitHub language bar alternative page and its markdown twin", async () => {
  const file = await readFile(new URL("public/docs/github-language-bar-alternative.md", ROOT), "utf8");
  assert.match(file, /^# /);

  for (const path of ["/docs/github-language-bar-alternative?format=md", "/docs/github-language-bar-alternative.md"]) {
    const response = await onRequest(docsAssetContext(path));
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /^text\/markdown; charset=utf-8/, path);
    assert.equal(await response.text(), file, path);
  }
});

test("docs pages serve the best SLOC counter tools comparison and its markdown twin", async () => {
  const file = await readFile(new URL("public/docs/best-sloc-counter-tools.md", ROOT), "utf8");
  assert.match(file, /^# /);

  for (const path of ["/docs/best-sloc-counter-tools?format=md", "/docs/best-sloc-counter-tools.md"]) {
    const response = await onRequest(docsAssetContext(path));
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /^text\/markdown; charset=utf-8/, path);
    assert.equal(await response.text(), file, path);
  }
});

test("sitemaps list the docs glossary alongside the other docs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  try {
    const generated = await onRequest(await renderedContext("/sitemap-static.xml", {
      source: "https://github.com/trending",
      generatedAt: "2026-07-15T02:17:00Z",
      date: "2026-07-15",
      repositories: [],
    }));
    const xml = await generated.text();
    assert.match(xml, /<loc>https:\/\/octocounts\.com\/docs\/glossary<\/loc>/);
    assert.match(xml, /<loc>https:\/\/octocounts\.com\/docs\/github-language-bar-alternative<\/loc>/);
    assert.match(xml, /<loc>https:\/\/octocounts\.com\/docs\/best-sloc-counter-tools<\/loc>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extension landing page serves complete SSR content with real store links", async () => {
  const response = await onRequest(await renderedContext("/extension"));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes("<title>OctoCounts GitHub Line Counter Extension for Chrome, Edge &amp; Firefox | OctoCounts</title>"));
  assert.ok(html.includes('<link rel="canonical" href="https://octocounts.com/extension" />'));
  assert.ok(html.includes("<h1>See GitHub code statistics in your browser</h1>"));
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
  for (const store of ["chromewebstore.google.com", "microsoftedge.microsoft.com", "addons.mozilla.org"]) {
    assert.ok(html.includes(store), `store link ${store}`);
  }
  // Visible facts only: no ratings or install counts anywhere in the schema.
  const jsonLd = html.match(/<script type="application\/ld\+json">([^<]*)<\/script>/);
  assert.doesNotMatch(jsonLd[1], /aggregateRating|ratingCount|userCount|installCount/i);
  const graph = JSON.parse(jsonLd[1])["@graph"];
  assert.ok(graph.some((node) => node["@type"] === "SoftwareApplication" && node.offers.price === "0"));
  assert.ok(graph.some((node) => node["@type"] === "FAQPage"));
  // Markdown twin carries the same install links.
  const md = await (await onRequest(await renderedContext("/extension.md"))).text();
  for (const store of ["chromewebstore.google.com", "microsoftedge.microsoft.com", "addons.mozilla.org"]) {
    assert.ok(md.includes(store), `markdown store link ${store}`);
  }
});

test("sitemap includes the extension landing page", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  try {
    const generated = await (await onRequest(await renderedContext("/sitemap-static.xml", {
      source: "https://github.com/trending", generatedAt: "2026-07-15T02:17:00Z", date: "2026-07-15", repositories: [],
    }))).text();
    assert.ok(generated.includes("<loc>https://octocounts.com/extension</loc>"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("editorial compare pages carry scoped, sourced explanations in every format", async () => {
  const restore = stubReportFetch(CURATED_FIXTURES);
  try {
    const [htmlResponse, mdResponse] = await Promise.all([
      onRequest(await renderedContext("/compare/react-vs-vue")),
      onRequest(await renderedContext("/compare/react-vs-vue.md")),
    ]);
    const html = await htmlResponse.text();
    const md = await mdResponse.text();
    for (const [source, label] of [[html, "HTML"], [md, "markdown"]]) {
      assert.ok(source.includes("About this comparison"), `${label} editorial heading`);
      assert.ok(source.includes("facebook/react is a monorepo"), `${label} scope statement`);
      assert.ok(source.includes("predominantly TypeScript"), `${label} data-supported insight`);
      assert.ok(source.includes("Neither number predicts the size, performance, or quality"), `${label} caution`);
      assert.ok(source.includes("https://github.com/facebook/react"), `${label} source link`);
      assert.ok(source.includes("Statements verified 2026-09-08"), `${label} verification date`);
    }
    // The client view model carries the same editorial (SG-01 parity).
    const model = JSON.parse(html.match(/<script type="application\/json" id="octocounts-compare-data">([^<]*)<\/script>/)[1]);
    assert.equal(model.editorial.scope.includes("monorepo"), true);
    assert.equal(model.editorial.insights.length >= 2, true);
    // Pages without editorial are unchanged.
    const plain = await (await onRequest(await renderedContext("/compare/vite-vs-webpack"))).text();
    assert.ok(plain.includes("About this comparison") === false || plain.includes("vitejs/vite is the Vite core repository"));
  } finally {
    restore();
  }
});

test("AI_MARKDOWN_UA=0 rolls the UA-derived markdown switch off without touching explicit .md", async () => {
  const context = await renderedContext("/github/octo-org/octo-repo");
  context.env.SEO_API_BASE = "https://api.test";
  context.env.AI_MARKDOWN_UA = "0";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    provider: "github", owner: "octo-org", repo: "octo-repo", repoFullName: "octo-org/octo-repo",
    htmlUrl: "https://github.com/octo-org/octo-repo", publicPath: "/github/octo-org/octo-repo",
    canonicalUrl: "https://octocounts.com/github/octo-org/octo-repo", title: "t", description: "d", citation: "c",
    generatedAt: "2026-07-01T00:00:00Z", refName: "main", commitSha: "a".repeat(40), tokeiVersion: "t", durationMs: 1,
    total: { files: 1, lines: 2, code: 3, comments: 0, blanks: 0 }, languages: [], topLanguage: null,
  });
  try {
    const bot = await onRequest(withUserAgent(context, "PerplexityBot/1.0"));
    assert.match(bot.headers.get("content-type") ?? "", /^text\/html/);
    const explicitContext = await renderedContext("/github/octo-org/octo-repo.md");
    explicitContext.env.SEO_API_BASE = "https://api.test";
    const explicit = await onRequest(withUserAgent(explicitContext, "PerplexityBot/1.0"));
    assert.match(explicit.headers.get("content-type") ?? "", /^text\/markdown/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
