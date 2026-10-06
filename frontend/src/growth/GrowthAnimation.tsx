// The growth-animation renderer. Renders THE SINGLE FRAME of the 5s
// template at a given progress — a pure function of (scene, progress): no
// clocks, no state, no effect that touches the DOM by time. The player
// drives progress via rAF and the GIF exporter steps it frame by frame;
// both get pixel-identical frames because every value below derives from
// `progress` alone.
//
// v1.1 — isometric code city. Each language is a building: footprint ∝ its
// share of the code (squarified treemap layout baked into every sample by
// buildScene), height ∝ its lines (design px, baked). The renderer projects
// the 100×100 ground plane with the standard 2:1 isometric projection into
// pure SVG polygons (no CSS 3D, no canvas) and interpolates rects/heights
// between adjacent samples by block name. All colors arrive pre-derived in
// the scene — this file does no color math (GIF palette determinism).
//
// Geometry: a fixed 1280x720 design canvas scaled into whatever width the
// wrapper measures, via the same ResizeObserver/CSS-var pattern as the
// share card (Share.tsx useElementScale). All inner layout is design px.
//
// Act map (screen seconds; timings come from scene.acts):
//   0.0-1.2  hook     terminal typing + repo title, counter boot ramp
//   1.2-8.5  data     empty lot → buildings rise (rank-staggered), heights
//                     follow the sample clock (dip segments hold then drop —
//                     the skyline visibly sinks), dip beats (amber flash +
//                     annotation), live rooftop LOC, flipping date cards,
//                     stars beacon on the tallest roof
//   8.5-10   finale   metric bar slides in; date and city settle; static 9.6+
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatCompactNumber, formatNumber } from "../reportUtils";
import { roofTextColors } from "./languageLogos";
import type { GrowthCityBlock, GrowthScene } from "./types";

// ---------------------------------------------------------------------------
// Scale-to-container (pattern twin of Share.tsx useElementScale; written to
// a --growth-scale CSS var straight on the node so per-frame renders never
// re-run for resize ticks). The GIF exporter sets scale 1 on its native
// 1280x720 host.
function useGrowthScale(baseWidth: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) el.style.setProperty("--growth-scale", String(width / baseWidth));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [baseWidth]);
  return ref;
}

// ---------------------------------------------------------------------------
// Pure math. Easings are GSAP-compatible curves (power1=quad, power2=cubic,
// power3=quart) so beats keep the approved demo's feel.
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const quadInOut = (x: number) => {
  const u = clamp(x, 0, 1);
  return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
};
const cubicIn = (x: number) => {
  const u = clamp(x, 0, 1);
  return u * u * u;
};
const cubicOut = (x: number) => 1 - cubicIn(1 - x);
const cubicInOut = (x: number) => {
  const u = clamp(x, 0, 1);
  return u < 0.5 ? 4 * u * u * u : 1 - 4 * (1 - u) * (1 - u) * (1 - u);
};
const quartOut = (x: number) => {
  const u = clamp(x, 0, 1);
  return 1 - (1 - u) * (1 - u) * (1 - u) * (1 - u);
};
// 0..1 across [t0, t1], clamped — the universal beat window.
const w01 = (t: number, t0: number, t1: number) => clamp((t - t0) / (t1 - t0 || 1), 0, 1);
// GSAP autoAlpha equivalent: visibility toggles so opacity:0 layers are
// never captured by the GIF exporter's html-to-image pass.
const autoAlpha = (opacity: number) => ({
  opacity,
  visibility: opacity <= 0 ? ("hidden" as const) : ("visible" as const),
});

// ---------------------------------------------------------------------------
// Deterministic typewriter (demo typeTable/charsAt): fixed [3,2,3,2..] chunk
// cycle, 0.025s lead, one chars-at-time table built synchronously.
type TypeRow = { t: number; n: number };
function buildTypeTable(str: string, t0: number, t1: number): TypeRow[] {
  const lead = 0.025;
  const chunks: number[] = [];
  let i = 0;
  let k = 0;
  while (i < str.length) {
    const n = k % 2 === 0 ? 3 : 2;
    chunks.push(Math.min(n, str.length - i));
    i += n;
    k += 1;
  }
  const step = (t1 - t0 - lead) / chunks.length;
  const rows: TypeRow[] = [{ t: t0, n: 0 }];
  let acc = 0;
  chunks.forEach((c, idx) => {
    acc += c;
    rows.push({ t: t0 + lead + step * (idx + 1), n: acc });
  });
  return rows;
}
function charsAt(rows: TypeRow[], time: number): number {
  for (let j = rows.length - 1; j >= 0; j -= 1) {
    if (time >= rows[j].t - 0.001) return rows[j].n;
  }
  return 0;
}

// Deterministic calendar math (fixed UTC epochs, never the wall clock).
const DAY_MS = 86_400_000;
const epochOf = (date: string) => Date.parse(`${date}T00:00:00Z`);
const dateAtDay = (epoch: number, day: number) => new Date(epoch + day * DAY_MS);
const isoDate = (epoch: number, day: number) => dateAtDay(epoch, day).toISOString().slice(0, 10);
const monthYear = (date: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(epochOf(date)),
  );

// ---------------------------------------------------------------------------
// Stage geometry (design px on the fixed 1280x720 canvas).
const STAGE_W = 1280;
const STAGE_H = 720;

