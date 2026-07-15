import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ArrowUp, ChevronDown, ChevronRight, Clipboard, Download, ExternalLink, FileJson, History, Loader2, Play, RotateCcw } from "lucide-react";
import React, { FormEvent, ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import i18n from "./i18n";
import { ChromeIcon, EdgeIcon, FirefoxIcon } from "./icons";
import { defaultRepoUrl, defaultRefName, extensionInfo } from "./constants";
import { analyzeRepository, fetchGrowthStats, fetchJson } from "./api";
import { AnalyticsEvents, initAnalytics, providerFromRepoUrl, trackEvent } from "./analytics";

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
import type { AnalysisOptions, AppStatus, GrowthRepositoryStat, GrowthStats, LanguageReport, PieItem, Report, Scheme, SortKey, Stats } from "./types";
import type { JobRecord } from "./types";
import { useAnalysisRunner } from "./useAnalysisRunner";

const queryClient = new QueryClient();
const showSharePreview = import.meta.env.DEV && import.meta.env.VITE_DEBUG_SHARE_PREVIEW === "true";
const BADGE_API_BASE = (import.meta.env.VITE_BADGE_API_BASE ?? "https://api.octocounts.com") as string;
const samples = [
  { label: "octocount", repoUrl: defaultRepoUrl, refName: defaultRefName },
  { label: "axum", repoUrl: "https://github.com/tokio-rs/axum", refName: "" },
  { label: "vite", repoUrl: "https://github.com/vitejs/vite", refName: "" },
  { label: "vscode", repoUrl: "https://github.com/microsoft/vscode", refName: "" },
];

const publicReportLinks = [
  { href: "/stats", key: "stats", command: "stats" },
  { href: "/recent", key: "recent", command: "tail -f" },
  { href: "/popular", key: "popular", command: "sort --hits" },
  { href: "/trending", key: "trending", command: "watch --daily" },
  { href: "/hall-of-monoliths", key: "hall", command: "top --lines" },
];

const RECENT_KEY = "octocounts.recentRepos";
const RECENT_MAX = 5;
const THEME_KEY = "octocounts.theme";

type RecentEntry = { repoUrl: string; refName: string; label: string };

function systemScheme(): Scheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "matrix" : "paper";
}

function readStoredScheme(): Scheme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "matrix" || value === "paper" || value === "amber" ? value : null;
  } catch {
    return null;
  }
}

function preferredScheme(): Scheme {
  return readStoredScheme() ?? systemScheme();
}

function persistScheme(scheme: Scheme) {
  try {
    localStorage.setItem(THEME_KEY, scheme);
  } catch {
    /* storage unavailable — theme still applies for the current page */
  }
}

function loadRecentRepos(): RecentEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is RecentEntry => typeof entry?.repoUrl === "string" && typeof entry?.label === "string")
      .map((entry) => ({ repoUrl: entry.repoUrl, refName: typeof entry.refName === "string" ? entry.refName : "", label: entry.label }))
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function saveRecentRepos(entries: RecentEntry[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, RECENT_MAX)));
  } catch {
    /* storage unavailable (private mode) — history is a nice-to-have */
  }
}

function useNearViewport<T extends HTMLElement>(rootMargin = "600px") {
  const ref = useRef<T>(null);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setIsNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setIsNear(true);
        observer.disconnect();
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, isNear };
}

