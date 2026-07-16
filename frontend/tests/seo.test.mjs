import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { onRequest } from "../functions/[[path]].js";

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
  assert.match(main, /octocounts-logo-96\.webp/);
  assert.match(main, /width="180" height="20"/);
  assert.match(main, /path\.startsWith\("\/github\/"\) \|\| path\.startsWith\("\/gitlab\/"\)/);
  assert.match(main, /if \(!isPublicReportPath\) \{[\s\S]*?setCanonical\(canonical\);[\s\S]*?return;/);
  assert.match(main, /DeferredContent minHeight=\{820\} rootMargin="100px"><Charts/);
  assert.match(main, /DeferredContent minHeight=\{420\}><CompareRepos/);
});

test("paper panels stay flat and advanced option checkboxes use the theme UI", async () => {
  const styles = await readFile(new URL("src/styles.css", ROOT), "utf8");

  assert.match(styles, /html\[data-scheme="paper"\]\s*\{[\s\S]*?--terminal-shadow:\s*0 0 0 1px[\s\S]*?inset;/);
  assert.match(styles, /\.analysis-options-grid input:not\(\[type="checkbox"\]\)/);
  assert.match(styles, /\.analysis-toggles input\[type="checkbox"\]\s*\{[\s\S]*?appearance:\s*none;/);
  assert.match(styles, /\.analysis-toggles input\[type="checkbox"\]:checked\s*\{[\s\S]*?background:\s*var\(--accent\);/);
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
    assert.doesNotMatch(html, /"@type":"FAQPage"|"@type":"WebApplication"/);
    assert.doesNotMatch(html, /OctoCounts – GitHub SLOC Counter<\/h1>/);
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
