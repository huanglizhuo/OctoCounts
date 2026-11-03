import React, { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { MarketingShell } from "./MarketingShell";
import { ExploreModuleError, ExploreSkeleton } from "./ExploreLoading";
import { loadedExplorePages, loadExplorePages } from "./explorePages";
import type { ExploreKind } from "./explorePages";

const Stats = React.lazy(() => loadExplorePages().then((m) => ({ default: m.StatsPage })));
const List = React.lazy(() => loadExplorePages().then((m) => ({ default: m.ReportListPage })));
const Trending = React.lazy(() => loadExplorePages().then((m) => ({ default: m.TrendingPage })));

class ExploreBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <ExploreModuleError /> : this.props.children; }
}

export function ExploreRoute({ kind }: { kind: ExploreKind }) {
  const { t } = useTranslation();
  const key = kind === "stats" ? "growth.stats" : `growth.pages.${kind === "monoliths" ? "hall" : kind}`;
  // Bootstrap passes through resolved exports so React.lazy cannot flash its fallback again.
  const pages = loadedExplorePages();
  const StatsPage = pages?.StatsPage ?? Stats;
  const ReportListPage = pages?.ReportListPage ?? List;
  const TrendingPage = pages?.TrendingPage ?? Trending;
  return <MarketingShell>
    <section className={`growth-hero${kind === "stats" ? "" : " list-hero"}`} aria-label={t(`${key}.title`)}>
      <h1>{t(`${key}.title`)}</h1>
      <p>{t(`${key}.subtitle`)}</p>
      {kind !== "stats" ? <p className="explore-policy">{t(`growth.explore.${kind === "trending" ? "trendingOrder" : `${kind}Policy`}`)} {kind !== "trending" ? <a href="/docs/methodology">{t("growth.pages.trending.methodology")}</a> : null}</p> : null}
    </section>
    <ExploreBoundary><Suspense fallback={<ExploreSkeleton kind={kind} />}>
      {kind === "stats" ? <StatsPage /> : kind === "trending" ? <TrendingPage /> : <ReportListPage kind={kind} />}
    </Suspense></ExploreBoundary>
  </MarketingShell>;
}
