#!/usr/bin/env node
// SG-02 product-facts consistency checker.
//
// frontend/content/product-facts.json is the source of truth for what public
// copy may claim about OctoCounts. This script fails when public-facing files
// drift from those facts: unsupported claims reappear, store links diverge,
// or documented scope statements go missing. Run from anywhere:
//   node scripts/check-product-facts.mjs

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = path.join(ROOT, "frontend");

const failures = [];
const note = (message) => failures.push(message);

// ---------- load the fact sheet ----------

const factsPath = path.join(FRONTEND, "content", "product-facts.json");
let facts;
try {
  facts = JSON.parse(await readFile(factsPath, "utf8"));
} catch (error) {
  console.error(`cannot read ${path.relative(ROOT, factsPath)}: ${error.message}`);
  process.exit(1);
}

// ---------- collect public copy files ----------

async function walk(dir, extensions, accumulator = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, extensions, accumulator);
    else if (extensions.some((extension) => entry.name.endsWith(extension))) accumulator.push(full);
  }
  return accumulator;
}

const publicFiles = await walk(path.join(FRONTEND, "public"), [".html", ".txt", ".md"]);
const copyFiles = [
  path.join(FRONTEND, "index.html"),
  path.join(FRONTEND, "functions", "[[path]].js"),
  path.join(FRONTEND, "src", "locales", "en.json"),
  path.join(FRONTEND, "src", "locales", "zh.json"),
  path.join(FRONTEND, "src", "constants.ts"),
  path.join(FRONTEND, "src", "homeFaq.ts"),
  path.join(FRONTEND, "functions", "compare-editorial.js"),
  ...publicFiles,
];

const contents = new Map();
for (const file of copyFiles) {
  try {
    contents.set(file, await readFile(file, "utf8"));
  } catch {
    // Optional file (e.g. a locale may not exist); required-phrase checks
    // below address the files that must exist.
  }
}

// ---------- forbidden claims ----------

// Performance claims: no comparative or multiplier performance statements
// without a published reproducible experiment (facts.performanceClaims).
const forbidden = [
  { pattern: /per-language totals in a few seconds|can swing totals by 20(?:-|–|&ndash;)50%/i, reason: "latency needs cache/queue conditions; filtering percentages must name the measured sample" },
  { pattern: /AI-Usage: search-allowed, training-permitted/i, reason: "default training-use signal is no, with an explicit GPTBot exception; crawl access is separate" },
  { pattern: /same URL and ref always produce the same count|regardless of branch movement|相同的链接和引用总是产生相同的计数|不受分支移动影响/i, reason: "reproducibility requires the same commit, engine and effective counting rules; live refs may move" },
  { pattern: /gitlab/i, reason: "all GitLab support and copy was removed from the public product on 2026-09-08; re-adding any mention needs an explicit product decision" },
  { pattern: /10[-–]50\s?x/i, reason: "unsupported size/speed multiplier (see product-facts.json performanceClaims)" },
  { pattern: /significantly faster/i, reason: "comparative performance claim without a published experiment (see product-facts.json performanceClaims)" },
  { pattern: /no rate limit that is publicly documented/i, reason: "default analyze rate limits are documented" },
  { pattern: /permanent(?:, shareable)? (?:report|OctoCounts report|commit-pinned)|every analysis a permanent URL/i, reason: "saved reports are cache entries, not permanent archives" },
  { pattern: /unusually complex|share from file counts and byte sizes|on a cold queue/i, reason: "unsupported complexity, Linguist, or benchmark claim" },
  { pattern: /hand-written source lines|dramatically faster|slowest of the three|widest language database/i, reason: "filtering does not prove authorship, and tool rankings need a versioned benchmark" },
  { pattern: /no other rate limit is publicly documented|unmatched language coverage|bytes per file extension/i, reason: "document force-refresh limits and Linguist classification without unsupported tool rankings" },
  { pattern: /cache is hit immediately|repeat visits load instantly|重复访问即时加载|缓存会立即命中|ref 时结果即时加载/i, reason: "cache reuse requires a matching retained entry" },
  { pattern: /link the pinned report for each repository so readers can reproduce|highest comment share among the C and C\+\+ codebases/i, reason: "historical table lacks saved reports and does not support this ranking" },
  { pattern: /recounting the same commit returns the identical numbers|same program reading the same (?:bytes|files)|reports always state their configuration|same repo, commit, and options returns identical numbers|re-analyzing the same commit with the same options returns identical numbers/i, reason: "reproduction also requires matching actual source, engine and effective rules; older policy metadata may be absent" },
  { pattern: /totals can differ by a few percent|raw measurements behind this claim/i, reason: "the filtering pilot is not a cross-tool or local-versus-server parity benchmark" },
];

for (const [file, text] of contents) {
  for (const { pattern, reason } of forbidden) {
    if (pattern.test(text)) {
      note(`${path.relative(ROOT, file)}: matches ${pattern} — ${reason}`);
    }
  }
}