function DeferredContent({ children }: { children: ReactNode }) {
  const { ref, isNear } = useNearViewport<HTMLDivElement>();
  return <div className="deferred-slot" ref={ref}>{isNear ? children : null}</div>;
}
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
  const routePath = window.location.pathname;
  if (routePath === "/stats") return <StatsPage />;
  if (routePath === "/recent") return <ReportListPage kind="recent" />;
  if (routePath === "/popular") return <ReportListPage kind="popular" />;
  if (routePath === "/trending") return <TrendingPage />;
  if (routePath === "/hall-of-monoliths") return <ReportListPage kind="monoliths" />;
  if (routePath === "/compare") return <ComparePage />;
  if (routePath === "/diff") return <DiffPage />;

  const initialRequest = useMemo(() => initialRequestFromLocation(), []);
  const [scheme, setScheme] = useState<Scheme>(() => preferredScheme());
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
    initAnalytics();
  }, []);

  const [recentRepos, setRecentRepos] = useState<RecentEntry[]>(() => loadRecentRepos());
  useEffect(() => {
    if (!report || report === seedReport) return;
    if (report.repository.htmlUrl === defaultRepoUrl) return;
    const entry: RecentEntry = {
      repoUrl: report.repository.htmlUrl,
      refName: "",
      label: `${report.repository.owner}/${report.repository.name}`,
    };
    setRecentRepos((current) => {
      const next = [entry, ...current.filter((item) => item.repoUrl !== entry.repoUrl)].slice(0, RECENT_MAX);
      saveRecentRepos(next);
      return next;
    });
  }, [report]);

  useEffect(() => {
    if (!report || report === seedReport) return;
    const path = window.location.pathname;
    if (path === "/compare" || path === "/diff") return;
    if (normalizedProvider(report) !== "github") return;
    const canonical = new URL(buildPublicReportUrl(report.repository.owner, report.repository.name, report.refName, "github"));
    const params = new URLSearchParams(window.location.search);
    params.delete("q");
    params.delete("url");
    params.delete("ref");
    const query = params.toString();
    window.history.replaceState(null, "", canonical.pathname + (query ? `?${query}` : ""));
  }, [report]);

  const playRecent = (entry: RecentEntry) => {
    trackEvent("recent_chip_clicked", { provider: providerFromRepoUrl(entry.repoUrl) });
    stopTyping();
    setRepoUrl(entry.repoUrl);
    setRefName(entry.refName);
    void runAnalysis(false, { repoUrl: entry.repoUrl, refName: entry.refName });
  };

  useEffect(() => {
    if (!autoRan.current && repoUrl) {
      autoRan.current = true;
      void runAnalysis(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typingTimer = useRef<number | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const stopTyping = () => {
    if (typingTimer.current !== null) {
      window.clearInterval(typingTimer.current);
      typingTimer.current = null;
    }
    setIsTyping(false);
  };
  useEffect(() => stopTyping, []);

  const playSample = (sample: (typeof samples)[number]) => {
    trackEvent("sample_chip_clicked", { sample: sample.label, provider: providerFromRepoUrl(sample.repoUrl) });
    stopTyping();
    setRefName(sample.refName);
    setLastCommand(commandText(sample.repoUrl, sample.refName, false));
    const runSample = () => void runAnalysis(false, { repoUrl: sample.repoUrl, refName: sample.refName });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRepoUrl(sample.repoUrl);
      runSample();
      return;
    }
    setIsTyping(true);
    setRepoUrl("");
    let index = 0;
    typingTimer.current = window.setInterval(() => {
      index += 1;
      setRepoUrl(sample.repoUrl.slice(0, index));
      if (index >= sample.repoUrl.length) {
        stopTyping();
        runSample();
      }
    }, 18);
  };

  useEffect(() => {
    document.documentElement.dataset.scheme = scheme;
    persistScheme(scheme);
  }, [scheme]);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    syncPageMetadata({ report, repoUrl, refName, defaultTitle: t("app.title"), defaultDescription: t("app.description") });
  }, [report, repoUrl, refName, t, i18n.language]);

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
                className={isTyping ? "typing" : undefined}
                value={repoUrl}
                onChange={(event) => {
                  stopTyping();
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
              <a className="btn install-btn" href={extensionInfo.chromeWebStoreUrl} target="_blank" rel="noreferrer" onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store: "chrome", placement: "hero" })}>
                <ChromeIcon size={15} />
                {t("hero.installChrome")}
              </a>
              <a className="copybtn install-btn secondary-install" href={extensionInfo.edgeAddOnsUrl} target="_blank" rel="noreferrer" onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store: "edge", placement: "hero" })}>
                <EdgeIcon size={14} />
                {t("hero.installEdge")}
              </a>
              <a className="copybtn install-btn secondary-install" href={extensionInfo.firefoxAddOnsUrl} target="_blank" rel="noreferrer" onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store: "firefox", placement: "hero" })}>
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
                  onClick={() => playSample(sample)}
                >
                  <span className="k">{t("samples.label")}</span>{sample.label}
                </button>
              ))}
            </div>
            {recentRepos.length > 0 ? (
              <div className="quick-rows recent-rows" aria-label={t("recent.ariaLabel")}>
                {recentRepos.map((entry) => (
                  <button
                    className="chip recent-chip"
                    key={entry.repoUrl}
                    type="button"
                    title={entry.repoUrl}
                    onClick={() => playRecent(entry)}
                  >
                    <History size={12} aria-hidden="true" />
                    <span className="k">{t("recent.label")}</span>{entry.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <section className="trust-strip" aria-label={t("hero.ariaTrust")}>
          <div className="social-proof">
            <a href="https://github.com/huanglizhuo/OctoCounts" target="_blank" rel="noreferrer" className="proof-badge">{t("hero.badgeOpenSource")}</a>
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

        <PublicReportIndex />

        <section>
          <div className="section-h">
            <h2>{t("badgeBuilder.title")}</h2>
            <span className="sub">{t("badgeBuilder.subtitle")}</span>
          </div>
          <BadgeBuilder repoUrl={repoUrl} refName={refName} report={report} />
          <BadgeWall />
        </section>

        <section>
          <div className="section-h">
            <h2>Developer tools</h2>
            <span className="sub">make SLOC reports show up where developers already work</span>
          </div>
          <DeveloperTools />
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
            <DeferredContent><BrowserExtensionSection /></DeferredContent>
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
          <Pipeline />
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
            <a href="/docs/api">{t("footer.apiDocs")}</a> &middot;
            <a href="/docs/github-sloc-counter">{t("footer.slocGuide")}</a> &middot;
            <a href="/stats">{t("growth.nav.stats.label")}</a> &middot;
            <a href="/popular">{t("growth.nav.popular.label")}</a> &middot; <a href="/trending">{t("growth.nav.trending.label")}</a> &middot;
            <a href="/launch-kit.html">{t("growth.launchKit")}</a> &middot;
            <Trans i18nKey="footer.builtBy" components={{ 1: <a href="https://github.com/huanglizhuo" target="_blank" rel="noreferrer" /> }} />
            {" "}{t("footer.copyright")}
          </span>
          <LanguageSwitcher />
        </footer>
      </main>
    </>
  );
}

type SeoReportSummary = {
  provider: "github" | "gitlab";
  owner: string;
  repo: string;
  repoFullName: string;
  htmlUrl: string;
  publicPath: string;
  generatedAt: string;
  refName: string;
  total: Stats;
  topLanguage?: { name: string; code: number; percent: number };
};

type SeoListResponse = {
  page: number;
  limit: number;
  reports: SeoReportSummary[];
};

type TrendingRepository = {
  rank: number;
  owner: string;
  name: string;
  fullName: string;
  description: string;
  language: string | null;
  starsToday: number;
  totalStars: number;
  htmlUrl: string;
  publicPath: string;
};

type TrendingSnapshot = {
  source: string;
  period: "daily";
  generatedAt: string;
  date: string;
  repositories: TrendingRepository[];
};

function MarketingShell({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const [scheme, setScheme] = useState<Scheme>(() => preferredScheme());

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.scheme = scheme;
    persistScheme(scheme);
  }, [scheme]);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="crt flicker" />
      <main id="main" className="page growth-page">
        <Topbar />
        <div className="marketing-controls">
          <ThemeSwitch scheme={scheme} setScheme={setScheme} />
        </div>
        {children}
        <footer>
          <span>{t("growth.footerTagline")}</span>
          <span>
            <a href="/stats">{t("growth.nav.stats.label")}</a> &middot; <a href="/recent">{t("growth.nav.recent.label")}</a> &middot; <a href="/popular">{t("growth.nav.popular.label")}</a> &middot; <a href="/trending">{t("growth.nav.trending.label")}</a> &middot; <a href="/hall-of-monoliths">{t("growth.nav.hall.label")}</a> &middot; <a href="/launch-kit.html">{t("growth.launchKit")}</a> &middot; <a href="/privacy">{t("footer.privacy")}</a>
          </span>
          <LanguageSwitcher />
        </footer>
      </main>
    </>
  );
}

function StatsPage() {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["growth-stats"], queryFn: fetchGrowthStats });
  const stats = query.data;

  return (
    <MarketingShell>
      <section className="growth-hero" aria-label={t("growth.stats.ariaLabel")}>
        <span className="chart-tag">{t("growth.stats.kicker")}</span>
        <h1>{t("growth.stats.title")}</h1>
        <p>{t("growth.stats.subtitle")}</p>
      </section>

      {query.isLoading ? <GrowthLoading /> : null}
      {query.isError ? <GrowthError /> : null}
      {stats ? <StatsDashboard stats={stats} /> : null}
    </MarketingShell>
  );
}

