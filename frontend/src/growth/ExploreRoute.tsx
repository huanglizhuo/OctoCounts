import React, { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { MarketingShell } from "./MarketingShell";
import { ExploreModuleError, ExploreSkeleton } from "./ExploreLoading";
import { loadedExplorePages, loadExplorePages } from "./explorePages";
import type { ExploreKind } from "./explorePages";

const Explore = React.lazy(() => loadExplorePages().then((m) => ({ default: m.ExploreApp })));

class ExploreBoundary extends React.Component<{ children: React.ReactNode; kind: ExploreKind }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <ExploreFrame kind={this.props.kind}><ExploreModuleError /></ExploreFrame> : this.props.children; }
}

export function ExploreRoute({ kind }: { kind: ExploreKind }) {
  const Page = loadedExplorePages()?.ExploreApp ?? Explore;
  return <ExploreBoundary kind={kind}><Suspense fallback={<ExploreFrame kind={kind}><ExploreSkeleton kind={kind} /></ExploreFrame>}>
    <Page />
  </Suspense></ExploreBoundary>;
}

export function ExploreFrame({ kind, children }: { kind: ExploreKind; children: React.ReactNode }) {
  const { t } = useTranslation();
  const key = kind === "stats" ? "growth.stats" : `growth.pages.${kind === "monoliths" ? "hall" : kind}`;
  return <MarketingShell>
    <section className={`growth-hero${kind === "stats" ? "" : " list-hero"}`} aria-label={t(`${key}.title`)}>
      <h1 tabIndex={-1}>{t(`${key}.title`)}</h1>
      <p>{t(`${key}.subtitle`)}</p>
      {kind !== "stats" ? <p className="explore-policy">{t(`growth.explore.${kind === "trending" ? "trendingOrder" : `${kind}Policy`}`)} {kind !== "trending" ? <a href="/docs/methodology">{t("growth.pages.trending.methodology")}</a> : null}</p> : null}
    </section>
    {children}
  </MarketingShell>;
}
