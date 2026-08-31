import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, Loader2 } from "lucide-react";
import { fetchRepoHistory } from "./api";
import { downloadDataUrl, formatNumber } from "./reportUtils";
import { AnalyticsEvents, trackEvent } from "./analytics";
import type { RepoHistory, SlocHistoryPoint, StarHistoryPoint } from "./types";

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { left: 48, right: 16, top: 30, bottom: 26 };
const PLOT_WIDTH = WIDTH - PAD.left - PAD.right;
const PLOT_HEIGHT = HEIGHT - PAD.top - PAD.bottom;
const BASELINE_Y = PAD.top + PLOT_HEIGHT;
/// A GitHub Marketplace-style embed only ever shows a static frame, so the
/// draw-in animation only matters here, on the interactive page — the GIF
/// export exists specifically to carry that same reveal into something
/// shareable off-site. 3 seconds, ~18 frames: enough to read as a smooth
/// reveal without producing a GIF heavy enough to feel like a bad idea to
/// paste into a README.
const GIF_DURATION_MS = 3000;
const GIF_FRAME_COUNT = 18;

/// While the SLOC backfill runs in the background, poll for progress rather
/// than making the visitor reload — most repos finish in well under a
/// minute, so a short interval keeps the "gathering..." state honest without
/// hammering the endpoint.
const BACKFILL_POLL_INTERVAL_MS = 5000;

type Coord<T> = { x: number; y: number; point: T };

/// Projects an arbitrary time series onto the shared x (time) axis, scaled to
/// its own y-domain — stars and SLOC live on wildly different scales, so each
/// series gets its own vertical scale even though both share the same
/// horizontal one.
function project<T>(
  points: T[],
  getDate: (point: T) => string,
  getValue: (point: T) => number,
  domainStart: number,
  domainEnd: number
): Coord<T>[] {
  const span = Math.max(domainEnd - domainStart, 1);
  const maxValue = Math.max(...points.map(getValue), 1);
  return points.map((point) => {
    const time = new Date(getDate(point) + "T00:00:00Z").getTime();
    return {
      x: PAD.left + ((time - domainStart) / span) * PLOT_WIDTH,
      y: BASELINE_Y - (getValue(point) / maxValue) * PLOT_HEIGHT,
      point,
    };
  });
}

function linePath(coords: { x: number; y: number }[]) {
  return coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
}

function areaPath(coords: { x: number; y: number }[]) {
  if (coords.length === 0) return "";
  const first = coords[0];
  const last = coords[coords.length - 1];
  return `${linePath(coords)} L${last.x.toFixed(1)},${BASELINE_Y} L${first.x.toFixed(1)},${BASELINE_Y} Z`;
}

function timeDomain(data: RepoHistory): [number, number] | null {
  const dates = [...data.starPoints.map((p) => p.date), ...data.slocPoints.map((p) => p.date)];
  if (dates.length < 2) return null;
  const times = dates.map((d) => new Date(d + "T00:00:00Z").getTime()).sort((a, b) => a - b);
  return [times[0], times[times.length - 1]];
}

