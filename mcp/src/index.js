#!/usr/bin/env node

const apiBase = trimTrailingSlash(process.env.OCTOCOUNTS_API_BASE || "https://api.octocounts.com");
let inputBuffer = Buffer.alloc(0);
let isDraining = false;

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  void drainMessages();
});
process.stdin.on("end", () => process.exit(0));

process.stdin.resume();

async function drainMessages() {
  if (isDraining) return;
  isDraining = true;
  try {
    while (true) {
      const headerEnd = inputBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = inputBuffer.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        inputBuffer = Buffer.alloc(0);
        return;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (inputBuffer.length < bodyEnd) return;
      const body = inputBuffer.slice(bodyStart, bodyEnd).toString("utf8");
      inputBuffer = inputBuffer.slice(bodyEnd);
      await handleMessage(JSON.parse(body));
    }
  } finally {
    isDraining = false;
    if (inputBuffer.indexOf("\r\n\r\n") !== -1) {
      void drainMessages();
    }
  }
}

async function handleMessage(message) {
  if (message.id === undefined) return;
  try {
    const result = await dispatch(message);
    writeMessage({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function dispatch(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "octocounts-mcp", version: "0.1.0" },
    };
  }

  if (message.method === "tools/list") {
    return { tools: toolDefinitions() };
  }

  if (message.method === "tools/call") {
    const { name, arguments: args = {} } = message.params || {};
    if (name === "analyze_repo") {
      const report = await analyzeAndWait({
        repoUrl: normalizeRepoInput(args.repo_url),
        refName: args.ref ?? "",
      });
      return toolResult(summarizeReport(report), { report, report_url: reportUrl(report) });
    }
    if (name === "compare_repos") {
      const [left, right] = await Promise.all([
        analyzeAndWait({ repoUrl: normalizeRepoInput(args.left_repo_url), refName: args.left_ref ?? "" }),
        analyzeAndWait({ repoUrl: normalizeRepoInput(args.right_repo_url), refName: args.right_ref ?? "" }),
      ]);
      return toolResult(summarizeComparison(left, right), {
        left_report: left,
        right_report: right,
        left_report_url: reportUrl(left),
        right_report_url: reportUrl(right),
      });
    }
    throw new Error(`Unknown tool: ${name}`);
  }

  throw new Error(`Unsupported method: ${message.method}`);
}

function toolDefinitions() {
  return [
    {
      name: "analyze_repo",
      description: "Analyze a public GitHub repository with OctoCounts and return SLOC totals.",
      inputSchema: {
        type: "object",
        properties: {
          repo_url: { type: "string", description: "GitHub URL or owner/repo." },
          ref: { type: "string", description: "Optional branch, tag, or commit SHA." },
        },
        required: ["repo_url"],
      },
    },
    {
      name: "compare_repos",
      description: "Compare SLOC totals between two public GitHub repositories or refs.",
      inputSchema: {
        type: "object",
        properties: {
          left_repo_url: { type: "string", description: "Left GitHub URL or owner/repo." },
          right_repo_url: { type: "string", description: "Right GitHub URL or owner/repo." },
          left_ref: { type: "string", description: "Optional left branch, tag, or commit SHA." },
          right_ref: { type: "string", description: "Optional right branch, tag, or commit SHA." },
        },
        required: ["left_repo_url", "right_repo_url"],
      },
    },
  ];
}

async function analyzeAndWait({ repoUrl, refName }) {
  const result = await postJson("/api/analyze", { repoUrl, refName, forceRefresh: false });
  if (result.kind === "cached") return result.report;
  if (!result.jobId) throw new Error(`Unexpected analyze response: ${JSON.stringify(result)}`);

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const job = await getJson(`/api/jobs/${encodeURIComponent(result.jobId)}`);
    if (job.status === "completed" && job.reportId) {
      return getJson(`/api/reports/${encodeURIComponent(job.reportId)}`);
    }
    if (job.status === "failed") {
      throw new Error(job.error?.message ?? "OctoCounts analysis failed");
    }
    await sleep(2500);
  }
  throw new Error(`Timed out waiting for OctoCounts job ${result.jobId}`);
}

function summarizeReport(report) {
  const top = [...report.languages].sort((a, b) => b.stats.code - a.stats.code).slice(0, 5);
  return [
    `${report.repository.owner}/${report.repository.name} @ ${report.commitSha.slice(0, 12)}`,
    `${formatNumber(report.total.code)} code lines, ${formatNumber(report.total.lines)} total lines, ${formatNumber(report.total.files)} files.`,
    `Top languages: ${top.map((language) => `${language.name} ${formatNumber(language.stats.code)}`).join(", ")}.`,
    `Report: ${reportUrl(report)}`,
  ].join("\n");
}

function summarizeComparison(left, right) {
  const delta = right.total.code - left.total.code;
  return [
    `${left.repository.owner}/${left.repository.name} -> ${right.repository.owner}/${right.repository.name}`,
    `Code lines: ${formatNumber(left.total.code)} -> ${formatNumber(right.total.code)} (${formatSigned(delta)}).`,
    `Files: ${formatNumber(left.total.files)} -> ${formatNumber(right.total.files)} (${formatSigned(right.total.files - left.total.files)}).`,
    `Left: ${reportUrl(left)}`,
    `Right: ${reportUrl(right)}`,
  ].join("\n");
}

function toolResult(text, structuredContent) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}

async function postJson(path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJsonResponse(response);
}

async function getJson(path) {
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

function writeMessage(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
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

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatSigned(value) {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "-"}${formatNumber(Math.abs(value))}`;
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
