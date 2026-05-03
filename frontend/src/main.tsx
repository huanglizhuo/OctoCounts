import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Clipboard, ExternalLink, FileJson, Github, Loader2, Play, RotateCcw } from "lucide-react";
import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8080";

type JobStatus = "queued" | "running" | "completed" | "failed";
type AppStatus = JobStatus | "idle" | "cached";
type Scheme = "matrix" | "paper" | "amber";
type TerminalVariant = "ticker" | "ascii" | "typing";
type SortKey = "name" | keyof Stats;
type PieItem = { label: string; value: number; color: string };

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
const terminalVariants: { id: TerminalVariant; label: string }[] = [
  { id: "ticker", label: "live ticker" },
  { id: "ascii", label: "ascii octopus" },
  { id: "typing", label: "typing terminal" },
];

function App() {
  const [scheme, setScheme] = useState<Scheme>("matrix");
  const [repoUrl, setRepoUrl] = useState(defaultRepoUrl);
  const [refName, setRefName] = useState(defaultRefName);
  const [jobId, setJobId] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastCommand, setLastCommand] = useState(commandText(defaultRepoUrl, defaultRefName, false));
  const [terminalVariant, setTerminalVariant] = useState<TerminalVariant>("ticker");

  useEffect(() => {
    document.documentElement.dataset.scheme = scheme;
  }, [scheme]);

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
    setError(null);
    setReport(null);
    setJobId(null);
    setIsSubmitting(true);
    const command = commandText(repoUrl, refName, forceRefresh);
    setLastCommand(command);

    try {
      const result = await analyzeRepository({ repoUrl, refName, forceRefresh });
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
            <h2 className="kicker">sloc for github</h2>
            <h1 className="title">Count code lines at <span className="glow">commit speed</span>.</h1>
            <p className="lede">
              Run OctoCount against a public repository archive, resolve a real ref, and render language, comment, blank, and file totals from the backend cache or a fresh job.
            </p>
            <form className="input-row" onSubmit={submit}>
              <span className="prompt">$</span>
              <input value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="https://github.com/owner/repo" aria-label="Repository URL" />
              <label className="ref">
                ref
                <input value={refName} onChange={(event) => setRefName(event.target.value)} placeholder="main" aria-label="Optional ref" />
              </label>
              <button className="btn" disabled={isSubmitting || !repoUrl.trim()}>
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
            <div className="meta-row">
              <span><b>cache</b> commit + tokei version</span>
              <span><b>limit</b> public GitHub archives</span>
              <span><b>mode</b> {scheme}</span>
            </div>
          </div>
          <TerminalPreview
            status={status}
            report={report}
            command={lastCommand}
            error={error ?? jobQuery.data?.error?.message ?? null}
            variant={terminalVariant}
            setVariant={setTerminalVariant}
          />
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
              <p>OctoCount validates the public GitHub URL, resolves the requested branch, tag, or SHA, and pins the run to a commit.</p>
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
          <span>OctoCount // public repository source line counts</span>
          <span>(c) 2026</span>
        </footer>
      </main>
    </>
  );
}