function StatsDashboard({ stats }: { stats: GrowthStats }) {
  const { t } = useTranslation();
  const totals = [
    { label: t("growth.metrics.reportsGenerated"), value: stats.totals.reportsGenerated },
    { label: t("growth.metrics.repositoriesAnalyzed"), value: stats.totals.repositoriesAnalyzed },
    { label: t("growth.metrics.linesCounted"), value: stats.totals.linesCounted },
    { label: t("growth.metrics.languagesDetected"), value: stats.totals.languagesDetected },
  ];
  const windows = [
    { label: t("growth.metrics.reportsToday"), value: stats.windows.reportsToday },
    { label: t("growth.metrics.reports7d"), value: stats.windows.reports7d },
    { label: t("growth.metrics.reports30d"), value: stats.windows.reports30d },
    { label: t("growth.metrics.newRepos30d"), value: stats.windows.repositories30d },
  ];

  return (
    <>
      <section className="growth-metrics" aria-label={t("growth.metrics.totalsAria")}>
        {totals.map((item) => <GrowthMetric key={item.label} label={item.label} value={item.value} />)}
      </section>
      <section className="growth-metrics compact" aria-label={t("growth.metrics.windowsAria")}>
        {windows.map((item) => <GrowthMetric key={item.label} label={item.label} value={item.value} />)}
      </section>
      <section className="growth-grid">
        <GrowthPanel title={t("growth.panels.sources.title")} subtitle={t("growth.panels.sources.subtitle")}>
          <RankedBars rows={stats.sources.map((row) => ({ label: sourceLabel(row.source), value: row.reports }))} />
        </GrowthPanel>
        <GrowthPanel title={t("growth.panels.languages.title")} subtitle={t("growth.panels.languages.subtitle")}>
          <RankedBars rows={stats.languages.map((row) => ({ label: row.language, value: row.code }))} />
        </GrowthPanel>
      </section>
      <section>
        <div className="section-h">
          <h2>{t("growth.sections.largest.title")}</h2>
          <span className="sub">{t("growth.sections.largest.subtitle")}</span>
        </div>
        <GrowthRepoGrid reports={stats.topRepositories} />
      </section>
      <section>
        <div className="section-h">
          <h2>{t("growth.sections.recent.title")}</h2>
          <span className="sub">{t("growth.sections.recent.subtitle")}</span>
        </div>
        <GrowthRepoGrid reports={stats.recentRepositories} />
      </section>
    </>
  );
}

function ReportListPage({ kind }: { kind: "recent" | "popular" | "monoliths" }) {
  const { t } = useTranslation();
  const endpoint = kind === "monoliths" ? "/api/seo/monoliths" : `/api/seo/${kind}`;
  const query = useQuery({
    queryKey: ["seo-list", kind],
    queryFn: () => fetchJson<SeoListResponse>(`${endpoint}?limit=36`),
  });
  const copy = listPageCopy(kind, t);

  return (
    <MarketingShell>
      <section className="growth-hero list-hero" aria-label={copy.title}>
        <span className="chart-tag">{copy.kicker}</span>
        <h1>{copy.title}</h1>
        <p>{copy.subtitle}</p>
      </section>
      {query.isLoading ? <GrowthLoading /> : null}
      {query.isError ? <GrowthError /> : null}
      {query.data ? <SeoReportGrid reports={query.data.reports} /> : null}
    </MarketingShell>
  );
}

function TrendingPage() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["github-trending", "daily"],
    queryFn: async () => {
      const response = await fetch("/github-trending.json");
      if (!response.ok) throw new Error(`Trending snapshot returned ${response.status}`);
      return response.json() as Promise<TrendingSnapshot>;
    },
    staleTime: 60 * 60 * 1000,
  });

  return (
    <MarketingShell>
      <section className="growth-hero list-hero" aria-label={t("growth.pages.trending.title")}>
        <span className="chart-tag">{t("growth.pages.trending.kicker")}</span>
        <h1>{t("growth.pages.trending.title")}</h1>
        <p>{t("growth.pages.trending.subtitle")}</p>
        {query.data ? <p className="sub">{t("growth.pages.trending.updated", { date: query.data.date })} · <a href={query.data.source} target="_blank" rel="noreferrer">GitHub Trending</a></p> : null}
      </section>
      {query.isLoading ? <GrowthLoading /> : null}
      {query.isError ? <GrowthError /> : null}
      {query.data ? <TrendingRepoGrid repositories={query.data.repositories} /> : null}
    </MarketingShell>
  );
}

function TrendingRepoGrid({ repositories }: { repositories: TrendingRepository[] }) {
  return (
    <div className="growth-repo-grid">
      {repositories.map((repo) => (
        <a className="growth-repo-card" href={repo.publicPath} key={repo.fullName}>
          <span className="chart-tag">#{repo.rank} · {repo.language ?? "mixed"}</span>
          <strong>{repo.fullName}</strong>
          <span>{repo.description || "GitHub Trending repository"}</span>
          <em>+{formatNumber(repo.starsToday)} stars today · {formatNumber(repo.totalStars)} total</em>
        </a>
      ))}
    </div>
  );
}

function ComparePage() {
  const { t } = useTranslation();
  return (
    <MarketingShell>
      <section className="growth-hero tool-hero" aria-label={t("compare.title")}>
        <span className="chart-tag">{t("compare.subtitle")}</span>
        <h1>{t("compare.title")}</h1>
        <p>{t("compare.help")}</p>
      </section>
      <CompareRepos showHelp={false} />
    </MarketingShell>
  );
}

function DiffPage() {
  const { t } = useTranslation();
  return (
    <MarketingShell>
      <section className="growth-hero tool-hero" aria-label={t("diff.title")}>
        <span className="chart-tag">{t("diff.subtitle")}</span>
        <h1>{t("diff.title")}</h1>
        <p>{t("diff.help")}</p>
      </section>
      <DiffRefs showHelp={false} />
    </MarketingShell>
  );
}

function GrowthMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="growth-metric">
      <span>{label}</span>
      <strong>{formatCompactNumber(value)}</strong>
      <em>{formatNumber(value)}</em>
    </div>
  );
}

function GrowthPanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="growth-panel">
      <div className="section-h">
        <h2>{title}</h2>
        <span className="sub">{subtitle}</span>
      </div>
      {children}
    </div>
  );
}

function RankedBars({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="ranked-bars">
      {rows.length ? rows.map((row) => (
        <div className="ranked-row" key={row.label}>
          <span>{row.label}</span>
          <i><b style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }} /></i>
          <em>{formatCompactNumber(row.value)}</em>
        </div>
      )) : <p className="growth-empty">No reports yet.</p>}
    </div>
  );
}

function GrowthRepoGrid({ reports }: { reports: GrowthRepositoryStat[] }) {
  return (
    <div className="growth-repo-grid">
      {reports.map((report) => (
        <a className="growth-repo-card" href={report.publicPath} key={`${report.provider}:${report.owner}/${report.repo}`}>
          <span className="chart-tag">{String(report.provider)}</span>
          <strong>{report.owner}/{report.repo}</strong>
          <span>{report.topLanguage ?? "mixed"} · {formatNumber(report.total.code)} code</span>
          <em>{new Date(report.generatedAt).toLocaleDateString()}</em>
        </a>
      ))}
    </div>
  );
}

function SeoReportGrid({ reports }: { reports: SeoReportSummary[] }) {
  return (
    <div className="growth-repo-grid">
      {reports.map((report) => (
        <a className="growth-repo-card" href={report.publicPath} key={`${report.provider}:${report.owner}/${report.repo}`}>
          <span className="chart-tag">{report.provider}</span>
          <strong>{report.repoFullName}</strong>
          <span>{report.topLanguage?.name ?? "mixed"} · {formatNumber(report.total.code)} code</span>
          <em>{new Date(report.generatedAt).toLocaleDateString()}</em>
        </a>
      ))}
    </div>
  );
}

function PublicReportIndex() {
  const { t } = useTranslation();
  const { ref, isNear } = useNearViewport<HTMLElement>();
  const query = useQuery({ queryKey: ["growth-stats", "home-index"], queryFn: fetchGrowthStats, staleTime: 5 * 60 * 1000, enabled: isNear });
  const totals = query.data?.totals;
  const statsCopy = totals
    ? t("growth.index.stats", {
      reports: formatCompactNumber(totals.reportsGenerated),
      repos: formatCompactNumber(totals.repositoriesAnalyzed),
      lines: formatCompactNumber(totals.codeLinesCounted),
    })
    : t("growth.index.fallback");

  return (
    <section className="report-index" aria-label={t("growth.index.ariaLabel")} ref={ref}>
      <div className="report-index-head">
        <span className="terminal-label">{t("growth.index.label")}</span>
        <p>{statsCopy}</p>
      </div>
      <nav className="report-index-grid" aria-label={t("growth.index.navAria")}>
        {publicReportLinks.map((item) => (
          <a key={item.href} href={item.href} className={item.href === "/stats" ? "report-index-link primary" : "report-index-link"}>
            <span>{item.command}</span>
            <strong>{t(`growth.nav.${item.key}.label`)}</strong>
            <em>{t(`growth.nav.${item.key}.detail`)}</em>
          </a>
        ))}
      </nav>
    </section>
  );
}

function GrowthLoading() {
  const { t } = useTranslation();
  return <section className="growth-state"><Loader2 className="spin" size={18} /> {t("growth.loading")}</section>;
}

function GrowthError() {
  const { t } = useTranslation();
  return <section className="growth-state">{t("growth.error")}</section>;
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    github_action: "GitHub Action",
    cli: "CLI",
    mcp: "MCP",
    api: "API",
    extension: "Extension",
    seed: "Seed",
    github_trending: "GitHub Trending",
    web: "Web",
    unknown: "Unknown",
  };
  return labels[source] ?? source;
}

function listPageCopy(kind: "recent" | "popular" | "monoliths", t: (key: string) => string) {
  if (kind === "popular") {
    return {
      kicker: t("growth.pages.popular.kicker"),
      title: t("growth.pages.popular.title"),
      subtitle: t("growth.pages.popular.subtitle"),
    };
  }
  if (kind === "monoliths") {
    return {
      kicker: t("growth.pages.hall.kicker"),
      title: t("growth.pages.hall.title"),
      subtitle: t("growth.pages.hall.subtitle"),
    };
  }
  return {
    kicker: t("growth.pages.recent.kicker"),
    title: t("growth.pages.recent.title"),
    subtitle: t("growth.pages.recent.subtitle"),
  };
}

