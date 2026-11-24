// Language leaderboards (/languages, /languages/:slug) and the tiered report
// sitemaps: what a crawler, a Markdown reader and the client page receive
// must be one model, and every failure must keep its true status.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest } from "../functions/[[path]].js";
import { languageHubModel, languageLeaderboardModel } from "../functions/language-pages.js";

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

const index = {
  minRepositories: 10,
  leaderboardSize: 50,
  languages: [
    { language: "TypeScript", slug: "typescript", repositories: 214, code: 31_000_000, lines: 41_000_000 },
    { language: "Rust", slug: "rust", repositories: 187, code: 28_456_789, lines: 35_000_000 },
    { language: "C++", slug: "cpp", repositories: 150, code: 9_000_000, lines: 12_000_000 },
  ],
};

const report = (owner, repo, code, languageCode, extra = {}) => ({
  repoFullName: `${owner}/${repo}`,
  publicPath: `/github/${owner}/${repo}`,
  canonicalUrl: `https://octocounts.com/github/${owner}/${repo}`,
  total: { files: 2_114, lines: 460_739, code },
  languageCode,
  languageShare: (languageCode / code) * 100,
  stars: 252_902,
  topLanguage: "JavaScript",
  generatedAt: "2026-11-21T23:17:26.849+00:00",
  ...extra,
});

const rustPage = {
  language: "Rust",
  slug: "rust",
  repositories: 187,
  code: 28_456_789,
  reports: [
    report("rust-lang", "rust", 2_306_821, 2_200_000),
    report("tokio-rs", "tokio", 180_026, 175_000),
  ],
};

/// Mocks the three API routes the pages and sitemaps read. `overrides`
/// replaces a response: a function, a Response, or null for a 404.
function mockApi(t, overrides = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async raw => {
    const url = new URL(raw);
    calls.push(url.pathname + url.search);
    const key = url.pathname === "/api/seo/languages" ? "languages" : url.pathname.startsWith("/api/seo/language/") ? "language" : url.pathname.slice(1);
    const override = overrides[key];
    if (typeof override === "function") return override(url);
    if (override instanceof Response) return override;
    if (override === null) return new Response(null, { status: 404 });
    if (url.pathname === "/api/seo/languages") return Response.json(index);
    if (key === "language") {
      const slug = url.pathname.split("/").at(-1);
      return slug === "rust" ? Response.json(rustPage) : new Response(null, { status: 404 });
    }
    if (url.pathname === "/api/seo/sitemap") {
      const query = url.searchParams;
      if (query.get("view") === "index") {
        return Response.json({
          entries: [],
          shards: [
            { tier: "core", page: 1, lastmod: "2026-11-20", urls: 2 },
            { tier: "core", page: 2, lastmod: "2026-10-02", urls: 1 },
            { tier: "tail", page: 1, lastmod: "2026-11-23", urls: 1 },
          ],
        });
      }
      const tier = query.get("tier");
      const entries = {
        "core:1": [{ loc: "https://octocounts.com/github/octo/star-a", lastmod: "2026-11-20", total: { files: 8 }, stars: 5000 }, { loc: "https://octocounts.com/github/octo/star-b", lastmod: "2026-11-19", total: { files: 8 }, stars: 1200 }],
        "core:2": [{ loc: "https://octocounts.com/github/octo/star-c", lastmod: "2026-10-02", total: { files: 8 }, stars: 1000 }],
        "tail:1": [{ loc: "https://octocounts.com/github/octo/long-tail", lastmod: "2026-11-23", total: { files: 8 }, stars: 12 }],
      }[`${tier}:${query.get("page")}`];
      // The legacy flat list carries every tier, in one sequence.
      if (!tier) return Response.json({ entries: tier === null && query.get("page") === "1" ? [
        { loc: "https://octocounts.com/github/octo/star-a", lastmod: "2026-11-20", total: { files: 8 }, stars: 5000 },
        { loc: "https://octocounts.com/github/octo/star-b", lastmod: "2026-11-19", total: { files: 8 }, stars: 1200 },
        { loc: "https://octocounts.com/github/octo/star-c", lastmod: "2026-10-02", total: { files: 8 }, stars: 1000 },
        { loc: "https://octocounts.com/github/octo/long-tail", lastmod: "2026-11-23", total: { files: 8 }, stars: 12 },
      ] : [] });
      return Response.json({ entries: entries ?? [] });
    }
    throw new Error(`unexpected request ${url}`);
  });
  return calls;
}

