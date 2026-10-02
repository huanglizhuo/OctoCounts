// Loading placeholders for the growth stage. GrowthSkeleton silhouettes the
// four-act layout the wait stands in for — terminal line top-left, counter
// center, donut right, bar skyline along the bottom — so the empty window
// reads as "an animation is being prepared here" (plan §3's reserved-height
// stage already fixes the geometry; the shaped fill now also previews it).
// GrowthLoadingBars is act 2's bar race in miniature and serves every growth
// loading line (report section, /growth page, lazy-page fallback). All
// motion is CSS, gated by prefers-reduced-motion in styles.css.
export function GrowthLoadingBars() {
  return (
    <span className="growth-loading-bars" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

// Skyline heights as percentages of the bar row, fixed so the silhouette
// stays deterministic (the animation itself renders from the scene, never
// from random values).
const SKELETON_BARS = [38, 55, 30, 68, 46, 85, 60, 40];

export function GrowthSkeleton({ label }: { label: string }) {
  return (
    <div className="growth-skeleton" role="status">
      <div className="growth-skeleton-stage" aria-hidden="true">
        <div className="growth-skeleton-term">
          <span className="growth-skeleton-prompt" />
          <span className="growth-skeleton-line" />
        </div>
        <div className="growth-skeleton-counter" />
        <div className="growth-skeleton-donut" />
        <div className="growth-skeleton-bars">
          {SKELETON_BARS.map((height, index) => (
            <span key={index} style={{ height: `${height}%` }} />
          ))}
        </div>
      </div>
      <p className="growth-skeleton-status">
        <GrowthLoadingBars />
        {label}
      </p>
    </div>
  );
}
