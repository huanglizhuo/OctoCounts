import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ArrowUp, ChevronDown, ChevronRight, Clipboard, Download, ExternalLink, FileJson, History, Loader2, Play, RotateCcw } from "lucide-react";
import React, { FormEvent, ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import i18n, { ready as i18nReady } from "./i18n";
import { ChromeIcon, EdgeIcon, FirefoxIcon } from "./icons";
import { defaultRepoUrl, defaultRefName, extensionInfo } from "./constants";
import { analyzeRepository, fetchGrowthStats, fetchJson } from "./api";
import { useGithubStatus } from "./githubStatus";
import { AnalyticsEvents, initAnalytics, providerFromRepoUrl, trackAiVisitIfReferred, trackEvent } from "./analytics";
import { Topbar, publicReportLinks } from "./Topbar";

const BrowserExtensionSection = React.lazy(() => import("./BrowserExtensionSection"));
// Marketing/tool pages are separate chunks; the home bundle no longer carries them.
const StatsPage = React.lazy(() => import("./pages/marketing").then((m) => ({ default: m.StatsPage })));
const ReportListPage = React.lazy(() => import("./pages/marketing").then((m) => ({ default: m.ReportListPage })));
const TrendingPage = React.lazy(() => import("./pages/marketing").then((m) => ({ default: m.TrendingPage })));
const ComparePage = React.lazy(() => import("./pages/marketing").then((m) => ({ default: m.ComparePage })));
const DiffPage = React.lazy(() => import("./pages/marketing").then((m) => ({ default: m.DiffPage })));
// Below-the-fold tool sections on the home page — deferred anyway, so lazy.
const CompareRepos = React.lazy(() => import("./compare").then((m) => ({ default: m.CompareRepos })));
const DiffRefs = React.lazy(() => import("./compare").then((m) => ({ default: m.DiffRefs })));

function PageFallback() {
  return <div className="growth-state" role="status">Loading…</div>;
}

function RoutedPage({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageFallback />}>
      {children}
    </Suspense>
  );
}
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
  visibleLanguageColor,
} from "./reportUtils";
import type { AnalysisOptions, AppStatus, GrowthRepositoryStat, GrowthStats, LanguageReport, PieItem, Report, SortKey, Stats } from "./types";
import type { JobRecord } from "./types";
import { useAnalysisRunner } from "./useAnalysisRunner";
import { SchemeProvider, ThemeSwitch, useScheme } from "./scheme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 },
  },
});
const showSharePreview = import.meta.env.DEV && import.meta.env.VITE_DEBUG_SHARE_PREVIEW === "true";
const BADGE_API_BASE = (import.meta.env.VITE_BADGE_API_BASE ?? "https://api.octocounts.com") as string;
const samples = [
  { label: "octocount", repoUrl: defaultRepoUrl, refName: defaultRefName },
  { label: "axum", repoUrl: "https://github.com/tokio-rs/axum", refName: "" },
  { label: "vite", repoUrl: "https://github.com/vitejs/vite", refName: "" },
  { label: "vscode", repoUrl: "https://github.com/microsoft/vscode", refName: "" },
];

const RECENT_KEY = "octocounts.recentRepos";
const RECENT_MAX = 5;

type RecentEntry = { repoUrl: string; refName: string; label: string };

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

function DeferredContent({ children, minHeight = 1, rootMargin = "300px" }: { children: ReactNode; minHeight?: number; rootMargin?: string }) {
  const { ref, isNear } = useNearViewport<HTMLDivElement>(rootMargin);
  return <div className="deferred-slot" ref={ref} style={{ minHeight }}>{isNear ? children : null}</div>;
}

