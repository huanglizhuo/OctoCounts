#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { COMPARE_REGISTRY } from "../frontend/functions/compare-registry.js";

const DEFAULT_API_BASE = "https://api.octocounts.com";
const DEFAULT_REPO_FILE = new URL("../data/popular-repos.txt", import.meta.url);

const args = parseArgs(process.argv.slice(2));
const apiBase = trimTrailingSlash(args["api-base"] ?? process.env.OCTOCOUNTS_API_BASE ?? DEFAULT_API_BASE);
const repoFile = args.file ?? DEFAULT_REPO_FILE;
const dryRun = Boolean(args["dry-run"]);
const limit = args.limit === undefined ? Infinity : Number(args.limit);
const batch = args.batch === undefined ? 0 : Number(args.batch);
const concurrency = numberArg(args.concurrency, 2);
const delayMs = numberArg(args["delay-ms"], 500);
const pollMs = numberArg(args["poll-ms"], 2500);
const maxPolls = numberArg(args["max-polls"], 120);
// Generous because the analyze limit (burst 5, then 10/minute per IP) is
// smaller than a batch: workers queue on Retry-After rather than fail.
const requestRetries = numberArg(args["request-retries"], 10);
const forceRefresh = Boolean(args["force-refresh"]);
const source = String(args.source ?? "seed");

if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

if (args.limit === true || args.batch === true || (!Number.isSafeInteger(limit) && limit !== Infinity) || limit < 1 || !Number.isSafeInteger(batch) || batch < 0) {
  throw new Error("--limit must be a positive integer and --batch a non-negative integer");
}
const inventory = mergeCompareRegistryRepos(await readRepos(repoFile));
const offset = Number.isFinite(limit) ? (batch % Math.max(1, Math.ceil(inventory.length / limit))) * limit : 0;
const repos = inventory.slice(offset, offset + limit);

if (repos.length === 0) {
  console.error("No repositories found to seed.");
  process.exit(1);
}

if (dryRun) {
  console.log(`Dry run: would seed ${repos.length} repositories against ${apiBase}`);
  for (const repo of repos) {
    console.log(formatRepo(repo));
  }
  process.exit(0);
}

console.log(`Seeding ${repos.length} repositories against ${apiBase}`);
console.log(`concurrency=${concurrency} delayMs=${delayMs} pollMs=${pollMs} maxPolls=${maxPolls} requestRetries=${requestRetries} forceRefresh=${forceRefresh} source=${source}`);

const results = await runPool(repos, Math.max(1, concurrency), async (repo, index) => {
  if (delayMs > 0 && index > 0) await sleep(delayMs);
  return seedRepo(repo);
});

const passed = results.filter((result) => result.status === "ok");
const failed = results.filter((result) => result.status === "failed");

console.log("");
console.log(`Done: ${passed.length} ok, ${failed.length} failed`);
for (const result of failed) {
  console.log(`FAIL ${formatRepo(result.repo)}: ${result.error}`);
}

process.exit(failed.length > 0 ? 1 : 0);

async function seedRepo(repo) {
  const repoUrl = `https://github.com/${repo.owner}/${repo.name}`;
  process.stdout.write(`START ${formatRepo(repo)} ... `);
  try {
    const analyze = await postJson("/api/analyze", {
      repoUrl,
      refName: repo.refName,
      forceRefresh,
      source,
    });

    if (analyze.kind === "cached") {
      console.log(`cached ${reportUrl(analyze.report)}`);
      return { status: "ok", repo, reportId: analyze.report.id, cached: true };
    }

    if (!analyze.jobId) {
      throw new Error(`unexpected analyze response: ${JSON.stringify(analyze)}`);
    }

    const job = await waitForJob(analyze.jobId);
    if (job.status !== "completed" || !job.reportId) {
      throw new Error(job.error?.message ?? `job ${job.status}`);
    }

    const report = await getJson(`/api/reports/${encodeURIComponent(job.reportId)}`);
    console.log(`complete ${reportUrl(report)}`);
    return { status: "ok", repo, reportId: job.reportId, cached: false };
  } catch (error) {
    console.log("failed");
    return { status: "failed", repo, error: error instanceof Error ? error.message : String(error) };
  }
}

async function waitForJob(jobId) {
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const job = await getJson(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (job.status === "completed" || job.status === "failed") return job;
    await sleep(pollMs);
  }
  throw new Error(`job timed out after ${maxPolls} polls`);
}

