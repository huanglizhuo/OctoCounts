#!/usr/bin/env node
// Sequential, commit-pinned research collection; raw reports survive cache eviction.
// NODE_USE_SYSTEM_CA=1 node scripts/collect-research-sample.mjs --repos owner/repo,... --out /tmp/study.jsonl --max-repos 10
import assert from "node:assert/strict";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeAndWait } from "../cli/src/api.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.OCTOCOUNTS_API ?? "https://api.octocounts.com";
const base = { ignoredDirs: [], ignoredLanguages: [], profile: "default", includeDocs: true, includeTests: true, includeGenerated: true, respectGitattributes: false };
export const CONFIGS = [
  { config: "default", options: { ...base } },
  { config: "exclude-tests", options: { ...base, includeTests: false } },
  { config: "exclude-docs", options: { ...base, includeDocs: false } },
  { config: "exclude-generated", options: { ...base, includeGenerated: false } },
  { config: "repository-declarations", options: { ...base, includeGenerated: false, respectGitattributes: true } },
];

export async function collectRun(repository, entry, pinnedCommit, collectorSha256) {
  const started = Date.now();
  const row = { study: "filtering-effects", repository, config: entry.config, options: entry.options, refName: pinnedCommit || null, collectedAt: new Date().toISOString(), collectorSha256 };
  try {
    if (entry.config !== "default" && !pinnedCommit) throw new Error("baseline failed; variant not submitted without a pinned commit");
    const report = await analyzeAndWait(API, { repoUrl: `https://github.com/${repository}`, refName: pinnedCommit || undefined, forceRefresh: false, options: entry.options, source: "api" });
    row.report = report;
    assert.match(report.commitSha, /^[a-f0-9]{40}$/i, "complete commit SHA required");
    if (pinnedCommit) assert.equal(report.commitSha, pinnedCommit, "variant changed the measured commit");
    assert.equal(`${report.repository.owner}/${report.repository.name}`.toLowerCase(), repository.toLowerCase(), "repository mismatch");
    assert.ok(report.id && report.tokeiVersion && Number.isFinite(Date.parse(report.generatedAt)), "report provenance required");
    assert.ok(report.countingPolicy?.version && report.countingPolicy.repositoryAttributes?.status, "effective counting rules required");
    for (const key of ["includeDocs", "includeTests", "includeGenerated"]) assert.equal(report.countingPolicy[key], entry.options[key], `effective ${key} differs`);
    assert.equal(report.analysisOptions?.respectGitattributes ?? false, entry.options.respectGitattributes, "repository declaration option differs");
    for (const key of ["files", "lines", "code", "comments", "blanks"]) assert.ok(Number.isFinite(report.total?.[key]) && report.total[key] >= 0, `invalid ${key}`);
    return { ...row, outcome: "ok", wallTimeMs: Date.now() - started, commitSha: report.commitSha, tokeiVersion: report.tokeiVersion, totals: report.total, report };
  } catch (error) {
    return { ...row, outcome: "failed", wallTimeMs: Date.now() - started, error: error.message, jobId: error.jobId ?? null };
  }
}

async function main() {
  const { values } = parseArgs({ options: { repos: { type: "string" }, out: { type: "string" }, "max-repos": { type: "string", default: "2" }, "dry-run": { type: "boolean", default: false } } });
  const repos = values.repos?.split(",").map(value => value.trim()) ?? [];
  const cap = Number(values["max-repos"]);
  assert.ok(repos.length && values.out, "--repos and --out are required");
  assert.ok(Number.isInteger(cap) && cap > 0 && cap <= 20, "--max-repos must be 1–20");
  assert.ok(repos.every(repo => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)), "repositories must use owner/name");
  assert.equal(new Set(repos.map(repo => repo.toLowerCase())).size, repos.length, "duplicate repository");
  const selected = repos.slice(0, cap);
  if (values["dry-run"]) return console.log(JSON.stringify({ api: API, repos: selected, configs: CONFIGS }, null, 2));
  const output = path.resolve(ROOT, values.out);
  const collectorSha256 = createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, "", { flag: "wx" }); // Never truncate earlier measurements.
  let first = true;
  for (const repository of selected) {
    let pinnedCommit;
    for (const entry of CONFIGS) {
      // Stay below the public 5/minute analysis limit, even on cache hits.
      if (!first) await new Promise(resolve => setTimeout(resolve, 13_000));
      first = false;
      const row = await collectRun(repository, entry, pinnedCommit, collectorSha256);
      if (entry.config === "default" && row.outcome === "ok") pinnedCommit = row.commitSha;
      await appendFile(output, `${JSON.stringify(row)}\n`);
      console.log(`${repository} ${entry.config}: ${row.outcome} ${row.totals ? `code=${row.totals.code}` : row.error}`);
    }
  }
  console.log(`done → ${output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
