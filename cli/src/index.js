#!/usr/bin/env node

import { analyzeAndWait, reportUrl, repositoryOptions } from "./api.js";

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h || (!args._[0] && !args.sample)) {
  printHelp();
  process.exit(args.help || args.h ? 0 : 1);
}

if (args["respect-gitattributes"] !== undefined && ![true, "true", "false"].includes(args["respect-gitattributes"])) {
  console.error("--respect-gitattributes must be true or false");
  process.exit(1);
}

const report = args.sample
  ? sampleReport()
  : await analyzeAndWait(trimTrailingSlash(args["api-base"] || process.env.OCTOCOUNTS_API_BASE || "https://api.octocounts.com"), {
      source: "cli",
      forceRefresh: false,
      options: repositoryOptions(args["respect-gitattributes"] === undefined ? undefined : args["respect-gitattributes"] === true || args["respect-gitattributes"] === "true"),
      repoUrl: normalizeRepoInput(args._[0]),
      refName: args.ref || "",
    }).catch((error) => { console.error(error.message); process.exit(1); });

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
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
  console.log(`Counting policy: ${report.countingPolicy ? JSON.stringify(report.countingPolicy) : "historical policy not recorded"}`);
  console.log(url);
  console.log("Install the browser extension: https://octocounts.com/");
}

function normalizeRepoInput(input) {
  const value = String(input || "").trim();
  if (/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(value)) return value;
  if (/^[^/]+\/[^/]+$/.test(value)) return `https://github.com/${value}`;
  throw new Error(`Expected owner/repo or https://github.com/owner/repo, got: ${value}`);
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
    } else if (["respect-gitattributes", "json", "sample", "help"].includes(key)) {
      parsed[key] = true;
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

function sampleReport() {
  return {
    commitSha: "0123456789abcdef",
    refName: "main",
    repository: { owner: "huanglizhuo", name: "OctoCounts" },
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
  --respect-gitattributes  Apply repository generated/vendored declarations
  --json             Print raw report JSON
  --api-base <url>   OctoCounts API base URL
  --sample           Print a local sample report without network calls
  --help             Show this help
`);
}
