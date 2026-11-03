import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { fetchGrowthStats, fetchJson } from "../api";
import { initAnalytics } from "../analytics";
import { CompareRepos, DiffRefs } from "../compare";
import { BadgeBuilder, BadgeWall, EmbedBuilder } from "../badges";
import { GrowthLoadingBars } from "../growth/GrowthSkeleton";
import { Topbar, publicReportLinks } from "../Topbar";
import { StoreLink } from "../StoreLink";
import { formatCompactNumber, formatNumber, formatPercent, formatRelativeTime, languageColor, visibleLanguageColor } from "../reportUtils";
import { useScheme } from "../scheme";
import { languageShares, readExploreSeed, validateExploreList, validateExploreStats } from "../growth/exploreData";
import type { CollectionKind, ExploreRepository } from "../growth/exploreData";
import { MIN_INDEXABLE_REPORT_FILES } from "../../functions/report-copy.js";
import { COMPARE_REGISTRY } from "../../functions/compare-registry.js";
import { trendingSloc, trendingReportPath, trendingIsStale, validateTrendingSnapshot } from "../../functions/trending-sloc.js";
import type { TrendingRepository } from "../../functions/trending-sloc.js";
import type { GrowthStats } from "../types";

// Marketing/growth pages (stats, recent, popular, trending, hall of
// monoliths, compare, diff). main.tsx lazy-imports these so the home page
// bundle does not carry them.

