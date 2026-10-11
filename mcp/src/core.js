import { analyzeAndWait, reportUrl, repositoryOptions, policyCompatibility } from "./api.js";

const apiBase = trimTrailingSlash(process.env.OCTOCOUNTS_API_BASE || "https://api.octocounts.com");

const SERVER_INFO = { name: "octocounts-mcp", version: "0.2.0" };

async function dispatch(message, signal) {
  if (message.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    };
  }

  if (message.method === "tools/list") {
    return { tools: toolDefinitions() };
  }

  if (message.method === "tools/call") {
    const { name, arguments: args = {} } = message.params || {};
    if (name === "analyze_repo") {
      const report = await analyzeAndWait(apiBase, {
        options: repositoryOptions(args.respect_gitattributes), forceRefresh: false, source: "mcp",
        repoUrl: normalizeRepoInput(args.repo_url),
        refName: args.ref ?? "",
      }, { signal });
      return toolResult(summarizeReport(report), { report, report_url: reportUrl(report) });
    }
    if (name === "compare_repos") {
      const [left, right] = await Promise.all([
        analyzeAndWait(apiBase, { repoUrl: normalizeRepoInput(args.left_repo_url), refName: args.left_ref ?? "", forceRefresh: false, source: "mcp", options: repositoryOptions(args.respect_gitattributes) }, { signal }),
        analyzeAndWait(apiBase, { repoUrl: normalizeRepoInput(args.right_repo_url), refName: args.right_ref ?? "", forceRefresh: false, source: "mcp", options: repositoryOptions(args.respect_gitattributes) }, { signal }),
      ]);
      return toolResult(summarizeComparison(left, right), {
        counting_policy_compatibility: policyCompatibility(left, right),
        left_report: left,
        right_report: right,
        left_report_url: reportUrl(left),
        right_report_url: reportUrl(right),
      });
    }
    throw new Error(`Unknown tool: ${name}`);
  }

  if (message.method === "ping") {
    return {};
  }

  throw new Error(`Unsupported method: ${message.method}`);
}

// Returns a JSON-RPC response object for requests, or null for notifications.
async function handleRequest(message, { signal } = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.method !== "string") {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } };
  }
  if (message.id === undefined) {
    return null;
  }
  try {
    const result = await dispatch(message, signal);
    return { jsonrpc: "2.0", id: message.id, result };
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
        ...(error.status !== undefined || error.jobId ? { data: { status: error.status, code: error.code, retryAfterMs: error.retryAfterMs, jobId: error.jobId } } : {}),
      },
    };
  }
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
          respect_gitattributes: { type: "boolean", description: "Apply generated/vendored repository declarations. Defaults off; keeps the existing public default profile." },
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
          respect_gitattributes: { type: "boolean", description: "Apply the same declaration-filter setting to both repositories. Defaults off." },
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

function summarizeReport(report) {
  const top = [...report.languages].sort((a, b) => b.stats.code - a.stats.code).slice(0, 5);
  return [
    `${report.repository.owner}/${report.repository.name} @ ${report.commitSha.slice(0, 12)}`,
    `${formatNumber(report.total.code)} code lines, ${formatNumber(report.total.lines)} total lines, ${formatNumber(report.total.files)} files.`,
    `Top languages: ${top.map((language) => `${language.name} ${formatNumber(language.stats.code)}`).join(", ")}.`,
    `Counting policy: ${report.countingPolicy ? JSON.stringify(report.countingPolicy) : "historical policy not recorded"}`,
    `Report: ${reportUrl(report)}`,
  ].join("\n");
}

function summarizeComparison(left, right) {
  const delta = right.total.code - left.total.code;
  return [
    `${left.repository.owner}/${left.repository.name} -> ${right.repository.owner}/${right.repository.name}`,
    `Code lines: ${formatNumber(left.total.code)} -> ${formatNumber(right.total.code)} (${formatSigned(delta)}).`,
    `Files: ${formatNumber(left.total.files)} -> ${formatNumber(right.total.files)} (${formatSigned(right.total.files - left.total.files)}).`,
    `Counting policy compatibility: ${policyCompatibility(left, right)}. Repository declarations apply separately.`,
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

function normalizeRepoInput(input) {
  const value = String(input || "").trim();
  if (/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(value)) return value;
  if (/^[^/]+\/[^/]+$/.test(value)) return `https://github.com/${value}`;
  throw new Error(`Expected owner/repo or https://github.com/owner/repo, got: ${value}`);
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

export {
  SERVER_INFO,
  handleRequest,
  toolDefinitions,
  normalizeRepoInput,
  reportUrl,
};
