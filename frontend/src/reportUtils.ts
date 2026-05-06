import type { AppStatus, LanguageReport, Report, SortKey, TickerRow } from "./types";

export const statusCopy: Record<AppStatus, string> = {
  idle: "Paste a repository URL and run the analyzer.",
  queued: "Job accepted. Waiting for an analysis slot.",
  running: "Downloading archive, extracting files, and counting language statistics.",
  completed: "Analysis completed.",
  cached: "Served from commit-level cache.",
  failed: "Analysis failed.",
};

export function tickerRows(report: Report): TickerRow[] {
  const rows = report.languages.filter((language) => language.stats.code > 0).slice(0, 6);
  const max = Math.max(...rows.map((row) => row.stats.code), 1);
  return rows.map((row) => ({
    label: row.name,
    value: row.stats.code,
    color: languageColor(row.name),
    percent: Math.max(4, Math.round((row.stats.code / max) * 100)),
  }));
}

export function logLines(status: AppStatus, report: Report | null, error: string | null) {
  if (status === "failed") return [{ ts: "00:00", kind: "err", text: error ?? "analysis failed" }];
  if (status === "idle") return [{ ts: "00:00", kind: "", text: "idle: command runner ready" }];
  if (status === "queued") return [{ ts: "00:01", kind: "warn", text: "queued: waiting for worker permit" }, { ts: "00:02", kind: "", text: "repository ref accepted" }];
  if (status === "running") return [{ ts: "00:01", kind: "ok", text: "ref resolved" }, { ts: "00:02", kind: "", text: "archive download in progress" }, { ts: "00:03", kind: "", text: "tokei counter running" }];
  if (report) return [{ ts: "00:01", kind: "ok", text: `resolved ${report.refName} -> ${report.commitSha.slice(0, 12)}` }, { ts: "00:02", kind: "ok", text: report.cached ? "cache hit returned" : "fresh report saved to cache" }, { ts: "00:03", kind: "ok", text: `${formatNumber(report.languages.length)} language rows rendered` }];
  return [];
}

export function progressValue(status: AppStatus) {
  if (status === "idle") return 0;
  if (status === "queued") return 30;
  if (status === "running") return 64;
  if (status === "failed") return 100;
  return 100;
}

export function sortRows(rows: LanguageReport[], key: SortKey, dir: "asc" | "desc") {
  return [...rows].sort((a, b) => {
    const left = key === "name" ? a.name : a.stats[key];
    const right = key === "name" ? b.name : b.stats[key];
    const result = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left) - Number(right);
    return dir === "asc" ? result : -result;
  });
}

export function languageColor(name: string) {
  const colors = ["var(--accent)", "var(--accent-2)", "var(--warn)", "var(--blue)", "var(--violet)", "var(--err)"];
  const hash = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

export function textReport(report: Report) {
  const lines = [`${report.repository.owner}/${report.repository.name} ${report.commitSha.slice(0, 12)}`, "Language        Files      Lines       Code   Comments     Blanks"];
  for (const row of report.languages) {
    lines.push(`${row.name.padEnd(14)} ${String(row.stats.files).padStart(6)} ${String(row.stats.lines).padStart(10)} ${String(row.stats.code).padStart(10)} ${String(row.stats.comments).padStart(10)} ${String(row.stats.blanks).padStart(10)}`);
  }
  lines.push(`${"Total".padEnd(14)} ${String(report.total.files).padStart(6)} ${String(report.total.lines).padStart(10)} ${String(report.total.code).padStart(10)} ${String(report.total.comments).padStart(10)} ${String(report.total.blanks).padStart(10)}`);
  return lines.join("\n");
}

export function commandText(repoUrl: string, refName: string, forceRefresh: boolean) {
  return `octocount analyze ${repoUrl.trim() || "<repo>"}${refName.trim() ? ` --ref ${refName.trim()}` : ""}${forceRefresh ? " --force" : ""}`;
}

export function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

export function formatCompactNumber(value: number) {
  if (value <= 99_999) return formatNumber(value);
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value: number, total: number) {
  if (total === 0) return "0%";
  return `${percentNumber(value, total)}%`;
}

function percentNumber(value: number, total: number) {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}
