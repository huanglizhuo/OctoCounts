import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toPng } from "html-to-image";
import { ChevronDown, ChevronRight, Clipboard, Download, ExternalLink, FileJson, Loader2, Play, RotateCcw } from "lucide-react";
import React, { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import "./i18n";
import { ChromeIcon, FirefoxIcon } from "./icons";
import { defaultRepoUrl, defaultRefName, extensionInfo } from "./constants";

const BrowserExtensionSection = React.lazy(() => import("./BrowserExtensionSection"));
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
  textReport,
  tickerRows,
} from "./reportUtils";
import type { AppStatus, LanguageReport, PieItem, Report, Scheme, SortKey, Stats } from "./types";
import { useAnalysisRunner } from "./useAnalysisRunner";

const queryClient = new QueryClient();
const showSharePreview = import.meta.env.DEV && import.meta.env.VITE_DEBUG_SHARE_PREVIEW === "true";
const samples = [
  { label: "octocount", repoUrl: defaultRepoUrl, refName: defaultRefName },
  { label: "axum", repoUrl: "https://github.com/tokio-rs/axum", refName: "" },
  { label: "vite", repoUrl: "https://github.com/vitejs/vite", refName: "" },
];

const seedReport = initialReportData as Report;

function App() {
  const { t, i18n } = useTranslation();
  const [scheme, setScheme] = useState<Scheme>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "matrix" : "paper"
  );
  const [repoUrl, setRepoUrl] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const [refName, setRefName] = useState(() => new URLSearchParams(window.location.search).get("ref") ?? "");
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

  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoRan.current && repoUrl) {
      autoRan.current = true;
      void runAnalysis(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.dataset.scheme = scheme;
  }, [scheme]);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

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
        <section className="hero" aria-label={t("hero.title")}>
          <div className="hero-left">
            <TopActions scheme={scheme} setScheme={setScheme} status={status} />
            <h1 className="title">
              <Trans i18nKey="hero.title" components={{ 1: <span className="glow" /> }} />
            </h1>
            <p className="subtitle">
              <Trans i18nKey="hero.subtitle" components={{ 1: <a href="https://github.com/XAMPPRocky/tokei" target="_blank" rel="noreferrer" /> }} />
            </p>
            <div className="social-proof">
              <a href="https://github.com/huanglizhuo/OctoCount" target="_blank" rel="noreferrer" className="proof-badge">{t("hero.badgeOpenSource")}</a>
              <span className="proof-badge">{t("hero.badgeFree")}</span>
              <span className="proof-badge">{t("hero.badgeLanguages")}</span>
            </div>
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
                placeholder={t("hero.placeholderUrl")}
                aria-label={t("hero.ariaUrl")}
              />
              <label className="ref">
                {t("hero.refLabel")}
                <input id="repo-ref" name="refName" value={refName} onChange={(event) => setRefName(event.target.value)} placeholder={t("hero.refPlaceholder")} aria-label={t("hero.ariaRef")} />
              </label>
              <button className="btn" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
                {t("hero.analyze")}
              </button>
            </form>
            <div className="hero-paths" aria-label={t("hero.sidebarHint")}>
              <a className="btn install-btn" href={extensionInfo.chromeWebStoreUrl} target="_blank" rel="noreferrer">
                <ChromeIcon size={15} />
                {t("hero.installChrome")}
              </a>
              <a className="copybtn install-btn secondary-install" href={extensionInfo.firefoxAddOnsUrl} target="_blank" rel="noreferrer">
                <FirefoxIcon size={14} />
                {t("hero.installFirefox")}
              </a>
              <span>{t("hero.sidebarHint")}</span>
            </div>
            <div className="quick-rows" aria-label={t("hero.ariaSamples")}>
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
                  <span className="k">{t("samples.label")}</span>{sample.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="section-h">
            <span className="num">01</span>
            <h2>{t("runner.title")}</h2>
            <span className="sub">{t("runner.status." + status)}</span>
          </div>
          {!repoUrl && (
            <p className="demo-note">{t("runner.demoNote")}</p>
          )}
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
            <h2>{t("extensionSection.title")}</h2>
            <span className="sub">{t("extensionSection.subtitle")}</span>
          </div>
          <Suspense fallback={null}>
            <BrowserExtensionSection />
          </Suspense>
        </section>

        <section>
          <div className="section-h">
            <span className="num">03</span>
            <h2>{t("useCases.title")}</h2>
            <span className="sub">{t("useCases.subtitle")}</span>
          </div>
          <div className="how">
            {(t("useCases.cases", { returnObjects: true }) as Array<{ title: string; text: string }>).map((item, idx) => (
              <div className="step" key={idx}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="section-h">
            <span className="num">04</span>
            <h2>{t("howItWorks.title")}</h2>
            <span className="sub">{t("howItWorks.subtitle")}</span>
          </div>
          <div className="how">
            {(t("howItWorks.steps", { returnObjects: true }) as Array<{ num: string; title: string; text: string; code: string }>).map((step) => (
              <div className="step" key={step.num}>
                <span className="n">{step.num}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                <div className="codeline">
                  <Trans i18nKey={`howItWorks.steps.${Number(step.num) - 1}.code`} components={{ 1: <span className="c" /> }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer>
          <span>{t("footer.tagline")}</span>
          <span>
            <a href="/privacy">{t("footer.privacy")}</a> &middot; <a href="/contact">{t("footer.contact")}</a> &middot;
            <Trans i18nKey="footer.builtBy" components={{ 1: <a href="https://github.com/huanglizhuo" target="_blank" rel="noreferrer" /> }} />
            {" "}{t("footer.copyright")}
          </span>
          <LanguageSwitcher />
        </footer>
      </main>
    </>
  );
}

function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const locales = [
    { code: "en", label: "EN" },
    { code: "zh", label: "\u4e2d\u6587" },
  ];
  return (
    <div className="language-switcher" role="group" aria-label={t("languageSwitcher.label")} style={{ marginTop: 8 }}>
      {locales.map((loc) => (
        <button
          key={loc.code}
          type="button"
          className="lang-btn"
          aria-current={i18n.language === loc.code ? "true" : undefined}
          onClick={() => i18n.changeLanguage(loc.code)}
        >
          {loc.label}
        </button>
      ))}
    </div>
  );
}

function Topbar() {
  const { t } = useTranslation();
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo"><img src="/favicons/web-app-manifest-192x192.png" alt={t("topbar.brandName") + " logo"} /></div>
        <div>
          <span className="brand-name">{t("topbar.brandName")}</span>
        </div>
      </div>
      <div className="topbar-links">
        <a className="github-link install-link" href={extensionInfo.chromeWebStoreUrl} target="_blank" rel="noreferrer">
          <ChromeIcon size={18} />
          <span>{t("topbar.chrome")}</span>
        </a>
        <a className="github-link install-link" href={extensionInfo.firefoxAddOnsUrl} target="_blank" rel="noreferrer">
          <FirefoxIcon size={18} />
          <span>{t("topbar.firefox")}</span>
        </a>
        <a className="github-link icon-link" href={defaultRepoUrl} target="_blank" rel="noreferrer" aria-label={t("topbar.githubAria")}>
          <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>
        </a>
      </div>
    </header>
  );
}

function TopActions({ scheme, setScheme, status }: { scheme: Scheme; setScheme: (scheme: Scheme) => void; status: AppStatus }) {
  const { t } = useTranslation();
  return (
    <div className="top-actions">
      <div className="theme-switch" role="group" aria-label={t("theme.ariaLabel")}>
        {(["matrix", "paper", "amber"] as const).map((item) => (
          <button className={`theme-btn ${scheme === item ? "active" : ""}`} key={item} onClick={() => setScheme(item)} type="button">
            <span className={`theme-sw ${item}`} />
            {t("theme." + item)}
          </button>
        ))}
      </div>
      <span className="pill"><span className={`dot ${status === "idle" ? "idle" : ""}`} />{t("runner.statusShort." + status)}</span>
    </div>
  );
}

function Runner({ command, status, report, error, onReset, onRerun }: { command: string; status: AppStatus; report: Report | null; error: string | null; onReset: () => void; onRerun: () => void }) {
  const { t } = useTranslation();
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
          <span className="pill"><span className={`dot ${status === "idle" ? "idle" : ""}`} />{t("runner.statusShort." + status)}</span>
          <code>$ {command}</code>
        </div>
        <div className="row-flex">
          {report ? <span>{report.refName} / {report.commitSha.slice(0, 12)} / {report.cached ? t("runner.cacheHit") : t("runner.freshRun")}</span> : <span>{t("runner.status." + status)}</span>}
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
            <span>{t("runner.generated", { date: new Date(report.generatedAt).toLocaleString(), duration: report.durationMs, version: report.tokeiVersion })}</span>
            <div className="actions">
              <button className="copybtn" onClick={() => copyText(textReport(report))}><Clipboard size={14} /> {t("runner.exportText")}</button>
              <button className="copybtn" onClick={() => copyText(JSON.stringify(report, null, 2))}><FileJson size={14} /> {t("runner.exportJson")}</button>
              <button className="copybtn" disabled={isExporting} onClick={() => void exportPng()}><Download size={14} /> {t("runner.exportPng")}</button>
              <a className="copybtn" href={report.repository.htmlUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {t("runner.exportGitHub")}</a>
              <button className="copybtn" onClick={onRerun}><RotateCcw size={14} /> {t("runner.reRun")}</button>
              <button className="copybtn" onClick={onReset}>{t("runner.clear")}</button>
            </div>
          </div>
          <div className="share-export-host" aria-hidden="true">
            <ShareTickerCard ref={shareCardRef} report={report} />
          </div>
          {showSharePreview ? (
            <section className="share-preview" aria-label={t("sharePreview.pngExportPreview")}>
              <div className="section-h">
                <span>{t("sharePreview.debug")}</span>
                <span className="sub">{t("sharePreview.pngExportPreview")}</span>
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
  const { t } = useTranslation();
  const rows = tickerRows(report).slice(0, 6);
  const hasMoreLanguages = report.languages.length > rows.length;
  const total = report.total.code + report.total.comments + report.total.blanks;
  return (
    <div className="share-card" ref={ref}>
      <div className="share-window">
        <div className="share-head">
          <div className="lights"><span className="r" /><span className="y" /><span className="g" /></div>
          <span>{t("shareCard.title")}</span>
        </div>
        <div className="share-body">
          <div className="share-kicker">{report.repository.owner}/{report.repository.name}</div>
          <div className="share-ref">{report.refName} / {report.commitSha.slice(0, 12)}</div>
          <div className="share-total">
            <span>{t("shareCard.totalLoc")}</span>
            <strong>{formatNumber(report.total.lines)}</strong>
          </div>
          <div className="share-breakdown">
            <ShareStat color="var(--accent)" label={t("shareCard.labelCode")} value={report.total.code} />
            <ShareStat color="var(--accent-2)" label={t("shareCard.labelComments")} value={report.total.comments} />
            <ShareStat color="var(--violet)" label={t("shareCard.labelBlanks")} value={report.total.blanks} />
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
            {hasMoreLanguages ? <div className="share-ticker-note">{t("shareCard.topLanguages")}</div> : null}
          </div>
          <div className="share-foot">
            <span>{t("shareCard.percentCode", { percent: formatPercent(report.total.code, total) })}</span>
            <span>{t("shareCard.generatedBy")}</span>
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
  const { t } = useTranslation();
  return (
    <div className="summary">
      <Metric label={t("summary.files")} value={stats.files} />
      <Metric label={t("summary.lines")} value={stats.lines} />
      <Metric label={t("summary.code")} value={stats.code} accent />
      <Metric label={t("summary.comments")} value={stats.comments} />
      <Metric label={t("summary.blanks")} value={stats.blanks} />
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return <div className={`cell ${accent ? "accent" : ""}`}><div className="lbl">{label}</div><div className="val">{formatNumber(value)}</div></div>;
}

function Charts({ report }: { report: Report }) {
  const { t } = useTranslation();
  const languageItems = useMemo(() => languagePieItems(report.languages), [report.languages]);
  const totalLines = report.total.lines;

  return (
    <div className="charts-grid">
      <div className="chart-card donut-card">
        <div className="chart-h"><span className="chart-tag">chart</span>{t("charts.languageShare")}</div>
        <Donut items={languageItems} total={totalLines} report={report} />
      </div>
      <div className="chart-card table-card">
        <div className="chart-h"><span className="chart-tag">table</span>{t("charts.report")}</div>
        <ReportTable report={report} compact />
      </div>
    </div>
  );
}

function Donut({ items, total, report }: { items: PieItem[]; total: number; report: Report }) {
  const { t } = useTranslation();
  const exactTotal = formatNumber(total);
  const slices = pieSlices(items);
  const breakdown = [
    { label: t("summary.code"), value: report.total.code, color: "var(--accent)" },
    { label: t("summary.comments"), value: report.total.comments, color: "var(--accent-2)" },
    { label: t("summary.blanks"), value: report.total.blanks, color: "var(--fg-mute)" },
  ];
  return (
    <>
      <div className="donut-wrap" role="img" aria-label={t("charts.languageShare")}>
        <svg viewBox="-1 -1 2 2">
          {slices.map((slice) => <path key={slice.label} d={slice.path} fill={slice.color} />)}
          <circle r="0.58" fill="var(--bg-2)" />
        </svg>
        <div className="donut-center" title={t("charts.totalLinesTooltip", { count: exactTotal })}>
          <span className="mute">{t("charts.lines")}</span>
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
  const { t } = useTranslation();
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
            <SortHead label={t("table.language")} active={sortKey === "name"} dir={sortDir} onClick={() => updateSort("name")} className="lang" />
            {(["files", "lines", "code", "comments", "blanks"] as const).map((key) => (
              <SortHead key={key} label={t("table." + key)} active={sortKey === key} dir={sortDir} onClick={() => updateSort(key)} />
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
            <td className="lang">{t("table.total")}</td>
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
  return (
    <th
      className={className}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      tabIndex={0}
      role="columnheader"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label} <span className="arr">{active ? (dir === "asc" ? "^" : "v") : ""}</span>
    </th>
  );
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
