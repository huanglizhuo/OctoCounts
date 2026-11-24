// Curated comparisons link to each other and carry a share card of their
// own figures: before 2026-11-24 each comparison linked only to the hub and
// its two report pages, and every one shared the site-wide preview image.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest } from "../functions/[[path]].js";
import { adjacentComparisons } from "../functions/compare-registry.js";

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

const report = (owner, repo, code) => ({
  provider: "github",
  owner,
  repo,
  repoFullName: `${owner}/${repo}`,
  htmlUrl: `https://github.com/${owner}/${repo}`,
  publicPath: `/github/${owner}/${repo}`,
  canonicalUrl: `https://octocounts.com/github/${owner}/${repo}`,
  title: `${owner}/${repo}`,
  description: "fixture",
  citation: "fixture",
  generatedAt: "2026-11-20T00:00:00Z",
  refName: "main",
  commitSha: "abcdef1234567890abcdef",
  tokeiVersion: "tokei-15.0.0",
  durationMs: 1,
  topLanguage: { name: "JavaScript", code, percent: 100 },
  languageCount: 1,
  languages: [{ name: "JavaScript", stats: { files: 10, lines: code + 10, code, comments: 5, blanks: 5 } }],
  total: { files: 10, lines: code + 10, code, comments: 5, blanks: 5 },
});

function stubReports(t, codes) {
  t.mock.method(globalThis, "fetch", async raw => {
    const owner = new URL(raw).searchParams.get("owner");
    const repo = new URL(raw).searchParams.get("repo");
    const code = codes[`${owner}/${repo}`];
    return code === undefined ? new Response(null, { status: 404 }) : Response.json(report(owner, repo, code));
  });
}

const seed = html => JSON.parse(html.match(/<script type="application\/json" id="octocounts-compare-data">([\s\S]*?)<\/script>/)[1]);

test("adjacent comparisons share a repository and never include the page itself", () => {
  assert.deepEqual(adjacentComparisons("react-vs-vue").map(entry => entry.slug), [
    "angular-vs-react", "svelte-vs-react", "angular-vs-vue", "svelte-vs-vue", "solidjs-vs-react",
  ]);
  // react-native is its own repository, so React Native vs Flutter is not
  // a neighbor of React vs Vue.
  assert.deepEqual(adjacentComparisons("alacritty-vs-kitty"), []);
  assert.deepEqual(adjacentComparisons("not-a-slug"), []);
});

test("a comparison page links its neighbors in HTML, Markdown and the client model, with its own share card", async (t) => {
  stubReports(t, { "react/react": 365_607, "vuejs/core": 61_495, "alacritty/alacritty": 30_000, "kovidgoyal/kitty": 40_000 });
  const response = await onRequest(context("/compare/react-vs-vue"));
  assert.equal(response.status, 200);
  const html = await response.text();
  const section = html.split("<h2>Related comparisons</h2>")[1].split("</section>")[0];
  const links = [...section.matchAll(/<a href="\/compare\/([a-z0-9.-]+)">([^<]+)<\/a>/g)].map(match => [match[1], match[2]]);
  assert.deepEqual(links, [
    ["angular-vs-react", "Angular vs React: lines of code compared"],
    ["svelte-vs-react", "Svelte vs React: lines of code compared"],
    ["angular-vs-vue", "Angular vs Vue: lines of code compared"],
    ["svelte-vs-vue", "Svelte vs Vue: lines of code compared"],
    ["solidjs-vs-react", "SolidJS vs React: lines of code compared"],
  ]);
  // The client page renders the same list from the model the body used.
  const model = seed(html);
  assert.deepEqual(model.relatedComparisons.map(entry => entry.slug), links.map(([slug]) => slug));
  assert.equal(html.match(/<a href="\/compare\/react-vs-vue">/g), null, "a page does not link to itself as related");

  // The share card shows this comparison's own code-line figures.
  assert.ok(html.includes('<meta property="og:image" content="https://api.test/og/compare?left=react%2Freact&amp;right=vuejs%2Fcore" />'), "og:image");
  assert.ok(html.includes('<meta name="twitter:image" content="https://api.test/og/compare?left=react%2Freact&amp;right=vuejs%2Fcore" />'), "twitter:image");
  assert.ok(html.includes('content="React vs Vue source lines of code compared: react/react 365,607 code lines, vuejs/core 61,495 code lines"'), "og:image:alt");

  const markdown = await onRequest(context("/compare/react-vs-vue.md"));
  const text = await markdown.text();
  assert.match(text, /## Related comparisons\n\n- \[Angular vs React: lines of code compared\]\(https:\/\/octocounts\.com\/compare\/angular-vs-react\)\n- \[Svelte vs React: lines of code compared\]/);
  assert.match(text, /- \[SolidJS vs React: lines of code compared\]\(https:\/\/octocounts\.com\/compare\/solidjs-vs-react\)\n\n## Related OctoCounts pages/);

  // A comparison whose neighbors share none of its repositories has no
  // related block, and still gets its own card.
  const lone = await (await onRequest(context("/compare/alacritty-vs-kitty"))).text();
  assert.doesNotMatch(lone, /<h2>Related comparisons<\/h2>/);
  assert.deepEqual(seed(lone).relatedComparisons, []);
  assert.ok(lone.includes("og/compare?left=alacritty%2Falacritty&amp;right=kovidgoyal%2Fkitty"));
});

test("the client compare page renders the related comparisons from its model", async () => {
  const page = await readFile(new URL("../src/pages/marketing.tsx", import.meta.url), "utf8");
  assert.match(page, /relatedComparisons\?: Array<\{ slug: string; name: string \}>;/);
  assert.match(page, /\{model\.relatedComparisons\?\.length \? \([\s\S]*?<a href=\{`\/compare\/\$\{entry\.slug\}`\}>\{entry\.name\}: lines of code compared<\/a>/);
});
