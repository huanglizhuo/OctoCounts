import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, Loader2 } from "lucide-react";
import { fetchRepoHistory } from "./api";
import { downloadDataUrl, formatNumber } from "./reportUtils";
import { AnalyticsEvents, trackEvent } from "./analytics";
import { useScheme } from "./scheme";
import type { RepoHistory, SlocHistoryPoint } from "./types";

// The GIF export rasterizes literal attribute colors (html-to-image clones
// carry no CSS variables), so pick the palette per on-screen scheme instead
// of always shipping the light variant to dark-theme users.
const GIF_PALETTES = {
  matrix: { bg: "#101713", line: "#55d37a", lineFill: "rgba(85, 211, 122, 0.15)", axis: "#7d9186", count: "#cfead9" },
  paper: { bg: "#ffffff", line: "#167a3b", lineFill: "rgba(22, 122, 59, 0.15)", axis: "#63706a", count: "#183326" },
} as const;

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

type Coord = { x: number; y: number; point: SlocHistoryPoint };

function project(points: SlocHistoryPoint[], domainStart: number, domainEnd: number): Coord[] {
  const span = Math.max(domainEnd - domainStart, 1);
  const maxValue = Math.max(...points.map((p) => p.totalLines), 1);
  return points.map((point) => {
    const time = new Date(point.date + "T00:00:00Z").getTime();
    return {
      x: PAD.left + ((time - domainStart) / span) * PLOT_WIDTH,
      y: BASELINE_Y - (point.totalLines / maxValue) * PLOT_HEIGHT,
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

function timeDomain(points: SlocHistoryPoint[]): [number, number] | null {
  if (points.length < 2) return null;
  const times = points.map((p) => new Date(p.date + "T00:00:00Z").getTime()).sort((a, b) => a - b);
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
  const { t, i18n } = useTranslation();
  const scheme = useScheme();
  const gifPalette = GIF_PALETTES[scheme];
  const isGitHub = provider === "github";
  const query = useQuery({
    queryKey: ["repo-history", provider, owner, repo],
    queryFn: () => fetchRepoHistory(provider, owner, repo),
    enabled: isGitHub,
    staleTime: 60 * 1000,
    retry: false,
    refetchInterval: (query) => (query.state.data?.slocBackfillInProgress ? BACKFILL_POLL_INTERVAL_MS : false),
  });

  const { data, isLoading } = query;
  const domain = useMemo(() => (data ? timeDomain(data.slocPoints) : null), [data]);
  const coords = useMemo(
    () => (data && domain ? project(data.slocPoints, domain[0], domain[1]) : null),
    [data, domain]
  );

  const [reveal, setReveal] = useState(0);
  const [displayedLines, setDisplayedLines] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [isExportingGif, setIsExportingGif] = useState(false);
  const [gifError, setGifError] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const gifExportRef = useRef<HTMLDivElement>(null);
  const gifClipRef = useRef<SVGRectElement>(null);
  const gifCountRef = useRef<SVGTextElement>(null);
  const reduceMotion = useRef(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  const currentLines = coords ? coords[coords.length - 1].point.totalLines : 0;

  // The one-time entrance animation: draws the line in and counts the total
  // lines up, both driven by the same `reveal` progress value so they finish
  // together. Skips straight to the end state under reduced-motion.
  useEffect(() => {
    if (!coords) return;
    if (reduceMotion.current) {
      setReveal(1);
      setDisplayedLines(currentLines);
      return;
    }
    setReveal(0);
    setDisplayedLines(0);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      // rAF's timestamp can land a hair before the `performance.now()` call
      // above (it marks when the frame began, not when this callback runs),
      // which produced a barely-negative progress on the first tick and fed
      // an invalid negative width into the SVG reveal <rect>. Clamp both ends.
      const progress = Math.max(0, Math.min((now - start) / 1400, 1));
      setReveal(progress);
      setDisplayedLines(Math.round(currentLines * progress));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, currentLines]);

  const exportGif = async () => {
    if (!coords || !gifExportRef.current) return;
    setIsExportingGif(true);
    setGifError(null);
    try {
      const [{ toCanvas }, { GIFEncoder, quantize, applyPalette }] = await Promise.all([
        import("html-to-image"),
        import("gifenc"),
      ]);
      const gif = GIFEncoder();
      const delay = GIF_DURATION_MS / GIF_FRAME_COUNT;
      for (let frame = 0; frame <= GIF_FRAME_COUNT; frame += 1) {
        const progress = frame / GIF_FRAME_COUNT;
        // Export from an offscreen SVG. Updating its DOM directly keeps the
        // interactive chart, tooltip, and its entrance animation untouched.
        gifClipRef.current?.setAttribute("width", String(PAD.left + PLOT_WIDTH * progress));
        if (gifCountRef.current) gifCountRef.current.textContent = formatNumber(Math.round(currentLines * progress));
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const canvas = await toCanvas(gifExportRef.current, {
          pixelRatio: 1,
          backgroundColor: gifPalette.bg,
          // The source is intentionally parked offscreen in the live document.
          // html-to-image clones it, so reset that positioning on the clone
          // before rasterizing or every frame is clipped to a blank canvas.
          style: { position: "static", left: "0", top: "0", transform: "none" },
        });
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
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      trackEvent(AnalyticsEvents.gifExported, { provider, owner, repo });
    } catch {
      setGifError(t("codeHistory.gifExportFailed"));
    } finally {
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
  if (query.isError) {
    return <section className="repo-history repo-history-loading" role="status">{t("codeHistory.unavailable")} <button className="copybtn" type="button" onClick={() => void query.refetch()}>{t("codeHistory.retry")}</button></section>;
  }
  if (!data || !coords) {
    return <section className="repo-history repo-history-loading" role="status">{t("codeHistory.empty")}</section>;
  }

  const revealWidth = PAD.left + PLOT_WIDTH * reveal;
  const hovered = hoverIndex !== null ? coords[hoverIndex] : null;

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    let nearestDistance = Infinity;
    coords.forEach((c, i) => {
      const distance = Math.abs(c.x - x);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  };
  const handleTouch = (event: React.TouchEvent<SVGSVGElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((touch.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    coords.forEach((coord, index) => {
      if (Math.abs(coord.x - x) < Math.abs(coords[nearest].x - x)) nearest = index;
    });
    setHoverIndex(nearest);
  };
  const selectIndex = (index: number) => setHoverIndex(Math.max(0, Math.min(coords.length - 1, index)));

  return (
    <section className="repo-history" aria-label={t("codeHistory.title")}>
      <div className="repo-history-head">
        <h2>{t("codeHistory.title")}</h2>
        <span className="repo-history-count">{formatNumber(displayedLines)} {t("codeHistory.locAbbrev")}</span>
      </div>
      <div className="repo-history-chart" ref={chartRef}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          role="img"
          aria-label={t("codeHistory.chartAriaLabel", { count: formatNumber(currentLines) })}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
          onTouchStart={handleTouch}
          onTouchMove={handleTouch}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") { event.preventDefault(); selectIndex((hoverIndex ?? -1) + 1); }
            if (event.key === "ArrowLeft") { event.preventDefault(); selectIndex((hoverIndex ?? coords.length) - 1); }
            if (event.key === "Home") { event.preventDefault(); selectIndex(0); }
            if (event.key === "End") { event.preventDefault(); selectIndex(coords.length - 1); }
          }}
        >
          <defs>
            <clipPath id="repo-history-reveal">
              <rect x={0} y={0} width={revealWidth} height={HEIGHT} />
            </clipPath>
          </defs>
          <g clipPath="url(#repo-history-reveal)">
            <path d={areaPath(coords)} className="repo-history-sloc-area" fill="#55c878" fillOpacity="0.15" />
            <path d={linePath(coords)} className="repo-history-sloc-line" stroke="#55d37a" fill="none" strokeWidth="2" />
          </g>
          {hovered ? (
            <>
              <line
                x1={hovered.x}
                x2={hovered.x}
                y1={PAD.top}
                y2={BASELINE_Y}
                className="repo-history-hover-line"
              />
              <circle cx={hovered.x} cy={hovered.y} r={4} className="repo-history-hover-dot" />
            </>
          ) : null}
          <text x={PAD.left} y={HEIGHT - 6} className="repo-history-axis-label">
            {formatHistoryDate(coords[0].point.date, i18n.language)}
          </text>
          <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end" className="repo-history-axis-label">
            {formatHistoryDate(coords[coords.length - 1].point.date, i18n.language)}
          </text>
        </svg>
        {hovered ? (
          <div className="repo-history-tooltip" style={{ left: `${Math.min(54, Math.max(24, (hovered.x / WIDTH) * 100))}%` }}>
            <strong>{formatNumber(hovered.point.totalLines)}</strong> {t("codeHistory.locAbbrev")} &middot; {formatHistoryDate(hovered.point.date, i18n.language)}
          </div>
        ) : null}
      </div>
      {data.slocBackfillInProgress ? (
        <div className="repo-history-progress">
          <Loader2 className="spin" size={13} /> {t("codeHistory.gatheringSloc")}
        </div>
      ) : null}
      <span className="visually-hidden" aria-live="polite">{hovered ? `${formatHistoryDate(hovered.point.date, i18n.language)}: ${formatNumber(hovered.point.totalLines)} ${t("codeHistory.locAbbrev")}` : ""}</span>
      <details className="repo-history-data">
        <summary>{t("codeHistory.dataTable")}</summary>
        <div className="repo-history-data-wrap">
          <table>
            <thead><tr><th>{t("codeHistory.date")}</th><th>{t("codeHistory.lines")}</th></tr></thead>
            <tbody>{coords.map((coord) => <tr key={coord.point.date}><td>{formatHistoryDate(coord.point.date, i18n.language)}</td><td>{formatNumber(coord.point.totalLines)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
      <div className="repo-history-export" ref={gifExportRef} aria-hidden="true">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT}>
          <defs><clipPath id="repo-history-export-reveal"><rect ref={gifClipRef} x={0} y={0} width={PAD.left} height={HEIGHT} /></clipPath></defs>
          <g clipPath="url(#repo-history-export-reveal)">
            <path d={areaPath(coords)} fill={gifPalette.line} fillOpacity="0.15" />
            <path d={linePath(coords)} stroke={gifPalette.line} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </g>
          <text x={PAD.left} y={HEIGHT - 6} fill={gifPalette.axis} fontSize="10">{formatHistoryDate(coords[0].point.date, i18n.language)}</text>
          <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end" fill={gifPalette.axis} fontSize="10">{formatHistoryDate(coords[coords.length - 1].point.date, i18n.language)}</text>
          <text ref={gifCountRef} x={PAD.left} y={20} fill={gifPalette.count} fontSize="14" fontWeight="700">0</text>
        </svg>
      </div>
      <div className="repo-history-actions">
        <button className="copybtn" disabled={isExportingGif} onClick={() => void exportGif()}>
          {isExportingGif ? <Loader2 className="spin" size={13} /> : <Download size={13} />}
          {" "}
          {t("codeHistory.exportGif")}
        </button>
        {gifError ? <span className="repo-history-error">{gifError}</span> : null}
      </div>
    </section>
  );
}

function formatHistoryDate(value: string, locale: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}
