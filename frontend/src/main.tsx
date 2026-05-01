import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Clipboard, Code2, Database, ExternalLink, FileJson, Loader2, Play, RotateCcw } from "lucide-react";
import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8080";

type JobStatus = "queued" | "running" | "completed" | "failed";

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

type SortKey = "name" | keyof Stats;

const queryClient = new QueryClient();

function App() {
  const [repoUrl, setRepoUrl] = useState("https://github.com/tokio-rs/axum");
  const [refName, setRefName] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    enabled: Boolean(jobId && !report),
    refetchInterval: (query) => {
      const data = query.state.data as JobRecord | undefined;
      return data?.status === "completed" || data?.status === "failed" ? false : 1200;
    },
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/api/jobs/${jobId}`);
      if (!response.ok) throw new Error("Unable to read job status");
      return (await response.json()) as JobRecord;
    },
  });

  const reportQuery = useQuery({
    queryKey: ["report", jobQuery.data?.reportId],
    enabled: jobQuery.data?.status === "completed" && Boolean(jobQuery.data.reportId) && !report,
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/api/reports/${jobQuery.data?.reportId}`);
      if (!response.ok) throw new Error("Unable to load report");
      return (await response.json()) as Report;
    },
  });

  useEffect(() => {
    if (reportQuery.data && !report) {
      setReport(reportQuery.data);
      setJobId(null);
    }
  }, [reportQuery.data, report]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setReport(null);
    setJobId(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoUrl, refName: refName || undefined }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.message ?? "Analysis request failed");
        return;
      }
      const result = body as AnalyzeResponse;
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

  const status = error
    ? "failed"
    : report
      ? report.cached
        ? "cached"
        : "completed"
      : jobQuery.data?.status ?? (isSubmitting ? "queued" : "idle");

  return (
    <main className="shell">
      <section className="commandPane">
        <div className="brand">
          <div className="mark"><Code2 size={19} /></div>
          <div>
            <p>OctoCount</p>
            <h1>Measure a public GitHub repo without cloning it.</h1>
          </div>
        </div>

        <form className="commandForm" onSubmit={submit}>
          <label>
            Repository URL
            <input value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="https://github.com/owner/repo" />
          </label>
          <label className="refField">
            Ref
            <input value={refName} onChange={(event) => setRefName(event.target.value)} placeholder="main, v1.0.0, or SHA" />
          </label>
          <button className="runButton" disabled={isSubmitting || !repoUrl.trim()}>
            {isSubmitting ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
            Analyze
          </button>
        </form>

        <StatusLine status={status} error={error ?? jobQuery.data?.error?.message ?? null} />
      </section>

      {report ? (
        <ReportView report={report} onReset={() => { setReport(null); setError(null); }} />
      ) : (
        <EmptyState status={status} />
      )}
    </main>
  );
}

function StatusLine({ status, error }: { status: string; error: string | null }) {
  return (
    <div className={`statusLine ${status}`}>
      <span>{status}</span>
      <p>{error ?? statusCopy[status] ?? "Ready for analysis."}</p>
    </div>
  );
}

const statusCopy: Record<string, string> = {
  idle: "Paste a repository URL and run the analyzer.",
  queued: "Job accepted. Waiting for an analysis slot.",
  running: "Downloading archive, extracting files, and counting language statistics.",
  completed: "Analysis completed.",
  cached: "Served from commit-level cache.",
};

function EmptyState({ status }: { status: string }) {
  return (
    <section className="emptyReport">
      <div className="scanline" />
      <div>
        <p className="terminalPrompt">$ sloc analyze --github</p>
        <pre>{status === "running" || status === "queued" ? "resolving commit...\ndownloading tarball...\ncounting source lines..." : "awaiting repository input..."}</pre>
      </div>
    </section>
  );
}

