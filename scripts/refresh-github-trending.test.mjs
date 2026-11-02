import assert from "node:assert/strict";
import test from "node:test";

import { enrichTrending, parseTrendingHtml } from "./refresh-github-trending.mjs";
import { trendingSloc } from "../frontend/functions/trending-sloc.js";

test("parses GitHub Trending repository metadata", () => {
  const html = `
    <article class="Box-row">
      <h2 class="h3"><a href="/octo-org/octo-repo"><span>octo-org /</span> octo-repo</a></h2>
      <p class="col-9 color-fg-muted my-1 pr-4">A fast &amp; useful counter.</p>
      <span itemprop="programmingLanguage">Rust</span>
      <a href="/octo-org/octo-repo/stargazers">12,345</a>
      <span>1,234 stars today</span>
    </article>`;

  assert.deepEqual(parseTrendingHtml(html), [{
    rank: 1,
    owner: "octo-org",
    name: "octo-repo",
    fullName: "octo-org/octo-repo",
    description: "A fast & useful counter.",
    language: "Rust",
    starsToday: 1234,
    totalStars: 12345,
    htmlUrl: "https://github.com/octo-org/octo-repo",
    publicPath: "/github/octo-org/octo-repo",
  }]);
});

test("limits results and tolerates missing optional metadata", () => {
  const article = (owner, name) => `<article class="Box-row"><h2><a href="/${owner}/${name}">${name}</a></h2></article>`;
  const parsed = parseTrendingHtml(article("a", "one") + article("b", "two"), 1);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].fullName, "a/one");
  assert.equal(parsed[0].language, null);
  assert.equal(parsed[0].starsToday, 0);
});

test("enriches cached reports without changing order, counting zero as a valid result", async () => {
  const repositories = ["one", "zero"].map((name, index) => ({ owner: "octo", name, fullName: `octo/${name}`, rank: index + 1 }));
  const enriched = await enrichTrending(repositories, async (url, options) => {
    const request = new URL(url);
    assert.equal(request.pathname, "/api/seo/report");
    assert.equal(request.searchParams.get("provider"), "github");
    assert.equal(request.searchParams.get("owner"), "octo");
    assert.ok(options.signal instanceof AbortSignal);
    const name = request.searchParams.get("repo");
    return Response.json({ provider: "github", repoFullName: `octo/${name}`, total: { code: name === "one" ? 24800 : 0 }, generatedAt: "2026-11-01T23:00:00-01:00" });
  }, "https://api.test/");
  assert.deepEqual(enriched.map((repo) => repo.fullName), ["octo/one", "octo/zero"]);
  assert.deepEqual(enriched.map((repo) => repo.sloc), [24800, 0].map((code) => ({ code, generatedAt: "2026-11-02T00:00:00.000Z" })));
  assert.ok(repositories.every((repo) => !("sloc" in repo)));
});

test("missing, failed, mismatched and malformed reports do not block the remaining snapshot", async () => {
  const outcomes = [
    () => new Response(null, { status: 404 }),
    () => new Response(null, { status: 503 }),
    () => { throw new DOMException("Timed out", "TimeoutError"); },
    () => new Response("not json"),
    () => Response.json({ provider: "github", repoFullName: "wrong/repo", total: { code: 10 }, generatedAt: "2026-11-01" }),
    () => Response.json({ provider: "github", repoFullName: "octo/5", total: { code: -1 }, generatedAt: "2026-11-01" }),
    () => Response.json({ provider: "github", repoFullName: "octo/6", total: { code: 10 }, generatedAt: "2026-11-01" }),
  ];
  const repos = outcomes.map((_, index) => ({ owner: "octo", name: String(index), fullName: `octo/${index}` }));
  const result = await enrichTrending(repos, async (url) => outcomes[Number(new URL(url).searchParams.get("repo"))]());
  assert.deepEqual(result.slice(0, 6).map((repo) => repo.sloc), Array(6).fill(null));
  assert.equal(result[6].sloc.code, 10);
});

test("SLOC validation handles old snapshots and rejects invalid counts or dates", () => {
  for (const value of [undefined, null, {}, { code: "0", generatedAt: "2026-11-01" },
    { code: 1.5, generatedAt: "2026-11-01" }, { code: -1, generatedAt: "2026-11-01" },
    { code: Number.MAX_SAFE_INTEGER + 1, generatedAt: "2026-11-01" },
    { code: 1, generatedAt: "bad-date" }, { code: 1, generatedAt: null }]) {
    assert.equal(trendingSloc(value), null);
  }
});
