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

test("performance assets avoid blocked inline fonts and oversized previews", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");
  const styles = await readFile(new URL("src/styles.css", ROOT), "utf8");
  const extensionSection = await readFile(new URL("src/BrowserExtensionSection.tsx", ROOT), "utf8");
  const main = await readFile(new URL("src/main.tsx", ROOT), "utf8");
  const badges = await readFile(new URL("src/badges.tsx", ROOT), "utf8");
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
  assert.match(badges, /width="180" height="20"/);
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
    "Strict-Transport-Security: max-age=63072000; includeSubDomains; preload",
    "Cross-Origin-Opener-Policy: same-origin",
  ]) assert.ok(headers.includes(value));
  assert.equal(response.headers.get("strict-transport-security"), "max-age=63072000; includeSubDomains; preload");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  const csp = response.headers.get("content-security-policy");
  assert.match(csp, /'sha256-WRZoCRpV9YaIG5sPOijC2jelInnwDvYw9BYBSfp3VQY='/);
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
    assert.equal(response.headers.get("cache-control"), "public, s-maxage=3600, stale-while-revalidate=86400");
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
  try {
    response = await onRequest(await renderedContext("/github/octo-org/octo-repo"));
    html = await response.text();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(html, /noindex/);
  assert.doesNotMatch(html, /No cached report exists yet/);
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

test("sitemap drops curated comparisons whose reports are missing but keeps them on transient failure", async () => {
  const originalFetch = globalThis.fetch;
  __resetCompareExistenceCacheForTests();
  globalThis.fetch = async (url) => {
    const request = new URL(url);
    if (request.pathname === "/api/seo/sitemap") return Response.json([]);
    const key = `${request.searchParams.get("owner")}/${request.searchParams.get("repo")}`;
    if (key === "vuejs/core") return new Response("not found", { status: 404 });
    if (key === "webpack/webpack") return new Response("backend exploded", { status: 500 });
    return Response.json(CURATED_FIXTURES["facebook/react"]);
  };
  let xml;
  try {
    const response = await onRequest(await renderedContext("/sitemap.xml", {
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
  // vite-vs-webpack: right side (webpack/webpack) failed transiently -> kept.
  assert.match(xml, /<loc>https:\/\/octocounts\.com\/compare\/vite-vs-webpack<\/loc>/);
  // The rest of the sitemap is untouched.
  assert.match(xml, /<loc>https:\/\/octocounts\.com\/trending<\/loc>/);
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
  // Every report exists, so no curated entry is filtered out.
  __resetCompareExistenceCacheForTests();
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

function stubReportAndRelatedFetch(relatedPayload) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const request = new URL(url);
    if (request.pathname === "/api/seo/related") {
      if (relatedPayload instanceof Response) return relatedPayload;
      return Response.json(relatedPayload);
    }
    return Response.json(RELATED_REPORT_FIXTURE);
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
  for (const path of ["/embed/github/octo-org/octo-repo", "/embed/gitlab/octo-group/sub/octo-repo"]) {
    const response = await onRequest(await renderedContext(path));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-frame-options"), null);
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors \*/);
    const html = await response.text();
    assert.match(html, /<meta name="robots" content="noindex,nofollow" \/>/);
    const reportPath = path.replace(/^\/embed\//, "/");
    assert.ok(html.includes(`<link rel="canonical" href="https://octocounts.com${reportPath}" />`));
  }
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

test("docs TechArticle dateModified stays in sync with the sitemap lastmod source", async () => {
  const edge = await readFile(new URL("functions/[[path]].js", ROOT), "utf8");
  const lastmod = edge.match(/const STATIC_SITEMAP_LASTMOD = "(\d{4}-\d{2}-\d{2})";/)?.[1];
  assert.ok(lastmod, "STATIC_SITEMAP_LASTMOD exists");
  const script = await readFile(new URL("../../scripts/refresh-llms-lastupdated.mjs", import.meta.url), "utf8");
  // The refresh script rewrites each docs page's TechArticle dateModified from
  // the same `today` it writes into STATIC_SITEMAP_LASTMOD.
  assert.match(script, /public\/docs\/\$\{slug\}\.html/);
  assert.match(script, /"dateModified": "\\d\{4\}/);
  for (const [slug] of docs) {
    const html = await readFile(new URL(`public/docs/${slug}.html`, ROOT), "utf8");
    assert.ok(html.includes(`"dateModified": "${lastmod}"`), `${slug} dateModified != STATIC_SITEMAP_LASTMOD`);
  }
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
      assert.equal(response.headers.get("cache-control"), "public, s-maxage=3600, stale-while-revalidate=86400", ua);
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
  // UA-based markdown is scoped to reports, comparisons, and docs; /trending
  // and /stats stay HTML for bots unless they explicitly ask for markdown.
  const bot = await onRequest(withUserAgent(await renderedContext("/trending", snapshot), "PerplexityBot/1.0"));
  assert.match(bot.headers.get("content-type") ?? "", /^text\/html/);

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

test("sitemaps list the docs glossary alongside the other docs", async () => {
  const staticSitemap = await readFile(new URL("public/sitemap.xml", ROOT), "utf8");
  assert.match(staticSitemap, /<loc>https:\/\/octocounts\.com\/docs\/glossary<\/loc>/);
  assert.match(staticSitemap, /<loc>https:\/\/octocounts\.com\/docs\/github-language-bar-alternative<\/loc>/);

  const originalFetch = globalThis.fetch;
  __resetCompareExistenceCacheForTests();
  globalThis.fetch = async () => Response.json([]);
  try {
    const generated = await onRequest(await renderedContext("/sitemap.xml", {
      source: "https://github.com/trending",
      generatedAt: "2026-07-15T02:17:00Z",
      date: "2026-07-15",
      repositories: [],
    }));
    assert.match(await generated.text(), /<loc>https:\/\/octocounts\.com\/docs\/glossary<\/loc>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