function DeveloperTools() {
  const tools = [
    {
      title: "Public stats",
      text: "Aggregate report totals, language coverage, largest repos, and source breakdown without user-level tracking.",
      command: "open https://octocounts.com/stats",
      href: "/stats",
    },
    {
      title: "GitHub Action",
      text: "Comment SLOC changes on pull requests so reports travel through review workflows.",
      command: "uses: huanglizhuo/OctoCounts/action@main",
      href: "https://github.com/huanglizhuo/OctoCounts/tree/main/action",
    },
    {
      title: "CLI",
      text: "Run OctoCounts from a terminal or CI script and print text or JSON summaries.",
      command: "npx octocounts https://github.com/owner/repo --json",
      href: "https://github.com/huanglizhuo/OctoCounts/tree/main/cli",
    },
    {
      title: "MCP server",
      text: "Expose SLOC reports to agent workflows and developer assistants through MCP tools.",
      command: "npx octocounts-mcp",
      href: "https://github.com/huanglizhuo/OctoCounts/tree/main/mcp",
    },
    {
      title: "README badge",
      text: "Add a live SLOC badge that links back to a permanent report page.",
      command: "[![SLOC](https://api.octocounts.com/badge/:owner/:repo)](...)",
      href: "#badges",
    },
    {
      title: "API",
      text: "Use analyze, jobs, reports, badge, SEO, and stats endpoints directly.",
      command: "GET https://api.octocounts.com/api/stats",
      href: "/docs/api",
    },
  ];

  return (
    <div className="developer-tools">
      {tools.map((tool) => (
        <a className="developer-tool" href={tool.href} key={tool.title}>
          <span className="chart-tag">{tool.title}</span>
          <p>{tool.text}</p>
          <code>{tool.command}</code>
        </a>
      ))}
    </div>
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
  const path = window.location.pathname;
  const isActive = (href: string) => path === href || (href === "/stats" && path.startsWith("/stats"));
  const reportsActive = publicReportLinks.slice(1).some((item) => isActive(item.href));
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label={t("topbar.brandName")}>
        <div className="logo"><img src="/octocounts-logo-96.webp" alt={t("topbar.brandName") + " logo"} width="96" height="96" /></div>
        <div>
          <span className="brand-name">{t("topbar.brandName")}</span>
        </div>
      </a>
      <div className="topbar-links">
        <a className={`github-link signal-link ${isActive("/stats") ? "active" : ""}`} href="/stats" aria-current={isActive("/stats") ? "page" : undefined}>
          <span>{t("growth.nav.stats.label")}</span>
        </a>
        <nav className={`report-rail ${reportsActive ? "active" : ""}`} aria-label={t("growth.navAria")}>
          {publicReportLinks.slice(1).map((item) => (
            <a key={item.href} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>
              {t(`growth.nav.${item.key}.label`)}
            </a>
          ))}
        </nav>
        <a className="github-link install-link" href={extensionInfo.chromeWebStoreUrl} target="_blank" rel="noreferrer" aria-label={t("topbar.chrome")} onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store: "chrome", placement: "topbar" })}>
          <ChromeIcon size={18} aria-hidden="true" />
          <span>{t("topbar.chrome")}</span>
        </a>
        <a className="github-link install-link" href={extensionInfo.edgeAddOnsUrl} target="_blank" rel="noreferrer" aria-label={t("topbar.edge")} onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store: "edge", placement: "topbar" })}>
          <EdgeIcon size={18} />
          <span>{t("topbar.edge")}</span>
        </a>
        <a className="github-link install-link" href={extensionInfo.firefoxAddOnsUrl} target="_blank" rel="noreferrer" aria-label={t("topbar.firefox")} onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store: "firefox", placement: "topbar" })}>
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
      <ThemeSwitch scheme={scheme} setScheme={setScheme} />
      <span className="pill"><span className={`dot ${status === "idle" ? "idle" : ""}`} />{t("runner.statusShort." + status)}</span>
    </div>
  );
}

function ThemeSwitch({ scheme, setScheme }: { scheme: Scheme; setScheme: (scheme: Scheme) => void }) {
  const { t } = useTranslation();
  return (
    <div className="theme-switch" role="group" aria-label={t("theme.ariaLabel")}>
      <span className="theme-label" aria-hidden="true">{t("theme.label")}</span>
      {(["matrix", "paper", "amber"] as const).map((item) => (
        <button className={`theme-btn ${scheme === item ? "active" : ""}`} key={item} onClick={() => setScheme(item)} type="button" aria-pressed={scheme === item}>
          <span className={`theme-sw ${item}`} />
          {t("theme." + item)}
        </button>
      ))}
    </div>
  );
}

