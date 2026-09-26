import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { History, Loader2, Play } from "lucide-react";
import React, { FormEvent, ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ready as i18nReady } from "./i18n";
import { StoreLink } from "./StoreLink";
import { defaultRepoUrl, defaultRefName, siteLastUpdated, sourceRepoUrl } from "./constants";
import { analyzeRepository, fetchGrowthStats } from "./api";
import { isHostDegraded, useGithubStatus } from "./githubStatus";
import { initAnalytics, providerFromRepoUrl, trackAiVisitIfReferred, trackEvent } from "./analytics";
import { Topbar, publicReportLinks } from "./Topbar";
import { buildPublicReportUrl, parsePublicRepo } from "./badges";
import { ReportContextTools } from "./report/ReportContextTools";
import { Runner } from "./report/Runner";

const BrowserExtensionSection = React.lazy(() => import("./BrowserExtensionSection"));
// Marketing/tool pages are separate chunks; the home bundle no longer carries them.
const StatsPage = React.lazy(() => import("./pages/marketing").then((m) => ({ default: m.StatsPage })));
const ReportListPage = React.lazy(() => import("./pages/marketing").then((m) => ({ default: m.ReportListPage })));
const TrendingPage = React.lazy(() => import("./pages/marketing").then((m) => ({ default: m.TrendingPage })));
const ComparePage = React.lazy(() => import("./pages/marketing").then((m) => ({ default: m.ComparePage })));
const CuratedComparePage = React.lazy(() => import("./pages/marketing").then((m) => ({ default: m.CuratedComparePage })));
const DiffPage = React.lazy(() => import("./pages/marketing").then((m) => ({ default: m.DiffPage })));
const BadgesPage = React.lazy(() => import("./pages/marketing").then((m) => ({ default: m.BadgesPage })));
const ExtensionPage = React.lazy(() => import("./pages/marketing").then((m) => ({ default: m.ExtensionPage })));
const EmbedPage = React.lazy(() => import("./embed").then((m) => ({ default: m.EmbedPage })));

