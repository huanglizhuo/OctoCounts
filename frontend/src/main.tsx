import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toPng } from "html-to-image";
import { ChevronDown, ChevronRight, Clipboard, Download, ExternalLink, FileJson, Loader2, Play, RotateCcw } from "lucide-react";

const ChromeIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728Z" />
  </svg>
);

const FirefoxIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.452 3.445a11.002 11.002 0 00-2.482-1.908C16.944.997 15.098.093 12.477.032c-.734-.017-1.457.03-2.174.144-.72.114-1.398.292-2.118.56-1.017.377-1.996.975-2.574 1.554.583-.349 1.476-.733 2.55-.992a10.083 10.083 0 013.729-.167c2.341.34 4.178 1.381 5.48 2.625a8.066 8.066 0 011.298 1.587c1.468 2.382 1.33 5.376.184 7.142-.85 1.312-2.67 2.544-4.37 2.53-.583-.023-1.438-.152-2.25-.566-2.629-1.343-3.021-4.688-1.118-6.306-.632-.136-1.82.13-2.646 1.363-.742 1.107-.7 2.816-.242 4.028a6.473 6.473 0 01-.59-1.895 7.695 7.695 0 01.416-3.845A8.212 8.212 0 019.45 5.399c.896-1.069 1.908-1.72 2.75-2.005-.54-.471-1.411-.738-2.421-.767C8.31 2.583 6.327 3.061 4.7 4.41a8.148 8.148 0 00-1.976 2.414c-.455.836-.691 1.659-.697 1.678.122-1.445.704-2.994 1.248-4.055-.79.413-1.827 1.668-2.41 3.042C.095 9.37-.2 11.608.14 13.989c.966 5.668 5.9 9.982 11.843 9.982C18.62 23.971 24 18.591 24 11.956a11.93 11.93 0 00-3.548-8.511z" />
  </svg>
);
import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import initialReportData from "./initialReport.json";
import { languagePieItems, pieSlices } from "./chartUtils";
import {
  commandText,
  copyText,
  downloadDataUrl,
  formatCompactNumber,
  formatNumber,
  formatPercent,
  languageColor,
  logLines,
  progressValue,
  sortRows,
  statusCopy,
  textReport,
  tickerRows,
} from "./reportUtils";
import type { AppStatus, LanguageReport, PieItem, Report, Scheme, SortKey, Stats } from "./types";
import { useAnalysisRunner } from "./useAnalysisRunner";

