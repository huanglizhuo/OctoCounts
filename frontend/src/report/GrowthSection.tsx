// Report-page mount for the growth animation (plan §3/§7): fetches the
// repo history, builds the scene with the active scheme's language colors,
// and drives the deterministic GrowthAnimation with the rAF player plus
// play/pause/replay/loop/seek controls and the GIF export flow. The scene is
// the single source of truth for everything the section shows beyond the
// animation itself: the history-data table and the "this report" divergence
// note both read scene.samples directly. The section is itself the lazy
// unit — Runner loads it via React.lazy so the whole growth chunk
// (renderer + player + exporter, minus the dynamically imported
// html-to-image/gifenc) stays out of the entry bundle. Crawlers get the SSR
// paragraph the edge function injects instead (functions/[[path]].js
// .growth-ssr); the reserved-height stage keeps the swap-in at zero CLS.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, Loader2, Pause, Play, RotateCcw, X } from "lucide-react";
import { fetchCanonicalReport, fetchRepoHistory } from "../api";
import { AnalyticsEvents, trackEvent } from "../analytics";
import { downloadDataUrl, formatNumber, languageColor, normalizedProvider, visibleLanguageColor } from "../reportUtils";
import { useScheme } from "../scheme";
import type { Report } from "../types";
import { buildScene } from "../growth/buildScene";
import { exportGrowthGif, exportGrowthPng, exportGrowthWebm } from "../growth/exportGif";
import { GrowthAnimation } from "../growth/GrowthAnimation";
import { GrowthSkeleton } from "../growth/GrowthSkeleton";
import { useGrowthPlayer } from "../growth/useGrowthPlayer";
import type { GrowthScene } from "../growth/types";

// While the SLOC backfill runs in the background, poll for progress rather
// than making the visitor reload — most repos finish in well under a
// minute, so a short interval keeps the "gathering..." state honest without
// hammering the endpoint.
const BACKFILL_POLL_INTERVAL_MS = 5000;