const jsonLd = html => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

test("report sitemaps split by tier and the language sitemap lists every leaderboard", async (t) => {
  mockApi(t);
  const indexXml = await (await onRequest(context("/sitemap.xml"))).text();
  const children = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)].map(match => [match[1].replace("https://octocounts.com/", ""), match[2] ?? null]);
  assert.deepEqual(children, [
    // No Trending snapshot and no compare dates in this fixture, so those
    // children carry no lastmod rather than an invented one.
    ["sitemap-static.xml", null],
    ["sitemap-compare.xml", null],
    // A live collection carries no lastmod it cannot justify.
    ["sitemap-languages.xml", null],
    // No shard is older than the report template, whatever its newest report.
    ["sitemap-reports-core-1.xml", "2026-11-24"],
    ["sitemap-reports-core-2.xml", "2026-11-24"],
    ["sitemap-reports-tail-1.xml", "2026-11-24"],
  ]);

  const core = await (await onRequest(context("/sitemap-reports-core-1.xml"))).text();
  assert.match(core, /octo\/star-a/);
  assert.match(core, /octo\/star-b/);
  assert.doesNotMatch(core, /star-c|long-tail/);
  const secondCore = await (await onRequest(context("/sitemap-reports-core-2.xml"))).text();
  assert.match(secondCore, /octo\/star-c/);
  const tail = await (await onRequest(context("/sitemap-reports-tail-1.xml"))).text();
  assert.match(tail, /octo\/long-tail/);
  assert.doesNotMatch(tail, /star-/);
  // The pre-tier file names still answer, from the whole list.
  const legacy = await (await onRequest(context("/sitemap-reports-1.xml"))).text();
  for (const name of ["star-a", "star-b", "star-c", "long-tail"]) assert.match(legacy, new RegExp(`octo/${name}`));
  assert.equal((await onRequest(context("/sitemap-reports-tail-2.xml"))).status, 404);
  assert.equal((await onRequest(context("/sitemap-reports-side-1.xml"))).status, 404);
  // A sitemap-looking URL the site does not publish is a 404, never the
  // SPA shell under an .xml address.
  const unknown = await onRequest(context("/sitemap-other.xml"));
  assert.equal(unknown.status, 404);
  assert.doesNotMatch(await unknown.text(), /<!doctype/i);

  const languages = await (await onRequest(context("/sitemap-languages.xml"))).text();
  const locs = [...languages.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual(locs, [
    "https://octocounts.com/languages",
    "https://octocounts.com/languages/typescript",
    "https://octocounts.com/languages/rust",
    "https://octocounts.com/languages/cpp",
  ]);
  assert.doesNotMatch(languages, /<lastmod>/);
});

test("the sitemap index and language sitemap stay retryable while the API is down", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  for (const path of ["/sitemap.xml", "/sitemap-languages.xml", "/sitemap-reports-core-1.xml"]) {
    const response = await onRequest(context(path));
    assert.equal(response.status, 503, path);
    assert.equal(response.headers.get("cache-control"), "no-store", path);
    assert.equal(response.headers.get("retry-after"), "60", path);
  }
});

