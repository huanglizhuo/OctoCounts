import i18n from "./i18n";
import type { AppStatus, LanguageReport, Report, SortKey, TickerRow } from "./types";
export { visibleLanguageColor } from "./colorContrast";

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

export function logLines(status: AppStatus, report: Report | null, error: string | null, elapsedSec = 0) {
  if (status === "failed") return [{ ts: "00:00", kind: "err", text: error ?? i18n.t("runner.status.failed") }];
  if (status === "idle") return [{ ts: "00:00", kind: "", text: i18n.t("runner.log.idle") }];
  if (status === "queued") {
    const lines = [
      { ts: "00:01", kind: "warn", text: i18n.t("runner.log.queuedWaiting") },
      { ts: "00:02", kind: "", text: i18n.t("runner.log.refAccepted") },
    ];
    if (elapsedSec >= 8) lines.push({ ts: logTs(elapsedSec), kind: "warn", text: i18n.t("runner.log.stillQueued") });
    return lines;
  }
  if (status === "running") {
    const lines = [
      { ts: "00:01", kind: "ok", text: i18n.t("runner.log.refResolved") },
      { ts: "00:02", kind: "", text: i18n.t("runner.log.archiveDownloading") },
    ];
    if (elapsedSec >= 5) lines.push({ ts: "00:05", kind: "", text: i18n.t("runner.log.archiveExtracting") });
    lines.push({ ts: elapsedSec >= 5 ? "00:06" : "00:03", kind: "", text: i18n.t("runner.log.tokeiRunning") });
    if (elapsedSec >= 20) lines.push({ ts: logTs(elapsedSec), kind: "warn", text: i18n.t("runner.log.stillCounting") });
    return lines;
  }
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
      {
        ts: "00:04",
        kind: "ok",
        text: i18n.t("runner.log.counted", { lines: formatNumber(report.total.lines), duration: report.durationMs }),
      },
    ];
  return [];
}

function logTs(elapsedSec: number) {
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function progressValue(status: AppStatus) {
  if (status === "idle") return 0;
  if (status === "queued") return 30;
  if (status === "running") return 64;
  if (status === "failed") return 100;
  return 100;
}

export function normalizedProvider(report: Report): "github" | "gitlab" {
  const provider = report.repository.provider;
  if (provider === "gitlab" || provider === "gitLab") return "gitlab";
  if (provider === "github" || provider === "gitHub") return "github";
  return report.repository.htmlUrl.includes("gitlab.com/") ? "gitlab" : "github";
}

export function sortRows(rows: LanguageReport[], key: SortKey, dir: "asc" | "desc") {
  return [...rows].sort((a, b) => {
    const left = key === "name" ? a.name : a.stats[key];
    const right = key === "name" ? b.name : b.stats[key];
    const result = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left) - Number(right);
    return dir === "asc" ? result : -result;
  });
}

const LANGUAGE_COLORS: Record<string, string> = {
  rust: "#CE422B",
  python: "#3572A5",
  javascript: "#F1E05A",
  typescript: "#3178C6",
  go: "#00ADD8",
  ruby: "#701516",
  java: "#B07219",
  c: "#555555",
  "c++": "#F34B7D",
  "c#": "#239120",
  swift: "#F05138",
  kotlin: "#7F52FF",
  scala: "#DC322F",
  php: "#4F5D95",
  html: "#E34C26",
  css: "#563D7C",
  shell: "#89E051",
  r: "#198CE7",
  dart: "#00B4AB",
  lua: "#000080",
  haskell: "#5E5086",
  elixir: "#6E4A7E",
  clojure: "#DB5855",
  perl: "#0298C3",
  vue: "#41B883",
  svelte: "#FF3E00",
  zig: "#EC915C",
  nix: "#7E7EFF",
  ocaml: "#3BE133",
  groovy: "#4298B8",
  powershell: "#012456",
  makefile: "#427819",
  dockerfile: "#384D54",
  json: "#292929",
  yaml: "#CB171E",
  toml: "#9C4221",
  markdown: "#083FA1",
  tex: "#3D6117",
};

const FALLBACK_COLORS = ["#3fb950", "#58a6ff", "#d29922", "#79c0ff", "#d2a8ff", "#f85149"];

export function languageColor(name: string): string {
  const canonical = LANGUAGE_COLORS[name.toLowerCase()];
  if (canonical) return canonical;
  const hash = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
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
  const write = navigator.clipboard?.writeText(value);
  if (write) {
    void write.catch(() => fallbackCopyText(value));
    return;
  }
  fallbackCopyText(value);
}

function fallbackCopyText(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } catch {
    /* Copy is best-effort; UI still keeps the user on the page. */
  } finally {
    textarea.remove();
  }
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
