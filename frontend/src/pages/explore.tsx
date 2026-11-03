import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "../api";
import { ExploreSkeleton, ExploreDataError } from "../growth/ExploreLoading";
import { ExploreContext, exploreHref } from "../growth/ExploreContext";
import { formatCompactNumber, formatNumber, formatPercent, formatRelativeTime, languageColor, visibleLanguageColor } from "../reportUtils";
import { useScheme } from "../scheme";
import { languageShares, readExploreSeed, validateExploreList, validateExploreStats } from "../growth/exploreData";
import type { CollectionKind, ExploreRepository } from "../growth/exploreData";
import { MIN_INDEXABLE_REPORT_FILES } from "../../functions/report-copy.js";
import { trendingSloc, trendingReportPath, trendingIsStale, validateTrendingSnapshot } from "../../functions/trending-sloc.js";
import type { TrendingRepository } from "../../functions/trending-sloc.js";
import type { GrowthStats } from "../types";

function RepositoryList({ reports, kind, start = 1, compact = false }: { reports: ExploreRepository[]; kind: CollectionKind; start?: number; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const scheme = useScheme();
  const { now } = useContext(ExploreContext);
  if (!reports.length) {
    return <p className="growth-empty">{t("growth.empty")}</p>;
  }
  return (
    <ol className={`explore-repos explore-repos--${kind}${compact ? " explore-repos--compact" : ""}`} start={start} role="list">
      {reports.map((repo, index) => {
        const shares = compact ? [] : languageShares(repo);
        const primary = typeof repo.topLanguage === "string" ? repo.topLanguage : repo.topLanguage?.name;
        return (
          <li key={`${repo.owner}/${repo.repo}`} value={start + index}>
            <a className="explore-repo" href={repo.publicPath}>
              {kind !== "recent" ? <span className="explore-rank" aria-label={t("growth.explore.rank", { rank: start + index })}>{start + index}</span> : null}
              <div className="explore-identity">
                <span className="explore-owner">{repo.owner} /</span>
                <strong>{repo.repo}</strong>
                <div className="explore-facts">
                  {repo.total.files !== undefined ? <span>{t("growth.explore.files", { count: repo.total.files, value: formatNumber(repo.total.files, i18n.language) })}</span> : null}
                  {repo.languageCount !== undefined ? <span>{t("growth.explore.languages", { count: repo.languageCount })}</span> : primary ? <span>{primary}</span> : null}
                </div>
              </div>
              <div className="explore-size">
                <strong title={formatNumber(repo.total.code, i18n.language)}><span aria-hidden="true">{formatCompactNumber(repo.total.code, i18n.language)}</span><span className="visually-hidden">{formatNumber(repo.total.code, i18n.language)}</span></strong>
                <span>{t("growth.explore.codeLines")}</span>
              </div>
              {shares.length ? <div className="explore-languages">
                <div className="explore-language-bar" aria-hidden="true">{shares.map((row) => <i key={row.name} style={{ width: `${row.code / repo.total.code * 100}%`, backgroundColor: row.name ? visibleLanguageColor(languageColor(row.name), scheme) : "var(--fg-dim)" }} />)}</div>
                <div className="explore-language-labels">{shares.map((row) => <span key={row.name}>{row.name || t("charts.other")} <b>{formatPercent(row.code, repo.total.code)}</b></span>)}</div>
              </div> : !compact && primary ? <span className="explore-languages">{primary}</span> : null}
              <div className="explore-repo-footer">
                <span>{t("growth.explore.analyzed")} <time dateTime={repo.generatedAt} title={repo.generatedAt}>{kind === "recent" ? formatRelativeTime(repo.generatedAt, i18n.language, now) : repo.generatedAt.slice(0, 10)}</time></span>
                {compact && repo.total.lines !== undefined ? <span>{t("growth.explore.totalLines", { value: formatNumber(repo.total.lines, i18n.language) })}</span> : null}
                {!compact ? <span className="explore-report-link">{t("growth.explore.viewReport")}</span> : null}
              </div>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

function TrendingList({ repositories }: { repositories: TrendingRepository[] }) {
  const { t, i18n } = useTranslation();
  if (!repositories.length) return <p className="growth-empty">{t("growth.empty")}</p>;
  return (
    <ol className="trending-list" role="list" aria-label={t("growth.pages.trending.title")}>
      {repositories.map((repo) => {
        const sloc = trendingSloc(repo.sloc);
        return (
          <li key={repo.fullName} value={repo.rank}>
            <a className="trending-row" href={trendingReportPath(repo)}>
              <span className="trending-rank" aria-hidden="true">{repo.rank}</span>
              <div className="trending-project">
                <strong>{repo.fullName}</strong>
                <p title={repo.description || undefined}>{repo.description || t("growth.repoCard.trendingFallback")}</p>
                {repo.language ? <span className="trending-language">{repo.language}</span> : null}
              </div>
              <div className="trending-metric trending-sloc">
                <span className="trending-label">SLOC</span>
                {sloc ? <>
                  <strong title={formatNumber(sloc.code, i18n.language)}><span aria-hidden="true">{formatCompactNumber(sloc.code, i18n.language)}</span><span className="visually-hidden">{formatNumber(sloc.code, i18n.language)}</span></strong>
                  <span className="trending-detail">{t("growth.pages.trending.counted")} <time dateTime={sloc.generatedAt} title={sloc.generatedAt}>{sloc.generatedAt.slice(0, 10)}</time></span>
                </> : <>
                  <span className="trending-missing">{t("growth.pages.trending.unavailable")}</span>
                  <span className="trending-action">{t("growth.pages.trending.analyze")}</span>
                </>}
              </div>
              <div className="trending-metric">
                <span className="trending-label">{t("growth.pages.trending.starsToday")}</span>
                <strong>+{formatNumber(repo.starsToday, i18n.language)}</strong>
                {repo.totalStars !== undefined ? <span className="trending-detail">{t("growth.pages.trending.totalStars", { total: formatCompactNumber(repo.totalStars, i18n.language) })}</span> : null}
              </div>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

// The same discovery links are visible in the server and client trees.
const REPORT_URL_PREFIX = "https://octocounts.com/github/";

function readMoreReportLocs(value: unknown): string[] {
  try {
    const locs: unknown = value;
    return Array.isArray(locs) ? locs.filter((loc): loc is string => typeof loc === "string" && loc.startsWith(REPORT_URL_PREFIX)) : [];
  } catch {
    return [];
  }
}

function reportLocName(loc: string): string {
  const name = loc.slice(REPORT_URL_PREFIX.length);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function MoreReports() {
  const { t, i18n } = useTranslation();
  const { seeds } = useContext(ExploreContext);
  const locs = readMoreReportLocs(seeds["octocounts-more-reports"] ?? readExploreSeed("octocounts-more-reports"));
  if (!locs.length) return null;
  return (
    <details className="explore-directory">
      <summary>{t("growth.moreReports")} <span>{locs.length}</span></summary>
      <ul className="link-columns">
        {locs.map((loc) => (
          <li key={loc}><a href={loc}>{reportLocName(loc)}</a></li>
        ))}
      </ul>
    </details>
  );
}


export function StatsPage() {
  const { seeds, now } = useContext(ExploreContext);
  const query = useQuery({
    queryKey: ["growth-stats"],
    initialData: () => validateExploreStats(seeds["octocounts-stats-data"] ?? readExploreSeed("octocounts-stats-data")),
    initialDataUpdatedAt: now || undefined,
    staleTime: 5 * 60 * 1000,
    retry: false,
    networkMode: "always",
    refetchOnReconnect: true,
    queryFn: async ({ signal }) => {
      const stats = validateExploreStats(await fetchJson<unknown>("/api/stats", { signal }, { deadline: Date.now() + 15_000 }));
      if (!stats) throw new Error("Invalid stats response");
      return stats;
    },
  });
  const stats = query.data;

  return (
    <div className="explore-data" aria-busy={query.isLoading}>
      {query.isLoading ? <ExploreSkeleton kind="stats" /> : null}
      {query.isError ? <ExploreDataError stale={!!query.data} onRetry={() => void query.refetch()} /> : null}
      {stats ? <StatsDashboard stats={stats} /> : null}
    </div>
  );
}

function StatsDashboard({ stats }: { stats: GrowthStats }) {
  const { t, i18n } = useTranslation();
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
      <p className="explore-policy">{t("growth.explore.statsPolicy")} {t("growth.explore.countedCode", { value: formatNumber(stats.totals.codeLinesCounted, i18n.language) })}</p>
      <section className="growth-grid">
        <GrowthPanel title={t("growth.panels.sources.title")} subtitle={t("growth.panels.sources.subtitle")}>
          <RankedBars rows={stats.sources.map((row) => ({ label: t(`growth.sources.${row.source}`, { defaultValue: sourceLabel(row.source) }), value: row.reports }))} />
        </GrowthPanel>
        <GrowthPanel title={t("growth.panels.languages.title")} subtitle={t("growth.panels.languages.subtitle")}>
          <RankedBars rows={stats.languages.map((row) => ({ label: row.language, value: row.code, detail: t("growth.explore.reports", { count: row.reports }) }))} />
        </GrowthPanel>
      </section>
      <div className="explore-preview-grid">
        <section>
          <div className="section-h">
            <h2>{t("growth.sections.largest.title")}</h2>
            <a className="explore-view-all" href={exploreHref("/hall-of-monoliths", i18n.language)}>{t("growth.explore.viewAll")}</a>
          </div>
          <RepositoryList reports={stats.topRepositories.slice(0, 6)} kind="monoliths" compact />
        </section>
        <section>
          <div className="section-h">
            <h2>{t("growth.sections.recent.title")}</h2>
            <a className="explore-view-all" href={exploreHref("/recent", i18n.language)}>{t("growth.explore.viewAll")}</a>
          </div>
          <RepositoryList reports={stats.recentRepositories.slice(0, 6)} kind="recent" compact />
        </section>
      </div>
    </>
  );
}

export function ReportListPage({ kind }: { kind: CollectionKind }) {
  const { pathname, search, seeds, now } = useContext(ExploreContext);
  const { t, i18n } = useTranslation();
  const endpoint = kind === "monoliths" ? "/api/seo/monoliths" : `/api/seo/${kind}`;
  // The edge function server-renders whichever ?page=N a deep link asks for;
  // fetch the same page or React would swap the SSR list back to page 1.
  const parsedPage = Number(new URLSearchParams(search).get("page"));
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const query = useQuery({
    queryKey: ["seo-list", kind, page],
    initialData: () => {
      const seed = (seeds["octocounts-list-data"] ?? readExploreSeed("octocounts-list-data")) as { kind?: unknown; payload?: unknown } | null;
      const data = seed?.kind === kind ? validateExploreList(seed.payload) : undefined;
      return data?.page === page && data.limit === 36 ? data : undefined;
    },
    initialDataUpdatedAt: now || undefined,
    staleTime: 5 * 60 * 1000,
    retry: false,
    networkMode: "always",
    refetchOnReconnect: true,
    queryFn: async ({ signal }) => {
      const data = validateExploreList(await fetchJson<unknown>(`${endpoint}?limit=36&page=${page}`, { signal }, { deadline: Date.now() + 15_000 }));
      if (!data || data.page !== page || data.limit !== 36) throw new Error("Invalid report list response");
      return data;
    },
  });
  const hasNext = query.data?.hasNext ?? (query.data?.reports.length === 36);
  const reports = query.data?.reports.filter((report) => report.total.files === undefined || report.total.files >= MIN_INDEXABLE_REPORT_FILES) ?? [];

  return (
    <div className="explore-data" aria-busy={query.isLoading}>

      {query.isLoading ? <ExploreSkeleton kind={kind} /> : null}
      {query.isError ? <ExploreDataError stale={!!query.data} onRetry={() => void query.refetch()} /> : null}
      {query.data ? <RepositoryList reports={reports} kind={kind} start={(page - 1) * query.data.limit + 1} /> : null}
      {query.data && !reports.length ? <a className="explore-view-all" href={page > 1 ? pathname : "/"}>{t(page > 1 ? "growth.explore.firstPage" : "growth.actions.analyze")}</a> : null}
      {query.data ? <nav className="list-pagination" aria-label={t("growth.pagination.ariaLabel")}>
        {page > 1 ? <a className="copybtn" href={exploreHref(page === 2 ? pathname : `${pathname}?page=${page - 1}`, i18n.language)}>{t("growth.pagination.previous")}</a> : <span />}
        <span>{t("growth.pagination.page", { page })}</span>
        {hasNext ? <a className="copybtn" href={exploreHref(`${pathname}?page=${page + 1}`, i18n.language)}>{t("growth.pagination.next")}</a> : <span />}
      </nav> : null}
      <MoreReports />
    </div>
  );
}

function readTrendingSnapshot(value: unknown) {
  try {
    return validateTrendingSnapshot(value) ?? undefined;
  } catch {
    return undefined;
  }
}

export function TrendingPage() {
  const { seeds, now } = useContext(ExploreContext);
  const { t, i18n } = useTranslation();
  const query = useQuery({
    queryKey: ["github-trending", "daily"],
    initialData: () => readTrendingSnapshot(seeds["octocounts-trending-data"] ?? readExploreSeed("octocounts-trending-data")),
    retry: false,
    networkMode: "always",
    refetchOnReconnect: true,
    queryFn: async ({ signal }) => {
      const response = await fetch("/github-trending.json", { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
      if (!response.ok) throw new Error(`Trending snapshot returned ${response.status}`);
      const snapshot = validateTrendingSnapshot(await response.json());
      if (!snapshot) throw new Error("Invalid Trending snapshot");
      return snapshot;
    },
    initialDataUpdatedAt: now || undefined,
    staleTime: 60 * 60 * 1000,
  });
  const stale = query.data && trendingIsStale(query.data, now);

  return (
    <div className="explore-data" aria-busy={query.isLoading}>
      {query.data ? <div className="explore-trending-meta">
        {query.data ? <p className="sub">{t("growth.pages.trending.updated", { date: query.data.date })} · <a href={query.data.source} target="_blank" rel="noreferrer">GitHub Trending</a></p> : null}
        {stale ? <p className="trending-stale" role="status">{t("growth.pages.trending.stale", { date: query.data.date })}</p> : null}
      </div> : null}
      {query.isLoading ? <ExploreSkeleton kind="trending" /> : null}
      {query.isError ? <ExploreDataError stale={!!query.data} onRetry={() => void query.refetch()} /> : null}
      {query.data ? <TrendingList repositories={query.data.repositories} /> : null}
      <p className="trending-policy">{t("growth.pages.trending.policy")} <a href="/docs/methodology">{t("growth.pages.trending.methodology")}</a></p>
      <MoreReports />
    </div>
  );
}

function GrowthMetric({ label, value }: { label: string; value: number }) {
  const { i18n } = useTranslation();
  return (
    <div className="growth-metric">
      <span>{label}</span>
      <strong title={formatNumber(value, i18n.language)}>{formatCompactNumber(value, i18n.language)}</strong>
      {formatCompactNumber(value, i18n.language) !== formatNumber(value, i18n.language) ? <em>{formatNumber(value, i18n.language)}</em> : null}
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

function RankedBars({ rows }: { rows: Array<{ label: string; value: number; detail?: string }> }) {
  const { t, i18n } = useTranslation();
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="ranked-bars">
      {rows.length ? rows.map((row) => (
        <div className="ranked-row" key={row.label}>
          <span>{row.label}{row.detail ? <small className="sub"> · {row.detail}</small> : null}</span>
          <i aria-hidden="true"><b style={{ width: `${(row.value / max) * 100}%` }} /></i>
          <em title={formatNumber(row.value, i18n.language)}><span aria-hidden="true">{formatCompactNumber(row.value, i18n.language)}</span><span className="visually-hidden">{formatNumber(row.value, i18n.language)}</span></em>
        </div>
      )) : <p className="growth-empty">{t("growth.empty")}</p>}
    </div>
  );
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
