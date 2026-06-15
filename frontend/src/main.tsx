import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toPng } from "html-to-image";
import { ChevronDown, ChevronRight, Clipboard, Download, ExternalLink, FileJson, Loader2, Play, RotateCcw } from "lucide-react";
import React, { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import i18n from "./i18n";
import { ChromeIcon, FirefoxIcon } from "./icons";
import { defaultRepoUrl, defaultRefName, extensionInfo } from "./constants";
import { analyzeRepository, fetchJson } from "./api";

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
import type { AnalysisOptions, AppStatus, LanguageReport, PieItem, Report, Scheme, SortKey, Stats } from "./types";
import type { JobRecord } from "./types";
import { useAnalysisRunner } from "./useAnalysisRunner";

const queryClient = new QueryClient();
const showSharePreview = import.meta.env.DEV && import.meta.env.VITE_DEBUG_SHARE_PREVIEW === "true";
const BADGE_API_BASE = (import.meta.env.VITE_BADGE_API_BASE ?? "https://api.octocounts.com") as string;
const samples = [
  { label: "octocount", repoUrl: defaultRepoUrl, refName: defaultRefName },
  { label: "axum", repoUrl: "https://github.com/tokio-rs/axum", refName: "" },
  { label: "vite", repoUrl: "https://github.com/vitejs/vite", refName: "" },
];
const defaultIgnoredDirs = [".cache", ".git", ".next", "build", "dist", "node_modules", "target", "vendor"];
const badgeTypes = ["summary", "code", "lines", "files", "comments", "languages", "top-language", "ratio", "language"] as const;
const defaultAnalysisOptions: AnalysisOptions = {
  ignoredDirs: [],
  ignoredLanguages: [],
  profile: "default",
  includeDocs: true,
  includeTests: true,
  includeGenerated: true,
};

const seedReport = normalizeReport(initialReportData as unknown as Report);

function App() {
  const { t, i18n } = useTranslation();
  const initialRequest = useMemo(() => initialRequestFromLocation(), []);
  const [scheme, setScheme] = useState<Scheme>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "matrix" : "paper"
  );
  const [repoUrl, setRepoUrl] = useState(() => initialRequest.repoUrl);
  const [refName, setRefName] = useState(() => initialRequest.refName);
  const [analysisOptions, setAnalysisOptions] = useState<AnalysisOptions>(() => defaultAnalysisOptions);
  const {
    report,
    error,
    errorCode,
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
    analysisOptions,
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
    syncPageMetadata({ report, repoUrl, refName, defaultTitle: t("app.title"), defaultDescription: t("app.description") });
  }, [report, repoUrl, refName, t, i18n.language]);

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
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="crt flicker" />
      <main id="main" className="page">
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
            <AnalysisOptionsPanel options={analysisOptions} setOptions={setAnalysisOptions} />
            {report && <BadgeEmbed report={report} refName={refName} />}
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

        <section className="trust-strip" aria-label={t("hero.ariaTrust")}>
          <div className="social-proof">
            <a href="https://github.com/huanglizhuo/OctoCount" target="_blank" rel="noreferrer" className="proof-badge">{t("hero.badgeOpenSource")}</a>
            <span className="proof-badge">{t("hero.badgeFree")}</span>
            <span className="proof-badge">{t("hero.badgeLanguages")}</span>
          </div>
        </section>

        <section>
          <div className="section-h">
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
            errorCode={errorCode}
            onReset={reset}
            onRerun={() => void runAnalysis(true)}
          />
        </section>

        <section>
          <div className="section-h">
            <h2>{t("badgeBuilder.title")}</h2>
            <span className="sub">{t("badgeBuilder.subtitle")}</span>
          </div>
          <BadgeBuilder repoUrl={repoUrl} refName={refName} report={report} />
        </section>

        <section>
          <div className="section-h">
            <h2>{t("compare.title")}</h2>
            <span className="sub">{t("compare.subtitle")}</span>
          </div>
          <CompareRepos />
        </section>

        <section>
          <div className="section-h">
            <h2>{t("diff.title")}</h2>
            <span className="sub">{t("diff.subtitle")}</span>
          </div>
          <DiffRefs />
        </section>

        <section>
          <div className="section-h">
            <h2>{t("extensionSection.title")}</h2>
            <span className="sub">{t("extensionSection.subtitle")}</span>
          </div>
          <Suspense fallback={null}>
            <BrowserExtensionSection />
          </Suspense>
        </section>

        <section>
          <div className="section-h">
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
            <a href="/docs/api.html">{t("footer.apiDocs")}</a> &middot;
            <a href="/docs/github-sloc-counter.html">{t("footer.slocGuide")}</a> &middot;
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
        <a className="github-link install-link" href={extensionInfo.chromeWebStoreUrl} target="_blank" rel="noreferrer" aria-label={t("topbar.chrome")}>
          <ChromeIcon size={18} aria-hidden="true" />
          <span>{t("topbar.chrome")}</span>
        </a>
        <a className="github-link install-link" href={extensionInfo.firefoxAddOnsUrl} target="_blank" rel="noreferrer" aria-label={t("topbar.firefox")}>
          <FirefoxIcon size={18} aria-hidden="true" />
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

