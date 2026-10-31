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
});
