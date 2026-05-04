import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { toPng } from "html-to-image";
import { ChevronDown, ChevronRight, Clipboard, Download, ExternalLink, FileJson, Loader2, Play, RotateCcw } from "lucide-react";
import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import initialReportData from "./initialReport.json";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8080";
const showSharePreview = import.meta.env.DEV && import.meta.env.VITE_DEBUG_SHARE_PREVIEW === "true";

type JobStatus = "queued" | "running" | "completed" | "failed";
type AppStatus = JobStatus | "idle" | "cached";
type Scheme = "matrix" | "paper" | "amber";
type SortKey = "name" | keyof Stats;
type PieItem = { label: string; value: number; color: string };
type TickerRow = { label: string; value: number; color: string; percent: number };

type Stats = {
  files: number;
  lines: number;
  code: number;
  comments: number;
  blanks: number;
};

type LanguageReport = {
  name: string;
  stats: Stats;
  children: LanguageReport[];
};

type Report = {
  id: string;
  repository: { owner: string; name: string; htmlUrl: string };
  refName: string;
  commitSha: string;
  generatedAt: string;
  durationMs: number;
  cached: boolean;
  tokeiVersion: string;
  languages: LanguageReport[];
  total: Stats;
};

type AnalyzeResponse =
  | { kind: "cached"; reportId: string; report: Report }
  | { kind: "job"; jobId: string; status: JobStatus };

type JobRecord = {
  id: string;
  status: JobStatus;
  reportId?: string;
  error?: { code: string; message: string };
};

const queryClient = new QueryClient();
const defaultRepoUrl = "https://github.com/huanglizhuo/OctoCount";
const defaultRefName = "e92153946164";
const samples = [
  { label: "octocount", repoUrl: defaultRepoUrl, refName: defaultRefName },
  { label: "axum", repoUrl: "https://github.com/tokio-rs/axum", refName: "" },
  { label: "vite", repoUrl: "https://github.com/vitejs/vite", refName: "" },
];

const seedReport = initialReportData as Report;