// Person identity must not merge the maintainer with their products.
function checkIdentity(value, file) {
  if (Array.isArray(value)) {
    for (const item of value) checkIdentity(item, file);
  } else if (value && typeof value === "object") {
    if (value["@type"] === "Dataset") {
      if (file.endsWith("largest-codebases.html") && value.license) {
        note(`${path.relative(ROOT, file)}: dataset licensing needs an explicit data-license source; the code license is insufficient`);
      }
      if (file.endsWith("research.html") && value.distribution?.some((item) => item.contentUrl?.endsWith("/pilot-samples.jsonl")) && value.dateModified !== "2026-10-16") {
        note(`${path.relative(ROOT, file)}: unchanged pilot Dataset must retain its recorded metadata date, independent of article edits`);
      }
    }
    if (value["@type"] === "Person" && value["@id"] === "https://github.com/huanglizhuo") {
      const identities = Array.isArray(value.sameAs) ? value.sameAs : value.sameAs ? [value.sameAs] : [];
      if (identities.some((url) => /github\.com\/huanglizhuo\/|chromewebstore|microsoftedge|addons\.mozilla|npmjs\.com\/package\//.test(url))) {
        note(`${path.relative(ROOT, file)}: Person.sameAs identifies a product rather than the person`);
      }
    }
    for (const child of Object.values(value)) checkIdentity(child, file);
  }
}

for (const [file, text] of contents) {
  if (!file.endsWith(".html")) continue;
  for (const [, json] of text.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      checkIdentity(JSON.parse(json), file);
    } catch (error) {
      note(`${path.relative(ROOT, file)}: invalid JSON-LD — ${error.message}`);
    }
  }
}

if (!facts.facts?.analysisOptions?.value?.includes("respectGitattributes")) {
  note("product-facts.json: analysisOptions must include respectGitattributes");
}
if (!/5 requests\/minute per IP.*burst 10/.test(facts.facts?.apiRateLimit?.value ?? "")) {
  note("product-facts.json: document the default analyze rate limit");
}
if (!facts.facts?.reportRetention) note("product-facts.json: document saved-report retention limits");

// The historical download preserves the published table, not a new analysis.
const historicalPath = path.join(FRONTEND, "public", "research", "largest-codebases-2026-10-15.json");
try {
  const historical = JSON.parse(await readFile(historicalPath, "utf8"));
  if (historical.measurements.length !== 8) note("historical codebase table: expected the eight published measurements");
  for (const row of historical.measurements) {
    for (const extension of ["md", "html"]) {
      const article = contents.get(path.join(FRONTEND, "public", "docs", `largest-codebases.${extension}`)) ?? "";
      const record = article.split("\n").find((line) => line.includes(row.repository) && line.includes(row.commitPrefix));
      if (!record || ![row.codeLines, row.totalLines, row.files].every((count) => record.includes(count.toLocaleString("en-US")))) {
        note(`largest-codebases.${extension}: published table differs from the historical download for ${row.repository}`);
      }
    }
  }
} catch (error) {
  note(`historical codebase table: ${error.message}`);
}

// ---------- required scope statements ----------

const required = [
  {
    file: path.join(FRONTEND, "public", "docs", "api.html"),
    pattern: /repoUrl<\/code> supports public <code>github\.com<\/code> repositories/,
    reason: "API docs must state the public github.com scope",
  },
  {
    file: path.join(FRONTEND, "public", "llms.txt"),
    pattern: /`?repoUrl`? must be a public `?github\.com`? URL/,
    reason: "llms.txt API summary must state the public github.com scope",
  },
];

for (const { file, pattern, reason } of required) {
  const text = contents.get(file);
  if (!text || !pattern.test(text)) note(`${path.relative(ROOT, file)}: missing required statement — ${reason}`);
}

// ---------- extension store URLs agree everywhere ----------

const stores = facts.facts?.extensions?.value;
if (!stores || !stores.chrome || !stores.edge || !stores.firefox) {
  note("product-facts.json: facts.extensions.value must list chrome, edge, and firefox store URLs");
} else {
  // Store pages canonically use one trailing-slash form per store, but some
  // historical copy uses the other equivalent form; accept either.
  const present = (text, url) => text.includes(url) || text.includes(url.replace(/\/$/, ""));
  for (const [file, text] of contents) {
    // Only files that talk about stores at all must carry all three; this
    // keeps the check meaningful without forcing store links into every page.
    const storeMentioned = Object.values(stores).some((url) => present(text, url));
    if (!storeMentioned) continue;
    for (const [store, url] of Object.entries(stores)) {
      if (!present(text, url)) {
        note(`${path.relative(ROOT, file)}: mentions a store URL but is missing the ${store} URL from product-facts.json`);
      }
    }
  }
}

// ---------- default ignored dirs agree with the fact sheet ----------

const ignoredDirs = facts.facts?.defaultIgnoredDirs?.value;
if (Array.isArray(ignoredDirs)) {
  const llmsFull = contents.get(path.join(FRONTEND, "public", "llms-full.txt")) ?? "";
  for (const dir of ignoredDirs) {
    if (!llmsFull.includes(dir)) {
      note(`frontend/public/llms-full.txt: default ignored dir "${dir}" from product-facts.json is missing`);
    }
  }
} else {
  note("product-facts.json: facts.defaultIgnoredDirs.value must be an array");
}

// ---------- report ----------

if (failures.length > 0) {
  console.error(`check-product-facts: ${failures.length} inconsistency${failures.length === 1 ? "" : "s"} found:\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`check-product-facts: OK (${copyFiles.length} files checked against product-facts.json v${facts.version}, verified ${facts.verifiedAt})`);
