// Report-page runner, restructured from the flat sibling stack in main.tsx.
// Section order: runner head (repo + scale tag + ref/sha/relative time),
// Summary, Charts, code-lines history, Share & embed, Similar repositories,
// and a collapsed Technical details disclosure (speed/result readouts, trust
// details, run timing, raw exports, re-run).
import React, { Suspense, useEffect, useRef, useState } from "react";
import { ArrowUp, Clipboard, ExternalLink, FileJson, RotateCcw, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { fetchJson } from "../api";
import { AnalyticsEvents, trackEvent } from "../analytics";
import { buildBadgeUrl, buildEmbedSnippet, buildEmbedUrl } from "../badges";
import { isHostDegraded, useGithubStatus } from "../githubStatus";
import { copyText, downloadDataUrl, formatNumber, formatRelativeTime, logLines, normalizedProvider, progressValue, textReport } from "../reportUtils";
import type { AppStatus, Report } from "../types";
import { Charts } from "./Charts";
import { Insights, projectScale } from "./Insights";
import { ShareSection } from "./Share";
import { SimilarRepos } from "./SimilarRepos";
import { StarBadge, buildSnapshotReportUrl, useCopied } from "./shared";
import { Summary } from "./Summary";
import { TrustDetails } from "./TrustDetails";

// The history chart only renders after a report completes, and it drags its
// own export helpers; keep it out of the critical bundle.
const RepoHistoryChart = React.lazy(() => import("../RepoHistoryChart").then((m) => ({ default: m.RepoHistoryChart })));

// A commit sha is by definition a pinned observation even when the host did
// not say so (e.g. a sha typed into the homepage ref box); anything else
// (branch/tag) merges into the history series unless the URL pinned it.
function isCommitRef(refName: string) {
  return /^[0-9a-f]{7,40}$/i.test(refName);
}

export function Runner({ command, status, report, error, errorCode, onReset, onRerun, variant = "full", isPinnedRef = false }: { command: string; status: AppStatus; report: Report | null; error: string | null; errorCode?: string; onReset: () => void; onRerun: () => void; variant?: "demo" | "full"; isPinnedRef?: boolean }) {
  const { t, i18n } = useTranslation();
  const shareCardRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const { copiedKey: copiedCta, showCopied: showCopiedCta } = useCopied();

  // A demo Runner presents a trimmed, read-only view of a seeded report. The
  // moment the visitor actually starts an analysis (or one fails) it must
  // behave like the full runner again: every run passes through
  // queued/running before a new report lands, while a seeded report arrives
  // already completed/cached — so that status transition is the switch and
  // it never flips on the seed itself.
  const [demoDismissed, setDemoDismissed] = useState(false);
  useEffect(() => {
    if (variant !== "demo" || demoDismissed) return;
    if (status === "queued" || status === "running" || status === "failed") setDemoDismissed(true);
  }, [variant, status, demoDismissed]);
  const isDemo = variant === "demo" && !demoDismissed;

  const isWorking = status === "queued" || status === "running";
  // The report body carries the star snapshot from analysis time; a cached
  // report can be months old, so the share card refreshes through the server
  // (which holds the GitHub token and a short cache) before rendering. On any
  // failure it silently falls back to the snapshot, and to no badge at all
  // when neither is present.
  const [liveStars, setLiveStars] = useState<number | null>(null);
  useEffect(() => {
    setLiveStars(null);
    if (!report) return;
    const controller = new AbortController();
    // 800ms was too tight from a cold browser: DNS + TLS + the Cloudflare
    // edge/tunnel path plus a cold GitHub fetch measured 0.8-1.4s end to end,
    // so the refresh aborted and the badge fell back to (often absent)
    // snapshots. The fetch is non-blocking; the share export happens well
    // after load, so a generous budget costs nothing.
    const timeout = window.setTimeout(() => controller.abort(), 2500);
    const query = `owner=${encodeURIComponent(report.repository.owner)}&repo=${encodeURIComponent(report.repository.name)}`;
    fetchJson<{ stars: number | null }>(`/api/repo-info?${query}`, { signal: controller.signal })
      .then((payload) => { if (typeof payload.stars === "number") setLiveStars(payload.stars); })
      .catch(() => {});
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [report]);
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!isWorking) {
      setElapsedSec(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [isWorking]);

  const headRef = useRef<HTMLDivElement>(null);
  const [showSticky, setShowSticky] = useState(false);
  useEffect(() => {
    const head = headRef.current;
    if (!head || typeof IntersectionObserver === "undefined") return;
    const update = () => setShowSticky(head.getBoundingClientRect().bottom < 0);
    const observer = new IntersectionObserver(update);
    observer.observe(head);
    // IO fires only on viewport crossings, so an instant jump that skips the
    // viewport (reduced-motion "back to top", Home key) never re-triggers it.
    // scrollend recomputes the final position; unsupported browsers just no-op.
    document.addEventListener("scrollend", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("scrollend", update);
    };
  }, []);

  const exportPng = async () => {
    if (!report || !shareCardRef.current) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(shareCardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        width: 1200,
        height: 630,
        backgroundColor: "#050a06",
        style: { transform: "none", transformOrigin: "top left" },
      });
      downloadDataUrl(dataUrl, `octocount-${report.repository.owner}-${report.repository.name}-${report.commitSha.slice(0, 12)}.png`);
      trackEvent(AnalyticsEvents.pngExported, { provider: normalizedProvider(report) });
    } catch {
      setExportError(t("runner.exportPngFailed"));
    } finally {
      setIsExporting(false);
    }
  };

  const fullTimestamp = report ? new Date(report.generatedAt).toLocaleString(i18n.language) : "";

  return (
    <div className="runner">
      {report && showSticky && !isDemo ? (
        <div className="sticky-bar" role="region" aria-label={t("stickyBar.ariaLabel")}>
          <span className="sticky-repo">
            {report.repository.owner}/{report.repository.name}
            {typeof (liveStars ?? report.repository.stars ?? null) === "number" ? (
              <StarBadge className="repo-stars" size={11} stars={(liveStars ?? report.repository.stars)!} />
            ) : null}
          </span>
          <span className="sticky-stats">
            {t("stickyBar.code", { count: report.total.code, code: formatNumber(report.total.code) })}
            {" · "}
            <span className={report.cached ? "ok" : ""}>{report.cached ? t("runner.cacheHit") : t("runner.freshRun")}</span>
          </span>
          <div className="sticky-actions">
            <button
              className="copybtn share-cta"
              onClick={() => {
                trackEvent(AnalyticsEvents.shareClicked, { share_type: "sticky_jump", placement: "sticky" });
                document.getElementById("share-showcase")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
              }}
            >
              <Share2 size={13} /> {t("stickyBar.share")}
            </button>
            <button className="copybtn" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })} aria-label={t("stickyBar.top")}><ArrowUp size={13} /> {t("stickyBar.top")}</button>
          </div>
        </div>
      ) : null}
      {isDemo && report ? (
        <div className="demo-report-head">
          <span className="chart-tag">{t("samples.label")}</span>
          <strong>{t("runner.exampleReport")}</strong>
        </div>
      ) : null}
      <div className="runner-head" ref={headRef}>
        <div className="left">
          {report ? (
            <>
              <strong className="runner-repo">{report.repository.owner}/{report.repository.name}</strong>
              <span className="scale-tag">{t("runner.scaleTag", { scale: t(`insights.scaleValues.${projectScale(report.total.code)}`) })}</span>
            </>
          ) : (
            <>
              <span className="pill"><span className={`dot ${status === "idle" ? "idle" : ""}`} />{t("runner.statusShort." + status)}</span>
              <code>$ {command}</code>
            </>
          )}
        </div>
        <div className="row-flex">
          {report ? (
            <span className="runner-meta">
              {report.refName} · {report.commitSha.slice(0, 7)} ·{" "}
              {/* 7-char sha for display only — URLs and exports keep the 12-char form. */}
              <time dateTime={report.generatedAt} title={fullTimestamp}>{formatRelativeTime(report.generatedAt, i18n.language)}</time>
            </span>
          ) : (
            <span>
              {t("runner.status." + status)}
              {isWorking && elapsedSec > 0 ? <b className="speed-val"> · {elapsedSec}s</b> : null}
            </span>
          )}
        </div>
      </div>
      <div className={`progress ${status === "queued" || status === "running" ? "indet" : ""}`}><i style={{ transform: `scaleX(${progressValue(status) / 100})` }} /></div>
      <span className="visually-hidden" aria-live="polite">{t("runner.status." + status)}</span>
      {!report ? <RunnerLog status={status} report={report} error={error} elapsedSec={elapsedSec} /> : null}
      {status === "failed" ? <ErrorState code={errorCode} message={error} onRetry={onRerun} /> : null}
      {report ? (
        isDemo ? (
          <>
            <Summary stats={report.total} />
            <Charts report={report} />
            <div className="demo-report-more">
              <a className="copybtn" href={buildSnapshotReportUrl(report)}>
                {t("runner.seeFullReport")} <span aria-hidden="true">→</span>
              </a>
            </div>
          </>
        ) : (
          <>
            <Summary stats={report.total} />
            <Charts report={report} />
            <Suspense fallback={null}>
              <RepoHistoryChart
                provider={normalizedProvider(report)}
                owner={report.repository.owner}
                repo={report.repository.name}
                reportDate={report.generatedAt.slice(0, 10)}
                reportCode={report.total.code}
                reportRef={report.refName}
                isPinnedRef={isPinnedRef || isCommitRef(report.refName)}
              />
            </Suspense>
            <ShareSection
              report={report}
              stars={liveStars ?? report.repository.stars ?? null}
              cardRef={shareCardRef}
              copiedCta={copiedCta}
              isExporting={isExporting}
              exportError={exportError}
              copyError={copyError}
              onCopyUrl={() => {
                void copyText(buildSnapshotReportUrl(report)).then((copied) => {
                  if (!copied) { setCopyError(t("reportCta.copyFailed")); return; }
                  setCopyError(null);
                  showCopiedCta("url");
                });
                trackEvent(AnalyticsEvents.reportUrlCopied, { provider: normalizedProvider(report), placement: "share_showcase" });
              }}
              onExportPng={() => void exportPng()}
              onCopyBadge={async () => {
                const url = buildSnapshotReportUrl(report);
                const badgeUrl = normalizedProvider(report) === "github"
                  ? buildBadgeUrl(report.repository.owner, report.repository.name, report.refName, "summary", "")
                  : "";
                if (!badgeUrl) return false;
                const copied = await copyText(`[![OctoCounts](${badgeUrl})](${url})`);
                if (copied) { showCopiedCta("badge"); trackEvent(AnalyticsEvents.badgeMarkdownCopied, { provider: "github", placement: "report_utility" }); }
                return copied;
              }}
              onCopyEmbed={async () => {
                const provider = normalizedProvider(report);
                const copied = await copyText(buildEmbedSnippet(buildEmbedUrl(provider, report.repository.owner, report.repository.name)));
                if (copied) { showCopiedCta("embed"); trackEvent(AnalyticsEvents.embedSnippetCopied, { provider, placement: "report_utility" }); }
                return copied;
              }}
            />
            <SimilarRepos report={report} />
            <TechnicalDetails
              report={report}
              stars={liveStars ?? report.repository.stars ?? null}
              command={command}
              fullTimestamp={fullTimestamp}
              runLog={<RunnerLog status={status} report={report} error={error} />}
              onExportText={async () => { const copied = await copyText(textReport(report)); if (copied) trackEvent("report_text_copied", { provider: normalizedProvider(report) }); return copied; }}
              onExportJson={async () => { const copied = await copyText(JSON.stringify(report, null, 2)); if (copied) trackEvent("report_json_copied", { provider: normalizedProvider(report) }); return copied; }}
              onRerun={onRerun}
              onReset={onReset}
            />
          </>
        )
      ) : null}
    </div>
  );
}

