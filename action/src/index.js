#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { buildComment, COMMENT_MARKER } from "./comment.js";

if (process.argv.includes("--sample-comment")) {
  console.log(buildComment(samplePayload()));
  process.exit(0);
}

const event = await readGitHubEvent();
const repo = input("repo") || envRepo(event);
const baseRef = input("base-ref") || event?.pull_request?.base?.sha || process.env.GITHUB_BASE_REF;
const headRef = input("head-ref") || event?.pull_request?.head?.sha || process.env.GITHUB_SHA;
const apiBase = trimTrailingSlash(input("api-base") || "https://api.octocounts.com");
const shouldComment = input("comment") !== "false";
const token = input("github-token");

if (!repo || !baseRef || !headRef) {
  fail("Missing repo/base-ref/head-ref. Run on pull_request or provide inputs explicitly.");
}

const [owner, name] = repo.split("/", 2);
if (!owner || !name) {
  fail(`Invalid repo input: ${repo}`);
}

const repoUrl = `https://github.com/${owner}/${name}`;
const [baseReport, headReport] = await Promise.all([
  analyzeAndWait({ apiBase, repoUrl, refName: baseRef }),
  analyzeAndWait({ apiBase, repoUrl, refName: headRef }),
]);

const body = buildComment({ repo, baseRef, headRef, baseReport, headReport });
console.log(body);

if (shouldComment) {
  if (!token) fail("github-token is required when comment=true.");
  const issueNumber = event?.pull_request?.number;
  if (!issueNumber) fail("No pull_request number found for comment upsert.");
  await upsertComment({ token, owner, repo: name, issueNumber, body });
}

async function analyzeAndWait({ apiBase, repoUrl, refName }) {
  const result = await postJson(apiBase, "/api/analyze", { repoUrl, refName, forceRefresh: false, source: "github_action" });
  if (result.kind === "cached") return result.report;
  if (!result.jobId) throw new Error(`Unexpected analyze response: ${JSON.stringify(result)}`);

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const job = await getJson(apiBase, `/api/jobs/${encodeURIComponent(result.jobId)}`);
    if (job.status === "completed" && job.reportId) {
      return getJson(apiBase, `/api/reports/${encodeURIComponent(job.reportId)}`);
    }
    if (job.status === "failed") {
      throw new Error(job.error?.message ?? "OctoCounts analysis failed");
    }
    await sleep(2500);
  }
  throw new Error(`Timed out waiting for OctoCounts job ${result.jobId}`);
}

async function upsertComment({ token, owner, repo, issueNumber, body }) {
  const comments = await githubJson(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`);
  const existing = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));
  if (existing) {
    await githubJson(token, `/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
      method: "PATCH",
      body: { body },
    });
    console.log(`Updated OctoCounts comment ${existing.id}`);
    return;
  }
  const created = await githubJson(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: { body },
  });
  console.log(`Created OctoCounts comment ${created.id}`);
}

async function postJson(apiBase, path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJsonResponse(response);
}

async function getJson(apiBase, path) {
  const response = await fetch(`${apiBase}${path}`);
  return readJsonResponse(response);
}

async function githubJson(token, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return readJsonResponse(response);
}

async function readJsonResponse(response) {
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(json?.message ?? (text || `${response.status} ${response.statusText}`));
  }
  return json;
}

async function readGitHubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;
  return JSON.parse(await readFile(eventPath, "utf8"));
}

function input(name) {
  return process.env[`INPUT_${name.toUpperCase()}`] ?? process.env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`] ?? "";
}

function envRepo(event) {
  return process.env.GITHUB_REPOSITORY || event?.repository?.full_name || "";
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function samplePayload() {
  const baseReport = sampleReport({ code: 12000, lines: 15000, files: 120, comments: 1800, blanks: 1200, rust: 9000, ts: 3000, sha: "111111111111" });
  const headReport = sampleReport({ code: 13250, lines: 16420, files: 132, comments: 1900, blanks: 1270, rust: 9800, ts: 3450, sha: "222222222222" });
  return {
    repo: "huanglizhuo/OctoCount",
    baseRef: "1111111111111111111111111111111111111111",
    headRef: "2222222222222222222222222222222222222222",
    baseReport,
    headReport,
  };
}

function sampleReport({ code, lines, files, comments, blanks, rust, ts, sha }) {
  return {
    commitSha: sha,
    refName: sha,
    repository: { owner: "huanglizhuo", name: "OctoCount" },
    total: { code, lines, files, comments, blanks },
    languages: [
      { name: "Rust", stats: { code: rust } },
      { name: "TypeScript", stats: { code: ts } },
    ],
  };
}
