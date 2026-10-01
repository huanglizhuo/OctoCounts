// The growth-animation clock. GrowthAnimation renders ONE frame at a progress
// value and has no internal timing; everything time-related lives here. This
// hook owns the rAF loop, turns frame gaps into progress, and exposes
// play/pause/toggle/seek/replay over the state machine below.
//
// The machine (createPlayerState / step / seekState / replayState) is pure and
// exported: tests walk it through simulated frame gaps with no React and no
// DOM, and the hook is only the rAF-driven shell that feeds it real deltas.
// The GIF exporter deliberately uses none of this — it steps progress on its
// own fixed 10fps schedule (plan §2: one timeline per consumer).
import { useCallback, useEffect, useRef, useState } from "react";

// Plan §4: a looping playback holds the finale frame for 0.6s before
// restarting from the hook frame.
export const LOOP_HOLD_MS = 600;

// Idle frame for viewers who have not started playback: the data act's
// final-lock beat — buildScene's fixed template parks the counter/race/timeline
// at their final values at 8.5s of the pinned 10s template. It is the one
// growth-only content (the time dimension) the report page does not already
// show in static form, and its numbers equal the finale's, so the idle frame
// never contradicts the report. The finale stats card stays reserved for the
// played animation (and for reduced-motion viewers, who park on progress 1).
export const IDLE_POSTER_PROGRESS = 0.85;

// The four-act template length (types.ts pins scene.durationMs to 10000). A
// malformed duration (0/NaN/negative) would divide into NaN progress on the
// very first frame, so it falls back to the only length v1 ever wires up.
const TEMPLATE_DURATION_MS = 10000;

// Accumulating `progress += dt / duration` across ~600 frames leaves float
// dust; without the snap, the "finished" frame would sit at 0.9999999999998
// and the exact-1 assertions (and the hold) would never trigger. 1e-9 of a
// 10s timeline is 10µs — invisible, and far above double rounding error.
const PROGRESS_EPSILON = 1e-9;

export type GrowthPlayerState = {
  // Ms per full pass, carried inside the state so `step` is self-contained.
  durationMs: number;
  progress: number; // 0..1 — the value render(p) consumes
  playing: boolean;
  // Ms already spent holding the finale frame in the current loop hold (0
  // outside a hold). Rendering never reads this; it only paces the restart.
  holdMs: number;
};

export type GrowthPlayerStepOptions = {
  // true: reach 1, hold LOOP_HOLD_MS, restart at 0 still playing.
  // false: reach 1 and stop there (playing=false).
  loop: boolean;
};

export type GrowthPlayer = {
  progress: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (progress: number) => void;
  replay: () => void;
};

export type UseGrowthPlayerOptions = { loop?: boolean };

/**
 * The initial machine state. `reducedMotion` is the verdict of
 * matchMedia("(prefers-reduced-motion: reduce)"): those viewers start on the
 * static finale frame, paused — the animation never starts on its own for
 * them, but every control still works (plan §0 accessibility row: explicit
 * user intent overrides the preference). Everyone else starts paused on the
 * data act's final-lock poster frame (IDLE_POSTER_PROGRESS): growth-only
 * content that does not duplicate the report's own charts.
 */
export function createPlayerState(durationMs: number, reducedMotion = false): GrowthPlayerState {
  return {
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : TEMPLATE_DURATION_MS,
    // Reduced-motion viewers park on the static finale frame (the most
    // informative single frame, since they may never press play); everyone
    // else parks on the data-act poster frame.
    progress: reducedMotion ? 1 : IDLE_POSTER_PROGRESS,
    playing: false,
    holdMs: 0,
  };
}

