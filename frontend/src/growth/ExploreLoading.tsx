import React from "react";
import { useTranslation } from "react-i18next";
import type { ExploreKind } from "./explorePages";

function Block({ size = "line" }: { size?: string }) {
  return <span className={`explore-placeholder explore-placeholder--${size}`} />;
}

function Rows({ kind, count = 6, compact = false }: { kind: ExploreKind; count?: number; compact?: boolean }) {
  if (kind === "trending") return <div className="trending-list">
    {Array.from({ length: count }, (_, index) => <div key={index} className="explore-trending-placeholder">
      <Block size="rank" />
      <div className="trending-project"><Block size="name" /><Block size="description" /><Block size="facts" /></div>
      <div className="trending-metric trending-sloc"><Block size="label" /><Block size="number" /><Block size="date" /></div>
      <div className="trending-metric"><Block size="label" /><Block size="number" /></div>
    </div>)}
  </div>;
  return <div className={`explore-repos explore-repos--${kind}${compact ? " explore-repos--compact" : ""}`}>
    {Array.from({ length: count }, (_, index) => <div key={index} className="explore-placeholder-row">
      {kind !== "recent" ? <Block size="rank" /> : null}
      <div><Block size="owner" /><Block size="name" /><Block size="facts" /></div>
      <div className="explore-size"><Block size="number" /><Block size="label" /></div>
      {!compact ? <div className="explore-languages"><Block size="bar" /><Block size="facts" /></div> : null}
      <div className="explore-repo-footer"><Block size="date" /></div>
    </div>)}
  </div>;
}

export function ExploreSkeleton({ kind }: { kind: ExploreKind }) {
  const { t } = useTranslation();
  return <div className="explore-skeleton" role="status" aria-busy="true" aria-label={t("growth.explore.loading")}>
    <span className="visually-hidden">{t("growth.explore.loading")}</span>
    <div aria-hidden="true">
      {kind === "stats" ? <>
        {[false, true].map((compact) => <div key={String(compact)} className={`growth-metrics${compact ? " compact" : ""}`}>
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="growth-metric"><Block size="label" /><Block size={compact ? "metric-small" : "metric"} /></div>)}
        </div>)}
        <div className="explore-policy"><Block /><Block size="facts" /></div>
        <div className="growth-grid">{[0, 1].map((index) => <div key={index} className="explore-placeholder-chart"><Block size="name" />{[0, 1, 2].map((row) => <Block key={row} size="chart" />)}</div>)}</div>
        <div className="explore-preview-grid">{["monoliths", "recent"].map((kind) => <div key={kind}><div className="section-h"><Block size="name" /></div><Rows kind={kind as ExploreKind} count={3} compact /></div>)}</div>
      </> : <>{kind === "trending" ? <div className="explore-trending-meta"><Block size="date" /></div> : null}<Rows kind={kind} count={kind === "trending" ? 5 : 6} /></>}
    </div>
  </div>;
}

export function ExploreDataError({ stale, onRetry }: { stale: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  return <div className={stale ? "explore-refresh-error" : "growth-state"} role="status">
    <span>{t(stale ? "growth.explore.refreshFailed" : "growth.error")}</span>
    <button type="button" className="copybtn retry-btn" onClick={onRetry}>{t("error.retry")}</button>
  </div>;
}

export function ExploreModuleError() {
  const { t } = useTranslation();
  return <div className="growth-state" role="alert">
    <span>{t("growth.explore.moduleFailed")}</span>
    <button type="button" className="copybtn" onClick={() => window.location.reload()}>{t("growth.explore.reload")}</button>
  </div>;
}