// Player + controls + export, split out of the data-fetching section so the
// useGrowthPlayer hook only mounts once a scene exists (the section renders
// skeleton/disabled states before that, and the player needs durationMs).
function GrowthStage({ scene }: { scene: GrowthScene }) {
  const { t } = useTranslation();
  const [loop, setLoop] = useState(false);
  const player = useGrowthPlayer(scene.durationMs, { loop });
  // The player already parks reduced-motion viewers on the static finale
  // frame; this hint tells them why and that play is still theirs to press.
  const [reducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  // Autoplay the story once on mount (loop defaults off, so it parks on the
  // finale frame). Reduced-motion viewers keep the paused finale poster —
  // autoplaying motion would override their explicit preference.
  useEffect(() => {
    if (!reducedMotion) player.replay();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);
  // growth.played fires once per mount, on the first user-initiated start.
  const playedOnce = useRef(false);
  const markPlayed = () => {
    if (playedOnce.current) return;
    playedOnce.current = true;
    trackEvent(AnalyticsEvents.growthPlayed, { provider: scene.provider, repo: scene.repoFullName });
  };

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const cancelRef = useRef<AbortController | null>(null);

  const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    downloadDataUrl(url, filename);
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  // All three exporters render the deterministic scene offscreen — the PNG is
  // the finale frame at 2× (the share card), the GIF quantizes the full 5s
  // timeline, and the WebM records the same 50 frames off a live canvas.
  const [owner = "repo", repo = owner] = scene.repoFullName.split("/");

  const runPngExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await exportGrowthPng(scene, owner, repo);
      saveBlob(blob, filename);
      trackEvent(AnalyticsEvents.growthPngExported, { provider: scene.provider, repo: scene.repoFullName });
    } catch {
      setExportError(t("growth.animation.exportFailed"));
    } finally {
      setExporting(false);
    }
  };

  const runGifExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    setExportProgress(0);
    // The exporter steps its own frame grid; the on-screen player freezes so
    // the two never fight over the same scene mid-capture.
    player.pause();
    const controller = new AbortController();
    cancelRef.current = controller;
    try {
      const { blob, filename } = await exportGrowthGif(scene, owner, repo, {
        signal: controller.signal,
        onProgress: (done, total) => setExportProgress(total > 0 ? done / total : 0),
      });
      saveBlob(blob, filename);
      trackEvent(AnalyticsEvents.growthGifExported, { variant: "full", provider: scene.provider, repo: scene.repoFullName });
    } catch (error) {
      // The exporter rejects a cancel with a DOMException AbortError between
      // frames — that is the Cancel button working, not a failure.
      if (error instanceof DOMException && error.name === "AbortError") {
        trackEvent(AnalyticsEvents.growthExportCancelled, { variant: "full", provider: scene.provider, repo: scene.repoFullName });
      } else {
        setExportError(t("growth.animation.exportFailed"));
      }
    } finally {
      cancelRef.current = null;
      setExporting(false);
      setExportProgress(0);
    }
  };

  const runWebmExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    setExportProgress(0);
    // Same freeze-the-player contract as the GIF export: the recorder steps
    // the frame grid itself, one 100ms tick per frame.
    player.pause();
    const controller = new AbortController();
    cancelRef.current = controller;
    try {
      const { blob, filename } = await exportGrowthWebm(scene, owner, repo, {
        signal: controller.signal,
        onProgress: (done, total) => setExportProgress(total > 0 ? done / total : 0),
      });
      saveBlob(blob, filename);
      trackEvent(AnalyticsEvents.growthWebmExported, { variant: "full", provider: scene.provider, repo: scene.repoFullName });
    } catch (error) {
      // Same as the GIF path: a cancel rejects with AbortError between frames
      // while the exporter's own cleanup stops the recorder and its tracks.
      if (error instanceof DOMException && error.name === "AbortError") {
        trackEvent(AnalyticsEvents.growthExportCancelled, { variant: "full", provider: scene.provider, repo: scene.repoFullName });
      } else {
        setExportError(t("growth.animation.exportFailed"));
      }
    } finally {
      cancelRef.current = null;
      setExporting(false);
      setExportProgress(0);
    }
  };

  const playLabel = t(player.playing ? "growth.animation.pauseAria" : "growth.animation.playAria");
  return (
    <>
      <GrowthAnimation scene={scene} progress={player.progress} playing={player.playing} interactive />
      <div className="growth-controls">
        <button
          className="copybtn"
          type="button"
          aria-label={playLabel}
          onClick={() => {
            markPlayed();
            player.toggle();
          }}
        >
          {player.playing ? <Pause size={13} /> : <Play size={13} />}{" "}
          {t(player.playing ? "growth.animation.pause" : "growth.animation.play")}
        </button>
        <button
          className="copybtn"
          type="button"
          aria-label={t("growth.animation.replayAria")}
          onClick={() => {
            markPlayed();
            player.replay();
          }}
        >
          <RotateCcw size={13} /> {t("growth.animation.replay")}
        </button>
        <label className="growth-loop">
          <input
            type="checkbox"
            checked={loop}
            onChange={(event) => {
              const next = event.currentTarget.checked;
              setLoop(next);
              trackEvent(AnalyticsEvents.growthLoopToggled, { loop: next, provider: scene.provider, repo: scene.repoFullName });
            }}
          />
          {t("growth.animation.loop")}
        </label>
        <input
          className="growth-seek"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={player.progress}
          onChange={(event) => player.seek(Number(event.currentTarget.value))}
          aria-label={t("growth.animation.seekAria")}
        />
      </div>
      <div className="growth-export">
        <button className="copybtn" type="button" disabled={exporting} onClick={() => void runPngExport()}>
          {exporting && exportProgress === 0 ? <Loader2 className="spin" size={13} /> : <Download size={13} />}{" "}
          {t("growth.animation.exportPng")}
        </button>
        <button className="copybtn" type="button" disabled={exporting} onClick={() => void runGifExport()}>
          {exporting ? <Loader2 className="spin" size={13} /> : <Download size={13} />}{" "}
          {exporting ? t("growth.animation.exporting", { percent: Math.round(exportProgress * 100) }) : t("growth.animation.exportGif")}
        </button>
        <button className="copybtn" type="button" disabled={exporting} onClick={() => void runWebmExport()}>
          {exporting ? <Loader2 className="spin" size={13} /> : <Download size={13} />}{" "}
          {exporting ? t("growth.animation.exporting", { percent: Math.round(exportProgress * 100) }) : t("growth.animation.exportWebm")}
        </button>
        <span className="growth-export-duration">{t("growth.animation.exportFull")}</span>
        {exporting ? (
          <button className="copybtn" type="button" onClick={() => cancelRef.current?.abort()}>
            <X size={13} /> {t("growth.animation.cancelExport")}
          </button>
        ) : null}
        {exportError ? <span className="growth-export-error" role="alert">{exportError}</span> : null}
      </div>
      {scene.realLanguageSplit ? (
        <p className="growth-note">{t("growth.animation.realNote")}</p>
      ) : scene.modeledLanguageSplit ? (
        <p className="growth-note">{t("growth.animation.modeledNote")}</p>
      ) : null}
      {scene.finaleDiverged ? (
        <p className="growth-note">{t("growth.animation.divergedNote")}</p>
      ) : null}
      {reducedMotion ? <p className="growth-note">{t("growth.animation.reducedMotionNote")}</p> : null}
    </>
  );
}