function RepositoryList({ reports, kind, start = 1, compact = false }: { reports: ExploreRepository[]; kind: CollectionKind; start?: number; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const scheme = useScheme();
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
                  {repo.total.files !== undefined ? <span>{t("growth.explore.files", { count: repo.total.files, value: formatNumber(repo.total.files) })}</span> : null}
                  {repo.languageCount !== undefined ? <span>{t("growth.explore.languages", { count: repo.languageCount })}</span> : primary ? <span>{primary}</span> : null}
                </div>
              </div>
              <div className="explore-size">
                <strong title={formatNumber(repo.total.code)}><span aria-hidden="true">{formatCompactNumber(repo.total.code)}</span><span className="visually-hidden">{formatNumber(repo.total.code)}</span></strong>
                <span>{t("growth.explore.codeLines")}</span>
              </div>
              {shares.length ? <div className="explore-languages">
                <div className="explore-language-bar" aria-hidden="true">{shares.map((row) => <i key={row.name} style={{ width: `${row.code / repo.total.code * 100}%`, backgroundColor: row.name ? visibleLanguageColor(languageColor(row.name), scheme) : "var(--fg-dim)" }} />)}</div>
                <div className="explore-language-labels">{shares.map((row) => <span key={row.name}>{row.name || t("charts.other")} <b>{formatPercent(row.code, repo.total.code)}</b></span>)}</div>
              </div> : !compact && primary ? <span className="explore-languages">{primary}</span> : null}
              <div className="explore-repo-footer">
                <span>{t("growth.explore.analyzed")} <time dateTime={repo.generatedAt} title={new Date(repo.generatedAt).toLocaleString(i18n.language)}>{kind === "recent" ? formatRelativeTime(repo.generatedAt, i18n.language) : repo.generatedAt.slice(0, 10)}</time></span>
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
  const { t } = useTranslation();
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
                  <strong title={formatNumber(sloc.code)}><span aria-hidden="true">{formatCompactNumber(sloc.code)}</span><span className="visually-hidden">{formatNumber(sloc.code)}</span></strong>
                  <span className="trending-detail">{t("growth.pages.trending.counted")} <time dateTime={sloc.generatedAt} title={sloc.generatedAt}>{sloc.generatedAt.slice(0, 10)}</time></span>
                </> : <>
                  <span className="trending-missing">{t("growth.pages.trending.unavailable")}</span>
                  <span className="trending-action">{t("growth.pages.trending.analyze")}</span>
                </>}
              </div>
              <div className="trending-metric">
                <span className="trending-label">{t("growth.pages.trending.starsToday")}</span>
                <strong>+{formatNumber(repo.starsToday)}</strong>
                {repo.totalStars !== undefined ? <span className="trending-detail">{t("growth.pages.trending.totalStars", { total: formatCompactNumber(repo.totalStars) })}</span> : null}
              </div>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

// The edge renders a rotating slice of report links into the hub pages and
// repeats it as data in <head> (#octocounts-more-reports): createRoot()
// discards the server copy, so the client renders the same links again and
// they stay in the DOM Google indexes.
const REPORT_URL_PREFIX = "https://octocounts.com/github/";

function readMoreReportLocs(): string[] {
  try {
    const locs: unknown = JSON.parse(document.getElementById("octocounts-more-reports")?.textContent || "[]");
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
  const { t } = useTranslation();
  const [locs] = useState(readMoreReportLocs);
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

function MarketingShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();

  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">{t("common.skipToContent")}</a>
      <main id="main" className="page growth-page">
        <Topbar />
        {publicReportLinks.some((link) => link.href === window.location.pathname) ? <nav className="explore-nav" aria-label={t("growth.index.navAria")}>
          {publicReportLinks.map((link) => <a key={link.href} href={link.href} aria-current={window.location.pathname === link.href ? "page" : undefined}>{t(`growth.nav.${link.key}.label`)}</a>)}
        </nav> : null}
        {children}
        <footer>
          <span>{t("growth.footerTagline")}</span>
          <span>
            <a href="/stats">{t("growth.nav.stats.label")}</a> &middot; <a href="/recent">{t("growth.nav.recent.label")}</a> &middot; <a href="/popular">{t("growth.nav.popular.label")}</a> &middot; <a href="/trending">{t("growth.nav.trending.label")}</a> &middot; <a href="/hall-of-monoliths">{t("growth.nav.hall.label")}</a> &middot; <a href="/extension">{t("footer.extension")}</a> &middot; <a href="/badges">{t("footer.badges")}</a> &middot; <a href="/privacy">{t("footer.privacy")}</a>
          </span>
        </footer>
      </main>
    </>
  );
}

export function StatsPage() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["growth-stats"],
    initialData: () => validateExploreStats(readExploreSeed("octocounts-stats-data")),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const stats = validateExploreStats(await fetchGrowthStats());
      if (!stats) throw new Error("Invalid stats response");
      return stats;
    },
  });
  const stats = query.data;

  return (
    <MarketingShell>
      <section className="growth-hero" aria-label={t("growth.stats.ariaLabel")}>
        <h1>{t("growth.stats.title")}</h1>
        <p>{t("growth.stats.subtitle")}</p>
      </section>

      {query.isLoading ? <GrowthLoading /> : null}
      {query.isError ? <GrowthError onRetry={() => void query.refetch()} /> : null}
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
      <p className="explore-policy">{t("growth.explore.statsPolicy")}</p>
      <section className="growth-grid">
        <GrowthPanel title={t("growth.panels.sources.title")} subtitle={t("growth.panels.sources.subtitle")}>
          <RankedBars rows={stats.sources.map((row) => ({ label: t(`growth.sources.${row.source}`, { defaultValue: sourceLabel(row.source) }), value: row.reports }))} />
        </GrowthPanel>
        <GrowthPanel title={t("growth.panels.languages.title")} subtitle={t("growth.panels.languages.subtitle")}>
          <RankedBars rows={stats.languages.map((row) => ({ label: row.language, value: row.code }))} />
        </GrowthPanel>
      </section>
      <div className="explore-preview-grid">
        <section>
          <div className="section-h">
            <h2>{t("growth.sections.largest.title")}</h2>
            <a className="explore-view-all" href="/hall-of-monoliths">{t("growth.explore.viewAll")}</a>
          </div>
          <RepositoryList reports={stats.topRepositories.slice(0, 6)} kind="monoliths" compact />
        </section>
        <section>
          <div className="section-h">
            <h2>{t("growth.sections.recent.title")}</h2>
            <a className="explore-view-all" href="/recent">{t("growth.explore.viewAll")}</a>
          </div>
          <RepositoryList reports={stats.recentRepositories.slice(0, 6)} kind="recent" compact />
        </section>
      </div>
    </>
  );
}