function App() {
  const [scheme, setScheme] = useState<Scheme>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "matrix" : "paper"
  );
  const [repoUrl, setRepoUrl] = useState("");
  const [refName, setRefName] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(seedReport);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastCommand, setLastCommand] = useState(commandText(defaultRepoUrl, defaultRefName, false));
  const repoInputRef = useRef<HTMLInputElement>(null);
  const didAutoAnalyze = useRef(true);

  useEffect(() => {
    document.documentElement.dataset.scheme = scheme;
  }, [scheme]);

  useEffect(() => {
    repoInputRef.current?.focus();
  }, []);

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    enabled: Boolean(jobId && !report),
    refetchInterval: (query) => {
      const data = query.state.data as JobRecord | undefined;
      return data?.status === "completed" || data?.status === "failed" ? false : 1200;
    },
    queryFn: () => fetchJson<JobRecord>(`/api/jobs/${jobId}`),
  });

  useEffect(() => {
    const reportId = jobQuery.data?.reportId;
    if (jobQuery.data?.status !== "completed" || !reportId || report) {
      return;
    }

    let cancelled = false;
    fetchJson<Report>(`/api/reports/${reportId}`)
      .then((nextReport) => {
        if (cancelled) return;
        setReport(nextReport);
        setJobId(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to fetch completed report");
        setJobId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [jobQuery.data?.status, jobQuery.data?.reportId, report]);

  useEffect(() => {
    if (jobQuery.data?.status === "failed") {
      setError(jobQuery.data.error?.message ?? "Analysis failed.");
      setJobId(null);
    }
  }, [jobQuery.data]);

  const runAnalysis = async (forceRefresh: boolean) => {
    const effectiveRepoUrl = repoUrl.trim() || defaultRepoUrl;
    const effectiveRefName = refName.trim() || (repoUrl.trim() ? "" : defaultRefName);
    setError(null);
    setReport(null);
    setJobId(null);
    setIsSubmitting(true);
    const command = commandText(effectiveRepoUrl, effectiveRefName, forceRefresh);
    setLastCommand(command);

    try {
      const result = await analyzeRepository({ repoUrl: effectiveRepoUrl, refName: effectiveRefName, forceRefresh });
      if (result.kind === "cached") {
        setReport(result.report);
      } else {
        setJobId(result.jobId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network request failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runAnalysis(false);
  };

  useEffect(() => {
    if (didAutoAnalyze.current) return;
    didAutoAnalyze.current = true;
    void runAnalysis(false);
  }, []);

  const status: AppStatus = error
    ? "failed"
    : report
      ? report.cached
        ? "cached"
        : "completed"
      : jobQuery.data?.status ?? (jobId || isSubmitting ? "queued" : "idle");

  return (
    <>
      <div className="crt flicker" />
      <main className="page">
        <Topbar />
        <section className="hero" aria-label="Repository analyzer">
          <div className="hero-left">
            <TopActions scheme={scheme} setScheme={setScheme} status={status} />
            <h1 className="title">Count code lines at <span className="glow">commit speed</span>.</h1>
            <p className="subtitle">Free GitHub SLOC counter powered by <a href="https://github.com/XAMPPRocky/tokei" target="_blank" rel="noreferrer">tokei</a>. Paste a repo URL — get a full language breakdown in seconds.</p>
            <form className="input-row" onSubmit={submit}>
              <span className="prompt">$</span>
              <input
                id="repo-url"
                name="repoUrl"
                ref={repoInputRef}
                value={repoUrl}
                onChange={(event) => {
                  setRepoUrl(event.target.value);
                  setRefName("main");
                }}
                placeholder="https://github.com/owner/repo"
                aria-label="Repository URL"
              />
              <label className="ref">
                ref
                <input id="repo-ref" name="refName" value={refName} onChange={(event) => setRefName(event.target.value)} placeholder="main" aria-label="Optional ref" />
              </label>
              <button className="btn" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
                Analyze
              </button>
            </form>
            <div className="quick-rows" aria-label="Example repositories">
              {samples.map((sample) => (
                <button
                  className="chip"
                  key={sample.repoUrl}
                  type="button"
                  onClick={() => {
                    setRepoUrl(sample.repoUrl);
                    setRefName(sample.refName);
                    setLastCommand(commandText(sample.repoUrl, sample.refName, false));
                  }}
                >
                  <span className="k">sample</span>{sample.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="section-h">
            <span className="num">01</span>
            <h2>Runner</h2>
            <span className="sub">{statusCopy[status]}</span>
          </div>
          <Runner
            command={lastCommand}
            status={status}
            report={report}
            error={error ?? jobQuery.data?.error?.message ?? null}
            onReset={() => {
              setReport(null);
              setError(null);
              setJobId(null);
            }}
            onRerun={() => void runAnalysis(true)}
          />
        </section>

        <section>
          <div className="section-h">
            <span className="num">02</span>
            <h2>How It Works</h2>
            <span className="sub">archive in, tokei report out</span>
          </div>
          <div className="how">
            <div className="step">
              <span className="n">01</span>
              <h3>Resolve</h3>
              <p>OctoCounts validates the public GitHub URL, resolves the requested branch, tag, or SHA, and pins the run to a commit.</p>
              <div className="codeline">GET <span className="c">/repos/:owner/:repo</span></div>
            </div>
            <div className="step">
              <span className="n">02</span>
              <h3>Count</h3>
              <p>The backend downloads the repository archive, skips heavy generated folders, extracts safely, and runs tokei in a worker job.</p>
              <div className="codeline">tokei <span className="c">--output json</span></div>
            </div>
            <div className="step">
              <span className="n">03</span>
              <h3>Cache</h3>
              <p>Reports are cached by owner, repo, commit, and tokei version. Analyze reuses the cache; re-run forces a fresh count.</p>
              <div className="codeline">cache <span className="c">commit + version</span></div>
            </div>
          </div>
        </section>

        <footer>
          <span>OctoCounts // public repository source line counts</span>
          <span>Built by <a href="https://github.com/huanglizhuo" target="_blank" rel="noreferrer">huanglizhuo</a> · (c) 2026</span>
        </footer>
      </main>
    </>
  );
}

function Topbar() {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo"><img src="/favicons/web-app-manifest-192x192.png" alt="OctoCounts logo" /></div>
        <div>
          <span className="brand-name">OctoCounts</span>
        </div>
      </div>
      <a className="github-link" href={defaultRepoUrl} target="_blank" rel="noreferrer">
        <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>
      </a>
    </header>
  );
}

function TopActions({ scheme, setScheme, status }: { scheme: Scheme; setScheme: (scheme: Scheme) => void; status: AppStatus }) {
  return (
    <div className="top-actions">
      <div className="theme-switch" role="group" aria-label="Theme">
        {(["matrix", "paper", "amber"] as const).map((item) => (
          <button className={`theme-btn ${scheme === item ? "active" : ""}`} key={item} onClick={() => setScheme(item)} type="button">
            <span className={`theme-sw ${item}`} />
            {item}
          </button>
        ))}
      </div>
      <span className="pill"><span className={`dot ${status === "idle" ? "idle" : ""}`} />{status}</span>
    </div>
  );
}

function Runner({ command, status, report, error, onReset, onRerun }: { command: string; status: AppStatus; report: Report | null; error: string | null; onReset: () => void; onRerun: () => void }) {
  const shareCardRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  const exportPng = async () => {
    if (!report || !shareCardRef.current) return;
    setIsExporting(true);
    try {
      const dataUrl = await toPng(shareCardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        width: 1200,
        height: 630,
        backgroundColor: "#050a06",
      });
      downloadDataUrl(dataUrl, `octocount-${report.repository.owner}-${report.repository.name}-${report.commitSha.slice(0, 12)}.png`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="runner">
      <div className="runner-head">
        <div className="left">
          <span className="pill"><span className={`dot ${status === "idle" ? "idle" : ""}`} />{status}</span>
          <code>$ {command}</code>
        </div>
        <div className="row-flex">
          {report ? <span>{report.refName} / {report.commitSha.slice(0, 12)} / {report.cached ? "cache hit" : "fresh run"}</span> : <span>{statusCopy[status]}</span>}
        </div>
      </div>
      <div className={`progress ${status === "queued" || status === "running" ? "indet" : ""}`}><i style={{ width: `${progressValue(status)}%` }} /></div>
      <div className="log">
        {logLines(status, report, error).map((line) => (
          <div key={line.text}><span className="ts">{line.ts}</span><span className={line.kind}>{line.text}</span></div>
        ))}
      </div>
      {report ? (
        <>
          <Summary stats={report.total} />
          <Charts report={report} />
          <div className="runner-foot">
            <span>generated {new Date(report.generatedAt).toLocaleString()} / {report.durationMs}ms / {report.tokeiVersion}</span>
            <div className="actions">
              <button className="copybtn" onClick={() => copyText(textReport(report))}><Clipboard size={14} /> text</button>
              <button className="copybtn" onClick={() => copyText(JSON.stringify(report, null, 2))}><FileJson size={14} /> json</button>
              <button className="copybtn" disabled={isExporting} onClick={() => void exportPng()}><Download size={14} /> png</button>
              <a className="copybtn" href={report.repository.htmlUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> github</a>
              <button className="copybtn" onClick={onRerun}><RotateCcw size={14} /> re-run</button>
              <button className="copybtn" onClick={onReset}>clear</button>
            </div>
          </div>
          <div className="share-export-host" aria-hidden="true">
            <ShareTickerCard ref={shareCardRef} report={report} />
          </div>
          {showSharePreview ? (
            <section className="share-preview" aria-label="PNG export debug preview">
              <div className="section-h">
                <span>debug</span>
                <span className="sub">PNG export preview</span>
              </div>
              <div className="share-preview-frame">
                <ShareTickerCard report={report} />
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const ShareTickerCard = React.forwardRef<HTMLDivElement, { report: Report }>(function ShareTickerCard({ report }, ref) {
  const rows = tickerRows(report).slice(0, 6);
  const hasMoreLanguages = report.languages.length > rows.length;
  const total = report.total.code + report.total.comments + report.total.blanks;
  return (
    <div className="share-card" ref={ref}>
      <div className="share-window">
        <div className="share-head">
          <div className="lights"><span className="r" /><span className="y" /><span className="g" /></div>
          <span>OctoCounts // SLOC</span>
        </div>
        <div className="share-body">
          <div className="share-kicker">{report.repository.owner}/{report.repository.name}</div>
          <div className="share-ref">{report.refName} / {report.commitSha.slice(0, 12)}</div>
          <div className="share-total">
            <span>// Total LOC</span>
            <strong>{formatNumber(report.total.lines)}</strong>
          </div>
          <div className="share-breakdown">
            <ShareStat color="var(--accent)" label="Code" value={report.total.code} />
            <ShareStat color="var(--accent-2)" label="Comments" value={report.total.comments} />
            <ShareStat color="var(--violet)" label="Blanks" value={report.total.blanks} />
          </div>
          <div className="share-ticker">
            <div className="share-ticker-list">
              {rows.map((row) => (
                <div className="share-ticker-row" key={row.label}>
                  <span>{row.label}</span>
                  <i><b style={{ width: `${row.percent}%`, background: row.color }} /></i>
                  <em>{formatNumber(row.value)}</em>
                </div>
              ))}
            </div>
            {hasMoreLanguages ? <div className="share-ticker-note">top languages loc</div> : null}
          </div>
          <div className="share-foot">
            <span>{formatPercent(report.total.code, total)} code</span>
            <span>generated by OctoCounts</span>
          </div>
        </div>
      </div>
    </div>
  );
});

function ShareStat({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="share-stat">
      <span style={{ background: color }} />
      <p>{label}</p>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function Summary({ stats }: { stats: Stats }) {
  return (
    <div className="summary">
      <Metric label="Files" value={stats.files} />
      <Metric label="Lines" value={stats.lines} />
      <Metric label="Code" value={stats.code} accent />
      <Metric label="Comments" value={stats.comments} />
      <Metric label="Blanks" value={stats.blanks} />
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return <div className={`cell ${accent ? "accent" : ""}`}><div className="lbl">{label}</div><div className="val">{formatNumber(value)}</div></div>;
}

function Charts({ report }: { report: Report }) {
  const languageItems = languagePieItems(report.languages);
  const totalLines = report.total.lines;

  return (
    <div className="charts-grid">
      <div className="chart-card donut-card">
        <div className="chart-h"><span className="chart-tag">chart</span>Language share</div>
        <Donut items={languageItems} total={totalLines} report={report} />
      </div>
      <div className="chart-card table-card">
        <div className="chart-h"><span className="chart-tag">table</span>Report</div>
        <ReportTable report={report} compact />
      </div>
    </div>
  );
}

function Donut({ items, total, report }: { items: PieItem[]; total: number; report: Report }) {
  const exactTotal = formatNumber(total);
  const slices = pieSlices(items);
  const breakdown = [
    { label: "code", value: report.total.code, color: "var(--accent)" },
    { label: "comments", value: report.total.comments, color: "var(--accent-2)" },
    { label: "blanks", value: report.total.blanks, color: "var(--fg-mute)" },
  ];
  return (
    <>
      <div className="donut-wrap" role="img" aria-label="Language share by total lines">
        <svg viewBox="-1 -1 2 2">
          {slices.map((slice) => <path key={slice.label} d={slice.path} fill={slice.color} />)}
          <circle r="0.58" fill="var(--bg-2)" />
        </svg>
        <div className="donut-center" title={`${exactTotal} total lines`}>
          <span className="mute">lines</span>
          <strong aria-label={exactTotal}>{formatCompactNumber(total)}</strong>
        </div>
      </div>
      <div className="legend">
        {items.map((item) => (
          <div className="legend-row" key={item.label}>
            <span className="key-sw" style={{ background: item.color }} />
            <span className="lname">{item.label}</span>
            <span>{formatPercent(item.value, total)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function ReportTable({ report, compact }: { report: Report; compact?: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rows = useMemo(() => sortRows(report.languages, sortKey, sortDir), [report.languages, sortKey, sortDir]);

  const updateSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const toggle = (name: string) => {
    const next = new Set(expanded);
    next.has(name) ? next.delete(name) : next.add(name);
    setExpanded(next);
  };

  return (
    <div className={`table-wrap ${compact ? "compact" : ""}`}>
      <table className="report">
        <thead>
          <tr>
            <SortHead label="Language" active={sortKey === "name"} dir={sortDir} onClick={() => updateSort("name")} className="lang" />
            {(["files", "lines", "code", "comments", "blanks"] as const).map((key) => (
              <SortHead key={key} label={key} active={sortKey === key} dir={sortDir} onClick={() => updateSort(key)} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <React.Fragment key={row.name}>
              <LanguageRow row={row} expanded={expanded.has(row.name)} onToggle={() => toggle(row.name)} />
              {expanded.has(row.name) && row.children.map((child) => <LanguageRow key={`${row.name}:${child.name}`} row={child} child />)}
            </React.Fragment>
          ))}
          <tr className="totals">
            <td className="lang">Total</td>
            <NumberCell value={report.total.files} />
            <NumberCell value={report.total.lines} />
            <NumberCell value={report.total.code} />
            <NumberCell value={report.total.comments} />
            <NumberCell value={report.total.blanks} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SortHead({ label, active, dir, onClick, className }: { label: string; active: boolean; dir: string; onClick: () => void; className?: string }) {
  return <th className={className} onClick={onClick}>{label} <span className="arr">{active ? (dir === "asc" ? "^" : "v") : ""}</span></th>;
}

function LanguageRow({ row, expanded, child, onToggle }: { row: LanguageReport; expanded?: boolean; child?: boolean; onToggle?: () => void }) {
  const hasChildren = row.children.length > 0;
  return (
    <tr className={`${child ? "file-row" : "lang-row"} ${expanded ? "expanded" : ""}`}>
      <td className="lang">
        {hasChildren ? <button className="expand" type="button" onClick={(e) => { e.stopPropagation(); onToggle?.(); }}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="expand-spacer" />}
        <span className="swatch" style={{ color: languageColor(row.name) }} />
        {row.name}
      </td>
      <NumberCell value={row.stats.files} />
      <NumberCell value={row.stats.lines} />
      <NumberCell value={row.stats.code} />
      <NumberCell value={row.stats.comments} />
      <NumberCell value={row.stats.blanks} />
    </tr>
  );
}

function NumberCell({ value }: { value: number }) {
  return <td>{formatNumber(value)}</td>;
}

const statusCopy: Record<AppStatus, string> = {
  idle: "Paste a repository URL and run the analyzer.",
  queued: "Job accepted. Waiting for an analysis slot.",
  running: "Downloading archive, extracting files, and counting language statistics.",
  completed: "Analysis completed.",
  cached: "Served from commit-level cache.",
  failed: "Analysis failed.",
};

function tickerRows(report: Report): TickerRow[] {
  const rows = report.languages
    .filter((language) => language.stats.code > 0)
    .slice(0, 6);
  const max = Math.max(...rows.map((row) => row.stats.code), 1);
  return rows.map((row) => ({
    label: row.name,
    value: row.stats.code,
    color: languageColor(row.name),
    percent: Math.max(4, Math.round((row.stats.code / max) * 100)),
  }));
}

function logLines(status: AppStatus, report: Report | null, error: string | null) {
  if (status === "failed") return [{ ts: "00:00", kind: "err", text: error ?? "analysis failed" }];
  if (status === "idle") return [{ ts: "00:00", kind: "", text: "idle: command runner ready" }];
  if (status === "queued") return [{ ts: "00:01", kind: "warn", text: "queued: waiting for worker permit" }, { ts: "00:02", kind: "", text: "repository ref accepted" }];
  if (status === "running") return [{ ts: "00:01", kind: "ok", text: "ref resolved" }, { ts: "00:02", kind: "", text: "archive download in progress" }, { ts: "00:03", kind: "", text: "tokei counter running" }];
  if (report) return [{ ts: "00:01", kind: "ok", text: `resolved ${report.refName} -> ${report.commitSha.slice(0, 12)}` }, { ts: "00:02", kind: "ok", text: report.cached ? "cache hit returned" : "fresh report saved to cache" }, { ts: "00:03", kind: "ok", text: `${formatNumber(report.languages.length)} language rows rendered` }];
  return [];
}

function progressValue(status: AppStatus) {
  if (status === "idle") return 0;
  if (status === "queued") return 30;
  if (status === "running") return 64;
  if (status === "failed") return 100;
  return 100;
}

function sortRows(rows: LanguageReport[], key: SortKey, dir: "asc" | "desc") {
  return [...rows].sort((a, b) => {
    const left = key === "name" ? a.name : a.stats[key];
    const right = key === "name" ? b.name : b.stats[key];
    const result = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left) - Number(right);
    return dir === "asc" ? result : -result;
  });
}

function languagePieItems(languages: LanguageReport[]): PieItem[] {
  const sorted = [...languages].filter((language) => language.stats.lines > 0).sort((a, b) => b.stats.lines - a.stats.lines);
  const visible = sorted.slice(0, 5).map((language) => ({
    label: language.name,
    value: language.stats.lines,
    color: languageColor(language.name),
  }));
  const other = sorted.slice(5).reduce((sum, language) => sum + language.stats.lines, 0);
  if (other > 0) visible.push({ label: "Other", value: other, color: "var(--fg-mute)" });
  return visible.length > 0 ? visible : [{ label: "No data", value: 0, color: "var(--fg-mute)" }];
}

function pieSlices(items: PieItem[]) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let start = 0;
  return items.map((item) => {
    const fraction = total > 0 ? item.value / total : 0;
    const end = start + fraction;
    const path = donutSlicePath(start, end);
    start = end;
    return { ...item, path };
  });
}

function donutSlicePath(startFraction: number, endFraction: number) {
  if (endFraction - startFraction >= 0.9999) {
    return "M 1 0 A 1 1 0 1 1 -1 0 A 1 1 0 1 1 1 0";
  }
  const start = polarPoint(startFraction);
  const end = polarPoint(endFraction);
  const largeArc = endFraction - startFraction > 0.5 ? 1 : 0;
  return `M 0 0 L ${start.x} ${start.y} A 1 1 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function polarPoint(fraction: number) {
  const angle = fraction * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function languageColor(name: string) {
  const colors = ["var(--accent)", "var(--accent-2)", "var(--warn)", "var(--blue)", "var(--violet)", "var(--err)"];
  const hash = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function textReport(report: Report) {
  const lines = [`${report.repository.owner}/${report.repository.name} ${report.commitSha.slice(0, 12)}`, "Language        Files      Lines       Code   Comments     Blanks"];
  for (const row of report.languages) {
    lines.push(`${row.name.padEnd(14)} ${String(row.stats.files).padStart(6)} ${String(row.stats.lines).padStart(10)} ${String(row.stats.code).padStart(10)} ${String(row.stats.comments).padStart(10)} ${String(row.stats.blanks).padStart(10)}`);
  }
  lines.push(`${"Total".padEnd(14)} ${String(report.total.files).padStart(6)} ${String(report.total.lines).padStart(10)} ${String(report.total.code).padStart(10)} ${String(report.total.comments).padStart(10)} ${String(report.total.blanks).padStart(10)}`);
  return lines.join("\n");
}

function commandText(repoUrl: string, refName: string, forceRefresh: boolean) {
  return `octocount analyze ${repoUrl.trim() || "<repo>"}${refName.trim() ? ` --ref ${refName.trim()}` : ""}${forceRefresh ? " --force" : ""}`;
}

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatCompactNumber(value: number) {
  if (value <= 99_999) return formatNumber(value);
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number, total: number) {
  if (total === 0) return "0%";
  return `${percentNumber(value, total)}%`;
}

function percentNumber(value: number, total: number) {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}

async function analyzeRepository(request: { repoUrl: string; refName: string; forceRefresh: boolean }): Promise<AnalyzeResponse> {
  return fetchJson<AnalyzeResponse>("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repoUrl: request.repoUrl,
      refName: request.refName || undefined,
      forceRefresh: request.forceRefresh,
    }),
  });
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(apiErrorMessage(body, response.statusText));
  return body as T;
}

function apiErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    return body.message;
  }
  return fallback || "Request failed";
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
