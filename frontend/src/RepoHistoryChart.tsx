import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, Loader2 } from "lucide-react";
import { fetchRepoHistory } from "./api";
import { downloadDataUrl, formatCompactNumber, formatNumber } from "./reportUtils";
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
// The interactive SVG renders 1:1 at the measured container width (no viewBox
// downscaling), so below this width the 12px axis text needs extra headroom.
const MOBILE_BREAKPOINT = 560;
const MOBILE_HEIGHT = 240;
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

type Coord = { x: number; y: number; point: SlocHistoryPoint; suspect: boolean };

const timeOf = (date: string) => new Date(`${date}T00:00:00Z`).getTime();

/// The report's commit date may arrive as a bare "yyyy-mm-dd" or as a full
/// ISO datetime; the series is keyed by calendar days, so normalize to the
/// date part and reject anything that is not a date at all.
function normalizeReportDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : null;
}

const plotSize = (width: number, height: number) => ({
  plotWidth: width - PAD.left - PAD.right,
  plotHeight: height - PAD.top - PAD.bottom,
});

function project(points: SlocHistoryPoint[], suspects: boolean[], domainStart: number, domainEnd: number, width: number, height: number): Coord[] {
  const span = Math.max(domainEnd - domainStart, 1);
  const { plotWidth, plotHeight } = plotSize(width, height);
  const baselineY = PAD.top + plotHeight;
  const maxValue = Math.max(...points.map((p) => p.totalLines), 1);
  return points.map((point, index) => ({
    x: PAD.left + ((timeOf(point.date) - domainStart) / span) * plotWidth,
    y: baselineY - (point.totalLines / maxValue) * plotHeight,
    point,
    suspect: suspects[index] ?? false,
  }));
}

/// One path per segment so the two segments hugging a suspect sample can be
/// dashed without touching the rest of the line.
function lineSegments(coords: Coord[]): Array<{ d: string; dashed: boolean }> {
  const segments: Array<{ d: string; dashed: boolean }> = [];
  for (let i = 0; i + 1 < coords.length; i += 1) {
    const a = coords[i];
    const b = coords[i + 1];
    segments.push({
      d: `M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}`,
      dashed: a.suspect || b.suspect,
    });
  }
  return segments;
}

function linePath(coords: { x: number; y: number }[]) {
  return coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
}

function areaPath(coords: { x: number; y: number }[], baselineY: number) {
  if (coords.length === 0) return "";
  const first = coords[0];
  const last = coords[coords.length - 1];
  return `${linePath(coords)} L${last.x.toFixed(1)},${baselineY} L${first.x.toFixed(1)},${baselineY} Z`;
}

function timeDomain(points: SlocHistoryPoint[]): [number, number] | null {
  if (points.length < 2) return null;
  const times = points.map((p) => timeOf(p.date)).sort((a, b) => a - b);
  return [times[0], times[times.length - 1]];
}

/// Interior samples that fall under half of BOTH neighbours are almost
/// certainly a partially backfilled snapshot, not real history — flag them
/// for hollow rendering and a tooltip note, but never drop the data.
function detectSuspects(points: SlocHistoryPoint[]): boolean[] {
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return false;
    const previous = points[index - 1].totalLines;
    const next = points[index + 1].totalLines;
    return point.totalLines < previous * 0.5 && point.totalLines < next * 0.5;
  });
}