// Tracks html[data-scheme] was replaced by the SchemeProvider context — see scheme.tsx.
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
  if (routePath === "/stats") return <RoutedPage><StatsPage /></RoutedPage>;
  if (routePath === "/recent") return <RoutedPage><ReportListPage kind="recent" /></RoutedPage>;
  if (routePath === "/popular") return <RoutedPage><ReportListPage kind="popular" /></RoutedPage>;
  if (routePath === "/trending") return <RoutedPage><TrendingPage /></RoutedPage>;
  if (routePath === "/hall-of-monoliths") return <RoutedPage><ReportListPage kind="monoliths" /></RoutedPage>;
  if (routePath === "/compare" || routePath.startsWith("/compare/")) return <RoutedPage><ComparePage /></RoutedPage>;
  if (routePath === "/diff") return <RoutedPage><DiffPage /></RoutedPage>;

  const initialRequest = useMemo(() => initialRequestFromLocation(), []);
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
    trackAiVisitIfReferred();
  }, []);

  // Shown only while GitHub self-reports a disruption, so users hitting a
  // failed analysis see the cause before they submit, not after.
  const hostStatus = useGithubStatus();

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

  // The typing animation lives in the RepoUrlInput component so the ~18ms
  // per-character updates only re-render the input, not the whole page. The
  // committed value syncs up when the demo finishes (or immediately when the
  // user types / picks another chip, which cancels the animation).
  const [typingTarget, setTypingTarget] = useState<string | null>(null);
  const typingDoneRef = useRef<(() => void) | null>(null);
  const [busySample, setBusySample] = useState<string | null>(null);
  const stopTyping = useCallback(() => {
    typingDoneRef.current = null;
    setTypingTarget(null);
  }, []);
  const finishTyping = useCallback(() => {
    const done = typingDoneRef.current;
    typingDoneRef.current = null;
    setTypingTarget(null);
    done?.();
  }, []);

  const playSample = (sample: (typeof samples)[number]) => {
    trackEvent("sample_chip_clicked", { sample: sample.label, provider: providerFromRepoUrl(sample.repoUrl) });
    stopTyping();
    setBusySample(sample.repoUrl);
    setRefName(sample.refName);
    setLastCommand(commandText(sample.repoUrl, sample.refName, false));
    const runSample = () => {
      void runAnalysis(false, { repoUrl: sample.repoUrl, refName: sample.refName })
        .finally(() => setBusySample(null));
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRepoUrl(sample.repoUrl);
      runSample();
      return;
    }
    setRepoUrl("");
    typingDoneRef.current = () => {
      setRepoUrl(sample.repoUrl);
      runSample();
    };
    setTypingTarget(sample.repoUrl);
  };

  // Page metadata only needs the settled input, not every keystroke.
  const [debouncedRepoUrl, setDebouncedRepoUrl] = useState(repoUrl);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedRepoUrl(repoUrl), 300);
    return () => window.clearTimeout(timer);
  }, [repoUrl]);

  useEffect(() => {
    syncPageMetadata({ report, repoUrl: debouncedRepoUrl, refName, defaultTitle: t("app.title"), defaultDescription: t("app.description") });
  }, [report, debouncedRepoUrl, refName, t, i18n.language]);

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
            <TopActions status={status} />
            <h1 className="title">
              <Trans i18nKey="hero.title" components={{ 1: <span className="glow" /> }} />
            </h1>
            <p className="subtitle">
              <Trans i18nKey="hero.subtitle" components={{ 1: <a href="https://github.com/XAMPPRocky/tokei" target="_blank" rel="noreferrer" /> }} />
            </p>
            {hostStatus && hostStatus.indicator !== "operational" ? (
              <p className="host-status-hint" role="status">
                {hostStatus.description} — {t("githubStatus.degradedHint")}{" "}
                <a href="https://www.githubstatus.com" target="_blank" rel="noreferrer">{t("githubStatus.link")}</a>
              </p>
            ) : null}
            <form className="input-row" onSubmit={submit}>
              <span className="prompt">$</span>
              <RepoUrlInput
                value={repoUrl}
                typingTarget={typingTarget}
                onTypingDone={finishTyping}
                onCancelTyping={stopTyping}
                onChange={(next) => {
                  setRepoUrl(next);
                  setRefName("main");
                }}
                placeholder={t("hero.placeholderUrl")}
                ariaLabel={t("hero.ariaUrl")}
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
            <div className="hero-paths" role="group" aria-label={t("hero.sidebarHint")}>
              <StoreLink store="chrome" placement="hero" className="btn install-btn" size={15}>{t("hero.installChrome")}</StoreLink>
              <StoreLink store="edge" placement="hero" className="copybtn install-btn secondary-install" size={14}>{t("hero.installEdge")}</StoreLink>
              <StoreLink store="firefox" placement="hero" className="copybtn install-btn secondary-install" size={14}>{t("hero.installFirefox")}</StoreLink>
              <span>{t("hero.sidebarHint")}</span>
            </div>
            <div className="quick-rows" role="group" aria-label={t("hero.ariaSamples")}>
              {samples.map((sample) => (
                <button
                  className={`chip ${busySample === sample.repoUrl ? "busy" : ""}`}
                  key={sample.repoUrl}
                  type="button"
                  disabled={busySample !== null}
                  aria-pressed={busySample === sample.repoUrl}
                  onClick={() => playSample(sample)}
                >
                  <span className="k">{t("samples.label")}</span>{sample.label}
                </button>
              ))}
            </div>
            {recentRepos.length > 0 ? (
              <div className="quick-rows recent-rows" role="group" aria-label={t("recent.ariaLabel")}>
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

        <DeferredContent minHeight={260}><PublicReportIndex /></DeferredContent>

        <section>
          <div className="section-h">
            <h2>{t("badgeBuilder.title")}</h2>
            <span className="sub">{t("badgeBuilder.subtitle")}</span>
          </div>
          <DeferredContent minHeight={420}>
            <BadgeBuilder repoUrl={repoUrl} refName={refName} report={report} />
            <BadgeWall />
          </DeferredContent>
        </section>

        <section>
          <div className="section-h">
            <h2>Developer tools</h2>
            <span className="sub">make SLOC reports show up where developers already work</span>
          </div>
          <DeferredContent minHeight={320}><DeveloperTools /></DeferredContent>
        </section>

        <section>
          <div className="section-h">
            <h2>{t("compare.title")}</h2>
            <span className="sub">{t("compare.subtitle")}</span>
          </div>
          <DeferredContent minHeight={420}><Suspense fallback={null}><CompareRepos /></Suspense></DeferredContent>
        </section>

        <section>
          <div className="section-h">
            <h2>{t("diff.title")}</h2>
            <span className="sub">{t("diff.subtitle")}</span>
          </div>
          <DeferredContent minHeight={420}><Suspense fallback={null}><DiffRefs /></Suspense></DeferredContent>
        </section>

        <section>
          <div className="section-h">
            <h2>{t("extensionSection.title")}</h2>
            <span className="sub">{t("extensionSection.subtitle")}</span>
          </div>
          <Suspense fallback={null}>
            <DeferredContent minHeight={560}><BrowserExtensionSection /></DeferredContent>
          </Suspense>
        </section>

        <section>
          <div className="section-h">
            <h2>{t("useCases.title")}</h2>
            <span className="sub">{t("useCases.subtitle")}</span>
          </div>
          <DeferredContent minHeight={320}>
            <div className="how">
              {(t("useCases.cases", { returnObjects: true }) as Array<{ title: string; text: string }>).map((item, idx) => (
                <div className="step" key={idx}>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              ))}
            </div>
          </DeferredContent>
        </section>

        <section>
          <div className="section-h">
            <h2>{t("howItWorks.title")}</h2>
            <span className="sub">{t("howItWorks.subtitle")}</span>
          </div>
          <DeferredContent minHeight={520}>
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
          </DeferredContent>
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

// Owns the demo typing animation so per-character state stays local; only the
// committed value flows through the parent.
function RepoUrlInput({
  value,
  typingTarget,
  onTypingDone,
  onCancelTyping,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string;
  typingTarget: string | null;
  onTypingDone: () => void;
  onCancelTyping: () => void;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const doneRef = useRef(onTypingDone);
  doneRef.current = onTypingDone;

  useEffect(() => {
    if (typingTarget === null) {
      setTyped(null);
      return;
    }
    let index = 0;
    setTyped("");
    const timer = window.setInterval(() => {
      index += 1;
      setTyped(typingTarget.slice(0, index));
      if (index >= typingTarget.length) {
        window.clearInterval(timer);
        doneRef.current();
      }
    }, 18);
    return () => window.clearInterval(timer);
  }, [typingTarget]);

  return (
    <input
      id="repo-url"
      name="repoUrl"
      className={typed !== null ? "typing" : undefined}
      value={typed ?? value}
      onChange={(event) => {
        onCancelTyping();
        setTyped(null);
        onChange(event.target.value);
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  );
}

function PublicReportIndex() {
  const { t } = useTranslation();
  const { ref, isNear } = useNearViewport<HTMLElement>();
  const query = useQuery({ queryKey: ["growth-stats"], queryFn: fetchGrowthStats, staleTime: 5 * 60 * 1000, enabled: isNear });
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
          aria-current={i18n.language === loc.code ? "page" : undefined}
          onClick={() => i18n.changeLanguage(loc.code)}
        >
          {loc.label}
        </button>
      ))}
    </div>
  );
}


// Single builder for extension store links: href + tracking + noreferrer in one place.
function StoreLink({ store, placement, size = 15, className, children }: { store: "chrome" | "edge" | "firefox"; placement: string; size?: number; className: string; children?: React.ReactNode }) {
  const href = store === "chrome" ? extensionInfo.chromeWebStoreUrl : store === "edge" ? extensionInfo.edgeAddOnsUrl : extensionInfo.firefoxAddOnsUrl;
  const Icon = store === "chrome" ? ChromeIcon : store === "edge" ? EdgeIcon : FirefoxIcon;
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer" onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store, placement })}>
      <Icon size={size} aria-hidden="true" />
      {children}
    </a>
  );
}

