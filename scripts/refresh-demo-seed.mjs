#!/usr/bin/env node
// Regenerate the homepage demo seed: frontend/src/initialReport.json plus the
// pinned defaultRefName in frontend/src/constants.ts.
//
// The seed must be exactly what the live analyze API returns for the demo
// repository at the pinned ref, because the app normalizes it through
// normalizeReport() — a field-shape drift breaks the homepage example report.
//
// Usage:
//   node scripts/refresh-demo-seed.mjs [--repo owner/name] [--tag v1.2.3]
//                                      [--api https://api.octocounts.com]
//   node scripts/refresh-demo-seed.mjs --check   # dry run: verify currency
//
// Defaults come from constants.ts (repo URL and pinned ref). Without --tag the
// latest published release of the repo is used (GitHub API, redirects
// followed). No dependencies.
import { readFile, writeFile } from "node:fs/promises";

const FRONTEND = new URL("../frontend/", import.meta.url);
const CONSTANTS_URL = new URL("src/constants.ts", FRONTEND);
const SEED_URL = new URL("src/initialReport.json", FRONTEND);
const FUNCTIONS_URL = new URL("functions/[[path]].js", FRONTEND);
const DEFAULT_API = "https://api.octocounts.com";

const DEFAULT_OPTIONS = {
  ignoredDirs: [],
  ignoredLanguages: [],
  profile: "default",
  includeDocs: true,
  includeTests: true,
  includeGenerated: true,
};

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") args.check = true;
    else if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--tag") args.tag = argv[++i];
    else if (arg === "--api") args.api = argv[++i];
    else args._.push(arg);
  }
  return args;
}

async function readConstants() {
  const source = await readFile(CONSTANTS_URL, "utf8");
  const repoUrl = source.match(/export const defaultRepoUrl = "([^"]+)";/)?.[1];
  const refName = source.match(/export const defaultRefName = "([^"]+)";/)?.[1];
  if (!repoUrl || refName === undefined) {
    throw new Error("could not read defaultRepoUrl/defaultRefName from frontend/src/constants.ts");
  }
  return { repoUrl, refName };
}

function repoSlugFromUrl(url) {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/);
  if (!match) throw new Error(`defaultRepoUrl is not a plain github.com repo URL: ${url}`);
  return `${match[1]}/${match[2]}`;
}

async function latestReleaseTag(repo) {
  // api.github.com/repos/:owner/:repo/releases/latest — follow redirects
  // (renamed repos answer 301 to their new home).
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    redirect: "follow",
    headers: { accept: "application/vnd.github+json", "user-agent": "octocounts-refresh-demo-seed" },
  });
  if (!response.ok) throw new Error(`GitHub releases/latest for ${repo}: HTTP ${response.status}`);
  const release = await response.json();
  if (typeof release.tag_name !== "string" || !release.tag_name) {
    throw new Error(`GitHub releases/latest for ${repo}: no tag_name`);
  }
  return release.tag_name;
}

async function fetchJson(url, init, what) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body.message === "string" ? body.message : response.statusText;
    throw new Error(`${what}: HTTP ${response.status} ${message}`);
  }
  return body;
}