function PageFallback() {
  const { t } = useTranslation();
  return <div className="growth-state" role="status">{t("growth.loading")}</div>;
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
import {
  commandText,
  formatCompactNumber,
  formatNumber,
  normalizedProvider,
} from "./reportUtils";
import type { AnalysisOptions, GrowthRepositoryStat, GrowthStats, Report, Stats } from "./types";
import type { JobRecord } from "./types";
import { useAnalysisRunner } from "./useAnalysisRunner";
import { SchemeProvider } from "./scheme";

const queryClient = new QueryClient({
  defaultOptions: {
    // refetchOnWindowFocus off: tab refocuses used to re-hit /api/stats and
    // friends after staleTime expired; the app refetches explicitly where it
    // matters, and polling jobs carry their own interval.
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
  },
});
const samples = [
  { label: "react", repoUrl: defaultRepoUrl, refName: defaultRefName },
  { label: "vscode", repoUrl: "https://github.com/microsoft/vscode", refName: "" },
  { label: "vite", repoUrl: "https://github.com/vitejs/vite", refName: "" },
  { label: "axum", repoUrl: "https://github.com/tokio-rs/axum", refName: "" },
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

function DeferredContent({ children, rootMargin = "300px" }: { children: ReactNode; rootMargin?: string }) {
  const { ref, isNear } = useNearViewport<HTMLDivElement>(rootMargin);
  return <div className="deferred-slot" ref={ref}>{isNear ? children : null}</div>;
}

const defaultAnalysisOptions: AnalysisOptions = {
  ignoredDirs: [],
  ignoredLanguages: [],
  profile: "default",
  includeDocs: true,
  includeTests: true,
  includeGenerated: true,
};

// On report deep links the edge function server-renders the facts and embeds a
// machine-readable summary (#octocounts-report-summary). Seeding the runner
// from it shows the full report instantly and halves the perceived double
// download; the auto-run analysis then refreshes it from the live API.
function seedReportFromSsrSummary(): Report | null {
  const node = document.getElementById("octocounts-report-summary");
  if (!node) return null;
  try {
    const summary = JSON.parse(node.textContent ?? "");
    // The URL is the only authority for which report this page is. A summary
    // describing any other repository (contaminated edge-cached HTML, a wrong
    // pairing upstream) must never drive the page — accepting it would render
    // another repo's line counts and meta description under this URL, the
    // exact "duplicate meta description" failure search consoles flag.
    const route = parsePublicReportPath(window.location.pathname);
    const parsedRoute = route ? parsePublicRepo(route.repoUrl) : null;
    if (!parsedRoute) return null;
    const summaryOwner = String(summary.repository?.owner ?? "").toLowerCase();
    const summaryRepo = String(summary.repository?.repo ?? "").toLowerCase();
    if (summaryOwner !== parsedRoute.owner.toLowerCase() || summaryRepo !== parsedRoute.repo.toLowerCase()) return null;
    return {
      id: "",
      repository: {
        owner: summary.repository.owner,
        name: summary.repository.repo,
        htmlUrl: summary.repository.htmlUrl,
        provider: summary.repository.provider,
      },
      refName: summary.refName,
      commitSha: summary.commitSha,
      generatedAt: summary.generatedAt,
      durationMs: summary.durationMs ?? 0,
      cached: true,
      tokeiVersion: summary.tokeiVersion ?? "",
      analysisKey: summary.analysisKey ?? "",
      analysisOptions: summary.analysisOptions ?? defaultAnalysisOptions,
      snapshotUrl: summary.snapshotUrl,
      languages: (summary.languages ?? []).map((language: { name: string; stats: Stats }) => ({
        name: language.name,
        stats: language.stats,
        children: [],
      })),
      total: summary.totals,
    } as Report;
  } catch {
    return null;
  }
}

const ssrSeed = seedReportFromSsrSummary();
// On a report route with no URL-matching SSR seed, no seed at all beats the
// bundled demo repository: metadata falls back to the per-repo "Source line
// count report for owner/repo" line while the auto-run fetches the real
// report, so this URL can never present another repository's numbers. The
// demo seed stays for the homepage, where it is the point.
const seedReport = ssrSeed
  ? normalizeReport(ssrSeed)
  : window.location.pathname.startsWith("/github/")
    ? null
    : normalizeReport(initialReportData as unknown as Report);

function App() {
  const { t, i18n } = useTranslation();
  const routePath = window.location.pathname;
  // A visitor who lands directly on a specific report from search sees the
  // full marketing hero (tagline, subtitle, definition, install buttons,
  // sample chips) before any repository data — on mobile that pushed the
  // actual report over a screen down. Collapse the hero to title + search
  // box on report routes; the homepage keeps the full pitch for first-time
  // visitors who have nothing else to look at yet.
  const isReportRoute = routePath.startsWith("/github/");
  // Report deep links name the repository in the URL, so the h1 is that
  // repository — parsed from the pathname, not the report payload, so it
  // renders before the analysis lands and never flashes a different repo.
  const reportRoute = isReportRoute ? parsePublicReportPath(routePath) : null;
  const reportRouteRepo = reportRoute ? parsePublicRepo(reportRoute.repoUrl) : null;
  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    const scrollToLandingAnchor = () => {
      cancelAnimationFrame(frame);
      const id = window.location.hash.slice(1);
      if (id !== "extension" && id !== "badges") return;
      const locate = () => {
        const target = document.getElementById(id);
        if (target) {
          target.scrollIntoView({ block: "start" });
          return;
        }
        if (attempts++ < 12) frame = requestAnimationFrame(locate);
      };
      frame = requestAnimationFrame(locate);
    };
    scrollToLandingAnchor();
    window.addEventListener("hashchange", scrollToLandingAnchor);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", scrollToLandingAnchor);
    };
  }, []);
  if (routePath === "/stats") return <RoutedPage><StatsPage /></RoutedPage>;
  if (routePath === "/recent") return <RoutedPage><ReportListPage kind="recent" /></RoutedPage>;
  if (routePath === "/popular") return <RoutedPage><ReportListPage kind="popular" /></RoutedPage>;
  if (routePath === "/trending") return <RoutedPage><TrendingPage /></RoutedPage>;
  if (routePath === "/hall-of-monoliths") return <RoutedPage><ReportListPage kind="monoliths" /></RoutedPage>;
  // Two page contracts (SG-01): /compare is the generic tool; /compare/:slug
  // is a curated comparison whose facts the Pages Function server-renders and
  // re-injects as #octocounts-compare-data. The curated page renders from that
  // model so enabling JS keeps the comparison instead of discarding it.
  if (routePath === "/compare") return <RoutedPage><ComparePage /></RoutedPage>;
  if (routePath.startsWith("/compare/")) return <RoutedPage><CuratedComparePage /></RoutedPage>;
  if (routePath === "/diff") return <RoutedPage><DiffPage /></RoutedPage>;
  if (routePath === "/badges") return <RoutedPage><BadgesPage /></RoutedPage>;
  if (routePath === "/extension") return <RoutedPage><ExtensionPage /></RoutedPage>;
  if (routePath.startsWith("/embed/")) return <RoutedPage><EmbedPage /></RoutedPage>;

  const initialRequest = useMemo(() => initialRequestFromLocation(), []);
  // The entry URL is the authority on pinning: a report route that names a ref
  // (/github/o/r/tree/v1.0.0, /github/o/r/commit/<sha>) is one observation of
  // one frozen commit and must be MARKED on the history chart, never merged
  // into the default-branch series as fake end-of-curve data. Captured once at
  // mount — after a report lands the canonicalization below replaceState's the
  // ref into the URL, and that rewrite must not retroactively flip a
  // default-branch report into a pinned one.
  const entryUrlPinnedRef = useMemo(() => Boolean(parsePublicReportPath(window.location.pathname)?.refName), []);
  const [repoUrl, setRepoUrl] = useState(() => initialRequest.repoUrl);
  const [refName, setRefName] = useState(() => initialRequest.refName);
  const [ambiguousRef, setAmbiguousRef] = useState(() => hasAmbiguousRefPath(initialRequest.repoUrl));
  // `main` is a homepage suggestion, not a replacement for an intentional
  // ref. Once someone supplies a ref by hand (including an intentional blank),
  // opens a report/deep link, or chooses a recent result, URL edits leave that
  // choice alone. A newly pasted unambiguous tree/commit URL is also explicit.
  const refIsExplicit = useRef(!initialRequest.usesSuggestedMain);
  const [analysisOptions, setAnalysisOptions] = useState<AnalysisOptions>(() => initialRequest.analysisOptions ?? defaultAnalysisOptions);
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
    // Analyze must use the ref the form displays, even when an empty repository
    // falls back to the demo repository. defaultRefName remains the runner's
    // fallback only when the form itself has no ref.
    refName,
    defaultRepoUrl,
    defaultRefName,
    // A server seed represents the default report URL only. A snapshot URL
    // carries explicit analysis options and must fetch that exact configuration
    // instead of briefly presenting the unrelated default SSR report.
    seedReport: initialRequest.analysisOptions ? null : seedReport,
    analysisOptions,
  });

  const autoRan = useRef(false);
  // A run occupies the button from submit through queued/running until the
  // report (or failure) lands — not just the initial POST.
  const runActive = isSubmitting || status === "queued" || status === "running";

  // Shown only while GitHub self-reports a disruption, so users hitting a
  // failed analysis see the cause before they submit, not after.
  const hostStatus = useGithubStatus();

  const [recentRepos, setRecentRepos] = useState<RecentEntry[]>(() => loadRecentRepos());
  useEffect(() => {
    if (!report || report === seedReport) return;
    if (report.repository.htmlUrl === defaultRepoUrl) return;
    const entry: RecentEntry = {
      repoUrl: report.repository.htmlUrl,
      refName: report.refName,
      label: `${report.repository.owner}/${report.repository.name}${report.refName ? ` @ ${report.refName}` : ""}`,
    };
    setRecentRepos((current) => {
      const next = [entry, ...current.filter((item) => item.repoUrl !== entry.repoUrl || item.refName !== entry.refName)].slice(0, RECENT_MAX);
      saveRecentRepos(next);
      return next;
    });
  }, [report]);

  useEffect(() => {
    if (!report || report === seedReport) return;
    const path = window.location.pathname;
    if (path === "/compare" || path === "/diff") return;
    const canonical = new URL(buildPublicReportUrl(report.repository.owner, report.repository.name, report.refName));
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
    // A chip owns both fields, so whatever was typed into the ref box is gone
    // on purpose and the next URL edit is free to derive again.
    refIsExplicit.current = true;
    setRefName(entry.refName);
    void runAnalysis(false, { repoUrl: entry.repoUrl, refName: entry.refName });
  };

  useEffect(() => {
    if (!autoRan.current && repoUrl) {
      autoRan.current = true;
      // A report deep link already carries the server-rendered report as the
      // seed (same data the edge page rendered from, at most 1h old). Skip the
      // auto-run: it would clear the seed, flash the runner, and re-download
      // what the page already has. Force refresh is still available by hand.
      if (ssrSeed && !initialRequest.analysisOptions) return;
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
    // A dropped animation also drops the pending runSample callback, so the
    // chip it came from must be released here or busySample sticks forever.
    if (typingDoneRef.current) setBusySample(null);
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
    refIsExplicit.current = false;
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

  // Demo state = the bundled seed report is showing and no user run has
  // happened (any run nulls `report` before its own result lands).
  const demoActive = !isReportRoute && report === seedReport;

  return (
    <>
      <a className="skip-link" href="#main">{t("common.skipToContent")}</a>
      <div className="crt" />
      <main id="main" className="page">
        <Topbar />
        <section className={`hero ${isReportRoute ? "hero-compact" : ""}`} aria-labelledby="hero-title">
          <div className="hero-left">
            {isReportRoute ? (
              reportRouteRepo ? (
                <>
                  <h1 id="hero-title" className="title title-compact">{reportRouteRepo.owner}/{reportRouteRepo.repo}</h1>
                  <p className="report-route-sub">
                    {reportRoute?.refName ? t("hero.reportSubtitleRef", { ref: reportRoute.refName }) : t("hero.reportSubtitle")}
                  </p>
                </>
              ) : (
                <h1 id="hero-title" className="title title-compact">OctoCounts</h1>
              )
            ) : (
              <>
                <h1 id="hero-title" className="title">
                  <Trans i18nKey="hero.title" components={{ 1: <span className="glow" /> }} />
                </h1>
                <p className="subtitle">
                  <Trans i18nKey="hero.subtitle" components={{ 1: <a href="https://github.com/XAMPPRocky/tokei" target="_blank" rel="noreferrer" /> }} />
                </p>
                <p className="hero-trust">{t("hero.trustLine")}</p>
                <p className="hero-definition">{t("hero.definition")}</p>
                <p className="hero-freshness">
                  {t("hero.freshnessLabel")}: <time dateTime={siteLastUpdated}>{siteLastUpdated}</time> · {t("hero.maintainedBy")}{" "}
                  <a href="https://github.com/huanglizhuo" target="_blank" rel="noreferrer">huanglizhuo</a>
                </p>
              </>
            )}
            {isHostDegraded(hostStatus) ? (
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
                  setAmbiguousRef(hasAmbiguousRefPath(next));
                  // Only a fresh homepage suggestion may derive a ref from
                  // the URL. A hand-entered value — including an intentional
                  // blank — is a stronger choice than any pasted tree path.
                  if (!refIsExplicit.current) {
                    const urlRef = refFromRepoUrl(next);
                    if (urlRef) {
                      refIsExplicit.current = true;
                      setRefName(urlRef);
                    } else if (hasAmbiguousRefPath(next)) {
                      // An ambiguous /tree/:ref/path URL asks the backend for
                      // the repository default branch instead of guessing.
                      refIsExplicit.current = true;
                      setRefName("");
                    } else {
                      setRefName("main");
                    }
                  }
                }}
                placeholder={t("hero.placeholderUrl")}
                ariaLabel={t("hero.ariaUrl")}
              />
              <label className="ref">
                {t("hero.refLabel")}
                <input id="repo-ref" name="refName" value={refName} onChange={(event) => { refIsExplicit.current = true; setRefName(event.target.value); }} placeholder={t("hero.refPlaceholder")} aria-label={t("hero.ariaRef")} />
              </label>
              {/* Disabled for the entire run (not just the POST): a second
                  click during queued/running would silently abort and restart
                  the job. Cancel is the explicit escape hatch instead. */}
              <button className="btn" disabled={runActive}>
                {isSubmitting ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
                {t("hero.analyze")}
              </button>
              {runActive ? (
                <button type="button" className="copybtn" onClick={() => reset()}>
                  {t("runner.cancel")}
                </button>
              ) : null}
            </form>
            <AnalysisOptionsPanel options={analysisOptions} setOptions={setAnalysisOptions} />
            {ambiguousRef ? <p className="input-hint" role="status">{t("hero.ambiguousRef")}</p> : null}
            {!isReportRoute && (
              <>
                <div className="quick-rows samples-row" role="group" aria-label={t("hero.ariaSamples")}>
                  <span className="samples-try">{t("samples.try")}</span>
                  {samples.map((sample) => (
                    <button
                      className={`chip ${busySample === sample.repoUrl ? "busy" : ""}`}
                      key={sample.repoUrl}
                      type="button"
                      disabled={busySample !== null}
                      aria-pressed={busySample === sample.repoUrl}
                      onClick={() => playSample(sample)}
                    >
                      {sample.label}
                    </button>
                  ))}
                </div>
                {/* Secondary path to the extension: one outline line below the
                    samples. Analyze stays the only solid primary button on the
                    first screen. */}
                <p className="hero-paths hero-paths-line">
                  <span>{t("hero.alsoLine")}</span>
                  <StoreLink store="chrome" placement="hero" className="copybtn install-btn hero-store-link" size={13}>{t("hero.addToChrome")}</StoreLink>
                  <span aria-hidden="true">·</span>
                  <StoreLink store="edge" placement="hero" className="copybtn install-btn hero-store-link" size={13}>{t("topbar.edge")}</StoreLink>
                  <span aria-hidden="true">·</span>
                  <StoreLink store="firefox" placement="hero" className="copybtn install-btn hero-store-link" size={13}>{t("topbar.firefox")}</StoreLink>
                </p>
                {/* Pre-rendered (CSS-toggled, no JS) coarse-pointer replacement
                    for the install CTAs — see the pointer:coarse media block. */}
                <p className="mobile-install-note">
                  {t("extensionSection.desktopOnly")} <a href="/extension">{t("extensionSection.learnMore")}</a>
                </p>
                {recentRepos.length > 0 ? (
                  <div className="quick-rows recent-rows" role="group" aria-label={t("recent.ariaLabel")}>
                    {recentRepos.map((entry) => (
                      <button
                        className="chip recent-chip"
                        key={`${entry.repoUrl}@${entry.refName}`}
                        type="button"
                        title={entry.repoUrl}
                        onClick={() => playRecent(entry)}
                      >
                        <History size={12} aria-hidden="true" />
                        <span className="k">{t("recent.label")}</span>{entry.label}
                      </button>
                    ))}
                    <button
                      className="chip recent-clear"
                      type="button"
                      onClick={() => { setRecentRepos([]); saveRecentRepos([]); }}
                    >
                      {t("recent.clear")}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>

        {/* The homepage runner starts as a read-only example report (the bundled
            seed); the moment a visitor starts a real analysis Runner drops the
            demo trim and renders the full report. */}
        <section>
          <div className="section-h">
            <h2>{demoActive ? t("runner.exampleReport") : t("runner.title")}</h2>
            {demoActive ? null : <span className="sub">{t("runner.status." + status)}</span>}
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
            variant={isReportRoute ? "full" : "demo"}
            isPinnedRef={entryUrlPinnedRef}
          />
        </section>

        {!isReportRoute ? <section id="extension" className="extension-promo">
          <div className="section-h"><h2>{t("extensionSection.title")}</h2><span className="sub">{t("extensionSection.subtitle")}</span></div>
          <Suspense fallback={null}><BrowserExtensionSection compact /></Suspense>
        </section> : null}

        {isReportRoute ? <ReportContextTools report={report} repoUrl={repoUrl} refName={refName} /> : <>
        <DeferredContent><PublicReportIndex /></DeferredContent>

        {/* One Tools grid replaces the four full forms that used to be embedded
            here (badge builder + wall, developer tools, compare, ref diff).
            Each card is a whole-click link to the page that owns the tool. */}
        <section id="tools">
          <div className="section-h">
            <h2>{t("tools.title")}</h2>
            <span className="sub">{t("tools.subtitle")}</span>
          </div>
          <DeferredContent><ToolsGrid /></DeferredContent>
        </section>

        <section className="section-compact">
          <div className="section-h">
            <h2>{t("useCases.title")}</h2>
            <span className="sub">{t("useCases.subtitle")}</span>
          </div>
          <DeferredContent>
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

        <section className="section-compact">
          <div className="section-h">
            <h2>{t("howItWorks.title")}</h2>
            <span className="sub">{t("howItWorks.subtitle")}</span>
          </div>
          <DeferredContent>
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

        </>}

        <footer>
          <div className="footer-meta">
            <span>{t("footer.tagline")}</span>
            <p>
              <Trans i18nKey="footer.builtBy" components={{ 1: <a href="https://github.com/huanglizhuo" target="_blank" rel="noreferrer" /> }} />
              {" "}{t("footer.copyright")}
            </p>
          </div>
          <nav className="footer-cols" aria-label={t("footer.navAria")}>
            <div className="footer-col">
              <h2>{t("footer.product")}</h2>
              <ul>
                <li><a href="/stats">{t("growth.nav.stats.label")}</a></li>
                <li><a href="/popular">{t("growth.nav.popular.label")}</a></li>
                <li><a href="/trending">{t("growth.nav.trending.label")}</a></li>
                <li><a href="/badges">{t("footer.badges")}</a></li>
                <li><a href="/extension">{t("footer.extension")}</a></li>
              </ul>
            </div>
            <div className="footer-col">
              <h2>{t("footer.docsCol")}</h2>
              <ul>
                <li><a href="/docs/api">{t("footer.apiDocs")}</a></li>
                <li><a href="/docs/github-sloc-counter">{t("footer.slocGuide")}</a></li>
                <li><a href="/docs/faq">{t("footer.faq")}</a></li>
                <li><a href="/docs/methodology">{t("footer.methodology")}</a></li>
              </ul>
            </div>
            <div className="footer-col">
              <h2>{t("footer.aboutCol")}</h2>
              <ul>
                <li><a href="/about">{t("footer.about")}</a></li>
                <li><a href="/privacy">{t("footer.privacy")}</a></li>
                <li><a href="/contact">{t("footer.contact")}</a></li>
                <li><a href={sourceRepoUrl} target="_blank" rel="noreferrer">{t("footer.github")}</a></li>
              </ul>
            </div>
          </nav>
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

// Whole-click cards to the real tool pages. SPA routes first (they render the
// tool instantly); CLI / Action / MCP live in the source repository. Stats has
// no card here on purpose: the public report index above already links it.
function ToolsGrid() {
  const { t } = useTranslation();
  const tools = [
    { key: "badges", command: "[![SLOC](https://api.octocounts.com/badge/:owner/:repo)](...)", href: "/badges" },
    { key: "compare", command: "open /compare?left=…&right=…", href: "/compare" },
    { key: "diff", command: "open /diff?repo=…&base=v1.0&head=v1.1", href: "/diff" },
    { key: "api", command: "GET https://api.octocounts.com/api/stats", href: "/docs/api" },
    { key: "cli", command: "npx octocounts https://github.com/owner/repo --json", href: `${sourceRepoUrl}/tree/main/cli` },
    { key: "action", command: "uses: huanglizhuo/OctoCounts/action@main", href: `${sourceRepoUrl}/tree/main/action` },
    { key: "mcp", command: "npx octocounts-mcp", href: `${sourceRepoUrl}/tree/main/mcp` },
  ];

  return (
    <div className="developer-tools tools-grid">
      {tools.map((tool) => (
        <a className="developer-tool" href={tool.href} key={tool.key}>
          <span className="chart-tag">{t(`tools.items.${tool.key}.title`)}</span>
          <p>{t(`tools.items.${tool.key}.text`)}</p>
          <code>{tool.command}</code>
        </a>
      ))}
    </div>
  );
}

function AnalysisOptionsPanel({ options, setOptions }: { options: AnalysisOptions; setOptions: (options: AnalysisOptions) => void }) {
  const { t } = useTranslation();
  // Keep what the person is typing separate from its parsed value. Rebuilding
  // the field from `split(',')` on each keystroke used to eat commas/spaces and
  // move the caret, making a normal `examples, fixtures` entry impossible.
  const [ignoredDirsDraft, setIgnoredDirsDraft] = useState(() => options.ignoredDirs.join(", "));
  const [ignoredLanguagesDraft, setIgnoredLanguagesDraft] = useState(() => options.ignoredLanguages.join(", "));
  const update = (patch: Partial<AnalysisOptions>) => setOptions({ ...options, ...patch });
  return (
    <details className="analysis-options">
      <summary>{t("analysisOptions.summary")}</summary>
      <div className="analysis-options-grid">
        <label>
          <span>{t("analysisOptions.profile")}</span>
          <select name="analysisProfile" value={options.profile} onChange={(event) => update({ profile: event.target.value as AnalysisOptions["profile"] })}>
            <option value="default">{t("analysisOptions.defaultProfile")}</option>
            <option value="source-only">{t("analysisOptions.sourceOnlyProfile")}</option>
          </select>
        </label>
        <label>
          <span>{t("analysisOptions.ignoredDirs")}</span>
          <input name="ignoredDirs" value={ignoredDirsDraft} onChange={(event) => { setIgnoredDirsDraft(event.target.value); update({ ignoredDirs: csvList(event.target.value) }); }} onBlur={() => update({ ignoredDirs: csvList(ignoredDirsDraft) })} placeholder="examples, fixtures" />
        </label>
        <label>
          <span>{t("analysisOptions.ignoredLanguages")}</span>
          <input name="ignoredLanguages" value={ignoredLanguagesDraft} onChange={(event) => { setIgnoredLanguagesDraft(event.target.value); update({ ignoredLanguages: csvList(event.target.value) }); }} onBlur={() => update({ ignoredLanguages: csvList(ignoredLanguagesDraft) })} placeholder="Markdown, JSON" />
        </label>
        <div className="analysis-toggles">
          <label><input type="checkbox" name="includeDocs" checked={options.includeDocs} onChange={(event) => update({ includeDocs: event.target.checked })} />{t("analysisOptions.includeDocs")}</label>
          <label><input type="checkbox" name="includeTests" checked={options.includeTests} onChange={(event) => update({ includeTests: event.target.checked })} />{t("analysisOptions.includeTests")}</label>
          <label><input type="checkbox" name="includeGenerated" checked={options.includeGenerated} onChange={(event) => update({ includeGenerated: event.target.checked })} />{t("analysisOptions.includeGenerated")}</label>
        </div>
      </div>
    </details>
  );
}

function csvList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

// Path segments after which a github.com URL names a ref.
const githubRefMarkers = new Set(["tree", "blob", "commit", "commits"]);

/**
 * Reads the ref out of a pasted browse URL, so pasting
 * `https://github.com/owner/repo/tree/master` and pressing Analyze counts
 * `master`. The scheme is part of that: `new URL` throws without one, and the
 * catch below returns `""`. Nothing is lost by it — `parse_repo_url` rejects a
 * scheme-less string as `invalid_url`, so the submit fails either way, and the
 * `git@github.com:` form `parsePublicRepo` accepts cannot carry a browse path.
 *
 * Only the unambiguous shape counts: exactly one segment after the marker.
 * `/tree/main/src` is either branch `main` plus a directory or a branch named
 * `main/src`, and neither side can tell which: the API takes `refName` as an
 * opaque string, and `parse_repo_url` in `backend/src/github.rs` keeps only the
 * first two path segments, so the browse suffix never reaches the resolver.
 *
 * An ambiguous URL therefore leaves the field empty, which is a request, not a
 * guess: `resolve_github_ref` drops a blank ref and resolves the repository's
 * `default_branch` instead. The cost is that `/tree/develop/src` is counted on
 * the default branch rather than on `develop` — and succeeds, so there is no
 * error to notice. What there is instead is the ref itself: `report.refName` is
 * the ref the server resolved, and both the runner header and the trust panel's
 * REF row print it with no interaction, so the mismatch with the pasted URL is
 * on the page rather than only in the request. (`RunnerLog`'s
 * `resolved <ref> -> <sha>` repeats it, but that one is behind the collapsed
 * `run details` disclosure and does not count as surfaced.)
 *
 * Guessing `segments[3]` instead would send `release` for `/tree/release/1.0`
 * and turn a URL that names its ref exactly into a `ref_not_found`; slashes are
 * legal in a ref name and there is no local way to tell one from a directory.
 */
function refFromRepoUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.hostname !== "github.com") return "";
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 4 || !githubRefMarkers.has(segments[2])) return "";
    return decodeRefSegment(segments[3]);
  } catch {
    return "";
  }
}

function hasAmbiguousRefPath(value: string) {
  try {
    const url = new URL(value.trim());
    const segments = url.pathname.split("/").filter(Boolean);
    return url.hostname === "github.com" && segments.length > 4 && githubRefMarkers.has(segments[2]);
  } catch {
    return false;
  }
}

/**
 * `url.pathname` is percent-encoded, but the ref goes to the API as data and is
 * re-encoded by `encodeRefPath` on the way into links. Decoded here it matches
 * what `parsePublicReportPath` produces from the same ref; left encoded it
 * became the ref name `release%2020.1` and double-encoded from there.
 *
 * A bare `%` throws and is not an error: `100%` is a legal branch name, so an
 * undecodable segment is kept rather than silently falling back to the default
 * branch.
 */
function decodeRefSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function initialRequestFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const queryRepo = params.get("q") ?? params.get("url");
  const queryRef = params.get("ref") ?? "";
  const analysisOptions = optionsFromSnapshotParam(params.get("analysis"));
  if (queryRepo) return { repoUrl: queryRepo, refName: queryRef, analysisOptions };

  const route = parsePublicReportPath(window.location.pathname);
  if (route) return { ...route, analysisOptions };

  // Only a brand-new homepage form receives the product's `main`
  // suggestion. Query and report routes keep blank refs meaningful: they ask
  // the provider to resolve its actual default branch.
  return { repoUrl: "", refName: "main", analysisOptions, usesSuggestedMain: true };
}

function optionsFromSnapshotParam(value: string | null): AnalysisOptions | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<AnalysisOptions>;
    if (parsed.profile !== "default" && parsed.profile !== "source-only") return null;
    if (!Array.isArray(parsed.ignoredDirs) || !Array.isArray(parsed.ignoredLanguages)) return null;
    return {
      profile: parsed.profile,
      ignoredDirs: parsed.ignoredDirs.filter((item): item is string => typeof item === "string"),
      ignoredLanguages: parsed.ignoredLanguages.filter((item): item is string => typeof item === "string"),
      includeDocs: typeof parsed.includeDocs === "boolean" ? parsed.includeDocs : true,
      includeTests: typeof parsed.includeTests === "boolean" ? parsed.includeTests : true,
      includeGenerated: typeof parsed.includeGenerated === "boolean" ? parsed.includeGenerated : true,
    };
  } catch {
    return null;
  }
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

  const isPublicReportPath = path.startsWith("/github/");
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
  return buildPublicReportUrl(report.repository.owner, report.repository.name, ref);
}

function buildCanonicalUrlForParsedRepo(parsed: { owner: string; repo: string }, _repoUrl: string, ref: string) {
  return buildPublicReportUrl(parsed.owner, parsed.repo, ref);
}

// Applies title/description/og/twitter/canonical in one call; the per-branch
// og/twitter boilerplate used to be copy-pasted three times through this file.
let lastMetaFingerprint = "";
function applyPageMetadata({ title, description, canonical, extraRobots }: { title: string; description: string; canonical: string; extraRobots?: string }) {
  // Fingerprint every value, not just the title: on report pages the title is
  // identical before and after the report arrives while the description (with
  // live line counts) and canonical change -- a title-only guard would skip
  // those updates entirely.
  const fingerprint = JSON.stringify([title, description, canonical, extraRobots ?? ""]);
  if (fingerprint === lastMetaFingerprint) return;
  lastMetaFingerprint = fingerprint;
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

// Wait for the locale bundle (lazy zh chunk) before first render.
void i18nReady.then(() => {
  // Analytics must init before App renders: the marketing routes in App()
  // early-return before any hook below them runs, so an in-component effect
  // would never fire on /recent, /compare, /stats, etc.
  initAnalytics();
  trackAiVisitIfReferred();
  createRoot(document.getElementById("root")!).render(
    <SchemeProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </SchemeProvider>,
  );
});
