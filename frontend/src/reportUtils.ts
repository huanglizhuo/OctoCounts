import i18n from "./i18n";
import type { AppStatus, LanguageReport, Report, SortKey, TickerRow } from "./types";

export const statusCopy: Record<AppStatus, string> = {
  idle: i18n.t("runner.status.idle"),
  queued: i18n.t("runner.status.queued"),
  running: i18n.t("runner.status.running"),
  completed: i18n.t("runner.status.completed"),
  cached: i18n.t("runner.status.cached"),
  failed: i18n.t("runner.status.failed"),
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
  if (status === "failed") return [{ ts: "00:00", kind: "err", text: error ?? i18n.t("runner.status.failed") }];
  if (status === "idle") return [{ ts: "00:00", kind: "", text: i18n.t("runner.log.idle") }];
  if (status === "queued")
    return [
      { ts: "00:01", kind: "warn", text: i18n.t("runner.log.queuedWaiting") },
      { ts: "00:02", kind: "", text: i18n.t("runner.log.refAccepted") },
    ];
  if (status === "running")
    return [
      { ts: "00:01", kind: "ok", text: i18n.t("runner.log.refResolved") },
      { ts: "00:02", kind: "", text: i18n.t("runner.log.archiveDownloading") },
      { ts: "00:03", kind: "", text: i18n.t("runner.log.tokeiRunning") },
    ];
  if (report)
    return [
      {
        ts: "00:01",
        kind: "ok",
        text: i18n.t("runner.log.resolvedRef", { ref: report.refName, sha: report.commitSha.slice(0, 12) }),
      },
      {
        ts: "00:02",
        kind: "ok",
        text: report.cached ? i18n.t("runner.log.cacheHit") : i18n.t("runner.log.freshReport"),
      },
      {
        ts: "00:03",
        kind: "ok",
        text: i18n.t("runner.log.languageRows", { count: formatNumber(report.languages.length) }),
      },
    ];
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
  const lines = [
    `${report.repository.owner}/${report.repository.name} ${report.commitSha.slice(0, 12)}`,
    `${i18n.t("textReport.language").padEnd(14)} ${i18n.t("textReport.files").padStart(6)} ${i18n.t("textReport.lines").padStart(10)} ${i18n.t("textReport.code").padStart(10)} ${i18n.t("textReport.comments").padStart(10)} ${i18n.t("textReport.blanks").padStart(10)}`,
  ];
  for (const row of report.languages) {
    lines.push(
      `${row.name.padEnd(14)} ${String(row.stats.files).padStart(6)} ${String(row.stats.lines).padStart(10)} ${String(row.stats.code).padStart(10)} ${String(row.stats.comments).padStart(10)} ${String(row.stats.blanks).padStart(10)}`
    );
  }
  const totalLabel = i18n.t("textReport.total");
  lines.push(
    `${totalLabel.padEnd(14)} ${String(report.total.files).padStart(6)} ${String(report.total.lines).padStart(10)} ${String(report.total.code).padStart(10)} ${String(report.total.comments).padStart(10)} ${String(report.total.blanks).padStart(10)}`
  );
  return lines.join("\n");
}

export function commandText(repoUrl: string, refName: string, forceRefresh: boolean) {
  return i18n.t("runner.command", {
    repo: repoUrl.trim() || "<repo>",
    ref: refName.trim() ? ` --ref ${refName.trim()}` : "",
    force: forceRefresh ? " --force" : "",
  });
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
  const pct = (value / total) * 100;
  if (pct < 0.1) return "<0.1%";
  const fixed = pct.toFixed(1);
  return fixed.endsWith(".0") ? `${Math.round(pct)}%` : `${fixed}%`;
}