function Runner({ command, status, report, error, errorCode, onReset, onRerun }: { command: string; status: AppStatus; report: Report | null; error: string | null; errorCode?: string; onReset: () => void; onRerun: () => void }) {
  const { t } = useTranslation();
  const shareCardRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [copiedCta, setCopiedCta] = useState<"badge" | "url" | null>(null);

  const isWorking = status === "queued" || status === "running";
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
    const observer = new IntersectionObserver(
      ([entry]) => setShowSticky(!entry.isIntersecting && entry.boundingClientRect.top < 0),
    );
    observer.observe(head);
    return () => observer.disconnect();
  }, []);

  const exportPng = async () => {
    if (!report || !shareCardRef.current) return;
    setIsExporting(true);
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(shareCardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        width: 1200,
        height: 630,
        backgroundColor: "#050a06",
      });
      downloadDataUrl(dataUrl, `octocount-${report.repository.owner}-${report.repository.name}-${report.commitSha.slice(0, 12)}.png`);
      trackEvent(AnalyticsEvents.pngExported, { provider: normalizedProvider(report) });
    } finally {
      setIsExporting(false);
    }
  };

  const showCopiedCta = (kind: "badge" | "url") => {
    setCopiedCta(kind);
    window.setTimeout(() => setCopiedCta((current) => current === kind ? null : current), 1800);
  };

  return (
    <div className="runner">
      {report && showSticky ? (
        <div className="sticky-bar" role="region" aria-label={t("stickyBar.ariaLabel")}>
          <span className="sticky-repo">{report.repository.owner}/{report.repository.name}</span>
          <span className="sticky-stats">
            {t("stickyBar.lines", { count: report.total.lines, lines: formatNumber(report.total.lines) })}
            {" · "}
            <span className={report.cached ? "ok" : ""}>{report.cached ? t("runner.cacheHit") : t("runner.freshRun")}</span>
          </span>
          <div className="sticky-actions">
            <button className="copybtn" onClick={() => { copyText(textReport(report)); trackEvent("report_text_copied", { provider: normalizedProvider(report), placement: "sticky" }); }}><Clipboard size={13} /> {t("runner.exportText")}</button>
            <button className="copybtn" disabled={isExporting} onClick={() => void exportPng()}><Download size={13} /> {t("runner.exportPng")}</button>
            <button className="copybtn" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })} aria-label={t("stickyBar.top")}><ArrowUp size={13} /> {t("stickyBar.top")}</button>
          </div>
        </div>
      ) : null}
      <div className="runner-head" ref={headRef}>
        <div className="left">
          <span className="pill"><span className={`dot ${status === "idle" ? "idle" : ""}`} />{t("runner.statusShort." + status)}</span>
          <code>$ {command}</code>
        </div>
        <div className="row-flex">
          {report ? (
            <span>
              {report.refName} / {report.commitSha.slice(0, 12)} /{" "}
              {report.cached
                ? <b className="cache-flex">{t("runner.cacheHit")} — {report.durationMs}ms</b>
                : <>{t("runner.freshRun")} / <b className="speed-val">{report.durationMs}ms</b></>}
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
      {status === "failed" ? <ErrorState code={errorCode} message={error} /> : null}
      {report ? (
        <>
          <ReportGrowthActions
            report={report}
            copiedCta={copiedCta}
            isExporting={isExporting}
            onCopyBadge={() => {
              const url = buildCanonicalReportUrl(report, report.refName);
              const badgeUrl = normalizedProvider(report) === "github"
                ? buildBadgeUrl(report.repository.owner, report.repository.name, report.refName, "summary", "")
                : "";
              if (!badgeUrl) return;
              copyText(`[![OctoCounts](${badgeUrl})](${url})`);
              trackEvent(AnalyticsEvents.badgeMarkdownCopied, { provider: "github", placement: "report_cta" });
              showCopiedCta("badge");
            }}
            onCopyUrl={() => {
              copyText(buildCanonicalReportUrl(report, report.refName));
              trackEvent(AnalyticsEvents.reportUrlCopied, { provider: normalizedProvider(report), placement: "report_cta" });
              showCopiedCta("url");
            }}
            onExportPng={() => void exportPng()}
          />
          <Insights report={report} />
          <Summary stats={report.total} />
          <Charts report={report} />
          <div className="runner-foot">
            <span>{t("runner.generated", { date: new Date(report.generatedAt).toLocaleString(), duration: report.durationMs, version: report.tokeiVersion })}</span>
            <div className="actions">
              <button className="copybtn" onClick={() => { copyText(textReport(report)); trackEvent("report_text_copied", { provider: normalizedProvider(report) }); }}><Clipboard size={14} /> {t("runner.exportText")}</button>
              <button className="copybtn" onClick={() => { copyText(JSON.stringify(report, null, 2)); trackEvent("report_json_copied", { provider: normalizedProvider(report) }); }}><FileJson size={14} /> {t("runner.exportJson")}</button>
              <button className="copybtn" onClick={() => { copyText(buildCanonicalReportUrl(report, report.refName)); trackEvent(AnalyticsEvents.reportUrlCopied, { provider: normalizedProvider(report), placement: "report_footer" }); }}><Clipboard size={14} /> {t("runner.copyReportUrl")}</button>
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

function ReportGrowthActions({
  report,
  copiedCta,
  isExporting,
  onCopyBadge,
  onCopyUrl,
  onExportPng,
}: {
  report: Report;
  copiedCta: "badge" | "url" | null;
  isExporting: boolean;
  onCopyBadge: () => void;
  onCopyUrl: () => void;
  onExportPng: () => void;
}) {
  const { t } = useTranslation();
  const isGitHub = normalizedProvider(report) === "github";

  return (
    <div className="report-actions" aria-label={t("reportCta.ariaLabel")}>
      <div className="report-actions-copy">
        <span className="chart-tag">{t("reportCta.kicker")}</span>
        <strong>{t("reportCta.title")}</strong>
        <span>{t("reportCta.subtitle")}</span>
      </div>
      <div className="report-actions-buttons">
        {isGitHub ? (
          <button className="copybtn" type="button" onClick={onCopyBadge}>
            <Clipboard size={14} />
            {copiedCta === "badge" ? t("reportCta.copied") : t("reportCta.copyBadge")}
          </button>
        ) : null}
        <button className="copybtn" type="button" onClick={onCopyUrl}>
          <Clipboard size={14} />
          {copiedCta === "url" ? t("reportCta.copied") : t("reportCta.copyUrl")}
        </button>
        <button className="copybtn" type="button" disabled={isExporting} onClick={onExportPng}>
          <Download size={14} />
          {t("reportCta.exportPng")}
        </button>
        <a className="copybtn install-btn secondary-install" href={extensionInfo.chromeWebStoreUrl} target="_blank" rel="noreferrer" onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store: "chrome", placement: "report_cta" })}>
          <ChromeIcon size={14} />
          {t("reportCta.installChrome")}
        </a>
        <a className="copybtn install-btn secondary-install" href={extensionInfo.edgeAddOnsUrl} target="_blank" rel="noreferrer" onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store: "edge", placement: "report_cta" })}>
          <EdgeIcon size={14} />
          {t("reportCta.installEdge")}
        </a>
      </div>
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

