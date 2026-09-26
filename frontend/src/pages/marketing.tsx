import { Loader2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { fetchGrowthStats, fetchJson } from "../api";
import { initAnalytics } from "../analytics";
import { CompareRepos, DiffRefs } from "../compare";
import { BadgeBuilder, BadgeWall, EmbedBuilder } from "../badges";
import { Topbar } from "../Topbar";
import { StoreLink } from "../StoreLink";
import { formatCompactNumber, formatNumber } from "../reportUtils";
import i18n from "../i18n";
import type { GrowthRepositoryStat, GrowthStats } from "../types";

// Marketing/growth pages (stats, recent, popular, trending, hall of
// monoliths, compare, diff). main.tsx lazy-imports these so the home page
// bundle does not carry them.

export type SeoReportSummary = {
  provider: "github";
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
  title: string;
  line: string;
  footer?: string;
  href: string;
};

// One card grid for all repo listings; adapters below map each API shape.
// owner/repo is the card's identity and its loudest line. The former
// provider tag ("GITHUB") and uppercase date footer only restated the link
// path — noise between the reader and the repo name.
function RepoCardGrid({ cards }: { cards: RepoCard[] }) {
  const { t } = useTranslation();
  if (cards.length === 0) {
    return <p className="growth-empty">{t("growth.empty")}</p>;
  }
  return (
    <div className="growth-repo-grid">
      {cards.map((card) => (
        <a className="growth-repo-card" href={card.href} key={card.key}>
          <strong>{card.title}</strong>
          <span>{card.line}</span>
          {card.footer ? <em>{card.footer}</em> : null}
        </a>
      ))}
    </div>
  );
}

function growthRepoCards(reports: GrowthRepositoryStat[]): RepoCard[] {
  return reports.map((report) => ({
    key: `${report.provider}:${report.owner}/${report.repo}`,
    title: `${report.owner}/${report.repo}`,
    line: `${report.topLanguage ?? i18n.t("growth.repoCard.mixed")} · ${formatNumber(report.total.code)} ${i18n.t("growth.repoCard.code")}`,
    href: report.publicPath,
  }));
}

function seoReportCards(reports: SeoReportSummary[]): RepoCard[] {
  return reports.map((report) => ({
    key: `${report.provider}:${report.owner}/${report.repo}`,
    title: report.repoFullName,
    line: `${report.topLanguage?.name ?? i18n.t("growth.repoCard.mixed")} · ${formatNumber(report.total.code)} ${i18n.t("growth.repoCard.code")}`,
    href: report.publicPath,
  }));
}

function trendingRepoCards(repositories: TrendingRepository[]): RepoCard[] {
  return repositories.map((repo) => ({
    key: repo.fullName,
    title: repo.fullName,
    line: `#${repo.rank} · ${repo.language ?? i18n.t("growth.repoCard.mixed")} — ${repo.description || i18n.t("growth.repoCard.trendingFallback")}`,
    footer: i18n.t("growth.repoCard.starsToday", { count: repo.starsToday, total: formatNumber(repo.totalStars) }),
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
      <a className="skip-link" href="#main">{t("common.skipToContent")}</a>
      <main id="main" className="page growth-page">
        <Topbar />
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
  // The edge function server-renders whichever ?page=N a deep link asks for;
  // fetch the same page or React would swap the SSR list back to page 1.
  const parsedPage = Number(new URLSearchParams(window.location.search).get("page"));
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const query = useQuery({
    queryKey: ["seo-list", kind, page],
    queryFn: () => fetchJson<SeoListResponse>(`${endpoint}?limit=36&page=${page}`),
  });
  const copy = listPageCopy(kind, t);
  const hasNext = (query.data?.reports.length ?? 36) === 36;

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
      <nav className="list-pagination" aria-label={t("growth.pagination.ariaLabel")}>
        {page > 1 ? <a className="copybtn" href={`?page=${page - 1}`}>{t("growth.pagination.previous")}</a> : <span />}
        <span>{t("growth.pagination.page", { page })}</span>
        {hasNext ? <a className="copybtn" href={`?page=${page + 1}`}>{t("growth.pagination.next")}</a> : <span />}
      </nav>
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

// The curated /compare/:slug contract (SG-01): the Pages Function builds one
// view model and renders three representations from it — the SSR HTML body,
// this React page, and the markdown twin. Numbers arrive as pre-formatted
// display strings so a browser locale can never disagree with the SSR body.
type CuratedCompareSide = {
  repoFullName: string;
  publicPath: string;
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
// placement=extension_page.
export function ExtensionPage() {
  const { t } = useTranslation();
  return (
    <MarketingShell>
      <section className="growth-hero tool-hero" aria-label={t("extensionLanding.heroTitle")}>
        <span className="chart-tag">{t("growth.nav.stats.kicker")}</span>
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
            {t("hero.addToChrome")}
          </StoreLink>
          <StoreLink store="edge" placement="extension_page" className="copybtn install-btn secondary-install" size={14}>
            {t("hero.installEdge")}
          </StoreLink>
          <StoreLink store="firefox" placement="extension_page" className="copybtn install-btn secondary-install" size={14}>
            {t("hero.installFirefox")}
          </StoreLink>
        </div>
      </section>
      <section aria-label="How the extension works">
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