export function ReportListPage({ kind }: { kind: CollectionKind }) {
  const { t } = useTranslation();
  const endpoint = kind === "monoliths" ? "/api/seo/monoliths" : `/api/seo/${kind}`;
  // The edge function server-renders whichever ?page=N a deep link asks for;
  // fetch the same page or React would swap the SSR list back to page 1.
  const parsedPage = Number(new URLSearchParams(window.location.search).get("page"));
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const query = useQuery({
    queryKey: ["seo-list", kind, page],
    initialData: () => {
      const seed = readExploreSeed("octocounts-list-data") as { kind?: unknown; payload?: unknown } | null;
      const data = seed?.kind === kind ? validateExploreList(seed.payload) : undefined;
      return data?.page === page && data.limit === 36 ? data : undefined;
    },
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const data = validateExploreList(await fetchJson<unknown>(`${endpoint}?limit=36&page=${page}`));
      if (!data || data.page !== page || data.limit !== 36) throw new Error("Invalid report list response");
      return data;
    },
  });
  const copy = listPageCopy(kind, t);
  const hasNext = query.data?.hasNext ?? (query.data?.reports.length === 36);
  const reports = query.data?.reports.filter((report) => report.total.files === undefined || report.total.files >= MIN_INDEXABLE_REPORT_FILES) ?? [];

  return (
    <MarketingShell>
      <section className="growth-hero list-hero" aria-label={copy.title}>
        <h1>{copy.title}</h1>
        <p>{copy.subtitle}</p>
        <p className="explore-policy">{t(`growth.explore.${kind}Policy`)} <a href="/docs/methodology">{t("growth.pages.trending.methodology")}</a></p>
      </section>
      {query.isLoading ? <GrowthLoading /> : null}
      {query.isError ? <GrowthError onRetry={() => void query.refetch()} /> : null}
      {query.data ? <RepositoryList reports={reports} kind={kind} start={(page - 1) * query.data.limit + 1} /> : null}
      {query.data && !reports.length ? <a className="explore-view-all" href={page > 1 ? window.location.pathname : "/"}>{t(page > 1 ? "growth.explore.firstPage" : "growth.actions.analyze")}</a> : null}
      {query.data ? <nav className="list-pagination" aria-label={t("growth.pagination.ariaLabel")}>
        {page > 1 ? <a className="copybtn" href={`?page=${page - 1}`}>{t("growth.pagination.previous")}</a> : <span />}
        <span>{t("growth.pagination.page", { page })}</span>
        {hasNext ? <a className="copybtn" href={`?page=${page + 1}`}>{t("growth.pagination.next")}</a> : <span />}
      </nav> : null}
      <MoreReports />
    </MarketingShell>
  );
}

function readTrendingSnapshot() {
  try {
    return validateTrendingSnapshot(JSON.parse(document.getElementById("octocounts-trending-data")?.textContent || "null")) ?? undefined;
  } catch {
    return undefined;
  }
}

export function TrendingPage() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["github-trending", "daily"],
    initialData: readTrendingSnapshot,
    queryFn: async () => {
      const response = await fetch("/github-trending.json");
      if (!response.ok) throw new Error(`Trending snapshot returned ${response.status}`);
      const snapshot = validateTrendingSnapshot(await response.json());
      if (!snapshot) throw new Error("Invalid Trending snapshot");
      return snapshot;
    },
    staleTime: 60 * 60 * 1000,
  });
  const stale = query.data && trendingIsStale(query.data);
  const title = t("growth.pages.trending.title");

  return (
    <MarketingShell>
      <section className="growth-hero list-hero" aria-label={title}>
        <h1>{title}</h1>
        <p>{t("growth.pages.trending.subtitle")}</p>
        {query.data ? <p className="sub">{t("growth.pages.trending.updated", { date: query.data.date })} · <a href={query.data.source} target="_blank" rel="noreferrer">GitHub Trending</a></p> : null}
        {stale ? <p className="trending-stale" role="status">{t("growth.pages.trending.stale", { date: query.data.date })}</p> : null}
        <p className="explore-policy">{t("growth.explore.trendingOrder")}</p>
      </section>
      {query.isLoading ? <GrowthLoading /> : null}
      {query.isError ? <GrowthError onRetry={() => void query.refetch()} /> : null}
      {query.data ? <TrendingList repositories={query.data.repositories} /> : null}
      <p className="trending-policy">{t("growth.pages.trending.policy")} <a href="/docs/methodology">{t("growth.pages.trending.methodology")}</a></p>
      <MoreReports />
    </MarketingShell>
  );
}

