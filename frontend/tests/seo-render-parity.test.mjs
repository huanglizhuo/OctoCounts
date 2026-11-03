// Explore hydrates the shared React tree. Facts, discovery links and schema
// must remain available in both the server HTML and the client bootstrap.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest } from "../functions/[[path]].js";

const shell = await readFile(new URL("../index.html", import.meta.url), "utf8");
const en = JSON.parse(await readFile(new URL("../src/locales/en.json", import.meta.url), "utf8"));
const zh = JSON.parse(await readFile(new URL("../src/locales/zh.json", import.meta.url), "utf8"));

const snapshot = {
  source: "https://github.com/trending",
  period: "daily",
  generatedAt: "2026-11-01T08:00:00.000Z",
  date: "2026-11-01",
  repositories: [{ rank: 1, owner: "octo", name: "trend", fullName: "octo/trend", description: "Trending fixture", language: "Go", starsToday: 12, totalStars: 340, htmlUrl: "https://github.com/octo/trend", publicPath: "/github/octo/trend" }],
};

// A fresh env per request: the rotating links are memoized per env and day.
function context(path) {
  return {
    request: new Request(`https://octocounts.com${path}`),
    env: {
      SEO_API_BASE: "https://api.test",
      ASSETS: {
        fetch: async (request) => new URL(request.url).pathname === "/github-trending.json"
          ? Response.json(snapshot)
          : new Response(shell, { headers: { "content-type": "text/html" } }),
      },
    },
  };
}

const report = (name, files) => ({
  owner: "octo", repo: name, generatedAt: "2026-11-03T00:00:00Z",
  repoFullName: `octo/${name}`,
  publicPath: `/github/octo/${name}`,
  canonicalUrl: `https://octocounts.com/github/octo/${name}`,
  description: `octo/${name} fixture`,
  total: { files, lines: 100, code: 90, comments: 5, blanks: 5 },
});

const rotating = ["alpha", "beta", "gamma"].map((name) => ({ loc: `https://octocounts.com/github/octo/${name}`, lastmod: "2026-10-01", total: { files: 9, lines: 10, code: 9 } }));

function mockApi(t, listReports) {
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input?.url ?? input);
    if (url.includes("/api/seo/sitemap")) return Response.json(rotating);
    return Response.json({ page: 1, limit: 36, reports: listReports });
  });
}

test("hub lists never link reports below the indexable floor and keep paging on the API page", async (t) => {
  mockApi(t, [report("tiny", 4), ...Array.from({ length: 35 }, (_, index) => report(`repo${index}`, 50))]);
  for (const collection of ["recent", "popular", "hall-of-monoliths"]) {
    const html = await (await onRequest(context(`/${collection}`))).text();
    assert.doesNotMatch(html, /octo\/tiny/, collection);
    assert.match(html, /href="\/github\/octo\/repo0"/);
    assert.ok(html.includes(`href="/${collection}?page=2">Next</a>`), collection);
  }
});

test("hub pages repeat their rotating report links as head data the client renders", async (t) => {
  mockApi(t, [report("listed", 50)]);
  for (const path of ["/recent", "/popular", "/hall-of-monoliths", "/trending"]) {
    const html = await (await onRequest(context(path))).text();
    const head = html.slice(0, html.indexOf("</head>"));
    const data = JSON.parse(head.match(/<script type="application\/json" id="octocounts-more-reports">([^<]*)<\/script>/)?.[1] ?? "null");
    const directory = html.match(/<details class="explore-directory">([\s\S]*?)<\/details>/)?.[1] ?? "";
    const visible = [...directory.matchAll(/<li><a href="([^"]+)">/g)].map((match) => match[1]);
    assert.equal(data.length, 3, path);
    assert.deepEqual(data, visible, path);
  }
});

test("server h1s name the page without the title's brand suffix", async (t) => {
  mockApi(t, [report("listed", 50)]);
  for (const path of ["/recent", "/popular", "/hall-of-monoliths", "/trending", "/compare", "/diff", "/badges"]) {
    const html = await (await onRequest(context(path))).text();
    const h1 = html.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1];
    assert.ok(h1, path);
    assert.doesNotMatch(h1, /\| OctoCounts/, path);
    assert.match(html, /<title>[^<]*\| OctoCounts<\/title>/, path);
  }
});

test("parallel Explore SSR requests isolate locale and preload the matching client entry", async (t) => {
  mockApi(t, [report("listed", 50)]);
  const locales = ["en", "zh", "zh", "en", "zh", "en"];
  const pages = await Promise.all(locales.map(async (locale) => {
    const response = await onRequest(context(`/popular?lng=${locale}`));
    assert.equal(response.status, 200);
    return response.text();
  }));
  pages.forEach((html, index) => {
    const locale = locales[index];
    const copy = locale === "zh" ? zh : en;
    assert.ok(html.includes(`<h1 tabindex="-1">${copy.growth.pages.popular.title}</h1>`));
    assert.ok(html.includes(`data-oc-locale="${locale}"`));
    assert.match(html, /rel="modulepreload" href="\/assets\/ExploreApp-[^"]+\.js"/);
    assert.match(html, /class="explore-nav"/);
    assert.match(html, /class="explore-repo"/);
    assert.doesNotMatch(html, /class="explore-skeleton/);
    const bootstrap = JSON.parse(html.match(/id="octocounts-explore-bootstrap">([^<]*)<\/script>/)[1]);
    assert.equal(bootstrap.locale, locale);
    assert.equal(bootstrap.seeds["octocounts-list-data"].payload.reports[0].repo, "listed");
  });
});

test("FAQPage schema on /badges and /extension states the FAQ the client page shows", async (t) => {
  mockApi(t, []);
  for (const [path, faq, zhFaq] of [["/badges", en.badgesPage.faq, zh.badgesPage.faq], ["/extension", en.extensionLanding.faq, zh.extensionLanding.faq]]) {
    const html = await (await onRequest(context(path))).text();
    const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"];
    const schemaFaq = graph.find((node) => node["@type"] === "FAQPage").mainEntity.map((item) => ({ question: item.name, answer: item.acceptedAnswer.text }));
    assert.deepEqual(schemaFaq, faq, path);
    assert.equal(zhFaq.length, faq.length, `${path} zh`);
  }
});

test("badge cache claims match the backend's badge headers", async () => {
  const badge = await readFile(new URL("../../backend/src/badge.rs", import.meta.url), "utf8");
  assert.ok(badge.includes('"public, max-age=300, s-maxage=86400, stale-while-revalidate=3600"'), "branch badges: one day at the edge");
  assert.ok(badge.includes('"public, max-age=300, s-maxage=604800"'), "tag and commit badges: one week at the edge");
  assert.match(en.badgesPage.faq.find((item) => item.question === "Will the badge slow down my README?").answer, /up to a day .* up to a week/);
  const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8");
  assert.ok(readme.includes("`max-age=300, s-maxage=86400, stale-while-revalidate=3600`"));
  assert.ok(readme.includes("`max-age=300, s-maxage=604800`"));
});