export function GrowthSection({
  report,
  onScene,
}: {
  report: Report;
  stars?: number | null;
  /** Reports the built scene up (Runner's sticky-bar PNG export reuses it). */
  onScene?: (scene: GrowthScene) => void;
}) {
  const { t } = useTranslation();
  const scheme = useScheme();
  const provider = normalizedProvider(report);
  const owner = report.repository.owner;
  const repo = report.repository.name;
  // The repo-history fetch for the scene (key: provider/owner/repo). The
  // 60s staleTime serves re-visits from cache; while the SLOC backfill runs,
  // the interval polls the endpoint to completion.
  const historyQuery = useQuery({
    queryKey: ["repo-history", provider, owner, repo],
    queryFn: () => fetchRepoHistory(provider, owner, repo),
    staleTime: 60 * 1000,
    retry: false,
    refetchInterval: (query) => (query.state.data?.slocBackfillInProgress ? BACKFILL_POLL_INTERVAL_MS : false),
  });
  const history = historyQuery.data;
  // The animation's finale must carry the same analysis profile its history
  // series was sampled under (default), not whatever options the visitor's
  // current interactive report happens to use — otherwise the counter locks
  // on one profile's number while the finale table shows another's. The
  // canonical SEO report is a cached public GET; on failure the interactive
  // report remains the fallback rather than blocking the section.
  const canonical = useQuery({
    queryKey: ["canonical-report", provider, owner, repo],
    queryFn: () => fetchCanonicalReport(provider, owner, repo),
    staleTime: 60 * 1000,
    retry: false,
  });

  // Scheme-aware visible language colors, baked into the scene so the
  // renderer and the GIF palette never re-resolve them per frame. Built from
  // whichever report feeds the scene (canonical preferred below).
  const sceneSource = canonical.data ?? report;
  const languageColors = useMemo(
    () => Object.fromEntries(sceneSource.languages.map((language) => [language.name, visibleLanguageColor(languageColor(language.name), scheme)])),
    [sceneSource.languages, scheme],
  );
  // Shareable config via URL (?gdur=15 stretches the template to 15s, ?glang=12
  // raises the skyline cap to 12 buildings; both clamped in buildScene).
  // Read once per mount — the SPA does not re-route report pages in place.
  const growthOverrides = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const overrides: { durationMs?: number; cityLimit?: number } = {};
    const durationSec = Number(params.get("gdur"));
    if (params.get("gdur") !== null && Number.isFinite(durationSec)) overrides.durationMs = durationSec * 1000;
    const cityLimit = Number(params.get("glang"));
    if (params.get("glang") !== null && Number.isFinite(cityLimit)) overrides.cityLimit = cityLimit;
    return overrides;
  }, []);
  const scene = useMemo(() => {
    // No samples yet -> no scene: the section renders its disabled state.
    if (!history || history.slocPoints.length === 0) return null;
    return buildScene({ report: sceneSource, history, languageColors, overrides: growthOverrides });
  }, [history, sceneSource, languageColors, growthOverrides]);
  useEffect(() => {
    if (scene) onScene?.(scene);
  }, [scene, onScene]);

  // Profile-divergence disclosure (the old history chart's "this report"
  // label): the scene is built from the canonical report while `report` here
  // is the visitor's interactive one, so when their code totals disagree the
  // subtitle says so instead of letting the two numbers silently coexist.
  const lastSampleCode = scene?.samples[scene.samples.length - 1]?.code;
  const reportDiverged = scene !== null && report.total.code !== lastSampleCode;

  const title = t("growth.animation.title");
  return (
    <section className="growth-section" aria-label={title}>
      <div className="growth-head">
        <h2>{title}</h2>
        <span>
          {t("growth.animation.subtitle")}
          {reportDiverged ? (
            <span className="growth-this-report"> · {t("growth.animation.thisReport", { count: formatNumber(report.total.code) })}</span>
          ) : null}
        </span>
      </div>
      {historyQuery.isLoading ? (
        <GrowthSkeleton label={t("growth.animation.loadingHistory")} />
      ) : historyQuery.isError ? (
        <div className="growth-empty">
          <p>{t("growth.animation.unavailable")}</p>
          <button className="copybtn" type="button" onClick={() => void historyQuery.refetch()}>
            {t("error.retry")}
          </button>
        </div>
      ) : !scene || !history ? (
        history?.slocBackfillInProgress ? (
          // First-ever samples are still being gathered: stay in the loading
          // state (the polls flip it to the animation on the first sample)
          // instead of flashing "no history yet".
          <GrowthSkeleton label={t("growth.animation.gatheringHistory")} />
        ) : (
          <div className="growth-empty">
            <p>
              <strong>{t("growth.animation.noHistory")}</strong>
            </p>
            <p className="growth-note">{t("growth.animation.noHistoryHint")}</p>
          </div>
        )
      ) : (
        <>
          {history.slocBackfillInProgress ? (
            <p className="growth-note growth-gathering">
              <Loader2 className="spin" size={13} /> {t("growth.animation.gatheringHistory")}
            </p>
          ) : null}
          <GrowthStage scene={scene} />
        </>
      )}
    </section>
  );
}