export function RepoHistoryChart({
  provider,
  owner,
  repo,
}: {
  provider: string;
  owner: string;
  repo: string;
}) {
  const { t } = useTranslation();
  const isGitHub = provider === "github";
  const { data, isLoading } = useQuery({
    queryKey: ["repo-history", provider, owner, repo],
    queryFn: () => fetchRepoHistory(provider, owner, repo),
    enabled: isGitHub,
    staleTime: 60 * 1000,
    retry: false,
    refetchInterval: (query) => (query.state.data?.slocBackfillInProgress ? BACKFILL_POLL_INTERVAL_MS : false),
  });

  const domain = useMemo(() => (data ? timeDomain(data) : null), [data]);
  const starCoords = useMemo(
    () => (data && domain ? project<StarHistoryPoint>(data.starPoints, (p) => p.date, (p) => p.stars, domain[0], domain[1]) : null),
    [data, domain]
  );
  const slocCoords = useMemo(
    () =>
      data && domain
        ? project<SlocHistoryPoint>(data.slocPoints, (p) => p.date, (p) => p.totalLines, domain[0], domain[1])
        : null,
    [data, domain]
  );

  const [reveal, setReveal] = useState(0);
  const [displayedCount, setDisplayedCount] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [isExportingGif, setIsExportingGif] = useState(false);
  const [gifError, setGifError] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useRef(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  const currentStars = data?.currentStars ?? 0;

  // The one-time entrance animation: draws both lines in and counts stars up,
  // both driven by the same `reveal` progress value so they finish together.
  // Skips straight to the end state under reduced-motion.
  useEffect(() => {
    if (!starCoords) return;
    if (reduceMotion.current) {
      setReveal(1);
      setDisplayedCount(currentStars);
      return;
    }
    setReveal(0);
    setDisplayedCount(0);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / 1400, 1);
      setReveal(progress);
      setDisplayedCount(Math.round(currentStars * progress));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starCoords, currentStars]);

  const exportGif = async () => {
    if (!starCoords || !chartRef.current) return;
    setIsExportingGif(true);
    setGifError(null);
    const priorReveal = reveal;
    const priorCount = displayedCount;
    try {
      const [{ toCanvas }, { GIFEncoder, quantize, applyPalette }] = await Promise.all([
        import("html-to-image"),
        import("gifenc"),
      ]);
      const gif = GIFEncoder();
      const delay = GIF_DURATION_MS / GIF_FRAME_COUNT;
      for (let frame = 0; frame <= GIF_FRAME_COUNT; frame += 1) {
        const progress = frame / GIF_FRAME_COUNT;
        setReveal(progress);
        setDisplayedCount(Math.round(currentStars * progress));
        // Two rAFs: one for React to commit the state update, one for the
        // browser to actually paint it before html-to-image reads the DOM.
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const canvas = await toCanvas(chartRef.current, { pixelRatio: 1, backgroundColor: "#ffffff" });
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        const { data: pixels, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const palette = quantize(pixels, 256);
        const indexed = applyPalette(pixels, palette);
        gif.writeFrame(indexed, width, height, { palette, delay, first: frame === 0 });
      }
      gif.finish();
      const blob = new Blob([new Uint8Array(gif.bytes())], { type: "image/gif" });
      const url = URL.createObjectURL(blob);
      downloadDataUrl(url, `octocounts-${owner}-${repo}-history.gif`);
      // A blob: URL is only guaranteed valid for the tab that created it and
      // is never automatically freed, unlike a data: URL — revoke it once
      // the download has had a moment to start.
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      trackEvent(AnalyticsEvents.gifExported, { provider, owner, repo });
    } catch {
      setGifError(t("starHistory.gifExportFailed"));
    } finally {
      setReveal(priorReveal);
      setDisplayedCount(priorCount);
      setIsExportingGif(false);
    }
  };

  if (!isGitHub) return null;
  if (isLoading) {
    return (
      <div className="repo-history repo-history-loading" aria-hidden="true">
        <Loader2 className="spin" size={16} />
      </div>
    );
  }
  if (!data || !starCoords) {
    // Either the fetch failed, or this is the very first view of this repo's
    // chart — the star series just started watching and has fewer than two
    // points (nothing has accumulated since day one yet). Nothing useful to
    // draw for stars in that case; the SLOC backfill may still be running in
    // the background for next time.
    return null;
  }

  const revealWidth = PLOT_WIDTH * reveal;
  const hoveredStar = hoverIndex !== null ? starCoords[hoverIndex] : null;
  const hoveredSloc =
    hoverIndex !== null && slocCoords && hoverIndex < slocCoords.length ? slocCoords[hoverIndex] : null;

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    let nearestDistance = Infinity;
    starCoords.forEach((c, i) => {
      const distance = Math.abs(c.x - x);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  };

  return (
    <section className="repo-history" aria-label={t("starHistory.title")}>
      <div className="repo-history-head">
        <h2>{t("starHistory.title")}</h2>
        <span className="repo-history-count">&#9733; {formatNumber(displayedCount)}</span>
      </div>
      {slocCoords && slocCoords.length >= 2 ? (
        <div className="repo-history-legend">
          <span className="repo-history-legend-item">
            <span className="repo-history-legend-swatch repo-history-legend-swatch--star" /> {t("starHistory.legendStars")}
          </span>
          <span className="repo-history-legend-item">
            <span className="repo-history-legend-swatch repo-history-legend-swatch--sloc" /> {t("starHistory.legendSloc")}
          </span>
        </div>
      ) : null}
      <div className="repo-history-chart" ref={chartRef}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          role="img"
          aria-label={t("starHistory.chartAriaLabel", { count: currentStars })}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <clipPath id="repo-history-reveal">
              <rect x={0} y={0} width={revealWidth} height={HEIGHT} />
            </clipPath>
          </defs>
          <g clipPath="url(#repo-history-reveal)">
            <path d={areaPath(starCoords)} className="repo-history-star-area" />
            <path d={linePath(starCoords)} className="repo-history-star-line" />
            {slocCoords && slocCoords.length >= 2 ? (
              <path d={linePath(slocCoords)} className="repo-history-sloc-line" />
            ) : null}
          </g>
          {hoveredStar ? (
            <>
              <line
                x1={hoveredStar.x}
                x2={hoveredStar.x}
                y1={PAD.top}
                y2={BASELINE_Y}
                className="repo-history-hover-line"
              />
              <circle cx={hoveredStar.x} cy={hoveredStar.y} r={4} className="repo-history-hover-dot" />
              {hoveredSloc ? (
                <circle
                  cx={hoveredSloc.x}
                  cy={hoveredSloc.y}
                  r={4}
                  className="repo-history-hover-dot repo-history-hover-dot--sloc"
                />
              ) : null}
            </>
          ) : null}
          <text x={PAD.left} y={HEIGHT - 6} className="repo-history-axis-label">
            {starCoords[0].point.date}
          </text>
          <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end" className="repo-history-axis-label">
            {starCoords[starCoords.length - 1].point.date}
          </text>
        </svg>
        {hoveredStar ? (
          <div className="repo-history-tooltip" style={{ left: `${(hoveredStar.x / WIDTH) * 100}%` }}>
            <strong>{formatNumber(hoveredStar.point.stars)}</strong> &#9733; {hoveredStar.point.date}
            {hoveredSloc ? (
              <>
                {" "}
                &middot; <strong>{formatNumber(hoveredSloc.point.totalLines)}</strong> {t("starHistory.locAbbrev")}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {data.slocBackfillInProgress ? (
        <div className="repo-history-progress">
          <Loader2 className="spin" size={13} /> {t("starHistory.gatheringSloc")}
        </div>
      ) : null}
      <div className="repo-history-actions">
        <button className="copybtn" disabled={isExportingGif} onClick={() => void exportGif()}>
          {isExportingGif ? <Loader2 className="spin" size={13} /> : <Download size={13} />}
          {" "}
          {t("starHistory.exportGif")}
        </button>
        {gifError ? <span className="repo-history-error">{gifError}</span> : null}
      </div>
    </section>
  );
}