async function postJson(path, body) {
  return requestJson(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getJson(path) {
  return requestJson(path);
}

async function requestJson(path, init) {
  let lastError;
  for (let attempt = 0; attempt <= requestRetries; attempt += 1) {
    let retryAfterMs = 0;
    try {
      const response = await fetch(`${apiBase}${path}`, init);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === requestRetries) return readJsonResponse(response);
      await response.text();
      // The API's per-IP token bucket says when the next request is admitted;
      // retrying sooner only spends another attempt on another 429.
      retryAfterMs = Number(response.headers.get("retry-after")) * 1_000 || 0;
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
      if (attempt === requestRetries) throw error;
    }

    const backoffMs = Math.min(Math.max(1_000 * (2 ** attempt), retryAfterMs), 60_000);
    console.log(`retry ${attempt + 1}/${requestRetries} for ${path} after ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    await sleep(backoffMs);
  }
  throw lastError;
}

async function readJsonResponse(response) {
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* handled below */
  }
  if (!response.ok) {
    const rawMessage = json?.message ?? json?.error?.message ?? (text || `${response.status} ${response.statusText}`);
    const message = String(rawMessage).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(message);
  }
  return json;
}

async function readRepos(file) {
  const text = await readFile(file, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, "").trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(parseRepoLine);
}

// Every repository referenced by the curated compare registry must have a
// cached report: each /compare/<slug> SSR page (and its sitemap entry) depends
// on both sides existing. data/popular-repos.txt has drifted from the registry
// before (registry entries added without re-seeding left 61 compare pages
// unindexable), so the registry is unioned in here unconditionally.
function mergeCompareRegistryRepos(repos) {
  const seen = new Set(repos.map((repo) => `${repo.owner}/${repo.name}`.toLowerCase()));
  const added = [];
  for (const entry of COMPARE_REGISTRY) {
    for (const side of [entry.left, entry.right]) {
      const key = `${side.owner}/${side.repo}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      added.push({ owner: side.owner, name: side.repo, refName: side.ref || "" });
    }
  }
  if (added.length > 0) {
    console.log(`Adding ${added.length} compare-registry repositories missing from the repo list`);
  }
  return repos.concat(added);
}

function parseRepoLine(line) {
  const [path, refName = ""] = line.split(/\s+/, 2);
  const [owner, name] = path.split("/", 2);
  if (!owner || !name) {
    throw new Error(`invalid repo line: ${line}`);
  }
  return { owner, name, refName };
}

async function runPool(items, size, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function reportUrl(report) {
  const base = `https://octocounts.com/github/${encodeURIComponent(report.repository.owner)}/${encodeURIComponent(report.repository.name)}`;
  const ref = String(report.refName || "").trim();
  if (!ref) return base;
  return `${base}/${looksLikeCommit(ref) ? "commit" : "tree"}/${encodeRefPath(ref)}`;
}

function encodeRefPath(ref) {
  return ref.trim().split("/").map(encodeURIComponent).join("/");
}

function looksLikeCommit(ref) {
  return /^[a-f0-9]{7,40}$/i.test(ref.trim());
}

function formatRepo(repo) {
  return `${repo.owner}/${repo.name}${repo.refName ? ` ${repo.refName}` : ""}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      parsed[rawKey] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      parsed[rawKey] = argv[index + 1];
      index += 1;
    } else {
      parsed[rawKey] = true;
    }
  }
  return parsed;
}

function numberArg(value, fallback) {
  if (value === undefined || value === true) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function printHelp() {
  console.log(`Usage: node scripts/seed-popular-repos.mjs [options]

Options:
  --dry-run                 Print planned repositories without network calls
  --api-base <url>          API base URL (default: ${DEFAULT_API_BASE})
  --file <path>             Repo list file (default: data/popular-repos.txt)
  --limit <n>               Maximum repos per batch (default: all)
  --batch <n>               Zero-based rotating batch, wraps after the inventory (default: 0)
  --concurrency <n>         Concurrent analyze jobs (default: 2)
  --delay-ms <n>            Delay before each started repo after the first (default: 500)
  --poll-ms <n>             Job polling interval (default: 2500)
  --max-polls <n>           Max polls per job (default: 120)
  --request-retries <n>     Retries for network, 429, and 5xx errors, honoring Retry-After (default: 10)
  --force-refresh           Bypass cached report lookup
  --source <name>           Analysis source label (default: seed)
`);
}