/**
 * Advance the clock by one frame gap. Every timing decision lives here so it
 * is testable without a browser; the hook only measures real dt and applies
 * the result.
 *
 * A single gap can span a whole pass plus holds (one frame after a janky
 * tab switch), so the gap is consumed in phases rather than assumed to fit
 * inside the current pass. A paused clock and a non-finite or negative gap
 * return the state untouched: the first rAF timestamp after a resume can
 * land before its performance.now() anchor (see the anchor note in
 * startFrame), and NaN must never reach progress.
 */
export function step(state: GrowthPlayerState, dtMs: number, options: GrowthPlayerStepOptions): GrowthPlayerState {
  if (!state.playing) return state;
  if (!Number.isFinite(dtMs) || dtMs < 0) return state;
  // Crafted states bypassing createPlayerState could carry 0/NaN; division
  // by those poisons progress, so a non-positive duration is inert.
  if (!(state.durationMs > 0)) return state;

  let { progress, holdMs } = state;
  let remainingMs = dtMs;
  // Safety valve only, so an absurd gap (hours) cannot spin the phase loop:
  // 1000 phases ≈ 178 minutes of 10s-template playback.
  for (let guard = 0; remainingMs > 0 && guard < 1000; guard += 1) {
    if (progress >= 1) {
      if (!options.loop) return { ...state, progress: 1, playing: false, holdMs: 0 };
      const holdLeft = Math.max(0, LOOP_HOLD_MS - holdMs);
      if (remainingMs < holdLeft) {
        holdMs += remainingMs;
        remainingMs = 0;
      } else {
        remainingMs -= holdLeft;
        progress = 0;
        holdMs = 0;
      }
      continue;
    }
    const passLeftMs = (1 - progress) * state.durationMs;
    const advanceMs = Math.min(remainingMs, passLeftMs);
    progress += advanceMs / state.durationMs;
    remainingMs -= advanceMs;
    if (1 - progress < PROGRESS_EPSILON) progress = 1;
    // No-loop playback that just landed on the finale (gap exactly spent) is
    // done NOW, not one frame later — the branch at the top of the loop only
    // re-fires when another step arrives.
    if (progress >= 1 && !options.loop) return { ...state, progress: 1, playing: false, holdMs: 0 };
  }
  return { ...state, progress: Math.min(progress, 1), holdMs, playing: true };
}

/**
 * Move the playhead without touching play/pause: seeking while playing keeps
 * playing from the new point; while paused it re-renders the new frame and
 * stays paused. The loop hold is cleared — it belongs to a completed pass,
 * not to wherever the playhead now sits.
 */
export function seekState(state: GrowthPlayerState, progress: number): GrowthPlayerState {
  // A slider mid-gesture can hand us NaN; keeping the current frame beats
  // freezing the player at 0.
  const clamped = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : state.progress;
  return { ...state, progress: clamped, holdMs: 0 };
}

/** Restart from the first frame, playing. Valid from any state. */
export function replayState(state: GrowthPlayerState): GrowthPlayerState {
  return { ...state, progress: 0, playing: true, holdMs: 0 };
}

/**
 * Drive a GrowthAnimation. `durationMs` is scene.durationMs; `options.loop`
 * (default true) holds the finale for LOOP_HOLD_MS and restarts, instead of
 * stopping at the end. The returned functions are stable identities; only
 * progress/playing trigger re-renders.
 *
 * Semantics worth knowing when wiring buttons:
 * - The first play() from the parked poster frame (IDLE_POSTER_PROGRESS, the
 *   mount default) restarts from frame 0: the press means "tell me the
 *   story", not "resume from the poster" (the reduced-motion finale-frame
 *   precedent below).
 * - play() from a finished end frame restarts from the beginning (the
 *   HTMLMediaElement play()-on-ended precedent) — notably the reduced-motion
 *   viewer who presses play gets the story, not another look at the finale
 *   they are already staring at.
 * - A pause()/play() round-trip mid-animation resumes where it stopped;
 *   an explicit seek() counts as engagement, so play() after a scrub resumes
 *   from the scrubbed position.
 * - pause() keeps progress and the elapsed hold exactly where they are.
 * - The tab being hidden pauses playback; it does NOT auto-resume on return.
 */