test("the language hub renders one model for crawlers, Markdown readers and the client page", async (t) => {
  mockApi(t);
  const response = await onRequest(context("/languages"));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Largest codebases by programming language \| OctoCounts<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/octocounts\.com\/languages" \/>/);
  assert.match(html, /<link rel="alternate" type="text\/markdown" href="https:\/\/octocounts\.com\/languages\.md" \/>/);
  assert.match(html, /content="index,follow,max-image-preview:large,max-snippet:-1"/);
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(html, /<h1>The largest codebases by programming language<\/h1>/);
  assert.match(html, /<main id="main" class="oc-ssr"><section>/);
  // Every language row links to its leaderboard, inside the server HTML.
  for (const entry of index.languages) {
    assert.ok(html.includes(`<a href="/languages/${entry.slug}">${entry.language}</a></td><td>${entry.repositories.toLocaleString("en-US")}</td><td>${entry.code.toLocaleString("en-US")}</td>`), entry.language);
  }
  // The model the client page re-renders is the one the body was built from.
  const model = JSON.parse(html.match(/<script type="application\/json" id="octocounts-language-data">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(model, languageHubModel(index));
  assert.equal(model.rows.length, 3);
  assert.ok(model.intro.includes("3 languages have at least 10 measured repositories, 551 repositories in all"));

  const graph = jsonLd(html)["@graph"];
  const page = graph.find(node => node["@type"] === "CollectionPage");
  assert.equal(page.url, "https://octocounts.com/languages");
  assert.deepEqual(page.mainEntity.itemListElement.map(item => [item.position, item.name, item.url]), [
    [1, "TypeScript", "https://octocounts.com/languages/typescript"],
    [2, "Rust", "https://octocounts.com/languages/rust"],
    [3, "C++", "https://octocounts.com/languages/cpp"],
  ]);
  const faq = graph.find(node => node["@type"] === "FAQPage");
  assert.ok(faq.mainEntity.length >= 3);
  // FAQ schema describes questions a reader can see.
  for (const item of faq.mainEntity) assert.ok(html.includes(item.name), item.name);
  assert.deepEqual(page.breadcrumb.itemListElement.map(item => item.name), ["OctoCounts", "Languages"]);
  // The hub links onward into the corpus.
  assert.match(html, /href="\/hall-of-monoliths"/);
  assert.match(html, /href="\/docs\/methodology"/);

  const markdown = await onRequest(context("/languages.md"));
  assert.equal(markdown.status, 200);
  assert.match(markdown.headers.get("content-type"), /^text\/markdown/);
  assert.equal(markdown.headers.get("x-robots-tag"), "noindex, follow");
  const text = await markdown.text();
  assert.match(text, /^# The largest codebases by programming language\n/);
  assert.match(text, /\[Rust\]\(https:\/\/octocounts\.com\/languages\/rust\)/);
  assert.match(text, /\| Language \| Repositories \| Code lines counted \|/);
  for (const item of faq.mainEntity) assert.ok(text.includes(item.acceptedAnswer.text), item.name);
});

test("a language leaderboard names its repositories, its rule and its largest member", async (t) => {
  mockApi(t);
  const response = await onRequest(context("/languages/rust"));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Rust repositories by lines of code \| OctoCounts<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/octocounts\.com\/languages\/rust" \/>/);
  assert.match(html, /<h1>The largest Rust repositories by lines of code<\/h1>/);
  // The answer comes first: the count of repositories and the leader.
  const body = html.split('<main id="main" class="oc-ssr">')[1];
  const lead = body.slice(0, body.indexOf("</p>"));
  assert.match(lead, /OctoCounts has measured 187 public GitHub repositories whose primary programming language is Rust\. rust-lang\/rust is the largest, with 2,306,821 code lines across 2,114 files, counted with tokei on November 21, 2026/);
  // Rows link the report pages this site actually serves.
  assert.match(html, /<a href="https:\/\/octocounts\.com\/github\/rust-lang\/rust">rust-lang\/rust<\/a><\/td><td>2,306,821<\/td><td>460,739<\/td><td>2,114<\/td><td>95\.4%<\/td>/);
  assert.match(html, /<td>2<\/td><td><a href="https:\/\/octocounts\.com\/github\/tokio-rs\/tokio">tokio-rs\/tokio<\/a>/);
  assert.match(html, /Rust share/);
  assert.match(html, /a repository belongs to Rust when Rust is its largest programming language by code lines/i);
  const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.ok(description.length <= 160, description);
  assert.match(description, /rust-lang\/rust leads with 2,306,821 code lines/);

  const graph = jsonLd(html)["@graph"];
  const page = graph.find(node => node["@type"] === "CollectionPage");
  assert.deepEqual(page.mainEntity.itemListElement.map(item => [item.position, item.url]), [
    [1, "https://octocounts.com/github/rust-lang/rust"],
    [2, "https://octocounts.com/github/tokio-rs/tokio"],
  ]);
  assert.deepEqual(page.breadcrumb.itemListElement.map(item => item.name), ["OctoCounts", "Languages", "Rust"]);
  const faq = graph.find(node => node["@type"] === "FAQPage");
  assert.equal(faq.mainEntity[0].name, "Which Rust repository has the most lines of code?");
  for (const item of faq.mainEntity) assert.ok(html.includes(item.acceptedAnswer.text), item.name);

  const model = JSON.parse(html.match(/<script type="application\/json" id="octocounts-language-data">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(model, languageLeaderboardModel(rustPage, index));
  assert.match(html, /href="\/languages">The largest codebases by programming language<\/a>/);
  // The registry's comparisons of this language link the leaderboard into
  // the curated compare corpus.
  assert.match(html, /<h2>Curated comparisons in Rust<\/h2>/);
  assert.match(html, /<a href="\/compare\/rust-vs-go">Rust vs Go: lines of code compared<\/a>/);
  assert.match(html, /<a href="\/compare\/electron-vs-tauri">Electron vs Tauri: lines of code compared<\/a>/);

  const markdown = await onRequest(context("/languages/rust?format=md"));
  assert.equal(markdown.status, 200);
  assert.equal(markdown.headers.get("x-robots-tag"), "noindex, follow");
  const text = await markdown.text();
  assert.match(text, /^# The largest Rust repositories by lines of code\n/);
  assert.match(text, /\| 1 \| \[rust-lang\/rust\]\(https:\/\/octocounts\.com\/github\/rust-lang\/rust\) \| 2,306,821 \| 460,739 \| 2,114 \| 95\.4% \|/);
});

test("a language without a leaderboard is a real 404, never a soft empty page", async (t) => {
  mockApi(t);
  for (const path of ["/languages/missing-language", "/languages/Rust", "/languages/-rust"]) {
    const response = await onRequest(context(path));
    assert.equal(response.status, 404, path);
    const html = await response.text();
    assert.match(html, /content="noindex,follow,max-image-preview:large"/);
    assert.match(html, /<h1>Language leaderboard not found<\/h1>/);
    assert.match(html, /href="\/languages">Browse the languages that have one<\/a>/);
    assert.doesNotMatch(html, /type="application\/ld\+json"/);
  }
});

test("leaderboard failures stay retryable and a payload that disagrees with the site is not published", async (t) => {
  const down = await mockApi(t, { language: () => new Response("unavailable", { status: 503 }) });
  let response = await onRequest(context("/languages/rust"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "60");
  // The outage page keeps the page's identity without the brand suffix.
  assert.match(await response.text(), /<h1>Language leaderboard<\/h1>/);
  response = await onRequest(context("/languages/rust.md"));
  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type"), /^text\/markdown/);
  assert.ok(down.length >= 2);
  t.mock.restoreAll();

  // A row whose URL is not a report this site serves, or a ranking out of
  // order, must not reach crawlers.
  for (const broken of [
    { ...rustPage, reports: [{ ...report("rust-lang", "rust", 2_306_821, 2_200_000), canonicalUrl: "https://evil.example/github/rust-lang/rust" }] },
    { ...rustPage, reports: [report("a", "small", 10, 5), report("b", "large", 2_306_821, 2_200_000)] },
    { ...rustPage, reports: [{ ...report("rust-lang", "rust", 2_306_821, 2_200_000), generatedAt: "yesterday" }] },
    { ...rustPage, repositories: 12 },
    { ...rustPage, reports: [] },
  ]) {
    mockApi(t, { language: () => Response.json(broken) });
    response = await onRequest(context("/languages/rust"));
    assert.equal(response.status, 503, JSON.stringify(broken).slice(0, 80));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(await response.text(), /evil\.example/);
    t.mock.restoreAll();
  }

  // An index the hub cannot trust is an outage too; an empty one is a 404.
  mockApi(t, { languages: () => Response.json({ languages: [{ language: "Rust", slug: "Bad Slug", repositories: 5, code: 1, lines: 1 }], minRepositories: 10 }) });
  assert.equal((await onRequest(context("/languages"))).status, 503);
  t.mock.restoreAll();
  mockApi(t, { languages: () => Response.json({ languages: [], minRepositories: 10, leaderboardSize: 50 }) });
  const empty = await onRequest(context("/languages"));
  assert.equal(empty.status, 404);
  assert.match(await empty.text(), /content="noindex,follow/);
  // No leaderboard means no hub either, so the sitemap is not published.
  assert.equal((await onRequest(context("/sitemap-languages.xml"))).status, 404);
});

test("leaderboard titles and descriptions stay inside search snippets", () => {
  const long = languageLeaderboardModel({
    ...rustPage,
    language: "A Rather Long Programming Language Name",
    reports: [{ ...report("an-organization-with-a-long-name", "and-a-repository-name-that-is-also-long", 1_234_567, 1_200_000) }],
  }, index);
  assert.equal(long.title, "A Rather Long Programming Language Name by lines of code");
  assert.ok(long.title.length <= 60, long.title);
  assert.ok(long.description.length <= 160, long.description);
  assert.ok(!long.description.includes("leads with"), "the leader is dropped before the description would truncate");
  const short = languageLeaderboardModel(rustPage, index);
  assert.equal(short.title, "Rust repositories by lines of code | OctoCounts");
});
