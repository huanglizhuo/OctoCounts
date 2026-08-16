import { Loader2 } from "lucide-react";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { fetchGrowthStats, fetchJson } from "../api";
import { initAnalytics } from "../analytics";
import { CompareRepos, DiffRefs } from "../compare";
import { Topbar } from "../Topbar";
import { formatCompactNumber, formatNumber } from "../reportUtils";
import { ThemeSwitch } from "../scheme";
import type { GrowthRepositoryStat, GrowthStats } from "../types";

// Marketing/growth pages (stats, recent, popular, trending, hall of
// monoliths, compare, diff). main.tsx lazy-imports these so the home page
// bundle does not carry them.

export type SeoReportSummary = {
  provider: "github" | "gitlab";
  owner: string;
  repo: string;
  repoFullName: string;
  htmlUrl: string;
  publicPath: string;
  generatedAt: string;
  refName: string;
  total: { code: number };
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

type RepoCard = {
  key: string;
  tag: string;
  title: string;
  line: string;
  footer: string;
  href: string;
};

// One card grid for all repo listings; adapters below map each API shape.
function RepoCardGrid({ cards }: { cards: RepoCard[] }) {
  const { t } = useTranslation();
  if (cards.length === 0) {
    return <p className="growth-empty">{t("growth.empty")}</p>;
  }
  return (
    <div className="growth-repo-grid">
      {cards.map((card) => (
        <a className="growth-repo-card" href={card.href} key={card.key}>
          <span className="chart-tag">{card.tag}</span>
          <strong>{card.title}</strong>
          <span>{card.line}</span>
          <em>{card.footer}</em>
        </a>
      ))}
    </div>
  );
}

function growthRepoCards(reports: GrowthRepositoryStat[]): RepoCard[] {
  return reports.map((report) => ({
    key: `${report.provider}:${report.owner}/${report.repo}`,
    tag: String(report.provider),
    title: `${report.owner}/${report.repo}`,
    line: `${report.topLanguage ?? "mixed"} · ${formatNumber(report.total.code)} code`,
    footer: new Date(report.generatedAt).toLocaleDateString(),
    href: report.publicPath,
  }));
}

function seoReportCards(reports: SeoReportSummary[]): RepoCard[] {
  return reports.map((report) => ({
    key: `${report.provider}:${report.owner}/${report.repo}`,
    tag: report.provider,
    title: report.repoFullName,
    line: `${report.topLanguage?.name ?? "mixed"} · ${formatNumber(report.total.code)} code`,
    footer: new Date(report.generatedAt).toLocaleDateString(),
    href: report.publicPath,
  }));
}

function trendingRepoCards(repositories: TrendingRepository[]): RepoCard[] {
  return repositories.map((repo) => ({
    key: repo.fullName,
    tag: `#${repo.rank} · ${repo.language ?? "mixed"}`,
    title: repo.fullName,
    line: repo.description || "GitHub Trending repository",
    footer: `+${formatNumber(repo.starsToday)} stars today · ${formatNumber(repo.totalStars)} total`,
    href: repo.publicPath,
  }));
}

function MarketingShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();

  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="crt flicker" />
      <main id="main" className="page growth-page">
        <Topbar />
        <div className="marketing-controls">
          <ThemeSwitch />
        </div>
        {children}
        <footer>
          <span>{t("growth.footerTagline")}</span>
          <span>
            <a href="/stats">{t("growth.nav.stats.label")}</a> &middot; <a href="/recent">{t("growth.nav.recent.label")}</a> &middot; <a href="/popular">{t("growth.nav.popular.label")}</a> &middot; <a href="/trending">{t("growth.nav.trending.label")}</a> &middot; <a href="/hall-of-monoliths">{t("growth.nav.hall.label")}</a> &middot; <a href="/launch-kit.html">{t("growth.launchKit")}</a> &middot; <a href="/privacy">{t("footer.privacy")}</a>
          </span>
        </footer>
      </main>
    </>
  );
}

export function StatsPage() {
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
        <RepoCardGrid cards={growthRepoCards(stats.topRepositories)} />
      </section>
      <section>
        <div className="section-h">
          <h2>{t("growth.sections.recent.title")}</h2>
          <span className="sub">{t("growth.sections.recent.subtitle")}</span>
        </div>
        <RepoCardGrid cards={growthRepoCards(stats.recentRepositories)} />
      </section>
    </>
  );
}

export function ReportListPage({ kind }: { kind: "recent" | "popular" | "monoliths" }) {
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
      {query.isError ? <GrowthError onRetry={() => void query.refetch()} /> : null}
      {query.data ? <RepoCardGrid cards={seoReportCards(query.data.reports)} /> : null}
    </MarketingShell>
  );
}

export function TrendingPage() {
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
      {query.isError ? <GrowthError onRetry={() => void query.refetch()} /> : null}
      {query.data ? <RepoCardGrid cards={trendingRepoCards(query.data.repositories)} /> : null}
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
  const { t } = useTranslation();
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="ranked-bars">
      {rows.length ? rows.map((row) => (
        <div className="ranked-row" key={row.label}>
          <span>{row.label}</span>
          <i><b style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }} /></i>
          <em>{formatCompactNumber(row.value)}</em>
        </div>
      )) : <p className="growth-empty">{t("growth.empty")}</p>}
    </div>
  );
}

function GrowthLoading() {
  const { t } = useTranslation();
  return <section className="growth-state"><Loader2 className="spin" size={18} /> {t("growth.loading")}</section>;
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
