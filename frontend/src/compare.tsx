import { ArrowLeftRight, Loader2, Play, Clipboard } from "lucide-react";
import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";
import { analyzeRepository, fetchJson } from "./api";
import { AnalyticsEvents, providerFromRepoUrl, trackEvent } from "./analytics";
import { defaultRefName, defaultRepoUrl } from "./constants";
import { copyText, formatNumber, languageColor, visibleLanguageColor } from "./reportUtils";
import { useScheme } from "./scheme";
import { ShareButtons } from "./ShareButtons";
import type { JobRecord, Report } from "./types";

// Compare (two repos) and Diff (two refs of one repo) share one panel layout,
// one status machine, and one results table. Extracted from main.tsx so the
// marketing pages can lazy-load them without pulling the whole app.

export function CompareRepos({ showHelp = true }: { showHelp?: boolean }) {
  const { t } = useTranslation();
  const initialCompare = useMemo(() => initialCompareFromLocation(), []);
  const [leftRepo, setLeftRepo] = useState(initialCompare.leftRepo);
  const [leftRef, setLeftRef] = useState(initialCompare.leftRef);
  const [rightRepo, setRightRepo] = useState(initialCompare.rightRepo);
  const [rightRef, setRightRef] = useState(initialCompare.rightRef);
  const [leftReport, setLeftReport] = useState<Report | null>(null);
  const [rightReport, setRightReport] = useState<Report | null>(null);
  const [compareStatus, setCompareStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [compareError, setCompareError] = useState("");
  const [completedShareUrl, setCompletedShareUrl] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<"copied" | "failed" | null>(null);
  const operation = useRef(0);

  const runCompare = async () => {
    const run = operation.current + 1;
    operation.current = run;
    const snapshot = { leftRepo: leftRepo.trim(), leftRef: leftRef.trim(), rightRepo: rightRepo.trim(), rightRef: rightRef.trim() };
    trackEvent("compare_run", { mode: "repos", leftProvider: providerFromRepoUrl(snapshot.leftRepo), rightProvider: providerFromRepoUrl(snapshot.rightRepo) });
    setCompareStatus("running");
    setCompareError("");
    try {
      const [left, right] = await Promise.all([
        analyzeAndWait(snapshot.leftRepo, snapshot.leftRef),
        analyzeAndWait(snapshot.rightRepo, snapshot.rightRef),
      ]);
      if (run !== operation.current) return;
      setLeftReport(left);
      setRightReport(right);
      setCompletedShareUrl(buildCompareUrl(snapshot.leftRepo, snapshot.rightRepo, snapshot.leftRef, snapshot.rightRef));
      setCompareStatus("completed");
    } catch (error) {
      if (run !== operation.current) return;
      setCompareError(error instanceof Error ? error.message : t("error.requestFailed"));
      setCompareStatus("failed");
    }
  };

  return (
    <div className="compare-panel">
      {showHelp ? <p className="compare-help">{t("compare.help")}</p> : null}
      <form className="compare-form" onSubmit={(event) => { event.preventDefault(); void runCompare(); }}>
        <CompareInput label={t("compare.leftRepo")} repo={leftRepo} refName={leftRef} setRepo={setLeftRepo} setRef={setLeftRef} />
        <button
          type="button"
          className="copybtn compare-swap"
          aria-label={t("compare.swapAria")}
          title={t("compare.swapAria")}
          onClick={() => {
            setLeftRepo(rightRepo);
            setRightRepo(leftRepo);
            setLeftRef(rightRef);
            setRightRef(leftRef);
          }}
        >
          <ArrowLeftRight size={16} aria-hidden="true" />
        </button>
        <CompareInput label={t("compare.rightRepo")} repo={rightRepo} refName={rightRef} setRepo={setRightRepo} setRef={setRightRef} />
        <button className="btn compare-run" disabled={compareStatus === "running"}>
          {compareStatus === "running" ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
          {t("compare.run")}
        </button>
      </form>
      <div className="compare-share-row">
        <code>{completedShareUrl ?? t("compare.resultPending")}</code>
        <button className="copybtn" type="button" disabled={!completedShareUrl} onClick={() => { if (completedShareUrl) void copyCompareUrl(completedShareUrl).then((copied) => setCopyFeedback(copied ? "copied" : "failed")); }}>
          <Clipboard size={14} />
          {copyFeedback === "copied" ? t("reportCta.copied") : copyFeedback === "failed" ? t("reportCta.copyFailedShort") : t("compare.copyUrl")}
        </button>
      </div>
      {compareStatus === "running" ? <div className="compare-status" role="status"><Loader2 className="spin" size={13} aria-hidden="true" /> {t("compare.running")}</div> : null}
      {compareStatus === "failed" ? (
        <div className="compare-error">
          <span>{compareError}</span>
          <button type="button" className="copybtn retry-btn" onClick={() => void runCompare()}>{t("error.retry")}</button>
        </div>
      ) : null}
      {completedShareUrl && completedShareUrl !== buildCompareUrl(leftRepo, rightRepo, leftRef, rightRef) ? <p className="draft-notice" role="status">{t("compare.draftChanged")}</p> : null}
      {leftReport && rightReport && completedShareUrl ? <CompareResults left={leftReport} right={rightReport} shareUrl={completedShareUrl} sharePlacement="compare" /> : null}
    </div>
  );
}

async function copyCompareUrl(url: string) {
  const copied = await copyText(url);
  if (copied) trackEvent(AnalyticsEvents.shareClicked, { share_type: "compare_url" });
  return copied;
}

function CompareInput({
  label,
  repo,
  refName,
  setRepo,
  setRef,
}: {
  label: string;
  repo: string;
  refName: string;
  setRepo: (value: string) => void;
  setRef: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="compare-field">
      <legend>{label}</legend>
      <label>
        <span>{t("compare.repoUrl")}</span>
        <input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="https://github.com/owner/repo" />
      </label>
      <label>
        <span>{t("compare.ref")}</span>
        <input value={refName} onChange={(event) => setRef(event.target.value)} placeholder={t("compare.refPlaceholder")} />
      </label>
    </fieldset>
  );
}

export function DiffRefs({ showHelp = true }: { showHelp?: boolean }) {
  const { t } = useTranslation();
  const [copyFeedback, setCopyFeedback] = useState<"copied" | "failed" | null>(null);
  const initialDiff = useMemo(() => initialDiffFromLocation(), []);
  const [repo, setRepo] = useState(initialDiff.repo);
  const [baseRef, setBaseRef] = useState(initialDiff.base);
  const [headRef, setHeadRef] = useState(initialDiff.head);
  const [baseReport, setBaseReport] = useState<Report | null>(null);
  const [headReport, setHeadReport] = useState<Report | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [error, setError] = useState("");
  const [completedShareUrl, setCompletedShareUrl] = useState<string | null>(null);
  const operation = useRef(0);

  const runDiff = async () => {
    const run = operation.current + 1;
    operation.current = run;
    const snapshot = { repo: repo.trim(), base: baseRef.trim(), head: headRef.trim() };
    trackEvent("compare_run", { mode: "diff", provider: providerFromRepoUrl(snapshot.repo) });
    setStatus("running");
    setError("");
    try {
      const [base, head] = await Promise.all([
        analyzeAndWait(snapshot.repo, snapshot.base),
        analyzeAndWait(snapshot.repo, snapshot.head),
      ]);
      if (run !== operation.current) return;
      setBaseReport(base);
      setHeadReport(head);
      setCompletedShareUrl(buildDiffUrl(snapshot.repo, snapshot.base, snapshot.head));
      setStatus("completed");
    } catch (err) {
      if (run !== operation.current) return;
      setStatus("failed");
      setError(err instanceof Error ? err.message : t("error.requestFailed"));
    }
  };

  return (
    <div className="compare-panel diff-panel">
      {showHelp ? <p className="compare-help">{t("diff.help")}</p> : null}
      <form className="compare-form diff-form" onSubmit={(event) => { event.preventDefault(); void runDiff(); }}>
        <fieldset className="compare-field">
          <legend>{t("diff.repo")}</legend>
          <label>
            <span>{t("compare.repoUrl")}</span>
            <input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="https://github.com/owner/repo" />
          </label>
        </fieldset>
        <fieldset className="compare-field">
          <legend>{t("diff.refs")}</legend>
          <label>
            <span>{t("diff.base")}</span>
            <input value={baseRef} onChange={(event) => setBaseRef(event.target.value)} placeholder={t("diff.base")} />
          </label>
          <label>
            <span>{t("diff.head")}</span>
            <input value={headRef} onChange={(event) => setHeadRef(event.target.value)} placeholder={t("diff.head")} />
          </label>
        </fieldset>
        <button className="btn compare-run" disabled={status === "running"}>
          {status === "running" ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
          {t("diff.run")}
        </button>
      </form>
      <div className="compare-share-row">
        <code>{completedShareUrl ?? t("diff.resultPending")}</code>
        <button className="copybtn" type="button" disabled={!completedShareUrl} onClick={() => { if (completedShareUrl) void copyText(completedShareUrl).then((copied) => { if (copied) trackEvent(AnalyticsEvents.shareClicked, { share_type: "diff_url" }); setCopyFeedback(copied ? "copied" : "failed"); }); }}>
          <Clipboard size={14} />
          {copyFeedback === "copied" ? t("reportCta.copied") : copyFeedback === "failed" ? t("reportCta.copyFailedShort") : t("compare.copyUrl")}
        </button>
      </div>
      {status === "running" ? <div className="compare-status" role="status"><Loader2 className="spin" size={13} aria-hidden="true" /> {t("compare.running")}</div> : null}
      {status === "failed" ? (
        <div className="compare-error">
          <span>{error}</span>
          <button type="button" className="copybtn retry-btn" onClick={() => void runDiff()}>{t("error.retry")}</button>
        </div>
      ) : null}
      {completedShareUrl && completedShareUrl !== buildDiffUrl(repo, baseRef, headRef) ? <p className="draft-notice" role="status">{t("compare.draftChanged")}</p> : null}
      {baseReport && headReport && completedShareUrl ? <CompareResults left={baseReport} right={headReport} shareUrl={completedShareUrl} sharePlacement="diff" /> : null}
    </div>
  );
}

function CompareResults({ left, right, shareUrl, sharePlacement }: { left: Report; right: Report; shareUrl: string; sharePlacement: string }) {
  const { t } = useTranslation();
  const scheme = useScheme();
  const topLeft = left.languages[0]?.name ?? t("charts.noData");
  const topRight = right.languages[0]?.name ?? t("charts.noData");
  const rows = [
    { label: t("summary.files"), left: left.total.files, right: right.total.files },
    { label: t("summary.lines"), left: left.total.lines, right: right.total.lines },
    { label: t("summary.code"), left: left.total.code, right: right.total.code },
    { label: t("summary.comments"), left: left.total.comments, right: right.total.comments },
    { label: t("summary.blanks"), left: left.total.blanks, right: right.total.blanks },
    { label: t("compare.languages"), left: left.languages.length, right: right.languages.length },
  ];
  const languageRows = compareLanguages(left, right).slice(0, 8);

  return (
    <div className="compare-results">
      <div className="compare-head">
        <div>
          <span>{left.repository.owner}/{left.repository.name}</span>
          <small>{left.refName || t("compare.defaultRef")} · {left.commitSha.slice(0, 12)}</small>
          <strong>{topLeft}</strong>
        </div>
        <div>
          <span>{right.repository.owner}/{right.repository.name}</span>
          <small>{right.refName || t("compare.defaultRef")} · {right.commitSha.slice(0, 12)}</small>
          <strong>{topRight}</strong>
        </div>
      </div>
      <div className="compare-table-wrap">
        <table className="compare-table">
          <thead>
            <tr>
              <th>{t("compare.metric")}</th>
              <th>{t("compare.left")}</th>
              <th>{t("compare.right")}</th>
              <th>{t("compare.delta")} = {t("compare.right")} − {t("compare.left")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{formatNumber(row.left)}</td>
                <td>{formatNumber(row.right)}</td>
                <td className={row.right - row.left >= 0 ? "pos" : "neg"}>{formatSignedNumber(row.right - row.left)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="compare-language-grid">
        {languageRows.length === 0 ? <p className="compare-help">{t("compare.noSharedLanguages")}</p> : null}
        {languageRows.map((row) => (
          <div className="compare-lang" key={row.name}>
            <span className="key-sw" style={{ background: visibleLanguageColor(languageColor(row.name), scheme) }} />
            <strong>{row.name}</strong>
            <span>{formatNumber(row.left)}</span>
            <span>{formatNumber(row.right)}</span>
            <em className={row.delta >= 0 ? "pos" : "neg"}>{formatSignedNumber(row.delta)}</em>
          </div>
        ))}
      </div>
      <ShareButtons
        url={shareUrl}
        text={t("share.compareText", { left: `${left.repository.owner}/${left.repository.name}`, right: `${right.repository.owner}/${right.repository.name}` })}
        placement={sharePlacement}
      />
    </div>
  );
}

async function analyzeAndWait(repoUrl: string, refName: string) {
  const result = await analyzeRepository({ repoUrl, refName, forceRefresh: false });
  if (result.kind === "cached") return result.report;

  for (let attempt = 0; attempt < 14; attempt += 1) {
    await delay(1_500);
    // Long-poll (backend holds each request up to 20s per status change);
    // 14 attempts ≈ the ~5-minute wall-clock cap the tight poll used to have.
    const job = await fetchJson<JobRecord>(`/api/jobs/${result.jobId}?wait=20`);
    if (job.status === "failed") {
      throw new Error(job.error?.message ?? i18n.t("compare.analysisFailed"));
    }
    if (job.status === "completed" && job.reportId) {
      return fetchJson<Report>(`/api/reports/${job.reportId}`);
    }
  }
  throw new Error(i18n.t("compare.analysisTimedOut"));
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function compareLanguages(left: Report, right: Report) {
  const names = new Set([...left.languages.map((row) => row.name), ...right.languages.map((row) => row.name)]);
  return [...names]
    .map((name) => {
      const leftCode = left.languages.find((row) => row.name === name)?.stats.code ?? 0;
      const rightCode = right.languages.find((row) => row.name === name)?.stats.code ?? 0;
      return { name, left: leftCode, right: rightCode, delta: rightCode - leftCode };
    })
    .sort((a, b) => Math.max(b.left, b.right) - Math.max(a.left, a.right));
}

function formatSignedNumber(value: number) {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "-"}${formatNumber(Math.abs(value))}`;
}

function initialCompareFromLocation() {
  if (window.location.pathname.startsWith("/compare/")) {
    // Curated comparison pages (functions/[[path]].js) embed the pair as JSON.
    const prefill = curatedComparePrefill();
    return {
      leftRepo: prefill?.left || defaultRepoUrl,
      leftRef: prefill?.leftRef || "",
      rightRepo: prefill?.right || "https://github.com/tokio-rs/axum",
      rightRef: prefill?.rightRef || "",
    };
  }
  if (window.location.pathname !== "/compare") {
    return {
      leftRepo: defaultRepoUrl,
      leftRef: "",
      rightRepo: "https://github.com/tokio-rs/axum",
      rightRef: "",
    };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    leftRepo: params.get("left") || defaultRepoUrl,
    leftRef: params.get("leftRef") ?? "",
    rightRepo: params.get("right") || "https://github.com/tokio-rs/axum",
    rightRef: params.get("rightRef") || "",
  };
}

function curatedComparePrefill(): { left?: string; right?: string; leftRef?: string; rightRef?: string } | null {
  const element = document.getElementById("octocounts-compare-prefill");
  if (!element?.textContent) return null;
  try {
    return JSON.parse(element.textContent) as { left?: string; right?: string; leftRef?: string; rightRef?: string };
  } catch {
    return null;
  }
}

function initialDiffFromLocation() {
  if (window.location.pathname !== "/diff") {
    return { repo: defaultRepoUrl, base: defaultRefName, head: "main" };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    repo: params.get("repo") || defaultRepoUrl,
    base: params.get("base") || defaultRefName,
    head: params.get("head") || "main",
  };
}

function buildCompareUrl(leftRepo: string, rightRepo: string, leftRef: string, rightRef: string) {
  const params = new URLSearchParams({ left: leftRepo.trim(), right: rightRepo.trim() });
  if (leftRef.trim()) params.set("leftRef", leftRef.trim());
  if (rightRef.trim()) params.set("rightRef", rightRef.trim());
  return `${window.location.origin}/compare?${params.toString()}`;
}

function buildDiffUrl(repo: string, base: string, head: string) {
  const params = new URLSearchParams({ repo: repo.trim(), base: base.trim(), head: head.trim() });
  return `${window.location.origin}/diff?${params.toString()}`;
}