export function ComparePage() {
  const { t } = useTranslation();
  return (
    <MarketingShell>
      <section className="growth-hero tool-hero" aria-label={t("compare.title")}>
        <span className="chart-tag">{t("compare.subtitle")}</span>
        <h1>{t("compare.title")}</h1>
        <p>{t("compare.help")}</p>
      </section>
      <CompareRepos showHelp={false} />
      {/* The same curated list the edge renders into /compare's server HTML. */}
      <section aria-label={t("compare.curatedTitle")}>
        <div className="section-h">
          <h2>{t("compare.curatedTitle")}</h2>
          <span className="sub">{t("compare.curatedSubtitle")}</span>
        </div>
        <ul className="link-columns">
          {COMPARE_REGISTRY.map((entry) => (
            <li key={entry.slug}><a href={`/compare/${entry.slug}`}>{entry.name}</a></li>
          ))}
        </ul>
      </section>
    </MarketingShell>
  );
}

// The curated /compare/:slug contract (SG-01): the Pages Function builds one
// view model and renders three representations from it — the SSR HTML body,
// this React page, and the markdown twin. Numbers arrive as pre-formatted
// display strings so a browser locale can never disagree with the SSR body.
type CuratedCompareSide = {
  repoFullName: string;
  publicPath: string;
  snapshotUrl?: string;
  refName: string;
  commitSha: string;
  generatedAt: string;
};

type CuratedCompareModel = {
  state: "ready" | "missing" | "unavailable";
  slug: string;
  name: string;
  canonical: string;
  heading: string;
  interactiveHref: string;
  left?: CuratedCompareSide;
  right?: CuratedCompareSide;
  rows?: Array<{ label: string; left: string; right: string }>;
  definitionText?: string;
  summaryText?: string;
  languageMixText?: string;
  methodologyText?: string;
  policyText?: string;
  retentionText?: string;
  disclaimerText?: string;
  faq?: Array<{ question: string; answer: string }>;
  relatedLinks?: Array<{ href: string; label: string }>;
  editorial?: {
    scope: string;
    insights: string[];
    caution: string;
    sources: Array<{ label: string; url: string }>;
    verifiedAt: string;
  } | null;
};

function readCuratedCompareModel(): CuratedCompareModel | null {
  const node = document.getElementById("octocounts-compare-data");
  if (!node?.textContent) return null;
  try {
    const model = JSON.parse(node.textContent) as CuratedCompareModel;
    return model && typeof model.slug === "string" && typeof model.heading === "string" ? model : null;
  } catch {
    return null;
  }
}

export function CuratedComparePage() {
  const { t } = useTranslation();
  const model = useMemo(readCuratedCompareModel, []);
  // Unknown slugs (404 in production) and JS-only previews have no model;
  // they degrade to the generic tool, exactly what /compare shows.
  if (!model) return <ComparePage />;
  const notice =
    model.state === "unavailable"
      ? t("curatedCompare.unavailable")
      : t("curatedCompare.missing");
  return (
    <MarketingShell>
      <section className="growth-hero tool-hero" aria-label={model.heading}>
        <span className="chart-tag">{t("compare.subtitle")}</span>
        <h1>{model.heading}</h1>
        <p>{model.state === "ready" ? model.definitionText : notice}</p>
      </section>
      {model.state === "ready" ? <CuratedCompareBody model={model} /> : null}
      <section className="curated-compare-tool" aria-label={t("compare.title")}>
        <div className="section-h">
          <h2>{t("compare.title")}</h2>
          <span className="sub">{t("compare.help")}</span>
        </div>
        <CompareRepos showHelp={false} />
      </section>
    </MarketingShell>
  );
}

