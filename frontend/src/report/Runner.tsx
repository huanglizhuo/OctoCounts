// Report-page runner, restructured from the flat sibling stack in main.tsx.
// Section order: runner head (repo + GitHub link + ref/sha/relative time),
// the action bar (copy link / export / re-analyze / more), Summary, Charts,
// code-lines history, Share & embed, Similar repositories, and a collapsed
// Technical details disclosure (verification facts only — actions moved up).
import React, { Suspense, useEffect, useRef, useState } from "react";
import { ArrowUp, ExternalLink, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { fetchJson } from "../api";
import { AnalyticsEvents, trackEvent } from "../analytics";
import { downloadDataUrl, formatNumber, formatRelativeTime, logLines, normalizedProvider, progressValue } from "../reportUtils";
import { isHostDegraded, useGithubStatus } from "../githubStatus";
import type { AppStatus, Report } from "../types";
import { Charts } from "./Charts";
import { ReportActions } from "./ReportActions";
import { StarBadge, buildSnapshotReportUrl } from "./shared";
import { Summary } from "./Summary";

// The history chart only renders after a report completes, and it drags its
// own export helpers; keep it out of the critical bundle.
const RepoHistoryChart = React.lazy(() => import("../RepoHistoryChart").then((m) => ({ default: m.RepoHistoryChart })));

// Full-report-only extras, all below the fold of a finished report: the
// share showcase (with the offscreen PNG capture card), similar
// repositories, and the insights/trust readouts inside Technical details.
// None of them render in the demo variant, so loading them as chunks keeps
// the share/export code out of the homepage entry entirely. Both Share
// exports come from the same module, so the preview section and the capture
// card share one chunk; the export flow waits for that chunk below.
const ShareSection = React.lazy(() => import("./Share").then((m) => ({ default: m.ShareSection })));
const ShareTickerCard = React.lazy(() => import("./Share").then((m) => ({ default: m.ShareTickerCard })));
const SimilarRepos = React.lazy(() => import("./SimilarRepos").then((m) => ({ default: m.SimilarRepos })));
const Insights = React.lazy(() => import("./Insights").then((m) => ({ default: m.Insights })));
const TrustDetails = React.lazy(() => import("./TrustDetails").then((m) => ({ default: m.TrustDetails })));

// The share-card chunk is lazy, so "mounted" is no longer two frames after
// setState — the chunk may still be downloading when the export click lands.
// Poll animation frames until the offscreen card commits (or the budget
// expires and the caller surfaces the retryable export error).
function waitForMountedCard(ref: React.RefObject<HTMLDivElement | null>, budgetMs: number): Promise<HTMLDivElement | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (ref.current) resolve(ref.current);
      else if (Date.now() - startedAt > budgetMs) resolve(null);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// A commit sha is by definition a pinned observation even when the host did
// not say so (e.g. a sha typed into the homepage ref box); anything else
// (branch/tag) merges into the history series unless the URL pinned it.
function isCommitRef(refName: string) {
  return /^[0-9a-f]{7,40}$/i.test(refName);
}

export function Runner({ command, status, report, error, errorCode, onReset, onRerun, variant = "full", isPinnedRef = false }: { command: string; status: AppStatus; report: Report | null; error: string | null; errorCode?: string; onReset: () => void; onRerun: () => void; variant?: "demo" | "full"; isPinnedRef?: boolean }) {
  const { t, i18n } = useTranslation();
  // Offscreen-but-laid-out mount of the share card, created only while a PNG
  // export is in flight. html-to-image needs a real layout; the visible
  // preview stays collapsed by default on every viewport, so the capture
  // source cannot depend on the user opening it first.
  const exportCardRef = useRef<HTMLDivElement>(null);
  const [exportMount, setExportMount] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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
    // Demo variant never refreshes stars: the only consumers (sticky bar,
    // share card, trust grid) are full-report UI, so the homepage example
    // must not pay the /api/repo-info round trip. A real run flips isDemo,
    // the effect re-runs, and the finished report refreshes as before.
    if (!report || isDemo) return;
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
  }, [report, isDemo]);
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
    if (!report || isExporting) return;
    setIsExporting(true);
    setExportError(null);
    setExportMount(true);
    try {
      // The offscreen card lives in the lazy Share chunk; wait for it to
      // actually commit, then one more frame guarantees a layout pass
      // before anything reads geometry.
      const node = await waitForMountedCard(exportCardRef, 5000);
      if (!node) throw new Error("share card not mounted");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      // Fonts must be resolved before capture or the PNG rasterizes fallback
      // glyphs. (The card embeds no raster images — its star mark is inline
      // SVG — so there is nothing further to decode.)
      await document.fonts.ready;
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: 2,
        width: 1200,
        height: 630,
        backgroundColor: "#050a06",
      });
      downloadDataUrl(dataUrl, `octocount-${report.repository.owner}-${report.repository.name}-${report.commitSha.slice(0, 12)}.png`);
      trackEvent(AnalyticsEvents.pngExported, { provider: normalizedProvider(report) });
    } catch {
      setExportError(t("runner.exportPngFailed"));
    } finally {
      setExportMount(false);
      setIsExporting(false);
    }
  };

  const stars = liveStars ?? report?.repository.stars ?? null;
  const fullTimestamp = report ? new Date(report.generatedAt).toLocaleString(i18n.language) : "";

  return (
    <div className="runner">
      {report && showSticky && !isDemo ? (
        <div className="sticky-bar" role="region" aria-label={t("stickyBar.ariaLabel")}>
          <span className="sticky-repo">
            {report.repository.owner}/{report.repository.name}
            {typeof stars === "number" ? <StarBadge className="repo-stars" size={11} stars={stars} /> : null}
          </span>
          <span className="sticky-stats">
            {t("stickyBar.code", { count: report.total.code, code: formatNumber(report.total.code) })}
            {" · "}
            <span className={report.cached ? "ok" : ""}>{report.cached ? t("runner.cacheHit") : t("runner.freshRun")}</span>
          </span>
          <div className="sticky-actions">
            {/* Same component and callbacks as the in-flow action bar; the
                compact form keeps the fixed strip slim (core actions only). */}
            <ReportActions compact report={report} onRerun={onRerun} onReset={onReset} onExportPng={() => void exportPng()} isExporting={isExporting} exportError={exportError} placement="sticky" />
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
              {/* Source repository, moved up from the old bottom action row. */}
              <a className="runner-github-link" href={report.repository.htmlUrl} target="_blank" rel="noreferrer" aria-label={t("reportActions.githubAria", { repo: `${report.repository.owner}/${report.repository.name}` })}>
                <ExternalLink size={15} aria-hidden="true" />
              </a>
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
            <Charts report={report} variant="demo" />
            <div className="demo-report-more">
              <a className="copybtn" href={buildSnapshotReportUrl(report)}>
                {t("runner.seeFullReport")} <span aria-hidden="true">→</span>
              </a>
            </div>
          </>
        ) : (
          <>
            <ReportActions
              report={report}
              onRerun={onRerun}
              onReset={onReset}
              onExportPng={() => void exportPng()}
              isExporting={isExporting}
              exportError={exportError}
              placement="report_actions"
            />
            <Summary stats={report.total} />
            <Charts report={report} variant="full" />
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
            {/* Summary, Charts and the action bar stay eager: they are the
                content the visitor is waiting for. Everything below is a
                below-fold extra in its own Suspense boundary (null fallback —
                a shared boundary would flash siblings back to the fallback
                whenever a later chunk resolved). */}
            <Suspense fallback={null}>
              <ShareSection
                report={report}
                stars={stars}
                isExporting={isExporting}
                exportError={exportError}
                onExportPng={() => void exportPng()}
              />
            </Suspense>
            <Suspense fallback={null}>
              <SimilarRepos report={report} />
            </Suspense>
            <TechnicalDetails
              report={report}
              stars={stars}
              command={command}
              fullTimestamp={fullTimestamp}
              runLog={<RunnerLog status={status} report={report} error={error} />}
            />
          </>
        )
      ) : null}
      {exportMount && report ? (
        <div className="share-export-target" aria-hidden="true">
          {/* The capture card comes from the same lazy chunk as the share
              section; exportPng polls the ref until it commits. */}
          <Suspense fallback={null}>
            <ShareTickerCard ref={exportCardRef} report={report} stars={stars} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}

// Collapsed-by-default home for everything a reader verifying the numbers
// needs: the speed/result readouts, the trust grid (commit, counter, ignored
// dirs), the run log and timing, and the counting-methodology note. The
// actions that used to live here moved to the ReportActions bar under the
// runner head.
function TechnicalDetails({
  report,
  stars,
  command,
  fullTimestamp,
  runLog,
}: {
  report: Report;
  stars: number | null;
  command: string;
  fullTimestamp: string;
  runLog: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <details className="report-details technical-details">
      <summary>{t("runner.technicalDetails")}</summary>
      <Suspense fallback={null}>
        <Insights report={report} />
      </Suspense>
      <div className="run-facts">
        <span>{t("runner.generated", { date: fullTimestamp, duration: report.durationMs, version: report.tokeiVersion })}</span>
        <span className={report.cached ? "ok" : ""}>{report.cached ? t("runner.cacheHit") : t("runner.freshRun")} · {report.durationMs}ms</span>
        <code>$ {command}</code>
      </div>
      {runLog}
      <Suspense fallback={null}>
        <TrustDetails report={report} stars={stars} />
      </Suspense>
      <p className="methodology-note">
        {t("runner.methodology")} <a href="/docs/methodology">{t("runner.methodologyLink")}</a>
      </p>
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
