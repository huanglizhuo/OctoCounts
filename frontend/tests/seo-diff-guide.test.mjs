// The /diff tool page: its server HTML explains what a diff measures, the
// hydrated page shows the same explanation and FAQ, and the FAQPage schema
// describes only what a reader can see.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { onRequest } from "../functions/[[path]].js";
import { DIFF_GUIDE } from "../functions/diff-copy.js";

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

const visible = html => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");

test("the diff page explains the measurement before the tool and publishes only its visible FAQ", async () => {
  const response = await onRequest(context("/diff"));
  assert.equal(response.status, 200);
  const html = await response.text();
  const text = visible(html);
  assert.ok(text.includes(DIFF_GUIDE.intro), "intro is in the server HTML");
  for (const section of DIFF_GUIDE.sections) {
    assert.ok(text.includes(section.h2), section.h2);
    for (const paragraph of section.paragraphs) assert.ok(text.includes(paragraph), paragraph.slice(0, 60));
  }
  const nodes = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]))[0]["@graph"];
  assert.deepEqual(nodes.map(node => node["@type"]).sort(), ["FAQPage", "WebApplication", "WebPage"]);
  const faq = nodes.find(node => node["@type"] === "FAQPage");
  assert.equal(faq["@id"], "https://octocounts.com/diff#faq");
  assert.deepEqual(faq.mainEntity.map(item => [item.name, item.acceptedAnswer.text]), DIFF_GUIDE.faq.map(item => [item.question, item.answer]));
  for (const item of faq.mainEntity) {
    assert.ok(text.includes(item.name), `question visible: ${item.name}`);
    assert.ok(text.includes(item.acceptedAnswer.text), `answer visible: ${item.name}`);
  }
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
  // The page answers the question a search for the tool is asking.
  assert.match(text, /net size change between two counted trees, head minus base/);
  assert.match(text, /Percentage change uses the base count/);
  assert.match(html, /<link rel="canonical" href="https:\/\/octocounts\.com\/diff" \/>/);
});

test("the compare hub and the client diff page agree with the server", async () => {
  // The hub has curated comparisons and no diff FAQ.
  const hub = await (await onRequest(context("/compare"))).text();
  assert.match(hub, /<h2>Curated comparisons<\/h2>/);
  assert.doesNotMatch(hub, /"@type":"FAQPage"/);

  // Google indexes the rendered DOM, so the heading a visitor sees after
  // hydration is the one that counts: it must be the server's own heading
  // for the same URL, not a shorter interface label ("Ref Diff").
  const en = JSON.parse(await readFile(new URL("../src/locales/en.json", import.meta.url), "utf8"));
  for (const [path, heading] of [["/compare", en.compare.title], ["/diff", en.diff.title]]) {
    const server = await (await onRequest(context(path))).text();
    assert.equal(server.match(/<h1[^>]*>([^<]*)<\/h1>/)[1], heading, `${path} client heading equals the server h1`);
    assert.ok(server.includes(`<title>${heading} | OctoCounts</title>`), `${path} title`);
  }

  // The client metadata uses the same description as the edge.
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.ok(app.includes(`: "${DIFF_GUIDE.description}";`), "App.tsx diff description matches diff-copy.js");

  // The hydrated diff page renders the same guide and FAQ.
  const page = await readFile(new URL("../src/pages/marketing.tsx", import.meta.url), "utf8");
  assert.match(page, /import \{ DIFF_GUIDE \} from "\.\.\/\.\.\/functions\/diff-copy\.js";/);
  assert.match(page, /<p>\{DIFF_GUIDE\.intro\}<\/p>/);
  assert.match(page, /\{DIFF_GUIDE\.faq\.map\(\(item\) => \([\s\S]*?<h3>\{item\.question\}<\/h3>\s*<p>\{item\.answer\}<\/p>/);
});

test("the diff guide states what the methodology page states", async () => {
  const methodology = await readFile(new URL("../public/docs/methodology.md", import.meta.url), "utf8");
  // Net change, not Git's added/deleted lines, and the zero-base rule, are
  // both defined on the methodology page.
  assert.match(methodology, /Diff reports a net size change between two counted trees \(head minus base\)\. It is not Git's added\/deleted line count\. Percentage change uses the base count; a zero base and positive head is shown as New\./);
  assert.match(methodology, /Compare and diff check policy version, tokei version and effective rules/);
});