/// Runs the exact analysis the homepage would, via the same /api/analyze the
/// frontend calls, and resolves to the finished report.
async function analyzeReport(api, repoUrl, refName) {
  const submit = () =>
    fetchJson(`${api}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoUrl, refName, forceRefresh: false, options: DEFAULT_OPTIONS, source: "web" }),
    }, "POST /api/analyze");

  let result = await submit();
  if (result.kind === "cached") return result.report;

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const job = await fetchJson(`${api}/api/jobs/${result.jobId}?wait=20`, {}, `GET /api/jobs/${result.jobId}`);
    if (job.status === "failed") throw new Error(`analysis failed: ${job.error?.message ?? "unknown error"}`);
    if (job.status === "completed" && job.reportId) {
      const report = await fetchJson(`${api}/api/reports/${job.reportId}`, {}, `GET /api/reports/${job.reportId}`);
      // Prefer a cache-hit copy for the committed seed (mirrors what a
      // homepage visitor gets once the report is warm).
      const again = await submit();
      return again.kind === "cached" ? again.report : report;
    }
    result = { kind: "job", jobId: result.jobId, status: job.status };
  }
  throw new Error("analysis timed out after 10 minutes");
}

/// The seed keeps the committed file's exact shape (main.tsx normalizes it via
/// normalizeReport; missing option fields are filled from defaults there).
function toSeedShape(report) {
  const required = ["id", "refName", "commitSha", "generatedAt", "durationMs", "cached", "tokeiVersion", "languages", "total"];
  for (const key of required) {
    if (report[key] === undefined) throw new Error(`API report is missing field "${key}" — seed shape would drift`);
  }
  for (const key of ["owner", "name", "htmlUrl"]) {
    if (report.repository?.[key] === undefined) throw new Error(`API report.repository is missing "${key}"`);
  }
  return {
    id: report.id,
    repository: {
      owner: report.repository.owner,
      name: report.repository.name,
      htmlUrl: report.repository.htmlUrl,
    },
    refName: report.refName,
    commitSha: report.commitSha,
    generatedAt: report.generatedAt,
    durationMs: report.durationMs,
    cached: report.cached,
    tokeiVersion: report.tokeiVersion,
    languages: report.languages,
    total: report.total,
  };
}

async function verifyNoStaleRefInFunctions(refs) {
  const functions = await readFile(FUNCTIONS_URL, "utf8");
  const stale = refs.filter((ref) => ref && functions.includes(ref));
  if (stale.length) {
    throw new Error(`stale demo ref(s) still present in frontend/functions/[[path]].js: ${stale.join(", ")}`);
  }
}

async function writeSeed(seed) {
  await writeFile(SEED_URL, `${JSON.stringify(seed, null, 2)}\n`);
}

async function writeConstants({ repoUrl, refName }) {
  const before = await readFile(CONSTANTS_URL, "utf8");
  const after = before
    .replace(/(export const defaultRepoUrl = ")[^"]+(")/, `$1${repoUrl}$2`)
    .replace(/(export const defaultRefName = ")[^"]+(")/, `$1${refName}$2`);
  if (after === before) return false;
  await writeFile(CONSTANTS_URL, after);
  return true;
}

const args = parseArgs(process.argv.slice(2));
const api = args.api ?? DEFAULT_API;
const constants = await readConstants();
const repoUrl = args.repo ? `https://github.com/${args.repo}` : constants.repoUrl;
const repo = repoSlugFromUrl(repoUrl);
const previousRef = constants.refName;
const previousSeed = JSON.parse(await readFile(SEED_URL, "utf8"));
const tag = args.tag ?? await latestReleaseTag(repo);

if (args.check) {
  // Dry mode: prove the committed seed is what the live API serves today for
  // the pinned repo+ref, and that no stale ref leaked into the edge function.
  const report = await analyzeReport(api, repoUrl, tag);
  const problems = [];
  if (previousRef !== tag) problems.push(`constants defaultRefName "${previousRef}" is not the analyzed ref "${tag}"`);
  if (previousSeed.commitSha !== report.commitSha) problems.push(`seed commitSha ${previousSeed.commitSha.slice(0, 12)} != live ${report.commitSha.slice(0, 12)}`);
  if (previousSeed.refName !== report.refName) problems.push(`seed refName "${previousSeed.refName}" != live "${report.refName}"`);
  await verifyNoStaleRefInFunctions([previousSeed.commitSha.slice(0, 12)]);
  if (problems.length) {
    console.error(`demo seed is stale (${repoUrl} @ ${tag}):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error("run: node scripts/refresh-demo-seed.mjs");
    process.exit(1);
  }
  console.log(`demo seed is current: ${repo} @ ${tag} (${report.commitSha.slice(0, 12)}, ${report.total.code} code lines)`);
  process.exit(0);
}

console.log(`refreshing demo seed: ${repoUrl} @ ${tag} (was ${previousRef})`);
const report = await analyzeReport(api, repoUrl, tag);
const seed = toSeedShape(report);
await writeSeed(seed);
const constantsChanged = await writeConstants({ repoUrl, refName: tag });
// The pinned ref and the seed's commit must not linger anywhere in the edge
// function (the homepage SSR body references the demo repo independently).
await verifyNoStaleRefInFunctions([previousRef, previousSeed.commitSha?.slice(0, 12)].filter((ref) => ref !== tag && ref !== report.commitSha.slice(0, 12)));
console.log(`seed written: ${seed.repository.owner}/${seed.repository.name} @ ${seed.refName} (${seed.commitSha.slice(0, 12)}, ${seed.total.code} code lines, ${seed.languages.length} languages)`);
console.log(constantsChanged ? `constants.ts updated: defaultRefName = ${tag}` : "constants.ts already current");
