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

test("legacy documentation .html URLs permanently redirect to extensionless canonicals", async () => {
  for (const [slug, canonical] of docs) {
    const response = await onRequest(requestContext(`/docs/${slug}.html`));
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), canonical);
  }
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
});
