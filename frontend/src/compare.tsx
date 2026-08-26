import { Loader2, Play, Clipboard } from "lucide-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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

  const runCompare = async () => {
    trackEvent("compare_run", { mode: "repos", leftProvider: providerFromRepoUrl(leftRepo), rightProvider: providerFromRepoUrl(rightRepo) });
    setCompareStatus("running");
    setCompareError("");
    try {
      const [left, right] = await Promise.all([
        analyzeAndWait(leftRepo, leftRef),
        analyzeAndWait(rightRepo, rightRef),
      ]);
      setLeftReport(left);
      setRightReport(right);
      setCompareStatus("completed");
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : t("error.requestFailed"));
      setCompareStatus("failed");
    }
  };

  return (
    <div className="compare-panel">
      {showHelp ? <p className="compare-help">{t("compare.help")}</p> : null}
      <form className="compare-form" onSubmit={(event) => { event.preventDefault(); void runCompare(); }}>
        <CompareInput label={t("compare.leftRepo")} repo={leftRepo} refName={leftRef} setRepo={setLeftRepo} setRef={setLeftRef} />
        <CompareInput label={t("compare.rightRepo")} repo={rightRepo} refName={rightRef} setRepo={setRightRepo} setRef={setRightRef} />
        <button className="btn compare-run" disabled={compareStatus === "running"}>
          {compareStatus === "running" ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
          {t("compare.run")}
        </button>
      </form>
      <div className="compare-share-row">
        <code>{buildCompareUrl(leftRepo, rightRepo, leftRef, rightRef)}</code>
        <button className="copybtn" type="button" onClick={() => { copyCompareUrl(buildCompareUrl(leftRepo, rightRepo, leftRef, rightRef)); }}>
          <Clipboard size={14} />
          {t("compare.copyUrl")}
        </button>
      </div>
      {compareStatus === "running" ? <div className="compare-status" role="status"><Loader2 className="spin" size={13} aria-hidden="true" /> {t("compare.running")}</div> : null}
      {compareStatus === "failed" ? (
        <div className="compare-error">
          <span>{compareError}</span>
          <button type="button" className="copybtn retry-btn" onClick={() => void runCompare()}>{t("error.retry")}</button>
        </div>
      ) : null}
      {leftReport && rightReport ? <CompareResults left={leftReport} right={rightReport} shareUrl={buildCompareUrl(leftRepo, rightRepo, leftRef, rightRef)} sharePlacement="compare" /> : null}
    </div>
  );
}

function copyCompareUrl(url: string) {
  copyText(url);
  trackEvent(AnalyticsEvents.shareClicked, { share_type: "compare_url" });
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
        <input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="https://github.com/owner/repo" aria-label={label} />
      </label>
      <label>
        <span>{t("compare.ref")}</span>
        <input value={refName} onChange={(event) => setRef(event.target.value)} placeholder={t("compare.refPlaceholder")} aria-label={`${label} ref`} />
      </label>
    </fieldset>
  );
}

export function DiffRefs({ showHelp = true }: { showHelp?: boolean }) {
  const { t } = useTranslation();
  const initialDiff = useMemo(() => initialDiffFromLocation(), []);
  const [repo, setRepo] = useState(initialDiff.repo);
  const [baseRef, setBaseRef] = useState(initialDiff.base);
  const [headRef, setHeadRef] = useState(initialDiff.head);
  const [baseReport, setBaseReport] = useState<Report | null>(null);
  const [headReport, setHeadReport] = useState<Report | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [error, setError] = useState("");

  const runDiff = async () => {
    trackEvent("compare_run", { mode: "diff", provider: providerFromRepoUrl(repo) });
    setStatus("running");
    setError("");
    try {
      const [base, head] = await Promise.all([
        analyzeAndWait(repo, baseRef),
        analyzeAndWait(repo, headRef),
      ]);
      setBaseReport(base);
      setHeadReport(head);
      setStatus("completed");
    } catch (err) {
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
        <code>{buildDiffUrl(repo, baseRef, headRef)}</code>
        <button className="copybtn" type="button" onClick={() => { copyText(buildDiffUrl(repo, baseRef, headRef)); trackEvent(AnalyticsEvents.shareClicked, { share_type: "diff_url" }); }}>
          <Clipboard size={14} />
          {t("compare.copyUrl")}
        </button>
      </div>
      {status === "running" ? <div className="compare-status" role="status"><Loader2 className="spin" size={13} aria-hidden="true" /> {t("compare.running")}</div> : null}
      {status === "failed" ? (
        <div className="compare-error">
          <span>{error}</span>
          <button type="button" className="copybtn retry-btn" onClick={() => void runDiff()}>{t("error.retry")}</button>
        </div>
      ) : null}
      {baseReport && headReport ? <CompareResults left={baseReport} right={headReport} shareUrl={buildDiffUrl(repo, baseRef, headRef)} sharePlacement="diff" /> : null}
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
          <strong>{topLeft}</strong>
        </div>
        <div>
          <span>{right.repository.owner}/{right.repository.name}</span>
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
              <th>{t("compare.delta")}</th>
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

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await delay(attempt < 5 ? 1_200 : 2_500);
    const job = await fetchJson<JobRecord>(`/api/jobs/${result.jobId}`);
    if (job.status === "failed") {
      throw new Error(job.error?.message ?? "analysis failed");
    }
    if (job.status === "completed" && job.reportId) {
      return fetchJson<Report>(`/api/reports/${job.reportId}`);
    }
  }
  throw new Error("analysis timed out");
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
      leftRef: defaultRefName,
      rightRepo: "https://github.com/tokio-rs/axum",
      rightRef: "",
    };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    leftRepo: params.get("left") || defaultRepoUrl,
    leftRef: params.get("leftRef") || defaultRefName,
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