function StarBadge({ stars, size = 11, className }: { stars: number; size?: number; className?: string }) {
  return (
    <span className={className} aria-label={`${formatCompactNumber(stars)} stars`}>
      <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 .25a.75.75 0 0 1 .67.42l1.88 3.8 4.2.61a.75.75 0 0 1 .42 1.28l-3.04 2.96.72 4.17a.75.75 0 0 1-1.09.79L8 12.35l-3.76 1.97a.75.75 0 0 1-1.09-.79l.72-4.17L.83 6.36a.75.75 0 0 1 .42-1.28l4.2-.6L6.66.66A.75.75 0 0 1 8 .25Z"/></svg>
      {formatCompactNumber(stars)}
    </span>
  );
}

// Copy-with-feedback state shared by the badge/url/report copy buttons.
function useCopied(timeoutMs = 1800) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const showCopied = (key: string) => {
    setCopiedKey(key);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopiedKey(null), timeoutMs);
  };
  return { copiedKey, showCopied };
}

function TopActions({ status }: { status: AppStatus }) {
  const { t } = useTranslation();
  return (
    <div className="top-actions">
      <ThemeSwitch />
      <span className="pill"><span className={`dot ${status === "idle" ? "idle" : ""}`} />{t("runner.statusShort." + status)}</span>
    </div>
  );
}

