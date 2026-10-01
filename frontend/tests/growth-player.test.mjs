import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Same transpile-to-node_modules-cache pattern as github-status.test.mjs: a
// data: URL has no parent directory to resolve bare specifiers from, and the
// hook imports React, so the compiled copy lands under node_modules/ where
// git already ignores it and "react" still resolves. The player's timing
// rules are factored into the exported pure machine (createPlayerState/step/
// seekState/replayState), so every test below drives simulated frame gaps
// with no React, no rAF, and no DOM — the hook is a thin shell over exactly
// these functions.
const cacheDir = new URL("../node_modules/.cache/octocounts-tests/", import.meta.url);
const source = await readFile(new URL("../src/growth/useGrowthPlayer.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
await mkdir(cacheDir, { recursive: true });
const modulePath = new URL("growth-player.mjs", cacheDir);
await writeFile(modulePath, compiled.outputText);
const { createPlayerState, step, seekState, replayState, LOOP_HOLD_MS } = await import(modulePath.href);

// A fresh playing clock over a convenient 1s timeline.
const playing = (durationMs = 1000, extra = {}) => ({
  ...createPlayerState(durationMs),
  playing: true,
  ...extra,
});

test("defaults: paused at frame 0; reduced-motion starts on the static finale frame", () => {
  assert.equal(LOOP_HOLD_MS, 600);
  assert.deepEqual(createPlayerState(10000), {
    durationMs: 10000,
    progress: 0,
    playing: false,
    holdMs: 0,
  });
  // The matchMedia verdict is factored into this boolean, so the
  // prefers-reduced-motion default (end frame, not playing) is testable
  // without mocking a browser: the user may still press play.
  assert.deepEqual(createPlayerState(10000, true), {
    durationMs: 10000,
    progress: 1,
    playing: false,
    holdMs: 0,
  });
});

test("a malformed duration falls back to the 10s template length instead of NaN progress", () => {
  for (const bad of [0, -5, NaN, Infinity]) {
    assert.equal(createPlayerState(bad).durationMs, 10000, String(bad));
  }
  // Even a crafted state that bypassed the constructor is inert, not
  // NaN-poisoned (the constructor above would already have normalized it).
  const crafted = { durationMs: 0, progress: 0.5, playing: true, holdMs: 0 };
  assert.deepEqual(step(crafted, 100, { loop: true }), crafted);
  const nanDuration = { durationMs: NaN, progress: 0.5, playing: true, holdMs: 0 };
  assert.deepEqual(step(nanDuration, 100, { loop: true }), nanDuration);
});

test("advances linearly over simulated frame gaps and lands on exactly 1", () => {
  let state = playing(1000);
  for (const expected of [0.25, 0.5, 0.75]) {
    state = step(state, 250, { loop: true });
    assert.equal(state.progress, expected);
    assert.equal(state.playing, true);
  }
  state = step(state, 250, { loop: true });
  // Exactly 1, not 0.9999…: the hold and the no-loop stop both key off this.
  assert.equal(state.progress, 1);
  assert.equal(state.playing, true); // loop mode holds at 1 first
  assert.equal(state.holdMs, 0);
});

test("a full 10s at 60fps gaps completes at exactly 1, monotonically", () => {
  let state = playing(10000);
  let last = 0;
  let frames = 0;
  while (state.playing && state.progress < 1 && frames < 1200) {
    state = step(state, 1000 / 60, { loop: true });
    assert.ok(state.progress >= last, `frame ${frames} went backwards`);
    assert.ok(state.progress <= 1);
    last = state.progress;
    frames += 1;
  }
  assert.equal(state.progress, 1);
  assert.equal(frames, 600); // 10000ms / (1000/60)ms — dust-free via the snap
});

test("a gap longer than the pass clamps at 1 instead of overshooting (no-loop)", () => {
  const end = step(playing(1000), 5000, { loop: false });
  assert.deepEqual(end, { durationMs: 1000, progress: 1, playing: false, holdMs: 0 });
});

test("one huge gap consumes a full pass + hold and continues into the next pass", () => {
  // 10000ms pass + 600ms hold + 500ms into pass two.
  const after = step(playing(10000), 11_100, { loop: true });
  assert.ok(Math.abs(after.progress - 0.05) < 1e-9);
  assert.equal(after.playing, true);
  assert.equal(after.holdMs, 0);
});

test("no-loop playback reaching exactly 1 stops on that frame, not one frame later", () => {
  let state = playing(1000);
  for (let i = 0; i < 4; i++) state = step(state, 250, { loop: false });
  assert.deepEqual(state, { durationMs: 1000, progress: 1, playing: false, holdMs: 0 });
});

test("loop mode reaches 1 and banks the overshoot into the hold", () => {
  let state = step(playing(1000), 900, { loop: true }); // 0.9
  state = step(state, 150, { loop: true }); // 100ms to reach 1, 50ms into the hold
  assert.equal(state.progress, 1);
  assert.equal(state.playing, true);
  assert.ok(Math.abs(state.holdMs - 50) < 1e-9);
});

test("holds the finale for 600ms, then restarts from 0 still playing", () => {
  let state = playing(1000, { progress: 1, holdMs: 0 });
  state = step(state, 300, { loop: true });
  assert.equal(state.progress, 1);
  assert.equal(state.playing, true);
  assert.equal(state.holdMs, 300);
  state = step(state, 299, { loop: true });
  assert.equal(state.progress, 1); // 599ms held: not yet
  assert.equal(state.holdMs, 599);
  // The exact boundary tick restarts at frame 0.
  assert.deepEqual(step({ ...state }, 1, { loop: true }), {
    durationMs: 1000,
    progress: 0,
    playing: true,
    holdMs: 0,
  });
  // A crossing tick spills its leftover into the new pass (one gap is
  // consumed across phases): 1ms finishes the hold, 299ms play pass two.
  state = step(state, 300, { loop: true });
  assert.ok(Math.abs(state.progress - 0.299) < 1e-9);
  assert.equal(state.playing, true);
  assert.equal(state.holdMs, 0);
});

test("a stopped player is inert: further gaps change nothing", () => {
  const stopped = step(playing(1000), 999_999, { loop: false });
  assert.deepEqual(stopped, { durationMs: 1000, progress: 1, playing: false, holdMs: 0 });
  for (const dt of [0, 100, 5000, -100, NaN]) {
    assert.deepEqual(step(stopped, dt, { loop: false }), stopped, `dt ${dt} moved a stopped clock`);
  }
});

test("a paused clock does not move, whatever the gap", () => {
  const paused = { ...createPlayerState(1000), playing: false, progress: 0.3 };
  for (const dt of [0, 100, 5000, -1, NaN, Infinity]) {
    assert.deepEqual(step(paused, dt, { loop: true }), paused, `dt ${dt} moved a paused clock`);
  }
});

test("negative, NaN, infinite, and zero gaps are absorbed, never NaN progress", () => {
  const state = playing(1000, { progress: 0.4 });
  for (const dt of [-50, NaN, Infinity, -Infinity, 0]) {
    assert.deepEqual(step(state, dt, { loop: true }), state, `dt ${dt} was not absorbed`);
  }
  assert.equal(step(state, 0, { loop: true }).progress, 0.4);
});

test("seeking mid-play jumps the playhead and playback continues from there", () => {
  let state = step(playing(1000), 300, { loop: true }); // 0.3
  state = seekState(state, 0.6);
  assert.equal(state.progress, 0.6);
  assert.equal(state.playing, true); // seek does not pause
  state = step(state, 100, { loop: true });
  assert.equal(state.progress, 0.7); // continued from 0.6, not from 0.3
});

test("seeking while paused stays paused on the new frame", () => {
  let state = { ...createPlayerState(1000), playing: false, progress: 0.2 };
  state = seekState(state, 0.8);
  assert.equal(state.progress, 0.8);
  assert.equal(state.playing, false);
  assert.equal(step(state, 400, { loop: true }).progress, 0.8); // still no clock
});

test("seek clamps into [0,1] and ignores non-finite input", () => {
  const state = createPlayerState(1000);
  assert.equal(seekState(state, 1.7).progress, 1);
  assert.equal(seekState(state, -3).progress, 0);
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(seekState({ ...state, progress: 0.42 }, bad).progress, 0.42, String(bad));
  }
});

test("seeking out of the finale clears the loop hold; reaching 1 re-earns it", () => {
  const holding = playing(1000, { progress: 1, holdMs: 450 });
  const sought = seekState(holding, 0.5);
  assert.equal(sought.holdMs, 0);
  const again = step({ ...sought, progress: 0.9 }, 200, { loop: true }); // 100ms to 1, 100ms hold
  assert.equal(again.progress, 1);
  assert.ok(Math.abs(again.holdMs - 100) < 1e-9);
});

test("replay restarts from the first frame, playing, from any state", () => {
  const stopped = { ...createPlayerState(1000), progress: 1, playing: false };
  let state = replayState(stopped);
  assert.deepEqual(state, { durationMs: 1000, progress: 0, playing: true, holdMs: 0 });
  state = step(state, 250, { loop: false });
  assert.equal(state.progress, 0.25);
  const midHold = replayState(playing(1000, { progress: 1, holdMs: 300 }));
  assert.deepEqual(midHold, { durationMs: 1000, progress: 0, playing: true, holdMs: 0 });
});