export function useGrowthPlayer(durationMs: number, options?: UseGrowthPlayerOptions): GrowthPlayer {
  // matchMedia is read once per mount: the verdict decides the default
  // frame, and a preference changed mid-session simply applies on the next
  // mount.
  const [initial] = useState(() => {
    const reduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return createPlayerState(durationMs, reduced);
  });
  const stateRef = useRef(initial);
  // Only progress/playing are rendered; holdMs lives purely in the machine.
  const [view, setView] = useState({ progress: initial.progress, playing: initial.playing });

  // Latest options without re-creating the stable callbacks below.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  // Guards the unmount path (rule: no state updates after unmount); re-armed
  // on mount so React StrictMode's double mount in dev cannot wedge it off.
  const mountedRef = useRef(false);
  // Distinguishes "parked, never started" from "paused mid-animation": the
  // first play press means "tell me the story" and restarts from frame 0
  // (the finale-frame precedent), while a later pause/play round-trip resumes
  // where it stopped. An explicit seek counts as engagement — play resumes
  // from the scrubbed position.
  const startedRef = useRef(false);

  const syncView = useCallback(() => {
    if (!mountedRef.current) return;
    const { progress, playing } = stateRef.current;
    setView((prev) => (prev.progress === progress && prev.playing === playing ? prev : { progress, playing }));
  }, []);

  const stopFrame = useCallback(() => {
    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  const startFrame = useCallback(() => {
    if (rafRef.current !== 0) return; // already running
    // Anchor the clock now so paused time never counts as progress. The
    // first rAF timestamp can predate this call (it marks frame start, not
    // callback run) — step's negative-gap guard absorbs that frame as zero.
    lastFrameRef.current = performance.now();
    const tick = (now: number) => {
      rafRef.current = 0;
      const next = step(stateRef.current, now - lastFrameRef.current, {
        loop: optionsRef.current?.loop ?? true,
      });
      lastFrameRef.current = now;
      stateRef.current = next;
      syncView();
      if (next.playing) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [syncView]);

  const pause = useCallback(() => {
    stateRef.current = { ...stateRef.current, playing: false };
    stopFrame();
    syncView();
  }, [stopFrame, syncView]);

  const play = useCallback(() => {
    const current = stateRef.current;
    if (current.playing) return;
    // From the parked poster (or the finale frame) play means "from the
    // top"; a pause/play round-trip mid-animation resumes instead.
    stateRef.current =
      !startedRef.current || current.progress >= 1 ? replayState(current) : { ...current, playing: true };
    startedRef.current = true;
    syncView();
    startFrame();
  }, [startFrame, syncView]);

  const toggle = useCallback(() => {
    if (stateRef.current.playing) pause();
    else play();
  }, [pause, play]);

  const seek = useCallback(
    (progress: number) => {
      startedRef.current = true;
      stateRef.current = seekState(stateRef.current, progress);
      // While playing the next tick re-renders anyway, but the playhead must
      // move the instant it is dropped, not one frame later. The rAF loop
      // keeps running untouched: its dt is wall-clock, so playback simply
      // continues from the new point.
      syncView();
    },
    [syncView],
  );

  const replay = useCallback(() => {
    startedRef.current = true;
    stateRef.current = replayState(stateRef.current);
    syncView();
    startFrame();
  }, [startFrame, syncView]);

  useEffect(() => {
    mountedRef.current = true;
    // Plan §10: the rAF loop pauses while the tab is hidden (hidden tabs
    // throttle rAF to nothing, and the first frame back would carry a giant
    // gap). Resuming is the user's call, not ours.
    const onVisibilityChange = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopFrame();
    };
  }, [pause, stopFrame]);

  return {
    progress: view.progress,
    playing: view.playing,
    play,
    pause,
    toggle,
    seek,
    replay,
  };
}