// Collapsed-by-default home for everything a reader verifying the numbers
// needs: the speed/result readouts, the trust grid (commit, counter, ignored
// dirs), the run log and timing, and the rawer actions (text/JSON copy,
// source repo, re-run, clear) that would only clutter the share section.
function TechnicalDetails({
  report,
  stars,
  command,
  fullTimestamp,
  runLog,
  onExportText,
  onExportJson,
  onRerun,
  onReset,
}: {
  report: Report;
  stars: number | null;
  command: string;
  fullTimestamp: string;
  runLog: React.ReactNode;
  onExportText: () => Promise<boolean>;
  onExportJson: () => Promise<boolean>;
  onRerun: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const [copyFeedback, setCopyFeedback] = useState<"copied" | "failed" | null>(null);
  const [manualCopyValue, setManualCopyValue] = useState<string | null>(null);
  const runCopy = async (action: () => Promise<boolean>, fallbackValue?: string) => {
    const copied = await action();
    setCopyFeedback(copied ? "copied" : "failed");
    setManualCopyValue(copied ? null : fallbackValue ?? null);
  };

  return (
    <details className="report-details technical-details">
      <summary>{t("runner.technicalDetails")}</summary>
      <Insights report={report} />
      <TrustDetails report={report} stars={stars} />
      <div className="run-facts">
        <span>{t("runner.generated", { date: fullTimestamp, duration: report.durationMs, version: report.tokeiVersion })}</span>
        <span className={report.cached ? "ok" : ""}>{report.cached ? t("runner.cacheHit") : t("runner.freshRun")} · {report.durationMs}ms</span>
        <code>$ {command}</code>
      </div>
      {runLog}
      <div className="run-detail-actions">
        <button className="copybtn" type="button" onClick={() => void runCopy(onExportText, textReport(report))}><Clipboard size={14} /> {t("runner.exportText")}</button>
        <button className="copybtn" type="button" onClick={() => void runCopy(onExportJson, JSON.stringify(report, null, 2))}><FileJson size={14} /> {t("runner.exportJson")}</button>
        <a className="copybtn" href={report.repository.htmlUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {t("runner.exportGitHub")}</a>
        <button className="copybtn" type="button" onClick={onRerun}><RotateCcw size={14} /> {t("runner.reRun")}</button>
        <button className="copybtn" type="button" onClick={onReset}>{t("runner.clear")}</button>
        {copyFeedback ? <span className="copy-feedback" role="status">{copyFeedback === "copied" ? t("reportCta.copied") : t("reportCta.copyFailedShort")}</span> : null}
        {manualCopyValue ? <textarea className="manual-copy utility-manual-copy" readOnly value={manualCopyValue} aria-label={t("reportCta.manualContentAria")} onFocus={(event) => event.currentTarget.select()} /> : null}
      </div>
    </details>
  );
}

function ErrorState({ code, message, onRetry }: { code?: string; message: string | null; onRetry?: () => void }) {
  const { t } = useTranslation();
  // Fetched unconditionally (it is a single cached request) but rendered only
  // when the failure itself is attributed to the repository host, so the
  // official status backs up our attribution instead of the user taking our
  // word for it.
  const hostStatus = useGithubStatus();
  const helpKey = code && i18n.exists(`errorHelp.${code}`) ? `errorHelp.${code}` : "errorHelp.default";
  return (
    <div className="error-state" role="alert">
      <div>
        <span className="chart-tag">{code ?? t("error.failedCode")}</span>
        <h3>{message ?? t("runner.status.failed")}</h3>
        <p>{t(helpKey)}</p>
        {code === "github_unavailable" ? (
          <p className="host-status-line">
            {isHostDegraded(hostStatus)
              ? `${t("githubStatus.official")} ${hostStatus.description} `
              : `${t("githubStatus.officialOperational")} `}
            <a href="https://www.githubstatus.com" target="_blank" rel="noreferrer">{t("githubStatus.link")}</a>
          </p>
        ) : null}
        {onRetry ? <button type="button" className="copybtn retry-btn" onClick={onRetry}>{t("error.retry")}</button> : null}
      </div>
    </div>
  );
}

function RunnerLog({ status, report, error, elapsedSec = 0 }: { status: AppStatus; report: Report | null; error: string | null; elapsedSec?: number }) {
  return (
    <div className="log">
      {logLines(status, report, error, elapsedSec).map((line) => (
        <div key={line.text}><span className="ts">{line.ts}</span><span className={line.kind}>{line.text}</span></div>
      ))}
    </div>
  );
}
