// The CLI, MCP server and GitHub Action landing pages: three tools that used
// to be reachable only as source directories on GitHub.
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

/// Serves the real static files the way the asset layer does: /docs/x as the
/// .html file, /docs/x.md as the Markdown twin, anything else as the shell.
function assetContext(path) {
  const files = new Map();
  return {
    request: new Request(`https://octocounts.com${path}`),
    env: {
      SEO_API_BASE: "https://api.test",
      ASSETS: {
        fetch: async request => {
          const name = new URL(request.url).pathname;
          if (!files.has(name)) {
            const onDisk = name.endsWith(".md") ? name : `${name}.html`;
            try {
              files.set(name, await readFile(new URL(`../public${onDisk}`, import.meta.url), "utf8"));
            } catch {
              files.set(name, null);
            }
          }
          const body = files.get(name);
          return body === null
            ? new Response("not found", { status: 404 })
            : new Response(body, { headers: { "content-type": name.endsWith(".md") ? "text/markdown" : "text/html" } });
        },
      },
    },
  };
}

const pages = [
  ["cli", "OctoCounts CLI: count SLOC from a terminal | OctoCounts"],
  ["mcp-server", "OctoCounts MCP server: SLOC for AI coding tools | OctoCounts"],
  ["github-action", "SLOC diff GitHub Action for pull requests | OctoCounts"],
];

test("each tool has a guide page with a canonical URL, one H1, schema and a Markdown twin", async () => {
  for (const [slug, title] of pages) {
    const html = await readFile(new URL(`../public/docs/${slug}.html`, import.meta.url), "utf8");
    const url = `https://octocounts.com/docs/${slug}`;
    assert.ok(html.includes(`<title>${title}</title>`), `${slug} title`);
    assert.ok(title.length <= 60, `${slug} title fits a search snippet`);
    assert.ok(html.includes(`<link rel="canonical" href="${url}" />`), `${slug} canonical`);
    assert.ok(html.includes(`<link rel="alternate" type="text/markdown" href="${url}.md" />`), `${slug} markdown alternate`);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${slug} single h1`);
    assert.ok(html.includes("<main>") && html.includes('class="answer"'), `${slug} main landmark and answer-first paragraph`);
    assert.ok(html.includes('content="index,follow,max-image-preview:large,max-snippet:-1"'), `${slug} indexable`);
    const nodes = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
    const types = nodes.map(node => node["@type"]).sort();
    assert.deepEqual(types, ["BreadcrumbList", "FAQPage", "Person", "TechArticle"], `${slug} schema nodes`);
    const article = nodes.find(node => node["@type"] === "TechArticle");
    assert.equal(article.mainEntityOfPage, url);
    assert.equal(article.dateModified, "2026-11-24");
    assert.ok(html.includes("Updated November 24, 2026"), `${slug} visible date agrees with schema`);
    // FAQ schema states questions a reader can see, and answers that appear verbatim.
    const faq = nodes.find(node => node["@type"] === "FAQPage").mainEntity;
    assert.ok(faq.length >= 5, `${slug} has a FAQ`);
    const visible = html.replace(/<[^>]*>/g, "");
    for (const item of faq) {
      assert.ok(visible.includes(item.name), `${slug} shows question ${item.name}`);
      assert.ok(visible.includes(item.acceptedAnswer.text), `${slug} shows answer for ${item.name}`);
    }
    const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
    assert.ok(description.length <= 160 && description.length >= 70, `${slug} description length ${description.length}`);

    // Markdown twin: same heading, canonical page link, and every FAQ answer.
    const markdown = await readFile(new URL(`../public/docs/${slug}.md`, import.meta.url), "utf8");
    assert.ok(markdown.startsWith(`# ${article.headline}\n`), `${slug} markdown heading`);
    assert.ok(markdown.includes(`Canonical page: ${url}`));
    for (const item of faq) assert.ok(markdown.includes(item.acceptedAnswer.text), `${slug} markdown answer ${item.name}`);

    // Served extensionless, and the twin on both explicit Markdown routes.
    const page = await onRequest(assetContext(`/docs/${slug}`));
    assert.equal(page.status, 200, slug);
    assert.ok((await page.text()).includes(`<title>${title}</title>`));
    for (const path of [`/docs/${slug}.md`, `/docs/${slug}?format=md`]) {
      const twin = await onRequest(assetContext(path));
      assert.equal(twin.status, 200, path);
      assert.match(twin.headers.get("content-type"), /^text\/markdown; charset=utf-8/);
      assert.equal(twin.headers.get("x-robots-tag"), "noindex, follow");
      assert.equal(await twin.text(), markdown, path);
    }
  }
});