// ---------------------------------------------------------------------------
// Isometric projection. Ground coords (gx, gy) in the scene's 100x100 grid;
// screen = ((gx-gy)·cos30°·S, (gx+gy)·0.5·S) with the building height z
// subtracted from y. S and the origin place the plate in the right-center
// of the stage, clear of the hero counter (left) and the metric bar (bottom).
const GROUND = 100; // must match GROUND_SIZE in buildScene.ts
const ISO_COS = Math.sqrt(3) / 2; // 0.8660 — the 2:1 isometric x factor
const GROUND_SCALE = 3.4; // screen px per ground unit: plate ≈ 589w x 340d
const ORIGIN_X = 878; // screen x of the ground's back corner (0,0)
const ORIGIN_Y = 266; // screen y of the back corner; front corner lands y=606
const isoX = (gx: number, gy: number) => ORIGIN_X + (gx - gy) * ISO_COS * GROUND_SCALE;
const isoY = (gx: number, gy: number, z = 0) => ORIGIN_Y + (gx + gy) * 0.5 * GROUND_SCALE - z;
const pt = (gx: number, gy: number, z = 0) => `${isoX(gx, gy).toFixed(2)},${isoY(gx, gy, z).toFixed(2)}`;

// Small roofs keep compact text; these thresholds reserve space for logos.
const LABEL_MIN_EDGE = 13; // ground units
const LABEL_MIN_AREA = 220; // ground units²
const LABEL_OVERLAP_RADIUS = 34; // screen px between adjacent rooftop labels

// demo constants that structure the choreography
const DIP_DROP = 0.225; // dip segments hold, then drop over the last 0.225s
const DIP_AMBER = 0.35; // skyline stays amber-stroked this long after entering a dip
const RISE_STAGGER = 0.15; // entrance delay per rank (full variant)
const RISE_DUR = 0.5;

