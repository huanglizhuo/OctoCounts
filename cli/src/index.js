#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h || (!args._[0] && !args.sample)) {
  printHelp();
  process.exit(args.help || args.h ? 0 : 1);
}

const report = args.sample
  ? sampleReport()
  : await analyzeAndWait({
      apiBase: trimTrailingSlash(args["api-base"] || process.env.OCTOCOUNTS_API_BASE || "https://api.octocounts.com"),
      repoUrl: normalizeRepoInput(args._[0]),
      refName: args.ref || "",
    });

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
}

async function analyzeAndWait({ apiBase, repoUrl, refName }) {
  const result = await postJson(apiBase, "/api/analyze", { repoUrl, refName, forceRefresh: false });
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

function printReport(report) {
  const total = report.total;
  const rows = [...report.languages].sort((a, b) => b.stats.code - a.stats.code).slice(0, 12);
  const url = reportUrl(report);

  console.log(`${report.repository.owner}/${report.repository.name} @ ${report.commitSha.slice(0, 12)}`);
  console.log(`${formatNumber(total.code)} code lines / ${formatNumber(total.lines)} total lines / ${formatNumber(total.files)} files`);
  console.log("");
  console.log(`${pad("Language", 18)} ${padLeft("Files", 8)} ${padLeft("Code", 12)} ${padLeft("Lines", 12)} ${padLeft("Comments", 10)}`);
  console.log(`${"-".repeat(18)} ${"-".repeat(8)} ${"-".repeat(12)} ${"-".repeat(12)} ${"-".repeat(10)}`);
  for (const language of rows) {
    console.log(`${pad(language.name, 18)} ${padLeft(formatNumber(language.stats.files), 8)} ${padLeft(formatNumber(language.stats.code), 12)} ${padLeft(formatNumber(language.stats.lines), 12)} ${padLeft(formatNumber(language.stats.comments), 10)}`);
  }
  console.log("");
  console.log(url);
  console.log("Install the browser extension: https://octocounts.com/");
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

async function readJsonResponse(response) {
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(json?.message ?? (text || `${response.status} ${response.statusText}`));
  }
  return json;
}

function normalizeRepoInput(input) {
  const value = String(input || "").trim();
  if (/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(value)) return value;
  if (/^[^/]+\/[^/]+$/.test(value)) return `https://github.com/${value}`;
  throw new Error(`Expected owner/repo or https://github.com/owner/repo, got: ${value}`);
}

function reportUrl(report) {
  const base = `https://octocounts.com/github/${encodeURIComponent(report.repository.owner)}/${encodeURIComponent(report.repository.name)}`;
  const ref = String(report.refName || report.commitSha || "").trim();
  if (!ref) return base;
  return `${base}/${looksLikeCommit(ref) ? "commit" : "tree"}/${encodeRefPath(ref)}`;
}

function encodeRefPath(ref) {
  return ref.trim().split("/").map(encodeURIComponent).join("/");
}

function looksLikeCommit(ref) {
  return /^[a-f0-9]{7,40}$/i.test(ref.trim());
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      parsed[key] = argv[index + 1];
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text.slice(0, width) : text.padEnd(width, " ");
}

function padLeft(value, width) {
  const text = String(value);
  return text.length >= width ? text : text.padStart(width, " ");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sampleReport() {
  return {
    commitSha: "0123456789abcdef",
    refName: "main",
    repository: { owner: "huanglizhuo", name: "OctoCount" },
    total: { files: 88, lines: 24567, code: 18120, comments: 3021, blanks: 3426 },
    languages: [
      { name: "TypeScript", stats: { files: 42, lines: 12600, code: 9400, comments: 1300 } },
      { name: "Rust", stats: { files: 18, lines: 7200, code: 5600, comments: 870 } },
      { name: "JavaScript", stats: { files: 28, lines: 4767, code: 3120, comments: 851 } },
    ],
  };
}

function printHelp() {
  console.log(`Usage: octocounts <owner/repo|github-url> [options]

Options:
  --ref <ref>        Branch, tag, or commit SHA
  --json             Print raw report JSON
  --api-base <url>   OctoCounts API base URL
  --sample           Print a local sample report without network calls
  --help             Show this help
`);
}
