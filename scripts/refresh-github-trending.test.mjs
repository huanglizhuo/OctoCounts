import assert from "node:assert/strict";
import test from "node:test";

import { parseTrendingHtml } from "./refresh-github-trending.mjs";

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