function ReportView({ report, onReset }: { report: Report; onReset: () => void }) {
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
    <section className="report">
      <header className="reportHeader">
        <div>
          <p className="eyebrow">Report</p>
          <h2>{report.repository.owner}/{report.repository.name}</h2>
          <div className="meta">
            <span>{report.refName}</span>
            <span>{report.commitSha.slice(0, 12)}</span>
            <span>{report.durationMs}ms</span>
            <span>{report.cached ? "cache hit" : "fresh run"}</span>
          </div>
        </div>
        <div className="actions">
          <button title="Copy text report" onClick={() => copyText(textReport(report))}><Clipboard size={16} />Text</button>
          <button title="Copy JSON report" onClick={() => copyText(JSON.stringify(report, null, 2))}><FileJson size={16} />JSON</button>
          <a href={report.repository.htmlUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />GitHub</a>
          <button title="Reset" onClick={onReset}><RotateCcw size={16} /></button>
        </div>
      </header>

      <div className="totals">
        <Metric label="Code" value={report.total.code} />
        <Metric label="Lines" value={report.total.lines} />
        <Metric label="Comments" value={report.total.comments} />
        <Metric label="Files" value={report.total.files} />
      </div>

      <div className="tableScroller">
        <table>
          <thead>
            <tr>
              <SortHead label="Language" active={sortKey === "name"} dir={sortDir} onClick={() => updateSort("name")} />
              {(["files", "lines", "code", "comments", "blanks"] as const).map((key) => (
                <SortHead key={key} label={key} active={sortKey === key} dir={sortDir} onClick={() => updateSort(key)} numeric />
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
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <NumberCell value={report.total.files} />
              <NumberCell value={report.total.lines} />
              <NumberCell value={report.total.code} />
              <NumberCell value={report.total.comments} />
              <NumberCell value={report.total.blanks} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div><span>{label}</span><strong>{formatNumber(value)}</strong></div>;
}

function SortHead({ label, active, dir, numeric, onClick }: { label: string; active: boolean; dir: string; numeric?: boolean; onClick: () => void }) {
  return <th className={numeric ? "num" : undefined}><button onClick={onClick}>{label}{active ? <span>{dir === "asc" ? "up" : "down"}</span> : null}</button></th>;
}

function LanguageRow({ row, expanded, child, onToggle }: { row: LanguageReport; expanded?: boolean; child?: boolean; onToggle?: () => void }) {
  const hasChildren = row.children.length > 0;
  return (
    <tr className={child ? "childRow" : undefined}>
      <th>
        {hasChildren ? <button className="expand" onClick={onToggle}>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button> : <span className="expandSpacer" />}
        {row.name}
      </th>
      <NumberCell value={row.stats.files} />
      <NumberCell value={row.stats.lines} />
      <NumberCell value={row.stats.code} />
      <NumberCell value={row.stats.comments} />
      <NumberCell value={row.stats.blanks} />
    </tr>
  );
}

function NumberCell({ value }: { value: number }) {
  return <td className="num">{formatNumber(value)}</td>;
}

function sortRows(rows: LanguageReport[], key: SortKey, dir: "asc" | "desc") {
  return [...rows].sort((a, b) => {
    const left = key === "name" ? a.name : a.stats[key];
    const right = key === "name" ? b.name : b.stats[key];
    const result = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left) - Number(right);
    return dir === "asc" ? result : -result;
  });
}

function textReport(report: Report) {
  const lines = [`${report.repository.owner}/${report.repository.name} ${report.commitSha.slice(0, 12)}`, "Language        Files      Lines       Code   Comments     Blanks"];
  for (const row of report.languages) {
    lines.push(`${row.name.padEnd(14)} ${String(row.stats.files).padStart(6)} ${String(row.stats.lines).padStart(10)} ${String(row.stats.code).padStart(10)} ${String(row.stats.comments).padStart(10)} ${String(row.stats.blanks).padStart(10)}`);
  }
  lines.push(`${"Total".padEnd(14)} ${String(report.total.files).padStart(6)} ${String(report.total.lines).padStart(10)} ${String(report.total.code).padStart(10)} ${String(report.total.comments).padStart(10)} ${String(report.total.blanks).padStart(10)}`);
  return lines.join("\n");
}

function copyText(value: string) {
  navigator.clipboard?.writeText(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