function Runner({ command, status, report, error, errorCode, onReset, onRerun }: { command: string; status: AppStatus; report: Report | null; error: string | null; errorCode?: string; onReset: () => void; onRerun: () => void }) {
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
      <span className="visually-hidden" aria-live="polite">{t("runner.status." + status)}</span>
      {!report ? <RunnerLog status={status} report={report} error={error} /> : null}
      {status === "failed" ? <ErrorState code={errorCode} message={error} /> : null}
      {report ? (
        <>
          <Insights report={report} />
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
          <TrustDetails report={report} />
          <details className="run-details">
            <summary>{t("runner.runDetails")}</summary>
            <RunnerLog status={status} report={report} error={error} />
          </details>
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

function TrustDetails({ report }: { report: Report }) {
  const { t } = useTranslation();
  const details = [
    { label: t("trust.commit"), value: report.commitSha },
    { label: t("trust.ref"), value: report.refName },
    { label: t("trust.counter"), value: report.tokeiVersion },
    { label: t("trust.cache"), value: report.cached ? t("runner.cacheHit") : t("runner.freshRun") },
    { label: t("trust.profile"), value: t(`analysisOptions.profiles.${report.analysisOptions.profile}`) },
    { label: t("trust.ignored"), value: [...defaultIgnoredDirs, ...report.analysisOptions.ignoredDirs].join(", ") },
    { label: t("trust.languages"), value: report.analysisOptions.ignoredLanguages.join(", ") || t("trust.none") },
  ];

  return (
    <div className="trust-details" aria-label={t("trust.title")}>
      {details.map((detail) => (
        <div key={detail.label}>
          <span>{detail.label}</span>
          <code>{detail.value}</code>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ code, message }: { code?: string; message: string | null }) {
  const { t } = useTranslation();
  const helpKey = code && i18n.exists(`errorHelp.${code}`) ? `errorHelp.${code}` : "errorHelp.default";
  return (
    <div className="error-state" role="alert">
      <div>
        <span className="chart-tag">{code ?? t("error.failedCode")}</span>
        <h3>{message ?? t("runner.status.failed")}</h3>
        <p>{t(helpKey)}</p>
      </div>
    </div>
  );
}

function RunnerLog({ status, report, error }: { status: AppStatus; report: Report | null; error: string | null }) {
  return (
    <div className="log">
      {logLines(status, report, error).map((line) => (
        <div key={line.text}><span className="ts">{line.ts}</span><span className={line.kind}>{line.text}</span></div>
      ))}
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

function BadgeEmbed({ report, refName }: { report: Report; refName: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const { owner, name } = report.repository;
  const effectiveRef = report.refName || refName;
  const badgeUrl = buildBadgeUrl(owner, name, effectiveRef, "summary", "");
  const frontendUrl = buildPublicReportUrl(owner, name, effectiveRef || refName);
  const markdown = `[![OctoCounts](${badgeUrl})](${frontendUrl})`;

  const handleCopy = () => {
    copyText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="badge-embed">
      <p className="badge-embed-desc">{t("badgeEmbed.description")}</p>
      <div className="badge-embed-row">
        <code className="badge-embed-code">{markdown}</code>
        <button className="copybtn" type="button" onClick={handleCopy}>
          <Clipboard size={14} />
          {copied ? t("badgeEmbed.copied") : t("badgeEmbed.copy")}
        </button>
      </div>
    </div>
  );
}

function AnalysisOptionsPanel({ options, setOptions }: { options: AnalysisOptions; setOptions: (options: AnalysisOptions) => void }) {
  const { t } = useTranslation();
  const update = (patch: Partial<AnalysisOptions>) => setOptions({ ...options, ...patch });
  return (
    <details className="analysis-options">
      <summary>{t("analysisOptions.summary")}</summary>
      <div className="analysis-options-grid">
        <label>
          <span>{t("analysisOptions.profile")}</span>
          <select value={options.profile} onChange={(event) => update({ profile: event.target.value as AnalysisOptions["profile"] })}>
            <option value="default">{t("analysisOptions.defaultProfile")}</option>
            <option value="source-only">{t("analysisOptions.sourceOnlyProfile")}</option>
          </select>
        </label>
        <label>
          <span>{t("analysisOptions.ignoredDirs")}</span>
          <input value={options.ignoredDirs.join(", ")} onChange={(event) => update({ ignoredDirs: csvList(event.target.value) })} placeholder="examples, fixtures" />
        </label>
        <label>
          <span>{t("analysisOptions.ignoredLanguages")}</span>
          <input value={options.ignoredLanguages.join(", ")} onChange={(event) => update({ ignoredLanguages: csvList(event.target.value) })} placeholder="Markdown, JSON" />
        </label>
        <div className="analysis-toggles">
          <label><input type="checkbox" checked={options.includeDocs} onChange={(event) => update({ includeDocs: event.target.checked })} />{t("analysisOptions.includeDocs")}</label>
          <label><input type="checkbox" checked={options.includeTests} onChange={(event) => update({ includeTests: event.target.checked })} />{t("analysisOptions.includeTests")}</label>
          <label><input type="checkbox" checked={options.includeGenerated} onChange={(event) => update({ includeGenerated: event.target.checked })} />{t("analysisOptions.includeGenerated")}</label>
        </div>
      </div>
    </details>
  );
}

function csvList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function CompareRepos() {
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

  const runCompare = async (event: FormEvent) => {
    event.preventDefault();
    setCompareStatus("running");
    setCompareError("");
    setLeftReport(null);
    setRightReport(null);
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
      <p className="compare-help">{t("compare.help")}</p>
      <form className="compare-form" onSubmit={(event) => void runCompare(event)}>
        <CompareInput label={t("compare.leftRepo")} repo={leftRepo} refName={leftRef} setRepo={setLeftRepo} setRef={setLeftRef} />
        <CompareInput label={t("compare.rightRepo")} repo={rightRepo} refName={rightRef} setRepo={setRightRepo} setRef={setRightRef} />
        <button className="btn compare-run" disabled={compareStatus === "running"}>
          {compareStatus === "running" ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
          {t("compare.run")}
        </button>
      </form>
      <div className="compare-share-row">
        <code>{buildCompareUrl(leftRepo, rightRepo, leftRef, rightRef)}</code>
        <button className="copybtn" type="button" onClick={() => copyText(buildCompareUrl(leftRepo, rightRepo, leftRef, rightRef))}>
          <Clipboard size={14} />
          {t("compare.copyUrl")}
        </button>
      </div>
      {compareStatus === "failed" ? <div className="compare-error">{compareError}</div> : null}
      {leftReport && rightReport ? <CompareResults left={leftReport} right={rightReport} /> : null}
    </div>
  );
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

function CompareResults({ left, right }: { left: Report; right: Report }) {
  const { t } = useTranslation();
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
            <span className="key-sw" style={{ background: languageColor(row.name) }} />
            <strong>{row.name}</strong>
            <span>{formatNumber(row.left)}</span>
            <span>{formatNumber(row.right)}</span>
            <em className={row.delta >= 0 ? "pos" : "neg"}>{formatSignedNumber(row.delta)}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffRefs() {
  const { t } = useTranslation();
  const initialDiff = useMemo(() => initialDiffFromLocation(), []);
  const [repo, setRepo] = useState(initialDiff.repo);
  const [baseRef, setBaseRef] = useState(initialDiff.base);
  const [headRef, setHeadRef] = useState(initialDiff.head);
  const [baseReport, setBaseReport] = useState<Report | null>(null);
  const [headReport, setHeadReport] = useState<Report | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [error, setError] = useState("");

  const runDiff = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("running");
    setError("");
    setBaseReport(null);
    setHeadReport(null);
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
      <p className="compare-help">{t("diff.help")}</p>
      <form className="compare-form diff-form" onSubmit={(event) => void runDiff(event)}>
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
        <button className="copybtn" type="button" onClick={() => copyText(buildDiffUrl(repo, baseRef, headRef))}>
          <Clipboard size={14} />
          {t("compare.copyUrl")}
        </button>
      </div>
      {status === "failed" ? <div className="compare-error">{error}</div> : null}
      {baseReport && headReport ? <CompareResults left={baseReport} right={headReport} /> : null}
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

function BadgeBuilder({ repoUrl, refName, report }: { repoUrl: string; refName: string; report: Report | null }) {
  const { t } = useTranslation();
  const [badgeType, setBadgeType] = useState<(typeof badgeTypes)[number]>("summary");
  const [language, setLanguage] = useState("rust");
  const repoPath = report
    ? { owner: report.repository.owner, repo: report.repository.name }
    : parseGitHubRepo(repoUrl || defaultRepoUrl);
  const effectiveRef = report?.refName || refName.trim();
  const badgeUrl = repoPath ? buildBadgeUrl(repoPath.owner, repoPath.repo, effectiveRef, badgeType, language) : "";
  const frontendUrl = repoPath ? buildPublicReportUrl(repoPath.owner, repoPath.repo, effectiveRef) : window.location.origin;
  const markdown = badgeUrl ? `[![OctoCounts](${badgeUrl})](${frontendUrl})` : "";

  return (
    <div className="badge-builder">
      <div className="badge-builder-controls">
        <label>
          <span>{t("badgeBuilder.type")}</span>
          <select value={badgeType} onChange={(event) => setBadgeType(event.target.value as (typeof badgeTypes)[number])}>
            {badgeTypes.map((type) => (
              <option value={type} key={type}>{t(`badgeBuilder.types.${type}`)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("badgeBuilder.language")}</span>
          <input value={language} onChange={(event) => setLanguage(event.target.value)} disabled={badgeType !== "language"} placeholder="rust" />
        </label>
      </div>
      <div className="badge-builder-preview">
        {badgeUrl ? <img src={badgeUrl} alt={t("badgeBuilder.previewAlt")} /> : <span>{t("badgeBuilder.noRepo")}</span>}
      </div>
      <div className="badge-builder-output">
        <code>{markdown || t("badgeBuilder.noRepo")}</code>
        <button className="copybtn" type="button" disabled={!markdown} onClick={() => copyText(markdown)}>
          <Clipboard size={14} />
          {t("badgeBuilder.copyMarkdown")}
        </button>
      </div>
    </div>
  );
}

function parseGitHubRepo(value: string) {
  try {
    const normalized = value.trim().startsWith("git@github.com:")
      ? value.trim().replace("git@github.com:", "https://github.com/")
      : value.trim();
    const url = new URL(normalized);
    if (url.hostname !== "github.com") return null;
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return null;
    return { owner, repo: repo.replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

function parsePublicRepo(value: string) {
  try {
    const trimmed = value.trim();
    const normalized = trimmed.startsWith("git@github.com:")
      ? trimmed.replace("git@github.com:", "https://github.com/")
      : trimmed.startsWith("git@gitlab.com:")
        ? trimmed.replace("git@gitlab.com:", "https://gitlab.com/")
        : trimmed;
    const url = new URL(normalized);
    if (url.hostname !== "github.com" && url.hostname !== "gitlab.com") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;
    return {
      host: url.hostname,
      owner: segments.slice(0, -1).join("/"),
      repo: segments[segments.length - 1].replace(/\.git$/, ""),
    };
  } catch {
    return null;
  }
}

function initialRequestFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const queryRepo = params.get("q") ?? params.get("url");
  const queryRef = params.get("ref") ?? "";
  if (queryRepo) return { repoUrl: queryRepo, refName: queryRef };

  const route = parsePublicReportPath(window.location.pathname);
  if (route) return route;

  return { repoUrl: "", refName: "" };
}

function initialCompareFromLocation() {
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

function normalizeReport(report: Report): Report {
  return {
    ...report,
    analysisKey: report.analysisKey || report.tokeiVersion,
    analysisOptions: { ...defaultAnalysisOptions, ...(report.analysisOptions ?? {}) },
  };
}

function parsePublicReportPath(pathname: string) {
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments[0] !== "github" || !segments[1] || !segments[2]) return null;
  const owner = segments[1];
  const repo = segments[2];
  const marker = segments[3];
  const refName = marker === "tree" || marker === "commit" ? segments.slice(4).join("/") : "";
  return { repoUrl: `https://github.com/${owner}/${repo}`, refName };
}

function buildPublicReportUrl(owner: string, repo: string, ref: string) {
  const base = `${window.location.origin}/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  if (!ref.trim()) return base;
  const marker = looksLikeCommit(ref) ? "commit" : "tree";
  return `${base}/${marker}/${encodeRefPath(ref)}`;
}

function encodeRefPath(ref: string) {
  return ref.trim().split("/").map(encodeURIComponent).join("/");
}

function looksLikeCommit(ref: string) {
  return /^[a-f0-9]{7,40}$/i.test(ref.trim());
}

function buildBadgeUrl(owner: string, repo: string, ref: string, type: (typeof badgeTypes)[number], language: string) {
  const safeOwner = encodeURIComponent(owner);
  const safeRepo = encodeURIComponent(repo);
  const refKind = looksLikeCommit(ref) ? "commit" : "branch";
  const safeRef = ref.trim() ? `/${refKind}/${encodeRefPath(ref)}` : "";
  const params = new URLSearchParams();
  if (type === "language") {
    params.set("lang", language.trim() || "rust");
  } else if (type !== "summary") {
    params.set("type", type);
  }
  const query = params.toString();
  return `${BADGE_API_BASE}/badge/${safeOwner}/${safeRepo}${safeRef}${query ? `?${query}` : ""}`;
}

function syncPageMetadata({
  report,
  repoUrl,
  refName,
  defaultTitle,
  defaultDescription,
}: {
  report: Report | null;
  repoUrl: string;
  refName: string;
  defaultTitle: string;
  defaultDescription: string;
}) {
  const path = window.location.pathname;
  if (path === "/compare" || path === "/diff") {
    const title = path === "/compare" ? "Compare repository SLOC | OctoCounts" : "Compare branch SLOC diff | OctoCounts";
    const description = path === "/compare"
      ? "Compare files, code lines, comments, blanks, and language mix between two public repositories or refs."
      : "Compare source line count changes between two branches, tags, or commits in a public repository.";
    document.title = title;
    setMeta("name", "description", description);
    setMeta("name", "robots", "noindex,follow,max-image-preview:large");
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", window.location.href);
    setMeta("property", "og:image", `${window.location.origin}/og-image.jpg`);
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", `${window.location.origin}/og-image.jpg`);
    setCanonical(`${window.location.origin}${path}`);
    return;
  }

  const parsed = report ? { owner: report.repository.owner, repo: report.repository.name } : parsePublicRepo(repoUrl);
  const effectiveRef = report?.refName || refName.trim();
  const title = parsed ? `${parsed.owner}/${parsed.repo} SLOC report | OctoCounts` : defaultTitle;
  const description = report
    ? `${parsed?.owner}/${parsed?.repo} has ${formatNumber(report.total.code)} code lines across ${formatNumber(report.total.files)} files and ${formatNumber(report.languages.length)} languages.`
    : parsed
      ? `Source line count report for ${parsed.owner}/${parsed.repo}: files, code lines, comments, blanks, and language totals.`
      : defaultDescription;
  const canonical = report
    ? buildCanonicalReportUrl(report, effectiveRef)
    : parsed
      ? buildCanonicalUrlForParsedRepo(parsed, repoUrl, effectiveRef)
      : window.location.origin + "/";

  document.title = title;
  setMeta("name", "description", description);
  setMeta("name", "robots", "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1");
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);
  setMeta("property", "og:url", canonical);
  setMeta("property", "og:image", `${window.location.origin}/og-image.jpg`);
  setMeta("name", "twitter:title", title);
  setMeta("name", "twitter:description", description);
  setMeta("name", "twitter:image", `${window.location.origin}/og-image.jpg`);
  setCanonical(canonical);
}

function buildCanonicalReportUrl(report: Report, ref: string) {
  if (report.repository.htmlUrl.includes("github.com/")) {
    return buildPublicReportUrl(report.repository.owner, report.repository.name, ref);
  }
  const params = new URLSearchParams({ q: report.repository.htmlUrl });
  if (ref.trim()) params.set("ref", ref.trim());
  return `${window.location.origin}/?${params.toString()}`;
}

function buildCanonicalUrlForParsedRepo(parsed: { owner: string; repo: string; host?: string }, repoUrl: string, ref: string) {
  if (parsed.host === "github.com") {
    return buildPublicReportUrl(parsed.owner, parsed.repo, ref);
  }
  const params = new URLSearchParams({ q: repoUrl.trim() });
  if (ref.trim()) params.set("ref", ref.trim());
  return `${window.location.origin}/?${params.toString()}`;
}

function setMeta(attr: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attr, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

function setCanonical(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.appendChild(element);
  }
  element.href = href;
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

function Insights({ report }: { report: Report }) {
  const { t } = useTranslation();
  const topLanguage = report.languages[0];
  const totalLines = report.total.lines;
  const totalCode = report.total.code;
  const totalLanguages = report.languages.length;
  const topLanguageShare = topLanguage ? formatPercent(topLanguage.stats.lines, totalLines) : t("charts.noData");
  const codeShare = formatPercent(totalCode, totalLines);
  const scale = projectScale(totalCode);
  const mix = languageMix(report.languages, totalLines);
  const cacheState = report.cached ? t("runner.cacheHit") : t("runner.freshRun");
  const commitLabel = `${report.refName} / ${report.commitSha.slice(0, 12)}`;
  const insightItems = [
    {
      label: t("insights.scale"),
      value: t(`insights.scaleValues.${scale}`),
      detail: t(`insights.scaleDetails.${scale}`),
      tone: "accent",
    },
    {
      label: t("insights.topLanguage"),
      value: topLanguage?.name ?? t("charts.noData"),
      detail: topLanguage ? t("insights.topLanguageDetail", { percent: topLanguageShare }) : t("insights.noLanguageDetail"),
      tone: "blue",
    },
    {
      label: t("insights.codeShare"),
      value: codeShare,
      detail: t("insights.codeShareDetail", { code: formatNumber(totalCode), lines: formatNumber(totalLines) }),
      tone: "violet",
    },
    {
      label: t("insights.languageMix"),
      value: t(`insights.mixValues.${mix}`),
      detail: t("insights.mixDetail", { count: formatNumber(totalLanguages) }),
      tone: "warn",
    },
    {
      label: t("insights.cacheState"),
      value: cacheState,
      detail: commitLabel,
      tone: "muted",
    },
  ];

  return (
    <div className="insights" aria-label={t("insights.title")}>
      <div className="insights-head">
        <span className="chart-tag">{t("insights.kicker")}</span>
        <h3>{t("insights.title")}</h3>
      </div>
      <div className="insight-grid">
        {insightItems.map((item) => (
          <div className={`insight-card ${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function projectScale(codeLines: number) {
  if (codeLines < 1_000) return "tiny";
  if (codeLines < 10_000) return "small";
  if (codeLines < 100_000) return "medium";
  if (codeLines < 500_000) return "large";
  return "huge";
}

function languageMix(languages: LanguageReport[], totalLines: number) {
  if (languages.length <= 1) return "single";
  const topShare = totalLines > 0 ? languages[0].stats.lines / totalLines : 0;
  if (topShare >= 0.8) return "focused";
  if (languages.length >= 6 && topShare < 0.55) return "polyglot";
  return "mixed";
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
      role="columnheader"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" className="sort-btn" onClick={onClick}>
        {label} <span className="arr">{active ? (dir === "asc" ? "^" : "v") : ""}</span>
      </button>
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