test("each tool page states only what the tool's own source shows", async () => {
  const cli = await readFile(new URL("../public/docs/cli.md", import.meta.url), "utf8");
  // The help text in cli/src/index.js is the authority for the flags.
  const cliSource = await readFile(new URL("../../cli/src/index.js", import.meta.url), "utf8");
  const helpFlags = [...cliSource.slice(cliSource.indexOf("Options:")).matchAll(/^\s+(--[a-z-]+)/gm)].map(match => match[1]);
  for (const flag of helpFlags) assert.ok(cli.includes(`\`${flag}`), `CLI page documents ${flag}`);
  assert.ok(!/--verbose|--exclude-dir/.test(cli), "the CLI page invents no flags");

  const mcp = await readFile(new URL("../public/docs/mcp-server.md", import.meta.url), "utf8");
  const mcpSource = await readFile(new URL("../../mcp/src/core.js", import.meta.url), "utf8");
  for (const tool of ["analyze_repo", "compare_repos"]) {
    assert.ok(mcpSource.includes(`name: "${tool}"`) && mcp.includes(`\`${tool}\``), `MCP page documents ${tool}`);
  }
  for (const argument of ["repo_url", "ref", "respect_gitattributes", "left_repo_url", "right_repo_url", "left_ref", "right_ref"]) {
    assert.ok(mcpSource.includes(`${argument}: {`) && mcp.includes(`\`${argument}\``), `MCP page documents ${argument}`);
  }

  const action = await readFile(new URL("../public/docs/github-action.md", import.meta.url), "utf8");
  const actionYml = await readFile(new URL("../../action/action.yml", import.meta.url), "utf8");
  const inputs = [...actionYml.matchAll(/^  ([a-z-]+):$/gm)].map(match => match[1]);
  assert.ok(inputs.length >= 7);
  for (const input of inputs) assert.ok(action.includes(`\`${input}\``), `Action page documents input ${input}`);
  assert.ok(action.includes("uses: huanglizhuo/octocounts-sloc-diff-action@v1"));
});

test("the tools are linked from the sitemap, the docs hub, the homepage and the FAQ", async () => {
  const sitemap = await (await onRequest(assetContext("/sitemap-static.xml"))).text();
  const hub = await readFile(new URL("../public/docs.html", import.meta.url), "utf8");
  const home = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const faq = await readFile(new URL("../public/docs/faq.md", import.meta.url), "utf8");
  for (const [slug] of pages) {
    const url = `https://octocounts.com/docs/${slug}`;
    assert.ok(sitemap.includes(`<loc>${url}</loc>\n    <lastmod>2026-11-24</lastmod>`), `${slug} in the static sitemap`);
    assert.ok(hub.includes(`href="/docs/${slug}"`), `${slug} linked from the docs hub`);
    assert.ok(app.includes(`href: "/docs/${slug}"`), `${slug} linked from the homepage tools`);
    assert.ok(faq.includes(`](https://octocounts.com/docs/${slug})`), `${slug} linked from the FAQ`);
  }
  // The homepage no longer sends visitors to a source directory for a tool.
  assert.doesNotMatch(app, /tree\/main\/(cli|action|mcp)`/);
  assert.match(home, /href="\/languages">Largest codebases by programming language<\/a>/);
  assert.match(home, /<time datetime="2026-11-24">Updated November 24, 2026\.<\/time>/);
});