// ---------------------------------------------------------------------------
// deriveFrame(scene, t, hovered) — every animated number at screen second t.
// Pure: deterministic scene data + deterministic calendar math only. `hovered`
// only reveals crowd-hidden small-roof labels; exports pass nothing, so GIF/
// PNG frames stay a function of (scene, progress) alone.
function deriveFrame(scene: GrowthScene, t: number, hovered: string | null = null) {
  const acts = scene.acts;
  const samples = scene.samples;
  const n = samples.length;
  const lastIdx = n - 1;
  const isCompact = scene.variant === "compact";
  const dataStart = acts.data.startTime;
  const dataEnd = acts.data.endTime;
  const fStart = acts.finale.startTime;

  // -- the sample clock: time<->sample linear in dayOffset across the data
  // act (plan: "time<->sample linear mapping, 4,435 days -> 7.3s"). --
  const totalDays = Math.max(samples[lastIdx].dayOffset, 1);
  const timeOf = (i: number) => dataStart + (samples[i].dayOffset / totalDays) * (dataEnd - dataStart);
  const dipIndices = new Set(scene.dips.map((d) => d.sampleIndex));

  // Driver segments, porting the demo timeline: normal segments ease
  // cubic-in-out (quad for the compressed <0.15s tail); a segment whose
  // TARGET is a dip sample holds flat, then drops cubic-in over DIP_DROP.
  const easeAt: Array<(u: number) => number> = [];
  for (let i = 0; i < lastIdx; i += 1) {
    const span = timeOf(i + 1) - timeOf(i);
    if (dipIndices.has(i + 1)) {
      const hold = Math.max(0, 1 - DIP_DROP / Math.max(span, 1e-6));
      easeAt.push((u: number) => (u < hold ? 0 : cubicIn((u - hold) / (1 - hold))));
    } else {
      easeAt.push(span < 0.15 ? quadInOut : cubicInOut);
    }
  }
  const sampleAt = (tt: number) => {
    if (tt <= timeOf(0)) return 0;
    if (tt >= timeOf(lastIdx)) return lastIdx;
    let i = 0;
    while (i < lastIdx - 1 && tt >= timeOf(i + 1)) i += 1;
    const u = w01(tt, timeOf(i), timeOf(i + 1));
    return i + easeAt[i](u);
  };

  const p = sampleAt(t);
  const i0 = n > 1 ? clamp(Math.floor(p), 0, n - 2) : 0;
  const i1 = Math.min(i0 + 1, lastIdx);
  const f = n > 1 ? clamp(p - i0, 0, 1) : 0;
  const sampleLerp = (pick: (s: (typeof samples)[number]) => number) => lerp(pick(samples[i0]), pick(samples[i1]), f);

  const codeNow = sampleLerp((s) => s.code);
  const dayNow = sampleLerp((s) => s.dayOffset);

  // -- calendar dates for the hook, dip labels, and flip cards --
  const epoch = epochOf(samples[0].date);
  const firstYear = dateAtDay(epoch, 0).getUTCFullYear();
  const lastYear = new Date(epochOf(samples[lastIdx].date)).getUTCFullYear();
  const years = Math.max(lastYear - firstYear, 1);
  const rangeLabel = `${firstYear} → ${lastYear}`;

  // -- dips: amber window on the counter + skyline + annotation band --
  const dipBeats = scene.dips.map((d) => {
    const t0 = timeOf(d.sampleIndex);
    const kIn = w01(t, t0, t0 + 0.11);
    const kOut = w01(t, t0 + 0.25, t0 + 0.35);
    const drop = d.fromValue > 0 ? (d.fromValue - d.toValue) / d.fromValue : 0;
    return {
      amber: t >= t0 && t < t0 + DIP_AMBER,
      alpha: kIn * (1 - kOut),
      y: 7 * (1 - quartOut(kIn)) - 4 * kOut,
      drop,
      month: monthYear(samples[d.sampleIndex].date),
    };
  });
  const amber = dipBeats.some((d) => d.amber);

  // -- hook: typewriter tables + word reveal, all anchored to dataStart --
  const prompt = acts.hook.prompt;
  const outText = `scanning ${years} years of commits · ${rangeLabel}`;
  const promptEnd = dataStart - 0.5;
  const outputEnd = dataStart - 0.1;
  const promptTable = buildTypeTable(prompt, 0, promptEnd);
  const outputTable = buildTypeTable(outText, promptEnd, outputEnd);
  // word reveal: owner/repo split with the slash as its own span
  const words = scene.repoFullName
    .split("/")
    .flatMap((w, i) => (i > 0 ? [{ text: "/", own: false }, { text: w, own: true }] : [{ text: w, own: true }]))
    .map((word, i) => {
      const t0 = dataStart - 0.95 + i * 0.06;
      const k = quartOut(w01(t, t0, t0 + 0.3));
      return { ...word, alpha: k, y: 24 * (1 - k) };
    });
  const hook = {
    promptText: prompt.slice(0, charsAt(promptTable, t)),
    outputText: outText.slice(0, charsAt(outputTable, t)),
    // square-wave caret blink: integer sine cycles, deterministic both ways
    caret1: t < promptEnd ? (Math.sin((t / promptEnd) * Math.PI * 2) >= 0 ? 1 : 0) : 0,
    caret2Gate: w01(t, promptEnd, promptEnd + 0.025),
    caret2: t >= outputEnd ? 1 : Math.sin(((t - promptEnd) / (outputEnd - promptEnd)) * Math.PI * 2) >= 0 ? 1 : 0,
    kickerAlpha: w01(t, dataStart - 0.675, dataStart - 0.425),
    // the whole block settles DOWN and away (never up into the counter band)
    exitAlpha: 1 - w01(t, dataStart, dataStart + 0.15),
    exitY: 9 * cubicIn(w01(t, dataStart, dataStart + 0.15)),
    exitScale: 1 - 0.03 * cubicIn(w01(t, dataStart, dataStart + 0.15)),
    titleText: `${years} years of code — ${rangeLabel}`,
  };

  // -- hero counter: boot ramp 0 -> first sample over the hook, then the
  // sample clock; one restrained pulse at the final lock. --
  const bootK = quartOut(w01(t, 0, dataStart));
  const pulse = (() => {
    const u = t - acts.data.finalLock;
    if (u <= 0 || u >= 0.19) return 1;
    if (u < 0.08) return 1 + 0.04 * cubicOut(u / 0.08);
    return 1 + 0.04 * (1 - cubicInOut((u - 0.08) / 0.11));
  })();
  const hero = {
    value: t >= dataStart ? codeNow : bootK * samples[0].code,
    scale: t >= dataStart ? pulse : 0.55 + 0.45 * bootK,
    amber,
    kickerAlpha: w01(t, dataStart, dataStart + 0.2) * (1 - w01(t, fStart - 0.05, fStart + 0.1)),
    kickerY: -5 * (1 - quartOut(w01(t, dataStart, dataStart + 0.2))),
  };

  const dateAtTime = (time: number) => {
    const index = sampleAt(time);
    const left = Math.min(Math.floor(index), lastIdx);
    const right = Math.min(left + 1, lastIdx);
    return isoDate(epoch, lerp(samples[left].dayOffset, samples[right].dayOffset, index - left));
  };
  const pageStart = dataStart + Math.floor(Math.max(0, t - dataStart) / 0.25) * 0.25;
  const lockedDate = isCompact || t >= dataEnd;
  const date = {
    current: lockedDate ? samples[lastIdx].date : dateAtTime(pageStart),
    previous: lockedDate ? samples[lastIdx].date : dateAtTime(Math.max(dataStart, pageStart - 0.25)),
    exact: isCompact ? samples[lastIdx].date : isoDate(epoch, dayNow),
    turn: lockedDate ? 1 : w01(t, pageStart, pageStart + 0.2),
    alpha: w01(t, dataStart, dataStart + 0.2),
  };

  // -- the city: interpolate every block's rect + height between the two
  // surrounding samples (compact variant: straight to the final skyline).
  // Heights ride the SAME eased sample clock as the counter, so a dip
  // segment holds the skyline flat then sinks it cubic-in — the buildings
  // themselves beat the dip. --
  const ci0 = isCompact ? lastIdx : i0;
  const ci1 = isCompact ? lastIdx : i1;
  const cf = isCompact ? 0 : f;
  const city0 = samples[ci0].city;
  const city1 = samples[ci1].city;
  const finalCity = samples[lastIdx].city;
  // Entrance order = the final skyline's rank (largest first); blocks absent
  // from the final sample (zero-code tails that vanished) enter last.
  const entranceRank = new Map(finalCity.map((block, i) => [block.name, i]));
  const stagger = isCompact ? 0.06 : RISE_STAGGER;
  const riseDur = isCompact ? 0.7 : RISE_DUR;
  const cityNames = [...new Set([...city0, ...city1].map((block) => block.name))].sort(
    (a, b) => (entranceRank.get(a) ?? 999) - (entranceRank.get(b) ?? 999),
  );
  const blockByName = (city: GrowthCityBlock[]) => {
    const map = new Map(city.map((block) => [block.name, block]));
    return map;
  };
  const map0 = blockByName(city0);
  const map1 = blockByName(city1);
  const blocks = cityNames
    .map((name) => {
      const b0 = map0.get(name);
      const b1 = map1.get(name);
      const ref = (b1 ?? b0)!; // a missing side collapses to a point at the other's spot
      const rect = {
        x: lerp(b0?.rect.x ?? ref.rect.x + ref.rect.w / 2, b1?.rect.x ?? ref.rect.x + ref.rect.w / 2, cf),
        y: lerp(b0?.rect.y ?? ref.rect.y + ref.rect.h / 2, b1?.rect.y ?? ref.rect.y + ref.rect.h / 2, cf),
        w: lerp(b0?.rect.w ?? 0, b1?.rect.w ?? 0, cf),
        h: lerp(b0?.rect.h ?? 0, b1?.rect.h ?? 0, cf),
      };
      const rank = entranceRank.get(name) ?? cityNames.length;
      const enterK = quartOut(w01(t, dataStart + rank * stagger, dataStart + rank * stagger + riseDur));
      const height = lerp(b0?.height ?? 0, b1?.height ?? 0, cf) * enterK;
      return {
        name,
        rect,
        height,
        enterK,
        color: ref.color,
        colorTop: ref.colorTop,
        colorRight: ref.colorRight,
        value: lerp(b0?.value ?? 0, b1?.value ?? 0, cf) * enterK,
        logo: ref.logo,
        merged: ref.merged,
        // painter's depth: larger gx+gy sits closer to the viewer
        depth: rect.x + rect.y,
      };
    })
    .sort((a, b) => a.depth - b.depth);

  const groundAlpha = quartOut(w01(t, dataStart, dataStart + 0.3));

  const languageByName = new Map(scene.languages.map((language) => [language.name, language]));
  const labels = blocks.map((block) => {
    const fits =
      block.rect.w >= LABEL_MIN_EDGE &&
      block.rect.h >= LABEL_MIN_EDGE &&
      block.rect.w * block.rect.h >= LABEL_MIN_AREA;
    const edge = Math.min(block.rect.w, block.rect.h);
    // The logo is a 24×24 path whose projected bottom corner dips
    // GROUND_SCALE×size px below its origin; keep it small enough that the
    // label text (see textDy below) clears it on medium roofs like CSS/JS.
    const size = Math.min(7, edge * 0.36);
    const offset = Math.min(4, edge * 0.15);
    const gx = block.rect.x + block.rect.w / 2 - offset - size / 2;
    const gy = block.rect.y + block.rect.h / 2 - offset - size / 2;
    const a = ISO_COS * GROUND_SCALE * size / 24;
    const b = 0.5 * GROUND_SCALE * size / 24;
    const x = isoX(block.rect.x + block.rect.w / 2, block.rect.y + block.rect.h / 2);
    const y = isoY(block.rect.x + block.rect.w / 2, block.rect.y + block.rect.h / 2, block.height);
    const share = codeNow > 0 ? (block.value / codeNow) * 100 : 0;
    const logo = fits && block.logo ? {
      ...block.logo,
      transform: `matrix(${a} ${b} ${-a} ${b} ${isoX(gx, gy)} ${isoY(gx, gy, block.height)})`,
    } : undefined;
    // Tiny roofs (<1.5% share) crowd each other at the skyline's foot; their
    // labels only appear while that building is hovered (live view) and stay
    // hidden in exports for a clean card.
    const hoverOnly = !fits && share < 1.5;
    return {
      name: block.name,
      merged: block.merged,
      value: block.value,
      share,
      x,
      y,
      alpha: block.enterK > 0 ? (hoverOnly && hovered !== block.name ? 0 : 1) : 0,
      hoverOnly,
      softened: false,
      compact: !fits,
      // Text sits below the logo's projected bottom corner (see size above):
      // name baseline y+20, value baseline y+33 vs logo bottom ≈ y+19.
      textDy: logo ? 22 : 0,
      textColor: block.logo?.textColor ?? roofTextColors(block.colorTop).textColor,
      valueColor: block.logo?.valueColor ?? roofTextColors(block.colorTop).valueColor,
      logo,
    };
  });
  const overlapPairs: Array<[string, string]> = [];
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const dx = labels[i].x - labels[j].x;
      const dy = labels[i].y - labels[j].y;
      if (Math.hypot(dx, dy) < LABEL_OVERLAP_RADIUS) overlapPairs.push([labels[i].name, labels[j].name]);
    }
  }
  const overlapNames = new Set(overlapPairs.flat());
  // Overlap softening dims always-visible crowded labels; hover-only labels
  // are already hidden at rest, so dimming them too would be invisible work.
  // `softened` rides the inline opacity (CSS class opacity would override the
  // SVG presentation attribute, which is why this is a value, not a class).
  for (const label of labels) {
    label.softened = !label.hoverOnly && overlapNames.has(label.name);
  }
  const labelShareNotes = labels.flatMap((label, index) => {
    const language = languageByName.get(label.name);
    if (!language || label.merged || label.value <= 0) return [];
    const left = Math.min(Math.floor(p), language.shares.length - 1);
    const right = Math.min(left + 1, language.shares.length - 1);
    const localT = language.shares.length > 1 ? clamp(p - left, 0, 1) : 0;
    const previous = language.shares[left] ?? 0;
    const next = language.shares[right] ?? previous;
    const delta = next - previous;
    const visibleDelta = Math.abs(delta) >= 1.5 && label.value > codeNow * 0.06;
    if (!visibleDelta) return [];
    return [{
      name: label.name,
      text: `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}%`,
      positive: delta > 0,
      x: label.x,
      y: label.y - 28,
      // Keep the note clear of simultaneous labels, including the one below it.
      alpha: label.alpha * (index % 2 === 0 ? 1 : 0),
    }];
  });

  // -- stars beacon: a glowing diamond hovering over the tallest roof, value
  // interpolating across the starred samples to starsNow (old HUD anchors). --
  let beacon: { alpha: number; value: number; x: number; y: number; anchorEnd: boolean } | null = null;
  if (scene.starsNow != null) {
    const anchors = samples
      .map((s, i) => ({ t: timeOf(i), v: s.stars }))
      .filter((a): a is { t: number; v: number } => a.v != null);
    if (anchors.length === 0 || anchors[anchors.length - 1].v !== scene.starsNow) {
      anchors.push({ t: dataEnd, v: scene.starsNow });
    }
    const tIn = anchors[0].t;
    let value = anchors[0].v;
    for (let k = 0; k < anchors.length - 1; k += 1) {
      value = lerp(anchors[k].v, anchors[k + 1].v, w01(t, anchors[k].t, anchors[k + 1].t));
    }
    const tallest = blocks.reduce<(typeof blocks)[number] | null>(
      (max, block) => (block.height > (max?.height ?? 0) ? block : max),
      null,
    );
    if (tallest && tallest.height > 1) {
      const gx = tallest.rect.x + tallest.rect.w / 2;
      const gy = tallest.rect.y + tallest.rect.h / 2;
      const bx = isoX(gx, gy);
      const by = isoY(gx, gy, tallest.height) - 50;
      beacon = {
        alpha: w01(t, tIn, tIn + 0.2),
        value,
        x: bx,
        y: by,
        anchorEnd: bx > STAGE_W - 220, // keep the label on-stage
      };
    }
  }

  // -- metric bar (finale): slides up at the bottom, metrics cascade until
  // staticFrom. Counts come from scene.finale.metrics; the span is the real
  // sample date range. --
  const barK = cubicOut(w01(t, fStart + 0.05, fStart + 0.35));
  const metrics = {
    alpha: barK,
    y: 14 * (1 - barK),
    items: [0, 1, 2, 3, 4].map((k) => {
      const kk = cubicOut(w01(t, fStart + 0.12 + k * 0.05, fStart + 0.32 + k * 0.05));
      return { alpha: kk, y: 8 * (1 - kk) };
    }),
  };

  const finaleK = cubicInOut(w01(t, fStart, fStart + 0.5));
  const cityTop = Math.min(ORIGIN_Y, ...finalCity.map((block) => isoY(block.rect.x, block.rect.y, block.height)));
  const cityBottom = isoY(GROUND, GROUND);
  const cityOffset = {
    x: (STAGE_W / 2 - ORIGIN_X) * finaleK,
    y: (STAGE_H / 2 - (cityTop + cityBottom) / 2) * finaleK,
  };
  const firstCode = samples[0].code;
  const lastCode = samples[lastIdx].code;
  return {
    finaleK,
    cityOffset,
    isCompact,
    t,
    dataStart,
    hero,
    hook,
    words,
    dipBeats,
    date,
    groundAlpha,
    blocks,
    amber,
    labels,
    overlapNames,
    labelShareNotes,
    beacon,
    metrics,
    // hero counter hands off to the finale at 8.5
    heroExit: 1 - w01(t, fStart - 0.05, fStart + 0.1),
    ariaLabel: `Growth animation: ${scene.repoFullName} code lines ${formatNumber(firstCode)}→${formatNumber(lastCode)}, ${years} years`,
    summary: `${scene.repoFullName} grew from ${formatNumber(firstCode)} code lines on ${samples[0].date} to ${formatNumber(lastCode)} code lines on ${samples[lastIdx].date}.`,
  };
}