function Topbar() {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo"><img src="/favicons/web-app-manifest-192x192.png" alt="" /></div>
        <div>
          <h1>OctoCount</h1>
          <div className="tag">repo telemetry terminal</div>
        </div>
      </div>
      <a className="github-link" href={defaultRepoUrl} target="_blank" rel="noreferrer">
        <Github size={16} />
        GitHub
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

function TerminalPreview({
  status,
  report,
  command,
  error,
  variant,
  setVariant,
}: {
  status: AppStatus;
  report: Report | null;
  command: string;
  error: string | null;
  variant: TerminalVariant;
  setVariant: (variant: TerminalVariant) => void;
}) {
  return (
    <aside className="term-wrap" aria-label="Terminal preview">
      <div className="variant-tabs" role="group" aria-label="Terminal design">
        {terminalVariants.map((item) => (
          <button className={variant === item.id ? "active" : ""} key={item.id} onClick={() => setVariant(item.id)} type="button">
            {item.label}
          </button>
        ))}
      </div>
      <div className="term">
        <div className="term-head">
          <div className="lights"><span className="r" /><span className="y" /><span className="g" /></div>
          <span>octocount://{variant}</span>
        </div>
        <div className={`term-body ${variant}`}>
          {variant === "ticker" ? <LiveTicker report={report} status={status} /> : null}
          {variant === "ascii" ? <AsciiOctopus status={status} report={report} command={command} error={error} /> : null}
          {variant === "typing" ? <TypingTerminal status={status} report={report} command={command} error={error} /> : null}
        </div>
      </div>
    </aside>
  );
}

function LiveTicker({ report, status }: { report: Report | null; status: AppStatus }) {
  const rows = tickerRows(report);
  return (
    <div className="ticker" aria-label="Live language ticker">
      <div className="ticker-head">
        <span>live ticker</span>
        <span>{status}</span>
      </div>
      {rows.map((row) => (
        <div className="ticker-row" key={row.label}>
          <span className="lang"><span className="key-sw" style={{ background: row.color }} />{row.label}</span>
          <span className="ticker-track"><i style={{ width: `${row.percent}%`, background: row.color }} /></span>
          <span className="num">{formatNumber(row.value)}</span>
        </div>
      ))}
      <div className="ticker-foot">
        <span>{report ? `${report.repository.owner}/${report.repository.name}` : "sample stream"}</span>
        <span>{report ? report.commitSha.slice(0, 12) : "awaiting run"}</span>
      </div>
    </div>
  );
}

function AsciiOctopus({ status, report, command, error }: { status: AppStatus; report: Report | null; command: string; error: string | null }) {
  return (
    <>
      <pre className="ascii-hero large">{asciiOctoLarge}</pre>
      {terminalLines(status, report, command, error).map((line, index) => (
        <div className="l" key={`${line}:${index}`} dangerouslySetInnerHTML={{ __html: line }} />
      ))}
      {(status === "idle" || status === "queued" || status === "running") && <span className="caret" />}
    </>
  );
}

function TypingTerminal({ status, report, command, error }: { status: AppStatus; report: Report | null; command: string; error: string | null }) {
  return (
    <div className="typing-lines">
      {terminalLines(status, report, command, error).map((line, index) => (
        <div className="type-line" key={`${line}:${index}`} style={{ "--delay": `${index * 420}ms` } as React.CSSProperties}>
          <span dangerouslySetInnerHTML={{ __html: line }} />
        </div>
      ))}
      {(status === "idle" || status === "queued" || status === "running") && <span className="caret" />}
    </div>
  );
}

function Runner({ command, status, report, error, onReset, onRerun }: { command: string; status: AppStatus; report: Report | null; error: string | null; onReset: () => void; onRerun: () => void }) {
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
          <ReportTable report={report} />
          <div className="runner-foot">
            <span>generated {new Date(report.generatedAt).toLocaleString()} / {report.durationMs}ms / {report.tokeiVersion}</span>
            <div className="actions">
              <button className="copybtn" onClick={() => copyText(textReport(report))}><Clipboard size={14} /> text</button>
              <button className="copybtn" onClick={() => copyText(JSON.stringify(report, null, 2))}><FileJson size={14} /> json</button>
              <a className="copybtn" href={report.repository.htmlUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> github</a>
              <button className="copybtn" onClick={onRerun}><RotateCcw size={14} /> re-run</button>
              <button className="copybtn" onClick={onReset}>clear</button>
            </div>
          </div>
        </>
      ) : null}
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
  const total = report.total.code + report.total.comments + report.total.blanks;
  const codePct = percentNumber(report.total.code, total);
  const commentsPct = percentNumber(report.total.comments, total);
  const blanksPct = Math.max(0, 100 - codePct - commentsPct);

  return (
    <div className="charts-grid">
      <div className="chart-card donut-card">
        <div className="chart-h"><span className="chart-tag">chart</span>Language share</div>
        <Donut items={languageItems} total={languageItems.reduce((sum, item) => sum + item.value, 0)} />
      </div>
      <div className="chart-card">
        <div className="chart-h"><span className="chart-tag">bars</span>Top languages</div>
        <div className="stacked-list">
          {report.languages.slice(0, 8).map((language) => (
            <StackedRow key={language.name} language={language} total={Math.max(language.stats.lines, 1)} />
          ))}
        </div>
      </div>
      <div className="chart-card full">
        <div className="chart-h"><span className="chart-tag">mix</span>Line composition</div>
        <div className="comp-bar">
          <div className="comp-seg comp-code" style={{ width: `${codePct}%` }}><span>code</span><b>{codePct}%</b></div>
          <div className="comp-seg comp-cmt" style={{ width: `${commentsPct}%` }}><span>comments</span><b>{commentsPct}%</b></div>
          <div className="comp-seg comp-blk" style={{ width: `${blanksPct}%` }}><span>blanks</span><b>{blanksPct}%</b></div>
        </div>
        <div className="comp-foot">
          <span><b>{formatNumber(report.total.code)}</b> code</span>
          <span><b>{formatNumber(report.total.comments)}</b> comments</span>
          <span><b>{formatNumber(report.total.blanks)}</b> blanks</span>
        </div>
      </div>
    </div>
  );
}

