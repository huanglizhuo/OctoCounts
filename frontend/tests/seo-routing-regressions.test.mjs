import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest } from "../functions/[[path]].js";

const shell = await readFile(new URL("../index.html", import.meta.url), "utf8");

function context(path) {
  return {
    request: new Request(`https://octocounts.com${path}`),
    env: {
      SEO_API_BASE: "https://api.test",
      ASSETS: { fetch: async () => new Response(shell, { headers: { "content-type": "text/html" } }) },
    },
  };
}

test("report and comparison outages preserve the requested Markdown representation", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  for (const path of [
    "/github/octo-org/octo-repo.md",
    "/github/octo-org/octo-repo?format=md",
    "/compare/react-vs-vue.md",
    "/compare/react-vs-vue?format=md",
  ]) {
    const response = await onRequest(context(path));
    assert.equal(response.status, 503, path);
    assert.match(response.headers.get("content-type"), /^text\/markdown/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("x-robots-tag"), "noindex, follow");
    const body = await response.text();
    assert.match(body, /temporarily unavailable/);
    assert.doesNotMatch(body, /<!doctype|<script|<html/i);
  }
  const html = await onRequest(context("/github/octo-org/octo-repo"));
  assert.equal(html.status, 503);
  assert.match(html.headers.get("content-type"), /^text\/html/);
});

test("historical live shares strip only their explicit public defaults", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
  const path = "/github/example/repository/tree/release/v1";
  const options = { ignoredDirs: [], ignoredLanguages: [], profile: "default", includeDocs: false, includeTests: false, includeGenerated: false };
  const params = new URLSearchParams({ analysis: JSON.stringify(options), format: "md" });
  const response = await onRequest(context(`${path}?${params}`));
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), `https://octocounts.com${path}?format=md`);
  params.set("reportId", "saved");
  assert.equal((await onRequest(context(`${path}?${params}`))).status, 404);
  params.delete("reportId");
  params.delete("format");
  params.set("analysis", JSON.stringify({ ...options, includeTests: true }));
  const custom = await onRequest(context(`${path}?${params}`));
  assert.equal(custom.status, 200);
  assert.match(await custom.text(), /content="noindex,follow"/);
});

test("empty collection pages past page one are hard 404s with a useful return link", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ reports: [] }));
  for (const collection of ["recent", "popular", "hall-of-monoliths"]) {
    const response = await onRequest(context(`/${collection}?page=999`));
    assert.equal(response.status, 404);
    const html = await response.text();
    assert.match(html, /<meta name="robots" content="noindex,follow"/);
    assert.ok(html.includes(`rel="canonical" href="https://octocounts.com/${collection}?page=999"`));
    assert.ok(html.includes(`href="https://octocounts.com/${collection}">Browse the first page</a>`));
    assert.equal((await onRequest(context(`/${collection}`))).status, 200);
  }
});

test("a temporary collection failure stays retryable rather than becoming a missing page", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  const response = await onRequest(context("/recent?page=999"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "60");
  // The outage page is a complete page, not a template with holes.
  const html = await response.text();
  assert.doesNotMatch(html, /undefined/);
  assert.match(html, /<h1>Recently analyzed repositories<\/h1>/);
});

test("the sitemap index and second shard request bounded API views", async (t) => {
  const entry = { loc: "https://octocounts.com/github/octo/last", lastmod: "2026-11-17", total: { files: 8 } };
  const calls = [];
  t.mock.method(globalThis, "fetch", async raw => {
    const url = new URL(raw);
    // A backend that predates the language leaderboards: no language child.
    if (url.pathname === "/api/seo/languages") return new Response(null, { status: 404 });
    const query = url.searchParams;
    calls.push(query.get("view"));
    // The pre-tier index shape: bare dates, one file per 10,000 reports.
    if (query.get("view") === "index") return Response.json({ shards: ["2026-11-13", "2026-11-17"], entries: [] });
    assert.equal(query.get("page"), "2");
    assert.equal(query.get("tier"), null, "legacy files are asked for without a tier");
    return Response.json({ entries: [entry] });
  });
  const index = await onRequest(context("/sitemap.xml"));
  const indexXml = await index.text();
  // A shard never reports a date older than the report template's own.
  assert.match(indexXml, /sitemap-reports-2\.xml<\/loc>\s*<lastmod>2026-11-24/);
  assert.match(indexXml, /sitemap-reports-1\.xml<\/loc>\s*<lastmod>2026-11-24/);
  assert.doesNotMatch(indexXml, /sitemap-languages|sitemap-reports-core|sitemap-reports-tail/);
  const shard = await onRequest(context("/sitemap-reports-2.xml"));
  assert.ok((await shard.text()).includes(entry.loc));
  assert.deepEqual(calls, ["index", "page"]);
});