function CuratedCompareBody({ model }: { model: CuratedCompareModel }) {
  const { t } = useTranslation();
  if (!model.left || !model.right || !model.rows) return null;
  // The methodology sentence embeds the same /docs/methodology link the SSR
  // body carries; split the plain string on the shared anchor phrase.
  const methodology = model.methodologyText ?? "";
  const [methodologyLead, methodologyTail] = methodology.split("See the counting methodology");
  return (
    <section className="curated-compare-body" aria-label={t("curatedCompare.resultsAria")}>
      {model.summaryText ? <p>{model.summaryText}</p> : null}
      <table>
        <thead>
          <tr>
            <th>{t("compare.metric")}</th>
            <th><a href={model.left.publicPath}>{model.left.repoFullName}</a></th>
            <th><a href={model.right.publicPath}>{model.right.repoFullName}</a></th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.left}</td>
              <td>{row.right}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {model.languageMixText ? <p>{model.languageMixText}</p> : null}
      {model.policyText ? <p>{model.policyText}</p> : null}
      {model.editorial ? (
        <section aria-label={t("curatedCompare.aboutAria")}>
          <h2>{t("curatedCompare.aboutTitle")}</h2>
          <p>{model.editorial.scope}</p>
          {model.editorial.insights.map((insight) => (
            <p key={insight}>{insight}</p>
          ))}
          <p><em>{model.editorial.caution}</em></p>
          <p>
            {t("curatedCompare.sourcesLabel")}{" "}
            {model.editorial.sources.map((source, index) => (
              <span key={source.url}>
                {index > 0 ? " · " : ""}
                <a href={source.url} rel="noreferrer">{source.label}</a>
              </span>
            ))}
            {" "}
            {t("curatedCompare.verified", { date: model.editorial.verifiedAt })}
          </p>
        </section>
      ) : null}
      {methodology ? (
        <p>
          {methodologyLead}See the <a href="/docs/methodology">counting methodology</a>
          {methodologyTail}
        </p>
      ) : null}
      <p>{t("curatedCompare.nextSteps")}</p>
      <ul>
        <li><a href={model.left.publicPath}>{t("curatedCompare.slocReport", { repo: model.left.repoFullName })}</a></li>
        <li><a href={model.right.publicPath}>{t("curatedCompare.slocReport", { repo: model.right.repoFullName })}</a></li>
        <li>
          <a href={model.interactiveHref}>
            {t("curatedCompare.interactive", { left: model.left.repoFullName, right: model.right.repoFullName })}
          </a>
        </li>
      </ul>
      {[model.left, model.right].filter((side) => side.snapshotUrl).map((side) => <p key={side.repoFullName}><a href={side.snapshotUrl}>{t("curatedCompare.savedReport", { repo: side.repoFullName })}</a></p>)}
      {model.retentionText ? <p>{model.retentionText}</p> : null}
      {model.disclaimerText ? <p>{model.disclaimerText}</p> : null}
      {model.faq?.length ? (
        <div className="how">
          <h2>{t("curatedCompare.faqTitle")}</h2>
          {model.faq.map((item) => (
            <div className="step" key={item.question}>
              <h3>{item.question}</h3>
              {item.answer.split(/\n\n+/).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {model.relatedLinks?.length ? (
        <nav aria-label={t("curatedCompare.relatedAria")}>
          <ul>
            {model.relatedLinks.map((link) => (
              <li key={link.href}><a href={link.href}>{link.label}</a></li>
            ))}
          </ul>
        </nav>
      ) : null}
    </section>
  );
}

// /extension landing page (SG-03). Static marketing copy that mirrors the
// facts the Pages Function server-renders (functions/[[path]].js
// EXTENSION_CONTENT); the product-facts checker keeps the store URLs in both
// files identical. Install links reuse the site-wide StoreLink analytics with
// placement=extension_page. The en button labels (extensionSection.install*)
// must stay identical to the SSR fallback's "Install from …" copy so
// hydration does not swap the text.
export function ExtensionPage() {
  const { t } = useTranslation();
  return (
    <MarketingShell>
      <section className="growth-hero tool-hero" aria-label={t("extensionLanding.heroTitle")}>
        <h1>{t("extensionLanding.heroTitle")}</h1>
        <p>{t("extensionLanding.heroIntro")}</p>
      </section>
      <section aria-label="Install OctoCounts">
        <div className="section-h">
          <h2>{t("extensionLanding.installTitle")}</h2>
          <span className="sub">{t("extensionLanding.installSubtitle")}</span>
        </div>
        <div className="hero-paths">
          <StoreLink store="chrome" placement="extension_page" className="btn install-btn hero-install-primary" size={15}>
            {t("extensionSection.installChrome")}
          </StoreLink>
          <StoreLink store="edge" placement="extension_page" className="copybtn install-btn secondary-install" size={14}>
            {t("extensionSection.installEdge")}
          </StoreLink>
          <StoreLink store="firefox" placement="extension_page" className="copybtn install-btn secondary-install" size={14}>
            {t("extensionSection.installFirefox")}
          </StoreLink>
        </div>
      </section>
      <section className="extension-guide" aria-label={t("extensionLanding.stepsTitle")}>
        <div className="section-h">
          <h2>{t("extensionLanding.stepsTitle")}</h2>
        </div>
        <ol>
          <li>{t("extensionLanding.step1")}</li>
          <li>{t("extensionLanding.step2")}</li>
          <li>{t("extensionLanding.step3")}</li>
        </ol>
        <h2>{t("extensionLanding.permissionsTitle")}</h2>
        <p>{t("extensionLanding.permissions")}</p>
        <h2>{t("extensionLanding.scopeTitle")}</h2>
        <p>{t("extensionLanding.scope")}</p>
      </section>
      {/* The edge page publishes these Q&As as FAQPage schema; they must be visible. */}
      <section aria-label={t("extensionLanding.faqTitle")}>
        <div className="section-h">
          <h2>{t("extensionLanding.faqTitle")}</h2>
        </div>
        <div className="how">
          {(t("extensionLanding.faq", { returnObjects: true }) as Array<{ question: string; answer: string }>).map((item) => (
            <div className="step" key={item.question}>
              <h3>{item.question}</h3>
              <p>{item.answer}</p>
            </div>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}

export function DiffPage() {
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

export function BadgesPage() {
  const { t } = useTranslation();
  const [targetRepo, setTargetRepo] = useState(() => new URLSearchParams(window.location.search).get("repo") ?? "");
  const [targetRef, setTargetRef] = useState(() => new URLSearchParams(window.location.search).get("ref") ?? "");
  const faqItems = t("badgesPage.faq", { returnObjects: true }) as Array<{ question: string; answer: string }>;
  return (
    <MarketingShell>
      <section className="growth-hero tool-hero" aria-label={t("badgesPage.title")}>
        <span className="chart-tag">{t("badgesPage.kicker")}</span>
        <h1>{t("badgesPage.title")}</h1>
        <p>{t("badgesPage.subtitle")}</p>
      </section>
      <form className="badge-target" onSubmit={(event) => event.preventDefault()}>
        <label><span>{t("badgesPage.repoLabel")}</span><input value={targetRepo} onChange={(event) => setTargetRepo(event.target.value)} placeholder="https://github.com/owner/repo" aria-label={t("badgesPage.repoAria")} /></label>
        <label><span>{t("badgesPage.refLabel")}</span><input value={targetRef} onChange={(event) => setTargetRef(event.target.value)} placeholder={t("badgesPage.refPlaceholder")} aria-label={t("badgesPage.refAria")} /></label>
      </form>
      <div className="tool-workspace">
        <section aria-label={t("badgeBuilder.title")}>
          <BadgeBuilder repoUrl={targetRepo} refName={targetRef} report={null} />
        </section>
        <section aria-label={t("embedBuilder.title")}>
          <div className="section-h">
            <h2>{t("embedBuilder.title")}</h2>
            <span className="sub">{t("embedBuilder.subtitle")}</span>
          </div>
          <EmbedBuilder repoUrl={targetRepo} report={null} />
        </section>
      </div>
      <BadgeWall />
      <section aria-label={t("badgesPage.faqTitle")}>
        <div className="section-h">
          <h2>{t("badgesPage.faqTitle")}</h2>
          <span className="sub">{t("badgesPage.faqSubtitle")}</span>
        </div>
        <div className="how">
          {faqItems.map((item, idx) => (
            <div className="step" key={idx}>
              <h3>{item.question}</h3>
              <p>{item.answer}</p>
            </div>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}

function GrowthMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="growth-metric">
      <span>{label}</span>
      <strong title={formatNumber(value)}>{formatCompactNumber(value)}</strong>
      {formatCompactNumber(value) !== formatNumber(value) ? <em>{formatNumber(value)}</em> : null}
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
  const { t } = useTranslation();
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="ranked-bars">
      {rows.length ? rows.map((row) => (
        <div className="ranked-row" key={row.label}>
          <span>{row.label}</span>
          <i aria-hidden="true"><b style={{ width: `${(row.value / max) * 100}%` }} /></i>
          <em>{formatCompactNumber(row.value)}</em>
        </div>
      )) : <p className="growth-empty">{t("growth.empty")}</p>}
    </div>
  );
}

function GrowthLoading() {
  const { t } = useTranslation();
  return (
    <section className="growth-state">
      <GrowthLoadingBars />
      {t("growth.loading")}
    </section>
  );
}

function GrowthError({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="growth-state">
      {t("growth.error")}
      {onRetry ? <button type="button" className="copybtn retry-btn" onClick={onRetry}>{t("error.retry")}</button> : null}
    </section>
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