export function RepoHistoryChart({
  provider,
  owner,
  repo,
  reportDate,
  reportCode,
  reportRef,
  isPinnedRef,
}: {
  provider: string;
  owner: string;
  repo: string;
  /** Date of the report's commit ("yyyy-mm-dd"; an ISO datetime is normalized). */
  reportDate?: string;
  /** report.total.code — the number the page above already shows. */
  reportCode?: number;
  /** Ref the report was generated at (branch name or commit sha). */
  reportRef?: string;
  /** True when the report is pinned to a specific ref rather than the default branch tip. */
  isPinnedRef?: boolean;
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

  // The series the chart commits to: the endpoint samples, plus the report's
  // own count merged in at the report commit date (report wins on a same-day
  // collision). Every downstream view — domain, projection, entrance
  // animation, GIF export, data table — reads this merged series so the
  // header number equals the report number by construction. A pinned-ref
  // report is NOT merged: it is one observation of one specific commit, so
  // it is marked on the chart instead (see the pinned marker below).
  const normalizedReportDate = normalizeReportDate(reportDate);
  const mergedPoints = useMemo(() => {
    const base = data?.slocPoints ? [...data.slocPoints] : [];
    if (!data || isPinnedRef || reportCode == null || !normalizedReportDate) return base;
    const merged = base.filter((p) => p.date !== normalizedReportDate);
    merged.push({ date: normalizedReportDate, totalLines: reportCode });
    return merged.sort((a, b) => a.date.localeCompare(b.date));
  }, [data, isPinnedRef, reportCode, normalizedReportDate]);

  const suspects = useMemo(() => detectSuspects(mergedPoints), [mergedPoints]);
  const domain = useMemo(() => timeDomain(mergedPoints), [mergedPoints]);

  // Interactive chart: rendered 1:1 at the measured container width so the
  // 12px axis text stays readable on phones (no viewBox downscaling). Fallback
  // 640 when the observer has not reported yet (or is unavailable, e.g. SSR).
  const [chartEl, setChartEl] = useState<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!chartEl || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setMeasuredWidth(width);
    });
    observer.observe(chartEl);
    return () => observer.disconnect();
  }, [chartEl]);
  const chartWidth = measuredWidth ?? WIDTH;
  const chartHeight = chartWidth < MOBILE_BREAKPOINT ? MOBILE_HEIGHT : HEIGHT;
  const { plotWidth, plotHeight } = plotSize(chartWidth, chartHeight);
  const baselineY = PAD.top + plotHeight;

  const coords = useMemo(
    () => (domain ? project(mergedPoints, suspects, domain[0], domain[1], chartWidth, chartHeight) : null),
    [mergedPoints, suspects, domain, chartWidth, chartHeight]
  );
  // The GIF export keeps its fixed 640x220 canvas, so it projects the same
  // merged series against the fixed geometry, independent of the live size.
  const exportCoords = useMemo(
    () => (domain ? project(mergedPoints, suspects, domain[0], domain[1], WIDTH, HEIGHT) : null),
    [mergedPoints, suspects, domain]
  );

  const [reveal, setReveal] = useState(0);
  const [displayedLines, setDisplayedLines] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [isExportingGif, setIsExportingGif] = useState(false);
  const [gifError, setGifError] = useState<string | null>(null);
  const gifExportRef = useRef<HTMLDivElement>(null);
  const gifClipRef = useRef<SVGRectElement>(null);
  const gifCountRef = useRef<SVGTextElement>(null);
  const reduceMotion = useRef(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  const currentLines = mergedPoints.length > 0 ? mergedPoints[mergedPoints.length - 1].totalLines : 0;
  const maxValue = Math.max(...mergedPoints.map((p) => p.totalLines), 1);
  const gridValues = [0, Math.round(maxValue / 2), maxValue];

  // The one-time entrance animation: draws the line in and counts the total
  // lines up, both driven by the same `reveal` progress value so they finish
  // together. Skips straight to the end state under reduced-motion. Keyed on
  // the series, not the geometry — a container resize must not replay it.
  useEffect(() => {
    if (!domain) return;
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
  }, [mergedPoints, currentLines]);

  const exportGif = async () => {
    if (!exportCoords || !gifExportRef.current) return;
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
        gifClipRef.current?.setAttribute("width", String(PAD.left + (WIDTH - PAD.left - PAD.right) * progress));
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
  if (!data || !coords || !exportCoords) {
    return <section className="repo-history repo-history-loading" role="status">{t("codeHistory.empty")}</section>;
  }

  const revealWidth = PAD.left + plotWidth * reveal;
  const hovered = hoverIndex !== null ? coords[hoverIndex] : null;
  const domainSpan = Math.max(domain ? domain[1] - domain[0] : 1, 1);

  // Pinned-ref reports mark their commit on the chart instead of merging:
  // dashed vertical at the commit date, dot at that date's series value (the
  // sample itself if one lands on that day, else interpolated between the
  // neighbouring samples).
  let pinnedPos: { x: number; y: number } | null = null;
  if (isPinnedRef && domain && normalizedReportDate) {
    const time = timeOf(normalizedReportDate);
    if (time >= domain[0] && time <= domain[1]) {
      const exact = mergedPoints.find((p) => p.date === normalizedReportDate);
      let value: number | null = exact ? exact.totalLines : null;
      if (value === null) {
        let lower: SlocHistoryPoint | null = null;
        let upper: SlocHistoryPoint | null = null;
        for (const point of mergedPoints) {
          const pointTime = timeOf(point.date);
          if (pointTime <= time) lower = point;
          if (pointTime >= time) {
            upper = point;
            break;
          }
        }
        if (lower && upper && lower !== upper) {
          const lowerTime = timeOf(lower.date);
          const upperTime = timeOf(upper.date);
          const ratio = upperTime === lowerTime ? 0 : (time - lowerTime) / (upperTime - lowerTime);
          value = lower.totalLines + (upper.totalLines - lower.totalLines) * ratio;
        } else {
          value = (lower ?? upper)?.totalLines ?? null;
        }
      }
      if (value !== null) {
        pinnedPos = {
          x: PAD.left + ((time - domain[0]) / domainSpan) * plotWidth,
          y: baselineY - (value / maxValue) * plotHeight,
        };
      }
    }
  }

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * chartWidth;
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
    const x = ((touch.clientX - rect.left) / rect.width) * chartWidth;
    let nearest = 0;
    coords.forEach((coord, index) => {
      if (Math.abs(coord.x - x) < Math.abs(coords[nearest].x - x)) nearest = index;
    });
    setHoverIndex(nearest);
  };
  const selectIndex = (index: number) => setHoverIndex(Math.max(0, Math.min(coords.length - 1, index)));

  const gridRows = (width: number, height: number) => {
    const { plotWidth: gw, plotHeight: gh } = plotSize(width, height);
    const baseY = PAD.top + gh;
    return gridValues.map((value) => ({
      value,
      y: baseY - (value / maxValue) * gh,
      x2: width - PAD.right,
    }));
  };
  const interactiveGrid = gridRows(chartWidth, chartHeight);
  const exportGrid = gridRows(WIDTH, HEIGHT);

  return (
    <section className="repo-history" aria-label={t("codeHistory.title")}>
      <div className="repo-history-head">
        <h2>{t("codeHistory.title")}</h2>
        <div className="repo-history-head-values">
          <span className="repo-history-count">{formatNumber(displayedLines)} {t("codeHistory.locAbbrev")}</span>
          {isPinnedRef && reportCode != null ? (
            <span className="repo-history-report-count">{t("codeHistory.thisReportCount", { count: formatNumber(reportCode) })}</span>
          ) : null}
        </div>
      </div>
      <div className="repo-history-chart" ref={setChartEl}>
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          width={chartWidth}
          height={chartHeight}
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
              <rect x={0} y={0} width={revealWidth} height={chartHeight} />
            </clipPath>
          </defs>
          {interactiveGrid.map((grid) => (
            <g key={grid.value}>
              <line x1={PAD.left} x2={grid.x2} y1={grid.y} y2={grid.y} className="repo-history-gridline" />
              <text x={PAD.left - 6} y={grid.y + 4} textAnchor="end" className="repo-history-axis-tick">
                {formatCompactNumber(grid.value)}
              </text>
            </g>
          ))}
          <g clipPath="url(#repo-history-reveal)">
            <path d={areaPath(coords, baselineY)} className="repo-history-sloc-area" fill="#55c878" fillOpacity="0.15" />
            {lineSegments(coords).map((segment, index) => (
              <path
                key={index}
                d={segment.d}
                className="repo-history-sloc-line"
                strokeDasharray={segment.dashed ? "4 3" : undefined}
                stroke="#55d37a"
                strokeWidth="2"
                fill="none"
              />
            ))}
            {coords.map((coord) => (
              <circle
                key={coord.point.date}
                cx={coord.x}
                cy={coord.y}
                r={2.5}
                className={coord.suspect ? "repo-history-point repo-history-point-suspect" : "repo-history-point"}
              />
            ))}
          </g>
          {pinnedPos ? (
            <g className="repo-history-report">
              <line x1={pinnedPos.x} x2={pinnedPos.x} y1={PAD.top} y2={baselineY} className="repo-history-report-line" />
              <circle cx={pinnedPos.x} cy={pinnedPos.y} r={4} className="repo-history-report-dot" />
              <text
                x={pinnedPos.x > chartWidth - 150 ? pinnedPos.x - 5 : pinnedPos.x + 5}
                y={PAD.top - 11}
                textAnchor={pinnedPos.x > chartWidth - 150 ? "end" : "start"}
                className="repo-history-report-label"
              >
                {t("codeHistory.thisReport", { ref: reportRef ?? "" })}
              </text>
            </g>
          ) : null}
          {hovered ? (
            <>
              <line
                x1={hovered.x}
                x2={hovered.x}
                y1={PAD.top}
                y2={baselineY}
                className="repo-history-hover-line"
              />
              <circle cx={hovered.x} cy={hovered.y} r={4} className="repo-history-hover-dot" />
            </>
          ) : null}
          <text x={PAD.left} y={chartHeight - 6} className="repo-history-axis-label">
            {formatHistoryDate(coords[0].point.date, i18n.language)}
          </text>
          <text x={chartWidth - PAD.right} y={chartHeight - 6} textAnchor="end" className="repo-history-axis-label">
            {formatHistoryDate(coords[coords.length - 1].point.date, i18n.language)}
          </text>
        </svg>
        {hovered ? (
          <div className="repo-history-tooltip" style={{ left: `${Math.min(54, Math.max(24, (hovered.x / chartWidth) * 100))}%` }}>
            <strong>{formatNumber(hovered.point.totalLines)}</strong> {t("codeHistory.locAbbrev")} &middot; {formatHistoryDate(hovered.point.date, i18n.language)}
            {hovered.suspect ? <span className="repo-history-suspect-note"> &middot; {t("codeHistory.sampleIncomplete")}</span> : null}
          </div>
        ) : null}
      </div>
      {data.slocBackfillInProgress ? (
        <div className="repo-history-progress">
          <Loader2 className="spin" size={13} /> {t("codeHistory.gatheringSloc")}
        </div>
      ) : null}
      <span className="visually-hidden" aria-live="polite">{hovered ? `${formatHistoryDate(hovered.point.date, i18n.language)}: ${formatNumber(hovered.point.totalLines)} ${t("codeHistory.locAbbrev")}${hovered.suspect ? ` (${t("codeHistory.sampleIncomplete")})` : ""}` : ""}</span>
      <details className="repo-history-data">
        <summary>{t("codeHistory.dataTable")}</summary>
        <div className="repo-history-data-wrap">
          <table>
            <thead><tr><th>{t("codeHistory.date")}</th><th>{t("codeHistory.lines")}</th></tr></thead>
            <tbody>{coords.map((coord) => (
              <tr key={coord.point.date}>
                <td>{formatHistoryDate(coord.point.date, i18n.language)}</td>
                <td>
                  {formatNumber(coord.point.totalLines)}
                  {coord.suspect ? <span className="repo-history-suspect-note"> &middot; {t("codeHistory.sampleIncomplete")}</span> : null}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
      <div className="repo-history-export" ref={gifExportRef} aria-hidden="true">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT}>
          <defs><clipPath id="repo-history-export-reveal"><rect ref={gifClipRef} x={0} y={0} width={PAD.left} height={HEIGHT} /></clipPath></defs>
          {exportGrid.map((grid) => (
            <g key={grid.value}>
              <line x1={PAD.left} x2={grid.x2} y1={grid.y} y2={grid.y} stroke={gifPalette.axis} strokeWidth={1} opacity={0.35} />
              <text x={PAD.left - 6} y={grid.y + 4} textAnchor="end" fill={gifPalette.axis} fontSize={12}>{formatCompactNumber(grid.value)}</text>
            </g>
          ))}
          <g clipPath="url(#repo-history-export-reveal)">
            <path d={areaPath(exportCoords, PAD.top + (HEIGHT - PAD.top - PAD.bottom))} fill={gifPalette.line} fillOpacity="0.15" />
            {lineSegments(exportCoords).map((segment, index) => (
              <path
                key={index}
                d={segment.d}
                stroke={gifPalette.line}
                fill="none"
                strokeWidth="2"
                strokeDasharray={segment.dashed ? "4 3" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {exportCoords.map((coord) => (
              <circle
                key={coord.point.date}
                cx={coord.x}
                cy={coord.y}
                r={2.5}
                fill={coord.suspect ? gifPalette.bg : gifPalette.line}
                stroke={coord.suspect ? gifPalette.line : undefined}
                strokeWidth={coord.suspect ? 1.5 : undefined}
              />
            ))}
          </g>
          <text x={PAD.left} y={HEIGHT - 6} fill={gifPalette.axis} fontSize="10">{formatHistoryDate(exportCoords[0].point.date, i18n.language)}</text>
          <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end" fill={gifPalette.axis} fontSize="10">{formatHistoryDate(exportCoords[exportCoords.length - 1].point.date, i18n.language)}</text>
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