function RunnerLog({ status, report, error, elapsedSec = 0 }: { status: AppStatus; report: Report | null; error: string | null; elapsedSec?: number }) {
  return (
    <div className="log">
      {logLines(status, report, error, elapsedSec).map((line) => (
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

  if (normalizedProvider(report) !== "github") {
    return null;
  }

  const { owner, name } = report.repository;
  const effectiveRef = report.refName || refName;
  const badgeUrl = buildBadgeUrl(owner, name, effectiveRef, "summary", "");
  const frontendUrl = buildPublicReportUrl(owner, name, effectiveRef || refName, "github");
  const markdown = `[![OctoCounts](${badgeUrl})](${frontendUrl})`;

  const handleCopy = () => {
    copyText(markdown);
    trackEvent(AnalyticsEvents.badgeMarkdownCopied, { provider: "github", placement: "report" });
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

function CompareRepos({ showHelp = true }: { showHelp?: boolean }) {
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
    trackEvent("compare_run", { mode: "repos", leftProvider: providerFromRepoUrl(leftRepo), rightProvider: providerFromRepoUrl(rightRepo) });
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
      {showHelp ? <p className="compare-help">{t("compare.help")}</p> : null}
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
        <button className="copybtn" type="button" onClick={() => { copyText(buildCompareUrl(leftRepo, rightRepo, leftRef, rightRef)); trackEvent(AnalyticsEvents.shareClicked, { share_type: "compare_url" }); }}>
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

function DiffRefs({ showHelp = true }: { showHelp?: boolean }) {
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
    trackEvent("compare_run", { mode: "diff", provider: providerFromRepoUrl(repo) });
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
      {showHelp ? <p className="compare-help">{t("diff.help")}</p> : null}
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
        <button className="copybtn" type="button" onClick={() => { copyText(buildDiffUrl(repo, baseRef, headRef)); trackEvent(AnalyticsEvents.shareClicked, { share_type: "diff_url" }); }}>
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
  const repoPath = report && normalizedProvider(report) === "github"
    ? { owner: report.repository.owner, repo: report.repository.name }
    : parseGitHubRepo(repoUrl || defaultRepoUrl);
  const effectiveRef = report?.refName || refName.trim();
  const badgeUrl = repoPath ? buildBadgeUrl(repoPath.owner, repoPath.repo, effectiveRef, badgeType, language) : "";
  const frontendUrl = repoPath ? buildPublicReportUrl(repoPath.owner, repoPath.repo, effectiveRef, "github") : window.location.origin;
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
        {badgeUrl ? <img src={badgeUrl} alt={t("badgeBuilder.previewAlt")} width="180" height="20" /> : <span>{t("badgeBuilder.noRepo")}</span>}
      </div>
      <div className="badge-builder-output">
        <code>{markdown || t("badgeBuilder.noRepo")}</code>
        <button className="copybtn" type="button" disabled={!markdown} onClick={() => { copyText(markdown); trackEvent(AnalyticsEvents.badgeMarkdownCopied, { provider: "github", placement: "builder" }); }}>
          <Clipboard size={14} />
          {t("badgeBuilder.copyMarkdown")}
        </button>
      </div>
    </div>
  );
}

const badgeWallEntries: Array<{ owner: string; repo: string; type: (typeof badgeTypes)[number] }> = [
  { owner: "huanglizhuo", repo: "OctoCounts", type: "summary" },
  { owner: "tokio-rs", repo: "axum", type: "code" },
  { owner: "vitejs", repo: "vite", type: "top-language" },
];

function BadgeWall() {
  const { t } = useTranslation();
  return (
    <div className="badge-wall">
      <div className="badge-wall-head">
        <span className="chart-tag">{t("badgeWall.kicker")}</span>
        <span>{t("badgeWall.hint")}</span>
      </div>
      <div className="badge-wall-row">
        {badgeWallEntries.map((entry) => (
          <a key={`${entry.owner}/${entry.repo}`} href={buildPublicReportUrl(entry.owner, entry.repo, "")} target="_blank" rel="noreferrer">
            <img src={buildBadgeUrl(entry.owner, entry.repo, "", entry.type, "")} alt={t("badgeWall.alt", { repo: `${entry.owner}/${entry.repo}` })} loading="lazy" width="180" height="20" />
            <code>{entry.owner}/{entry.repo}</code>
          </a>
        ))}
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
      : trimmed;
    const url = new URL(normalized);
    if (url.hostname !== "github.com") return null;
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
    repository: { ...report.repository, provider: normalizedProvider(report) },
    analysisKey: report.analysisKey || report.tokeiVersion,
    analysisOptions: { ...defaultAnalysisOptions, ...(report.analysisOptions ?? {}) },
  };
}

function parsePublicReportPath(pathname: string) {
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments[0] === "github" && segments[1] && segments[2]) {
    const owner = segments[1];
    const repo = segments[2];
    const marker = segments[3];
    const refName = marker === "tree" || marker === "commit" ? segments.slice(4).join("/") : "";
    return { repoUrl: `https://github.com/${owner}/${repo}`, refName };
  }
  return null;
}

function buildPublicReportUrl(owner: string, repo: string, ref: string, provider: "github" | "gitlab" = "github") {
  const ownerPath = provider === "gitlab"
    ? owner.split("/").map(encodeURIComponent).join("/")
    : encodeURIComponent(owner);
  const base = `${window.location.origin}/${provider}/${ownerPath}/${encodeURIComponent(repo)}`;
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

function normalizedProvider(report: Report): "github" | "gitlab" {
  const provider = report.repository.provider;
  if (provider === "gitlab" || provider === "gitLab") return "gitlab";
  if (provider === "github" || provider === "gitHub") return "github";
  return report.repository.htmlUrl.includes("gitlab.com/") ? "gitlab" : "github";
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

  const isPublicReportPath = path.startsWith("/github/") || path.startsWith("/gitlab/");
  if (!isPublicReportPath) {
    const canonical = `${window.location.origin}/`;
    document.title = defaultTitle;
    setMeta("name", "description", defaultDescription);
    setMeta("name", "robots", "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1");
    setMeta("property", "og:title", defaultTitle);
    setMeta("property", "og:description", defaultDescription);
    setMeta("property", "og:url", canonical);
    setMeta("property", "og:image", `${window.location.origin}/og-image.jpg`);
    setMeta("name", "twitter:title", defaultTitle);
    setMeta("name", "twitter:description", defaultDescription);
    setMeta("name", "twitter:image", `${window.location.origin}/og-image.jpg`);
    setCanonical(canonical);
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
  const provider = normalizedProvider(report);
  if (provider === "github" || provider === "gitlab") {
    return buildPublicReportUrl(report.repository.owner, report.repository.name, ref, provider);
  }
  const params = new URLSearchParams({ q: report.repository.htmlUrl });
  if (ref.trim()) params.set("ref", ref.trim());
  return `${window.location.origin}/?${params.toString()}`;
}

function buildCanonicalUrlForParsedRepo(parsed: { owner: string; repo: string; host?: string }, repoUrl: string, ref: string) {
  if (parsed.host === "github.com") {
    return buildPublicReportUrl(parsed.owner, parsed.repo, ref, "github");
  }
  if (parsed.host === "gitlab.com") {
    return buildPublicReportUrl(parsed.owner, parsed.repo, ref, "gitlab");
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

function Pipeline() {
  const { t } = useTranslation();
  const stages = ["url", "tarball", "tokei", "report"] as const;
  return (
    <div className="pipeline" aria-hidden="true">
      {stages.map((stage, index) => (
        <React.Fragment key={stage}>
          {index > 0 ? <span className="pipe-link"><i /></span> : null}
          <span className={`pipe-node ${stage === "report" ? "accent" : ""}`}>{t("howItWorks.pipeline." + stage)}</span>
        </React.Fragment>
      ))}
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
      label: t("insights.speed"),
      value: `${report.durationMs}ms`,
      detail: t("insights.speedDetail", { lines: formatNumber(totalLines), version: report.tokeiVersion }),
      tone: "warn",
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
  const [hoveredSlice, setHoveredSlice] = useState<string | null>(null);
  const otherLabel = t("charts.other");
  const sliceLabels = useMemo(() => new Set(languageItems.map((item) => item.label)), [languageItems]);
  const sliceForLanguage = (name: string) => (sliceLabels.has(name) ? name : sliceLabels.has(otherLabel) ? otherLabel : null);

  return (
    <div className="charts-grid">
      <div className="chart-card donut-card">
        <div className="chart-h"><span className="chart-tag">chart</span>{t("charts.languageShare")}</div>
        <Donut items={languageItems} total={totalLines} hovered={hoveredSlice} onHover={setHoveredSlice} />
      </div>
      <div className="chart-card table-card">
        <div className="chart-h"><span className="chart-tag">table</span>{t("charts.report")}</div>
        <ReportTable report={report} compact hoveredSlice={hoveredSlice} sliceForLanguage={sliceForLanguage} onHoverLanguage={(name) => setHoveredSlice(name === null ? null : sliceForLanguage(name))} />
      </div>
    </div>
  );
}

function Donut({ items, total, hovered, onHover }: { items: PieItem[]; total: number; hovered: string | null; onHover: (label: string | null) => void }) {
  const { t } = useTranslation();
  const exactTotal = formatNumber(total);
  const slices = pieSlices(items);
  return (
    <>
      <div className="donut-wrap" role="img" aria-label={t("charts.languageShare")}>
        <svg viewBox="-1 -1 2 2" onMouseLeave={() => onHover(null)}>
          {slices.map((slice) => (
            <path
              key={slice.label}
              d={slice.path}
              fill={slice.color}
              className={hovered && hovered !== slice.label ? "dim" : undefined}
              onMouseEnter={() => onHover(slice.label)}
            />
          ))}
          <circle r="0.58" fill="var(--bg-2)" />
        </svg>
        <div className="donut-center" title={t("charts.totalLinesTooltip", { count: exactTotal })}>
          <span className="mute">{t("charts.lines")}</span>
          <strong aria-label={exactTotal}>{formatCompactNumber(total)}</strong>
        </div>
      </div>
      <ul className="visually-hidden">
        {items.map((item) => (
          <li key={item.label}>{item.label}: {formatPercent(item.value, total)}</li>
        ))}
      </ul>
      <div className="legend" onMouseLeave={() => onHover(null)}>
        {items.map((item) => (
          <div
            className={`legend-row ${hovered === item.label ? "hl" : ""}`}
            key={item.label}
            onMouseEnter={() => onHover(item.label)}
          >
            <span className="key-sw" style={{ background: item.color }} />
            <span className="lname">{item.label}</span>
            <span>{formatPercent(item.value, total)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

const SORT_KEYS: SortKey[] = ["name", "files", "lines", "code", "comments", "blanks"];

function initialSortFromLocation(): { key: SortKey; dir: "asc" | "desc" } {
  const params = new URLSearchParams(window.location.search);
  const key = params.get("sort") as SortKey | null;
  const dir = params.get("dir");
  return {
    key: key && SORT_KEYS.includes(key) ? key : "code",
    dir: dir === "asc" || dir === "desc" ? dir : "desc",
  };
}

function persistSortInLocation(key: SortKey, dir: "asc" | "desc") {
  const params = new URLSearchParams(window.location.search);
  if (key === "code" && dir === "desc") {
    params.delete("sort");
    params.delete("dir");
  } else {
    params.set("sort", key);
    params.set("dir", dir);
  }
  const query = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
}

function ReportTable({ report, compact, hoveredSlice, sliceForLanguage, onHoverLanguage }: { report: Report; compact?: boolean; hoveredSlice?: string | null; sliceForLanguage?: (name: string) => string | null; onHoverLanguage?: (name: string | null) => void }) {
  const { t } = useTranslation();
  const initialSort = useMemo(() => initialSortFromLocation(), []);
  const [sortKey, setSortKey] = useState<SortKey>(initialSort.key);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialSort.dir);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rows = useMemo(() => sortRows(report.languages, sortKey, sortDir), [report.languages, sortKey, sortDir]);

  const updateSort = (key: SortKey) => {
    let nextDir: "asc" | "desc";
    if (sortKey === key) {
      nextDir = sortDir === "asc" ? "desc" : "asc";
      setSortDir(nextDir);
    } else {
      nextDir = key === "name" ? "asc" : "desc";
      setSortKey(key);
      setSortDir(nextDir);
    }
    persistSortInLocation(key, nextDir);
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
        <tbody onMouseLeave={() => onHoverLanguage?.(null)}>
          {rows.map((row) => (
            <React.Fragment key={row.name}>
              <LanguageRow
                row={row}
                expanded={expanded.has(row.name)}
                onToggle={() => toggle(row.name)}
                highlighted={Boolean(hoveredSlice && sliceForLanguage?.(row.name) === hoveredSlice)}
                onHover={onHoverLanguage}
              />
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

function LanguageRow({ row, expanded, child, onToggle, highlighted, onHover }: { row: LanguageReport; expanded?: boolean; child?: boolean; onToggle?: () => void; highlighted?: boolean; onHover?: (name: string | null) => void }) {
  const { t } = useTranslation();
  const hasChildren = row.children.length > 0;
  const ratioTotal = row.stats.code + row.stats.comments + row.stats.blanks;
  const ratioTitle = `${formatPercent(row.stats.code, ratioTotal)} ${t("table.code")} · ${formatPercent(row.stats.comments, ratioTotal)} ${t("table.comments")} · ${formatPercent(row.stats.blanks, ratioTotal)} ${t("table.blanks")}`;
  return (
    <tr
      className={`${child ? "file-row" : "lang-row"} ${expanded ? "expanded" : ""} ${highlighted ? "hl-row" : ""}`}
      onMouseEnter={child ? undefined : () => onHover?.(row.name)}
    >
      <td className="lang">
        {hasChildren ? <button className="expand" type="button" aria-label={t(expanded ? "table.collapseLanguage" : "table.expandLanguage", { language: row.name })} aria-expanded={Boolean(expanded)} onClick={(e) => { e.stopPropagation(); onToggle?.(); }}>{expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}</button> : <span className="expand-spacer" />}
        <span className="swatch" style={{ color: languageColor(row.name) }} />
        {row.name}
        {!child && ratioTotal > 0 ? (
          <span className="row-ratio" title={ratioTitle} aria-hidden="true">
            <i style={{ width: `${(row.stats.code / ratioTotal) * 100}%` }} />
            <i className="cm" style={{ width: `${(row.stats.comments / ratioTotal) * 100}%` }} />
            <i className="bl" style={{ width: `${(row.stats.blanks / ratioTotal) * 100}%` }} />
          </span>
        ) : null}
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