function Runner({ command, status, report, error, errorCode, onReset, onRerun }: { command: string; status: AppStatus; report: Report | null; error: string | null; errorCode?: string; onReset: () => void; onRerun: () => void }) {
  const { t } = useTranslation();
  const shareCardRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const { copiedKey: copiedCta, showCopied: showCopiedCta } = useCopied();

  const isWorking = status === "queued" || status === "running";
  // The report body carries the star snapshot from analysis time; a cached
  // report can be months old, so the share card refreshes through the server
  // (which holds the GitHub token and a short cache) before rendering. On any
  // failure it silently falls back to the snapshot, and to no badge at all
  // when neither is present.
  const [liveStars, setLiveStars] = useState<number | null>(null);
  useEffect(() => {
    setLiveStars(null);
    if (!report) return;
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
  }, [report]);
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
    if (!report || !shareCardRef.current) return;
    setIsExporting(true);
    setExportError(null);
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
    } catch {
      setExportError(t("runner.exportPngFailed"));
    } finally {
      setIsExporting(false);
    }
  };


  return (
    <div className="runner">
      {report && showSticky ? (
        <div className="sticky-bar" role="region" aria-label={t("stickyBar.ariaLabel")}>
          <span className="sticky-repo">
            {report.repository.owner}/{report.repository.name}
            {typeof (liveStars ?? report.repository.stars ?? null) === "number" ? (
              <StarBadge className="repo-stars" size={11} stars={(liveStars ?? report.repository.stars)!} />
            ) : null}
          </span>
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
                ? <b className="cache-flex">{t("runner.cacheHit")} · {report.durationMs}ms</b>
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
      {status === "failed" ? <ErrorState code={errorCode} message={error} onRetry={onRerun} /> : null}
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
          {exportError ? <p className="export-error" role="alert">{exportError}</p> : null}
          <Insights report={report} />
          <Summary stats={report.total} />
          <DeferredContent minHeight={820} rootMargin="100px"><Charts report={report} /></DeferredContent>
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
          <TrustDetails report={report} stars={liveStars ?? report.repository.stars ?? null} />
          <details className="run-details">
            <summary>{t("runner.runDetails")}</summary>
            <RunnerLog status={status} report={report} error={error} />
          </details>
          <div className="share-export-host" aria-hidden="true">
            <ShareTickerCard ref={shareCardRef} report={report} stars={liveStars ?? report.repository.stars ?? null} />
          </div>
          {showSharePreview ? (
            <section className="share-preview" aria-label={t("sharePreview.pngExportPreview")}>
              <div className="section-h">
                <span>{t("sharePreview.debug")}</span>
                <span className="sub">{t("sharePreview.pngExportPreview")}</span>
              </div>
              <div className="share-preview-frame">
                <ShareTickerCard report={report} stars={liveStars ?? report.repository.stars ?? null} />
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
  copiedCta: string | null;
  isExporting: boolean;
  onCopyBadge: () => void;
  onCopyUrl: () => void;
  onExportPng: () => void;
}) {
  const { t } = useTranslation();
  const isGitHub = normalizedProvider(report) === "github";

  return (
    <div className="report-actions" role="group" aria-label={t("reportCta.ariaLabel")}>
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
        <StoreLink store="chrome" placement="report_cta" className="copybtn install-btn secondary-install" size={14}>{t("reportCta.installChrome")}</StoreLink>
        <StoreLink store="edge" placement="report_cta" className="copybtn install-btn secondary-install" size={14}>{t("reportCta.installEdge")}</StoreLink>
      </div>
    </div>
  );
}

function TrustDetails({ report, stars }: { report: Report; stars?: number | null }) {
  const { t } = useTranslation();
  const details = [
    { label: t("trust.commit"), value: report.commitSha },
    { label: t("trust.ref"), value: report.refName },
    { label: t("trust.counter"), value: report.tokeiVersion },
    { label: t("trust.cache"), value: report.cached ? t("runner.cacheHit") : t("runner.freshRun") },
    ...(typeof stars === "number" ? [{ label: t("trust.stars"), value: formatCompactNumber(stars) }] : []),
    { label: t("trust.profile"), value: t(`analysisOptions.profiles.${report.analysisOptions.profile}`) },
    { label: t("trust.ignored"), value: [...defaultIgnoredDirs, ...report.analysisOptions.ignoredDirs].join(", ") },
    { label: t("trust.languages"), value: report.analysisOptions.ignoredLanguages.join(", ") || t("trust.none") },
  ];

  return (
    <div className="trust-details" role="group" aria-label={t("trust.title")}>
      {details.map((detail) => (
        <div key={detail.label}>
          <span>{detail.label}</span>
          <code>{detail.value}</code>
        </div>
      ))}
    </div>
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
            {hostStatus && hostStatus.indicator !== "operational"
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

const ShareTickerCard = React.forwardRef<HTMLDivElement, { report: Report; stars?: number | null }>(function ShareTickerCard({ report, stars }, ref) {
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
          <div className="share-kicker-row">
            <div className="share-kicker">{report.repository.owner}/{report.repository.name}</div>
            {typeof stars === "number" ? (
              <StarBadge className="share-stars" size={15} stars={stars} />
            ) : null}
          </div>
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
                  <i><b style={{ width: `${row.percent}%`, background: visibleLanguageColor(row.color, "matrix") }} /></i>
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
  const { copiedKey: copied, showCopied } = useCopied(2000);

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
    showCopied("badge");
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
  const parsed = parsePublicRepo(value);
  if (!parsed || parsed.host !== "github.com") return null;
  return { owner: parsed.owner, repo: parsed.repo };
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
    // Server-side injection (functions/[[path]].js) makes these indexable;
    // keep the client-side value aligned so hydration does not flip them to noindex.
    applyPageMetadata({ title, description, canonical: `${window.location.origin}${path}` });
    return;
  }

  const isPublicReportPath = path.startsWith("/github/") || path.startsWith("/gitlab/");
  if (!isPublicReportPath) {
    applyPageMetadata({
      title: defaultTitle,
      description: defaultDescription,
      canonical: `${window.location.origin}/`,
      extraRobots: ",max-video-preview:-1",
    });
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

  applyPageMetadata({ title, description, canonical, extraRobots: ",max-video-preview:-1" });
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

// Applies title/description/og/twitter/canonical in one call; the per-branch
// og/twitter boilerplate used to be copy-pasted three times through this file.
function applyPageMetadata({ title, description, canonical, extraRobots }: { title: string; description: string; canonical: string; extraRobots?: string }) {
  if (document.title === title) return; // most calls are no-ops while typing in the repo input
  document.title = title;
  const robots = `index,follow,max-image-preview:large,max-snippet:-1${extraRobots ?? ""}`;
  const image = `${window.location.origin}/og-image.jpg`;
  const metas: Array<["name" | "property", string, string]> = [
    ["name", "description", description],
    ["name", "robots", robots],
    ["property", "og:title", title],
    ["property", "og:description", description],
    ["property", "og:url", canonical],
    ["property", "og:image", image],
    ["name", "twitter:title", title],
    ["name", "twitter:description", description],
    ["name", "twitter:image", image],
  ];
  for (const [attr, key, content] of metas) setMeta(attr, key, content);
  setCanonical(canonical);
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
    <div className="insights" role="group" aria-label={t("insights.title")}>
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
  const scheme = useScheme();
  const languageItems = useMemo(() => languagePieItems(report.languages), [report.languages]);
  // Lift near-black language colors so slices/swatches stay visible on the dark scheme.
  const visibleItems = useMemo(
    () => languageItems.map((item) => ({ ...item, color: visibleLanguageColor(item.color, scheme) })),
    [languageItems, scheme],
  );
  const totalLines = report.total.lines;
  const [hoveredSlice, setHoveredSlice] = useState<string | null>(null);
  const otherLabel = t("charts.other");
  const sliceLabels = useMemo(() => new Set(visibleItems.map((item) => item.label)), [visibleItems]);
  const sliceForLanguage = useCallback(
    (name: string) => (sliceLabels.has(name) ? name : sliceLabels.has(otherLabel) ? otherLabel : null),
    [sliceLabels, otherLabel],
  );
  const onHoverLanguage = useCallback(
    (name: string | null) => setHoveredSlice(name === null ? null : sliceForLanguage(name)),
    [sliceForLanguage],
  );

  return (
    <div className="charts-grid">
      <div className="chart-card donut-card">
        <div className="chart-h"><span className="chart-tag">chart</span>{t("charts.languageShare")}</div>
        <Donut items={visibleItems} total={totalLines} hovered={hoveredSlice} onHover={setHoveredSlice} />
      </div>
      <div className="chart-card table-card">
        <div className="chart-h"><span className="chart-tag">table</span>{t("charts.report")}</div>
        <ReportTable report={report} compact hoveredSlice={hoveredSlice} sliceForLanguage={sliceForLanguage} onHoverLanguage={onHoverLanguage} />
      </div>
    </div>
  );
}

function Donut({ items, total, hovered, onHover }: { items: PieItem[]; total: number; hovered: string | null; onHover: (label: string | null) => void }) {
  const { t } = useTranslation();
  const exactTotal = formatNumber(total);
  const slices = useMemo(() => pieSlices(items), [items]);
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
          <strong>{formatCompactNumber(total)}</strong>
        </div>
      </div>
      <ul className="visually-hidden">
        {items.map((item) => (
          <li key={item.label}>{item.label}: {formatPercent(item.value, total)}</li>
        ))}
      </ul>
      <div className="legend" onMouseLeave={() => onHover(null)}>
        {items.map((item) => (
          <span
            className={`legend-row ${hovered === item.label ? "hl" : ""}`}
            key={item.label}
            onMouseEnter={() => onHover(item.label)}
          >
            <span className="key-sw" style={{ background: item.color }} />
            <span className="lname">{item.label}</span>
            <span>{formatPercent(item.value, total)}</span>
          </span>
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

  const toggle = useCallback((name: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);

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
                onToggle={toggle}
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
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button type="button" className="sort-btn" onClick={onClick}>
        {label} <span className="arr" aria-hidden="true">{active ? (dir === "asc" ? "^" : "v") : ""}</span>
      </button>
    </th>
  );
}

const LanguageRow = React.memo(function LanguageRow({ row, expanded, child, onToggle, highlighted, onHover }: { row: LanguageReport; expanded?: boolean; child?: boolean; onToggle?: (name: string) => void; highlighted?: boolean; onHover?: (name: string | null) => void }) {
  const { t } = useTranslation();
  const scheme = useScheme();
  const hasChildren = row.children.length > 0;
  const expandable = hasChildren && !child;
  const ratioTotal = row.stats.code + row.stats.comments + row.stats.blanks;
  const ratioTitle = `${formatPercent(row.stats.code, ratioTotal)} ${t("table.code")} · ${formatPercent(row.stats.comments, ratioTotal)} ${t("table.comments")} · ${formatPercent(row.stats.blanks, ratioTotal)} ${t("table.blanks")}`;
  return (
    <tr
      className={`${child ? "file-row" : "lang-row"} ${expandable ? "expandable" : ""} ${expanded ? "expanded" : ""} ${highlighted ? "hl-row" : ""}`}
      onMouseEnter={child ? undefined : () => onHover?.(row.name)}
      onClick={expandable ? () => onToggle?.(row.name) : undefined}
    >
      <td className="lang">
        {hasChildren ? <button className="expand" type="button" aria-label={t(expanded ? "table.collapseLanguage" : "table.expandLanguage", { language: row.name })} aria-expanded={Boolean(expanded)} onClick={(e) => { e.stopPropagation(); onToggle?.(row.name); }}>{expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}</button> : <span className="expand-spacer" />}
        <span className="swatch" style={{ color: visibleLanguageColor(languageColor(row.name), scheme) }} />
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
});

function NumberCell({ value }: { value: number }) {
  return <td>{formatNumber(value)}</td>;
}

// Wait for the locale bundle (lazy zh chunk) before first render.
void i18nReady.then(() => {
  createRoot(document.getElementById("root")!).render(
    <SchemeProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </SchemeProvider>,
  );
});
