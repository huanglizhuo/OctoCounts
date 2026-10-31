import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const publicRoot = new URL("../public/", import.meta.url);
const schemas = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));

test("guide modification dates agree across visible HTML, Markdown, and article schema", async () => {
  for (const directory of ["docs/", "zh/docs/"]) {
    for (const name of await readdir(new URL(directory, publicRoot))) {
      if (!name.endsWith(".html")) continue;
      const html = await readFile(new URL(`${directory}${name}`, publicRoot), "utf8");
      const article = schemas(html).find((node) => node["@type"] === "TechArticle");
      const date = article.dateModified;
      const visibleDate = directory.startsWith("zh/") ? `更新于 ${date}` : `Updated ${new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}`;
      const markdown = await readFile(new URL(`${directory}${name.replace(/\.html$/, ".md")}`, publicRoot), "utf8");
      assert.ok(html.includes(visibleDate), `${directory}${name}: HTML date matches schema`);
      assert.ok(markdown.includes(visibleDate), `${directory}${name}: Markdown date matches schema`);
    }
  }
});

test("citation and reproduction answers keep the same qualifications in all published formats", async () => {
  for (const [slug, question, required] of [
    ["faq", "How do I cite an OctoCounts report?", ["reportId", "full commit SHA", "tokei version", "effective counting rules", "cache cleanup and replacement"]],
    ["tokei-online", "Is OctoCounts really running tokei?", ["same source tree", "tokei version", "effective counting rules", "countingPolicy"]],
  ]) {
    const html = await readFile(new URL(`docs/${slug}.html`, publicRoot), "utf8");
    const markdown = await readFile(new URL(`docs/${slug}.md`, publicRoot), "utf8");
    const answer = schemas(html).find((node) => node["@type"] === "FAQPage").mainEntity.find((node) => node.name === question).acceptedAnswer.text;
    const body = html.split("<body>")[1];
    for (const phrase of required) {
      for (const [format, content] of [["schema", answer], ["HTML", body], ["Markdown", markdown]]) {
        assert.ok(content.includes(phrase), `${slug} ${format}: ${phrase}`);
      }
    }
  }
});