function Donut({ items, total }: { items: PieItem[]; total: number }) {
  const slices = pieSlices(items);
  return (
    <>
      <div className="donut-wrap" role="img" aria-label="Language share by code lines">
        <svg viewBox="-1 -1 2 2">
          {slices.map((slice) => <path key={slice.label} d={slice.path} fill={slice.color} />)}
          <circle r="0.58" fill="var(--bg-2)" />
        </svg>
        <div className="donut-center"><span className="mute">code</span><strong>{formatNumber(total)}</strong></div>
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

function StackedRow({ language, total }: { language: LanguageReport; total: number }) {
  return (
    <div className="stk-row">
      <span className="stk-label">{language.name}</span>
      <span className="stk-track">
        <span className="stk-bar">
          <i className="seg-code" style={{ width: `${percentNumber(language.stats.code, total)}%` }} />
          <i className="seg-cmt" style={{ width: `${percentNumber(language.stats.comments, total)}%` }} />
          <i className="seg-blk" style={{ width: `${percentNumber(language.stats.blanks, total)}%` }} />
        </span>
      </span>
      <span className="stk-num">{formatNumber(language.stats.code)}</span>
    </div>
  );
}

function ReportTable({ report }: { report: Report }) {
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
    <div className="table-wrap">
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
    <tr className={`${child ? "file-row" : "lang-row"} ${expanded ? "expanded" : ""}`} onClick={hasChildren ? onToggle : undefined}>
      <td className="lang">
        {hasChildren ? <button className="expand" type="button">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="expand-spacer" />}
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

const asciiOctoLarge = [
  "             .-.",
  "          .-(   )-.",
  "       .-(  OCTO  )-.",
  "      (___COUNT___)",
  "       /  /  |  \\  \\",
  "      /__/___|___\\__\\",
  "        /   / \\   \\",
  "       /___/   \\___\\",
].join("\n");

const sampleTickerRows = [
  { label: "Rust", value: 12480, color: "var(--accent)", percent: 92 },
  { label: "TypeScript", value: 8420, color: "var(--accent-2)", percent: 62 },
  { label: "CSS", value: 2984, color: "var(--warn)", percent: 22 },
  { label: "Shell", value: 860, color: "var(--violet)", percent: 8 },
];

function terminalLines(status: AppStatus, report: Report | null, command: string, error: string | null) {
  const safeCommand = escapeHtml(command);
  if (status === "idle") {
    return [`<span class="hl">$</span> ${safeCommand}`, `<span class="mute">ready: awaiting repository input</span>`];
  }
  if (status === "failed") {
    return [`<span class="hl">$</span> ${safeCommand}`, `<span class="err">error:</span> ${escapeHtml(error ?? "analysis failed")}`];
  }
  if (status === "queued") {
    return [`<span class="hl">$</span> ${safeCommand}`, `<span class="warn">queued</span> resolving repository ref...`];
  }
  if (status === "running") {
    return [`<span class="hl">$</span> ${safeCommand}`, `download archive...`, `extract tree...`, `<span class="hl">count source lines...</span>`];
  }
  if (report) {
    return [
      `<span class="hl">$</span> ${safeCommand}`,
      `<span class="ok">ok</span> ${escapeHtml(report.repository.owner)}/${escapeHtml(report.repository.name)} @ ${report.commitSha.slice(0, 12)}`,
      `files=${formatNumber(report.total.files)} lines=${formatNumber(report.total.lines)} code=${formatNumber(report.total.code)}`,
      `${report.cached ? "cache hit" : "fresh run"} / ${report.durationMs}ms`,
    ];
  }
  return [`<span class="hl">$</span> ${safeCommand}`];
}

function tickerRows(report: Report | null) {
  if (!report) return sampleTickerRows;
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
  const sorted = [...languages].filter((language) => language.stats.code > 0).sort((a, b) => b.stats.code - a.stats.code);
  const visible = sorted.slice(0, 5).map((language) => ({
    label: language.name,
    value: language.stats.code,
    color: languageColor(language.name),
  }));
  const other = sorted.slice(5).reduce((sum, language) => sum + language.stats.code, 0);
  if (other > 0) visible.push({ label: "Other", value: other, color: "var(--fg-mute)" });
  return visible.length > 0 ? visible : [{ label: "No code", value: 0, color: "var(--fg-mute)" }];
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

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatPercent(value: number, total: number) {
  if (total === 0) return "0%";
  return `${percentNumber(value, total)}%`;
}

function percentNumber(value: number, total: number) {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
