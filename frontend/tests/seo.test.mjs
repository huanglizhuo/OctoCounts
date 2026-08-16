import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

import { onRequest } from "../functions/[[path]].js";
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

test("performance assets avoid blocked inline fonts and oversized previews", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");
  const styles = await readFile(new URL("src/styles.css", ROOT), "utf8");
  const extensionSection = await readFile(new URL("src/BrowserExtensionSection.tsx", ROOT), "utf8");
  const main = await readFile(new URL("src/main.tsx", ROOT), "utf8");
  const topbar = await readFile(new URL("src/Topbar.tsx", ROOT), "utf8");

  assert.match(html, /preconnect" href="https:\/\/api\.octocounts\.com"/);
  assert.match(html, /preload" as="font" href="\/fonts\/jetbrains-mono-800-latin\.woff2"/);
  assert.match(html, /<script>document\.documentElement\.dataset\.scheme=/);
  assert.doesNotMatch(html, /\/boot\.js/);
  assert.doesNotMatch(html, /octocounts-(?:light|dark)-card\.webp" as="image"/);
  assert.doesNotMatch(styles, /data:font/);
  assert.doesNotMatch(styles, /@keyframes pipe-packet\s*{[\s\S]*?\bleft:/);
  assert.match(styles, /@keyframes pipe-packet\s*{[\s\S]*?transform:/);
  assert.match(extensionSection, /card-768\.webp 768w/);
  assert.match(extensionSection, /loading="lazy" width="1280" height="800"/);
  assert.match(topbar, /octocounts-logo-96\.webp/);
  assert.match(main, /width="180" height="20"/);
  assert.match(main, /path\.startsWith\("\/github\/"\) \|\| path\.startsWith\("\/gitlab\/"\)/);
  assert.match(main, /if \(!isPublicReportPath\) \{[\s\S]*?applyPageMetadata\(\{[\s\S]*?return;/);
  assert.match(main, /minHeight=\{820\} rootMargin="100px"><Charts/);
  assert.match(main, /Suspense fallback=\{null\}><CompareRepos/);
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

test("matrix language colors meet the non-text contrast threshold", async () => {
  const source = await readFile(new URL("src/colorContrast.ts", ROOT), "utf8");
  const compiled = await transform(source, { loader: "ts", format: "esm", target: "es2020" });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`;
  const { contrastRatio, MIN_GRAPHIC_CONTRAST, parseHexColor, visibleLanguageColor } = await import(moduleUrl);
  const matrixSurface = [20, 27, 23];

  for (const color of ["#000080", "#292929", "#083FA1"]) {
    const adjusted = visibleLanguageColor(color, "matrix");
    assert.ok(contrastRatio(parseHexColor(adjusted), matrixSurface) >= MIN_GRAPHIC_CONTRAST);
    assert.equal(visibleLanguageColor(color, "paper"), color);
  }
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
    "Strict-Transport-Security: max-age=63072000; includeSubDomains",
    "Cross-Origin-Opener-Policy: same-origin",
  ]) assert.ok(headers.includes(value));
  assert.equal(response.headers.get("strict-transport-security"), "max-age=63072000; includeSubDomains");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  const csp = response.headers.get("content-security-policy");
  assert.match(csp, /'sha256-WRZoCRpV9YaIG5sPOijC2jelInnwDvYw9BYBSfp3VQY='/);
  assert.match(csp, /'nonce-[a-f0-9]{32}'/);
  assert.match(csp, /cloud\.umami\.is/);
  assert.match(csp, /gateway\.umami\.is/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(response.headers.get("cache-control"), /no-transform/);
});

test("Pages static HTML uses a nonce CSP without disabling compression transforms", async () => {
  const response = await onRequest({
    request: new Request("https://octocounts.com/"),
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
  assert.match(response.headers.get("content-security-policy"), /'nonce-[a-f0-9]{32}'/);
  assert.doesNotMatch(response.headers.get("content-security-policy"), /script-src[^;]*'unsafe-inline'/);
});

test("homepage and launch kit link to the released Edge add-on", async () => {
  const homepage = await readFile(new URL("index.html", ROOT), "utf8");
  const launchKit = await readFile(new URL("public/launch-kit.html", ROOT), "utf8");
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
  const staticSitemap = await readFile(new URL("public/sitemap.xml", ROOT), "utf8");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  let generatedXml;
  try {
    const generatedSitemap = await onRequest(requestContext("/sitemap.xml"));
    generatedXml = await generatedSitemap.text();
  } finally {
    globalThis.fetch = originalFetch;
  }

  for (const [slug, canonical] of docs) {
    assert.match(staticSitemap, new RegExp(`<loc>${canonical}</loc>`));
    assert.match(generatedXml, new RegExp(`<loc>${canonical}</loc>`));
    assert.doesNotMatch(staticSitemap, new RegExp(`/docs/${slug}\\.html`));
    assert.doesNotMatch(generatedXml, new RegExp(`/docs/${slug}\\.html`));
  }
  assert.doesNotMatch(staticSitemap, /<changefreq>|<priority>/);
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
    assert.equal((html.match(/<noscript>/g) ?? []).length, 1);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
    assert.equal((html.match(/type="application\/ld\+json"/g) ?? []).length, 1);
    assert.match(html, /Repository size insights/);
    assert.match(html, /"@type":"Dataset"/);
    assert.match(html, /"@type":"BreadcrumbList"/);
    assert.match(html, /"@type":"FAQPage"/);
    assert.match(html, /"name":"How many lines of code does octo-org\/octo-repo have\?"/);
    assert.doesNotMatch(html, /"@type":"WebApplication"/);
    assert.doesNotMatch(html, /OctoCounts – GitHub SLOC Counter<\/h1>/);
    assert.match(html, /\/compare\/rust-vs-go/);
    assert.equal(response.headers.get("cache-control"), "public, s-maxage=86400, stale-while-revalidate=604800");
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
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
  assert.equal(response.headers.get("cache-control"), "public, s-maxage=3600, stale-while-revalidate=86400");
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
    const response = await onRequest(await renderedContext("/sitemap.xml", snapshot));
    const xml = await response.text();
    assert.match(xml, /<loc>https:\/\/octocounts.com\/trending<\/loc>\s*<lastmod>2026-07-15<\/lastmod>/);
    assert.match(xml, /<loc>https:\/\/octocounts.com\/github\/octo\/repo<\/loc>\s*<lastmod>2026-07-14<\/lastmod>/);
    assert.doesNotMatch(xml, /<changefreq>|<priority>/);
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
    assert.equal((html.match(/<noscript>/g) ?? []).length, 1);
  }
});

test("static sitemap entries carry a lastmod date in both sitemap copies", async () => {
  const staticSitemap = await readFile(new URL("public/sitemap.xml", ROOT), "utf8");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  let generatedXml;
  try {
    const generatedSitemap = await onRequest(await renderedContext("/sitemap.xml", {
      source: "https://github.com/trending",
      generatedAt: "2026-07-15T02:17:00Z",
      date: "2026-07-15",
      repositories: [],
    }));
    generatedXml = await generatedSitemap.text();
  } finally {
    globalThis.fetch = originalFetch;
  }

  for (const xml of [staticSitemap, generatedXml]) {
    const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
    assert.ok(blocks.length > 0);
    for (const block of blocks) {
      assert.match(block, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/, block);
    }
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
    assert.equal(response.headers.get("cache-control"), "public, s-maxage=3600, stale-while-revalidate=86400", slug);
    assert.ok(html.includes(`<title>${name}: source lines of code compared | OctoCounts</title>`), `${slug} title`);
    assert.ok(html.includes(`<link rel="canonical" href="https://octocounts.com/compare/${slug}" />`), `${slug} canonical`);
    assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1" \/>/);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${slug} single h1`);
    assert.equal((html.match(/<noscript>/g) ?? []).length, 1, `${slug} single noscript`);
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

    // JSON-LD parses and stays consistent with the page facts.
    const jsonLd = html.match(/<script type="application\/ld\+json">([^<]*)<\/script>/);
    assert.ok(jsonLd, `${slug} JSON-LD script`);
    const graph = JSON.parse(jsonLd[1])["@graph"];
    const dataset = graph.find((node) => node["@type"] === "Dataset");
    assert.ok(dataset, `${slug} Dataset node`);
    assert.deepEqual(dataset.isBasedOn, [left.canonicalUrl, right.canonicalUrl]);
    assert.equal(dataset.url, `https://octocounts.com/compare/${slug}`);
    assert.equal(dataset.dateModified, right.generatedAt > left.generatedAt ? right.generatedAt : left.generatedAt);
    assert.ok(graph.some((node) => node["@type"] === "BreadcrumbList"), `${slug} breadcrumbs`);
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
});

test("bare /compare noscript links every curated comparison", async () => {
  const response = await onRequest(await renderedContext("/compare"));
  const html = await response.text();
  assert.match(html, /Curated comparisons/);
  for (const entry of COMPARE_REGISTRY) {
    assert.ok(html.includes(`href="/compare/${entry.slug}"`), entry.slug);
  }
});

test("generated and static sitemaps include every curated comparison", async () => {
  const staticSitemap = await readFile(new URL("public/sitemap.xml", ROOT), "utf8");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  let generatedXml;
  try {
    const generatedSitemap = await onRequest(await renderedContext("/sitemap.xml", {
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
    assert.ok(staticSitemap.includes(loc), `static ${entry.slug}`);
    assert.ok(generatedXml.includes(loc), `generated ${entry.slug}`);
  }
  for (const xml of [staticSitemap, generatedXml]) {
    const curatedCount = (xml.match(/<loc>https:\/\/octocounts\.com\/compare\//g) ?? []).length;
    assert.equal(curatedCount, COMPARE_REGISTRY.length);
  }
});