const queryClient = new QueryClient();
const showSharePreview = import.meta.env.DEV && import.meta.env.VITE_DEBUG_SHARE_PREVIEW === "true";
const defaultRepoUrl = "https://github.com/huanglizhuo/OctoCount";
const defaultRefName = "e92153946164";
const extensionInfo = {
  name: "OctoCounts — GitHub SLOC",
  version: "0.1.3",
  chromeWebStoreUrl: "https://chromewebstore.google.com/detail/octocounts-%E2%80%94-github-sloc/gkgjpjdnaklagijmekoolhcpebmoldbj",
  firefoxAddOnsUrl: "https://addons.mozilla.org/en-US/firefox/addon/octocounts-github-sloc",
};
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
  const {
    report,
    error,
    isSubmitting,
    lastCommand,
    status,
    setLastCommand,
    runAnalysis,
    reset,
  } = useAnalysisRunner({
    repoUrl,
    refName,
    defaultRepoUrl,
    defaultRefName,
    seedReport,
  });

  useEffect(() => {
    document.documentElement.dataset.scheme = scheme;
  }, [scheme]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setScheme(e.matches ? "matrix" : "paper");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

const submit = (event: FormEvent) => {
    event.preventDefault();
    void runAnalysis(false);
  };

  return (
    <>
      <div className="crt flicker" />
      <main className="page">
        <Topbar />
        <section className="hero" aria-label="Repository analyzer">
          <div className="hero-left">
            <TopActions scheme={scheme} setScheme={setScheme} status={status} />
            <h1 className="title">The SLOC panel <span className="glow">GitHub forgot</span>.</h1>
            <p className="subtitle">Install the browser extension to see SLOC directly in GitHub's repo sidebar, or paste a public repo URL here for the full web report. Powered by <a href="https://github.com/XAMPPRocky/tokei" target="_blank" rel="noreferrer">tokei</a>, no clone required.</p>
            <form className="input-row" onSubmit={submit}>
              <span className="prompt">$</span>
              <input
                id="repo-url"
                name="repoUrl"
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
            <div className="hero-paths" aria-label="OctoCounts usage paths">
              <a className="btn install-btn" href={extensionInfo.chromeWebStoreUrl} target="_blank" rel="noreferrer">
                <ChromeIcon size={15} />
                Chrome Web Store
              </a>
              <a className="copybtn install-btn secondary-install" href={extensionInfo.firefoxAddOnsUrl} target="_blank" rel="noreferrer">
                <FirefoxIcon size={14} />
                Firefox Add-ons
              </a>
              <span>See SLOC directly in GitHub's repo sidebar.</span>
            </div>
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
            error={error}
            onReset={reset}
            onRerun={() => void runAnalysis(true)}
          />
        </section>

        <section>
          <div className="section-h">
            <span className="num">02</span>
            <h2>Browser Extension</h2>
            <span className="sub">sidebar counts on GitHub</span>
          </div>
          <BrowserExtensionSection />
        </section>

        <section>
          <div className="section-h">
            <span className="num">03</span>
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
          <span>OctoCounts // actual SLOC for public GitHub repos</span>
          <span><a href="/privacy">Privacy</a> · <a href="/contact">Contact</a> · Built by <a href="https://github.com/huanglizhuo" target="_blank" rel="noreferrer">huanglizhuo</a> · (c) 2026</span>
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
      <div className="topbar-links">
        <a className="github-link install-link" href={extensionInfo.chromeWebStoreUrl} target="_blank" rel="noreferrer">
          <ChromeIcon size={18} />
          <span>Chrome</span>
        </a>
        <a className="github-link install-link" href={extensionInfo.firefoxAddOnsUrl} target="_blank" rel="noreferrer">
          <FirefoxIcon size={18} />
          <span>Firefox</span>
        </a>
        <a className="github-link icon-link" href={defaultRepoUrl} target="_blank" rel="noreferrer" aria-label="View OctoCounts on GitHub">
          <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>
        </a>
      </div>
    </header>
  );
}

function BrowserExtensionSection() {
  const features = [
    "Repo sidebar card",
    "Total/code/comment/blank counts",
    "Language table",
    "Local cache",
    "Auto-analyze setting",
    "Placement setting",
  ];

  return (
    <div className="extension-panel">
      <div className="extension-preview">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcSet="/octocounts-dark-card.webp" />
          <source media="(prefers-color-scheme: light)" srcSet="/octocounts-light-card.webp" />
          <img src="/octocounts-light-card.webp" alt="OctoCounts browser extension showing SLOC results on a GitHub repository" loading="lazy" />
        </picture>
      </div>
      <div className="extension-copy">
        <div className="terminal-label">browser-extension@octocounts v{extensionInfo.version}</div>
        <h3>{extensionInfo.name}</h3>
        <p>Open a GitHub repository and OctoCounts adds a compact SLOC card to the repo sidebar. Click the card for the full panel with totals, language rows, and cached results.</p>
        <ul className="extension-features">
          {features.map((feature) => <li key={feature}>{feature}</li>)}
        </ul>
        <div className="extension-actions">
          <a className="btn install-btn" href={extensionInfo.chromeWebStoreUrl} target="_blank" rel="noreferrer">
            <ChromeIcon size={15} />
            Install from Chrome Web Store
          </a>
          <a className="copybtn install-btn secondary-install" href={extensionInfo.firefoxAddOnsUrl} target="_blank" rel="noreferrer">
            <FirefoxIcon size={14} />
            Install from Firefox Add-ons
          </a>
          <a className="copybtn" href={defaultRepoUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            View source
          </a>
        </div>
      </div>
    </div>
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

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