export type GrowthFrame = ReturnType<typeof deriveFrame>;

// ---------------------------------------------------------------------------
// Component: one pure render of the frame at `progress`. `playing` only
// suppresses the pause affordance — the player owns all timing.
export function GrowthAnimation({
  scene,
  progress,
  playing,
  interactive,
}: {
  scene: GrowthScene;
  progress: number;
  playing?: boolean;
  /** Finale-only hover details; exports pass nothing so GIFs stay interactive-free. */
  interactive?: boolean;
}) {
  const wrapRef = useGrowthScale(STAGE_W);
  const seconds = clamp(progress, 0, 1) * (scene.durationMs / 1000);
  const [hovered, setHovered] = useState<string | null>(null);
  const f = deriveFrame(scene, seconds, hovered);
  useEffect(() => {
    if (!interactive || progress < 1) setHovered(null);
  }, [interactive, progress]);
  const interactiveFinale = interactive === true && progress >= 1 && f.finaleK >= 1;
  const detailBlock = interactiveFinale && hovered ? f.blocks.find((block) => block.name === hovered) ?? null : null;
  const handleStageMouseMove = (event: React.MouseEvent<HTMLElement>) => {
    if (!interactiveFinale) {
      if (hovered) setHovered(null);
      return;
    }
    const wrap = wrapRef.current;
    if (!wrap) {
      setHovered(null);
      return;
    }
    const rect = wrap.getBoundingClientRect();
    const scale = rect.width / STAGE_W || 1;
    const point = {
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale,
    };
    // Blocks are sorted back-to-front for painting; hit-test in reverse so the
    // visually front-most building wins where projected boxes overlap.
    const hit = [...f.blocks].reverse().find((block) => {
      if (block.enterK <= 0 || block.rect.w <= 0 || block.rect.h <= 0) return false;
      const { x, y, w, h } = block.rect;
      const corners = [
        [x, y, block.height],
        [x + w, y, block.height],
        [x + w, y + h, block.height],
        [x, y + h, block.height],
        [x, y + h, 0],
        [x + w, y + h, 0],
        [x + w, y, 0],
        [x, y, 0],
      ].map(([gx, gy, z]) => [isoX(gx, gy) + f.cityOffset.x, isoY(gx, gy, z) + f.cityOffset.y] as const);
      const xs = corners.map((corner) => corner[0]);
      const ys = corners.map((corner) => corner[1]);
      return point.x >= Math.min(...xs) && point.x <= Math.max(...xs) && point.y >= Math.min(...ys) && point.y <= Math.max(...ys);
    });
    setHovered(hit?.name ?? null);
  };
  return (
    <div className="growth-wrap" ref={wrapRef}>
      <p className="visually-hidden">{f.summary}</p>
      <div
        className="growth-stage"
        role="img"
        aria-label={f.ariaLabel}
        onMouseMove={handleStageMouseMove}
        onMouseLeave={() => setHovered(null)}
      >
        <CityLayer
          f={f}
          scene={scene}
          hovered={interactiveFinale ? hovered : null}
          revealOnHover={interactiveFinale}
        />
        <HudLayer scene={scene} f={f} />
        <MetricBar scene={scene} f={f} />
        <HookAct f={f} />
        {interactiveFinale && detailBlock ? <LanguageDetail scene={scene} f={f} block={detailBlock} /> : null}
        {playing === false && progress < 1 ? (
          <div className="growth-paused" aria-hidden="true">
            <span>▶</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Act 1 — the terminal hook: typed prompt + output, repo title word reveal,
// kicker; the whole block settles down and away as the data act begins.
function HookAct({ f }: { f: GrowthFrame }) {
  const h = f.hook;
  return (
    <div className="growth-layer">
      <div
        className="growth-hook"
        style={{
          ...autoAlpha(h.exitAlpha),
          transform: `translateY(${h.exitY}px) scale(${h.exitScale})`,
        }}
      >
        <div className="growth-term">
          <div className="growth-term-line">
            <span className="growth-term-prompt">$</span>
            <span className="growth-term-cmd">{h.promptText}</span>
            <span className="growth-term-caret" style={autoAlpha(h.caret1)} />
          </div>
          <div className="growth-term-line">
            <span className="growth-term-out">{h.outputText}</span>
            <span className="growth-term-caret-gate" style={autoAlpha(h.caret2Gate)}>
              <span className="growth-term-caret" style={autoAlpha(h.caret2)} />
            </span>
          </div>
        </div>
        <h2 className="growth-repo-name">
          {f.words.map((w, i) => (
            <span key={i} style={{ ...autoAlpha(w.alpha), transform: `translateY(${w.y}px)` }}>
              {w.text}
            </span>
          ))}
        </h2>
        <div className="growth-title-kicker" style={autoAlpha(h.kickerAlpha)}>
          {h.titleText}
        </div>
      </div>
    </div>
  );
}

// The city itself — one full-stage SVG. Ground plate + grid, then buildings
// back-to-front (painter's algorithm over gx+gy depth), rooftop labels, and
// the stars beacon. All geometry arrives pre-computed in the frame.
function CityLayer({
  f,
  scene,
  hovered,
  revealOnHover,
}: {
  f: GrowthFrame;
  scene: GrowthScene;
  hovered: string | null;
  /** Finale hover mode: keep hover-only labels mounted (opacity 0) so hover can reveal them. */
  revealOnHover: boolean;
}) {
  const { t } = useTranslation();
  const gridLines: string[] = [];
  for (let u = 20; u < GROUND; u += 20) {
    gridLines.push(`${pt(u, 0)} ${pt(u, GROUND)}`);
    gridLines.push(`${pt(0, u)} ${pt(GROUND, u)}`);
  }
  return (
    <svg
      className="growth-city-svg"
      viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
      aria-hidden="true"
      style={{ transform: `translate(${f.cityOffset.x}px, ${f.cityOffset.y}px)` }}
    >
      {/* ground plate: the empty lot the city rises from */}
      <g opacity={f.groundAlpha}>
        <polygon className="growth-city-plate" points={`${pt(0, 0)} ${pt(GROUND, 0)} ${pt(GROUND, GROUND)} ${pt(0, GROUND)}`} />
        {gridLines.map((points, i) => (
          <polyline key={i} className="growth-city-grid" points={points} />
        ))}
      </g>

      {/* buildings: three polygons each — roof (top shade), left face (base
          color), right face (dark shade); amber stroke during dip beats */}
      {f.blocks.map((block) => {
        const { x, y, w, h } = block.rect;
        const z = block.height;
        if (block.enterK <= 0 || w <= 0 || h <= 0) return null;
        const stroke = f.amber ? "var(--warn)" : undefined;
        return (
          <g
            key={block.name}
            className={hovered === block.name ? "growth-city-block is-hovered" : "growth-city-block"}
            data-language={block.name}
          >
            {z > 0.5 ? (
              <>
                <polygon
                  className="growth-city-face"
                  fill={block.color}
                  style={stroke ? { stroke } : undefined}
                  points={`${pt(x, y + h)} ${pt(x + w, y + h)} ${pt(x + w, y + h, z)} ${pt(x, y + h, z)}`}
                />
                <polygon
                  className="growth-city-face"
                  fill={block.colorRight}
                  style={stroke ? { stroke } : undefined}
                  points={`${pt(x + w, y)} ${pt(x + w, y + h)} ${pt(x + w, y + h, z)} ${pt(x + w, y, z)}`}
                />
              </>
            ) : null}
            <polygon
              className="growth-city-face"
              fill={block.colorTop}
              style={stroke ? { stroke } : undefined}
              points={`${pt(x, y, z)} ${pt(x + w, y, z)} ${pt(x + w, y + h, z)} ${pt(x, y + h, z)}`}
            />
          </g>
        );
      })}

      {/* rooftop labels follow every building; logos appear where space allows. */}
      {f.labels.map((label) => {
        if (label.alpha <= 0 && !(revealOnHover && label.hoverOnly)) return null;
        return (
          <g
            key={label.name}
            className="growth-city-label-group"
            opacity={label.alpha * (label.softened ? 0.74 : 1)}
            data-language={label.name}
            data-loc={Math.round(label.value)}
            data-share={label.share.toFixed(1)}
          >
            {label.logo ? (
              <path
                className="growth-city-logo"
                data-language={label.name}
                d={label.logo.path}
                fill={label.logo.color}
                transform={label.logo.transform}
              />
            ) : null}
            <text
              className={label.compact ? "growth-city-label growth-city-label-small" : "growth-city-label"}
              data-language={label.name}
              data-loc={Math.round(label.value)}
              data-share={label.share.toFixed(1)}
              style={{ fill: label.textColor }}
              x={label.x}
              y={label.y + label.textDy}
              textAnchor="middle"
            >
              <tspan x={label.x} dy={-2} className="growth-city-label-name">
                {label.merged ? t(label.compact ? "growth.animation.otherShort" : "growth.animation.otherBlock", { count: label.merged }) : label.name}
              </tspan>
              <tspan x={label.x} dy={13} className="growth-city-label-value growth-num" style={{ fill: label.valueColor }}>
                {formatNumber(Math.round(label.value))}
              </tspan>
            </text>
          </g>
        );
      })}
      {f.labelShareNotes.map((note) => (
        <text
          key={note.name}
          className={`growth-share-note growth-num${note.positive ? " positive" : ""}`}
          data-language={note.name}
          x={note.x}
          y={note.y}
          textAnchor="middle"
          opacity={note.alpha}
        >
          {note.text}
        </text>
      ))}

      {/* stars beacon over the tallest roof */}
      {f.beacon && f.beacon.alpha > 0 && f.finaleK < 1 ? (
        <g opacity={f.beacon.alpha * (1 - f.finaleK)} aria-label={t("growth.animation.beaconAria")}>
          <polygon
            className="growth-beacon-glow"
            points={`${f.beacon.x},${f.beacon.y - 13} ${f.beacon.x + 9},${f.beacon.y} ${f.beacon.x},${f.beacon.y + 13} ${f.beacon.x - 9},${f.beacon.y}`}
          />
          <polygon
            className="growth-beacon-core"
            points={`${f.beacon.x},${f.beacon.y - 6} ${f.beacon.x + 4.5},${f.beacon.y} ${f.beacon.x},${f.beacon.y + 6} ${f.beacon.x - 4.5},${f.beacon.y}`}
          />
          <text
            className="growth-beacon-value growth-num"
            x={f.beacon.anchorEnd ? f.beacon.x - 12 : f.beacon.x + 12}
            y={f.beacon.y + 4}
            textAnchor={f.beacon.anchorEnd ? "end" : "start"}
          >
            ★ {formatNumber(Math.round(f.beacon.value))}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

function FlipDate({ f }: { f: GrowthFrame }) {
  const previous = f.date.previous.split("-");
  const current = f.date.current.split("-");
  return (
    <time className="growth-date growth-num" dateTime={f.date.exact} style={autoAlpha(f.date.alpha)}>
      {current.map((value, i) => {
        const changed = value !== previous[i];
        const turn = changed ? f.date.turn : 1;
        return (
          <span key={i} className={`growth-date-cell${i === 0 ? " growth-date-year" : ""}`}>
            <span className="growth-date-static">{value}</span>
            {changed && turn < 1 ? (
              <>
                <span className="growth-date-old" aria-hidden="true" style={{ opacity: 1 - turn }}>{previous[i]}</span>
                <span className="growth-date-leaf" aria-hidden="true" style={{ transform: `scaleY(${Math.cos(turn * Math.PI)})` }}>
                  <span style={{ transform: turn > 0.5 ? "scaleY(-1)" : undefined }}>
                    {turn <= 0.5 ? previous[i] : value}
                  </span>
                </span>
              </>
            ) : null}
            <span className="growth-date-reduced">{f.date.exact.split("-")[i]}</span>
          </span>
        );
      })}
    </time>
  );
}

function HudLayer({ scene, f }: { scene: GrowthScene; f: GrowthFrame }) {
  const { t } = useTranslation();
  return (
    <div className="growth-layer">
      {/* hero zone */}
      <div className="growth-hero-zone" style={autoAlpha(f.heroExit)}>
        <div
          className="growth-kicker"
          style={{ ...autoAlpha(f.hero.kickerAlpha), transform: `translateY(${f.hero.kickerY}px)` }}
        >
          {scene.repoFullName} · CODE LINES
        </div>
        <div
          className="growth-hero-num growth-num"
          style={{
            color: f.hero.amber ? "var(--warn)" : "var(--fg)",
            transform: `scale(${f.hero.scale})`,
          }}
        >
          {formatNumber(Math.round(f.hero.value))}
        </div>
        <div className="growth-dip-row">
          {f.dipBeats.map((d, i) => (
            <span
              key={i}
              className="growth-dip-note"
              style={{ ...autoAlpha(d.alpha), transform: `translateY(${d.y}px)` }}
            >
              {t("growth.animation.dipNote", { percent: Math.round(d.drop * 100), month: d.month })}
            </span>
          ))}
        </div>
      </div>

      {f.beacon ? (
        <div
          className="growth-stars-summary growth-num"
          data-stars={Math.round(f.beacon.value)}
          style={autoAlpha(f.finaleK * f.beacon.alpha)}
        >
          <span className="growth-stars-icon" aria-hidden="true">★</span>
          <span>{formatNumber(Math.round(f.beacon.value))}</span>
          <span className="growth-stars-caption">Stars</span>
        </div>
      ) : null}
      {/* Finale identity: a PNG export of the final frame doubles as the share
          card, so the repo name and brand ride on the frame itself. */}
      <div className="growth-finale-id" data-repo={scene.repoFullName} style={autoAlpha(f.finaleK)} aria-hidden="true">
        <span className="growth-finale-repo">{scene.repoFullName}</span>
        <span className="growth-finale-brand">· octocounts</span>
      </div>
      <FlipDate f={f} />
    </div>
  );
}

function LanguageDetail({
  scene,
  f,
  block,
}: {
  scene: GrowthScene;
  f: GrowthFrame;
  block: GrowthFrame["blocks"][number];
}) {
  const { t } = useTranslation();
  const language = scene.languages.find((entry) => entry.name === block.name) ?? null;
  const stats = block.merged
    ? scene.finale.tableRows.find((row) => row.merged) ?? null
    : scene.languageDetails[block.name] ?? null;
  const share = block.merged
    ? Math.max(0, 100 - f.labels.filter((label) => !label.merged).reduce((sum, label) => sum + label.share, 0))
    : language
      ? language.currentShare
      : (block.value / Math.max(f.hero.value, 1)) * 100;
  const x = clamp(block.rect.x + block.rect.w / 2 + f.cityOffset.x, 180, STAGE_W - 180);
  const top = isoY(block.rect.x, block.rect.y, block.height) + f.cityOffset.y;
  const placeBelow = top < 330;
  const y = placeBelow
    ? clamp(top + 18, 120, STAGE_H - 180)
    : clamp(top - 20, 180, STAGE_H - 120);
  const rows: Array<[string, string]> = stats
    ? [
        [t("growth.animation.metricFiles"), formatNumber(stats.files)],
        [t("growth.animation.metricCode"), formatNumber(stats.code)],
        [t("growth.animation.metricComments"), formatNumber(stats.comments)],
        [t("growth.animation.metricBlanks"), formatNumber(stats.blanks)],
      ]
    : [];
  return (
    <div
      className="growth-detail growth-num"
      data-language={block.name}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: placeBelow ? "translate(-50%, 0) scale(1)" : "translate(-50%, -100%) scale(1)",
        opacity: 1,
        visibility: "visible",
      }}
    >
      <div className="growth-detail-head">
        <span className="growth-detail-swatch" style={{ background: block.colorTop }} />
        <strong>{block.merged ? t("growth.animation.otherBlock", { count: block.merged ?? 0 }) : block.name}</strong>
        <span className="growth-detail-share">{share.toFixed(1)}%</span>
      </div>
      {language ? (
        <div className="growth-detail-loc">{formatNumber(Math.round(block.value))} {t("growth.animation.codeLines")}</div>
      ) : null}
      {rows.length > 0 ? (
        <dl className="growth-detail-grid">
          {rows.map(([label, value]) => (
            <div key={label} className="growth-detail-row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

// The finale metric bar: files / code / comments / blanks / date span, one
// line sliding up at the bottom of the settled skyline.
function MetricBar({ scene, f }: { scene: GrowthScene; f: GrowthFrame }) {
  const { t } = useTranslation();
  const fin = scene.finale;
  const samples = scene.samples;
  const span = `${samples[0].date.slice(0, 4)}–${samples[samples.length - 1].date.slice(0, 4)}`;
  const items: Array<{ label: string; value: string; accent?: boolean }> = [
    { label: t("growth.animation.metricFiles"), value: formatCompactNumber(fin.metrics.files) },
    { label: t("growth.animation.metricCode"), value: formatCompactNumber(fin.metrics.code), accent: true },
    { label: t("growth.animation.metricComments"), value: formatCompactNumber(fin.metrics.comments) },
    { label: t("growth.animation.metricBlanks"), value: formatCompactNumber(fin.metrics.blanks) },
    { label: t("growth.animation.metricSpan"), value: span },
  ];
  return (
    <div
      className="growth-city-metrics"
      style={{ ...autoAlpha(f.metrics.alpha), transform: `translateY(${f.metrics.y}px)` }}
    >
      {items.map((item, i) => (
        <div
          key={item.label}
          className={item.accent ? "growth-city-metric accent" : "growth-city-metric"}
          style={{ ...autoAlpha(f.metrics.items[i].alpha), transform: `translateY(${f.metrics.items[i].y}px)` }}
        >
          <span className="lbl">{item.label}</span>
          <span className="val growth-num">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
