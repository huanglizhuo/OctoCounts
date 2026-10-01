// The growth-animation renderer. Renders THE SINGLE FRAME of the approved
// 10s four-act template (octocounts-growth-demo) at a given progress — a
// pure function of (scene, progress): no clocks, no state, no effect that
// touches the DOM by time. The Wave-2 player drives progress via rAF and
// the GIF exporter steps it frame by frame; both get pixel-identical
// frames because every value below derives from `progress` alone.
//
// Geometry: a fixed 1280x720 design canvas — the demo's 1920x1080 at
// exactly 2/3 scale — scaled into whatever width the wrapper measures,
// via the same ResizeObserver/CSS-var pattern as the share card
// (Share.tsx useElementScale). All inner layout is design px; provenance
// comments cite the demo values being ported. The ring keeps the demo's
// 1:1 dasharray math (r=180, stroke-width=62, C=2*pi*180 inside a 520
// viewBox) and is simply rendered at 2/3 size.
//
// Act map (screen seconds; timings come from scene.acts, values in
// comments are the demo beats this ports):
//   0.0-1.2  hook     terminal typing + repo title, counter boot ramp
//   1.2-8.5  data     counter follows the sample clock (dip segments hold
//                    then drop), 6-language race, dip beats (amber counter
//                    + annotation), date timeline strip, stars HUD
//   8.55-9.3 morph    race bars collapse to one stacked bar centered on
//                    the finale ring, then dissolve as the six ring arcs
//                    grow (staggered, JS first)
//   9.3-10   finale   stats card assembles around the ring; static 9.6+
import { useEffect, useRef } from "react";
import { formatCompactNumber, formatNumber } from "../reportUtils";
import type { GrowthScene } from "./types";

// ---------------------------------------------------------------------------
// Scale-to-container (pattern twin of Share.tsx useElementScale; written to
// a --growth-scale CSS var straight on the node so per-frame renders never
// re-run for resize ticks). The GIF exporter's hidden 640x360 clone gets
// scale 0.5 from the same mechanism.
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
// Pure math. Easings are the GSAP curves the demo used (power1=quad,
// power2=cubic, power3=quart).
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (x: number) => {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
};
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
const quartInOut = (x: number) => {
  const u = clamp(x, 0, 1);
  return u < 0.5 ? 8 * u * u * u * u : 1 - 8 * (1 - u) * (1 - u) * (1 - u) * (1 - u);
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
const daysSinceEpoch = (epoch: number, y: number) => (Date.UTC(y, 0, 1) - epoch) / DAY_MS;
const monthYear = (date: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(epochOf(date)),
  );

// ---------------------------------------------------------------------------
// Stage geometry (design px; demo 1920x1080 x 2/3). The finale column stack
// is exact arithmetic so the ring's absolute position matches the card
// layout by construction: 64 pad + 40 head + 13+2 rule + 23+54 summary +
// 29 gap = body top 225; body height = 720 - 64 - 225 = 431.
const STAGE_W = 1280;
const STAGE_H = 720;
const PAD = 64; // demo 96

// hero counter (top-left)
const KICKER_Y = 100; // demo y150
const HERO_TOP = 159; // demo y238; 117px/1 text band lands ~y140-295
const HERO_SIZE = 117; // demo 176px
const DIP_Y = 308; // demo y462, clear of the number's text band

// hook block (terminal + repo title)
const TERM_TOP = 307; // demo y460, below the booting counter's band
const TERM_W = 733; // demo 1100

// race zone (right)
const RACE_LEFT = 687; // demo x1030
const RACE_TITLE_Y = 173; // demo y260
const PLOT_TOP = 200; // demo y300
const ROW_H = 56; // demo 84
const NAME_W = 113; // demo 170
const TRACK_W = 353; // demo 530
const BAR_H = 29; // demo 44

// timeline strip (bottom)
const TL_TOP = 633; // demo y950
const TL_H = 5; // demo 8

// morph ring / finale donut — one absolutely-positioned box shared by both
// acts so the bar -> ring -> donut handoff is pixel-continuous.
const RING_BOX = 347; // demo 520 box rendered at 2/3; viewBox stays 520 (1:1 math)
const RING_R = 180;
const RING_SW = 62;
const RING_C = 2 * Math.PI * RING_R; // 1130.973
const FIN_COL_GAP = 37; // demo 56
const FIN_DONUT_W = (STAGE_W - 2 * PAD - FIN_COL_GAP) * 0.38; // 38fr of the body grid = 423.5
const FIN_BODY_TOP = 225;
const FIN_BODY_H = STAGE_H - PAD - FIN_BODY_TOP; // 431
const RING_LEFT = PAD + FIN_DONUT_W / 2 - RING_BOX / 2; // ~102.3
const RING_TOP = FIN_BODY_TOP + (FIN_BODY_H - RING_BOX) / 2; // 267
const RING_CX = RING_LEFT + RING_BOX / 2; // ~275.8 (demo center 413.7 x 2/3)
const RING_CY = RING_TOP + RING_BOX / 2; // 440.5 (demo 664.2 x 2/3)
const STACK_W = 392; // demo 588; widest bar that respects the donut-zone margins
const STACK_H = BAR_H; // demo: the collapse never changes bar height
const STACK_TOP = RING_CY - STACK_H / 2;
const STACK_X0 = RING_CX - STACK_W / 2;

// compact variant: the single full-width bar lives mid-stage
const COMPACT_BAR_Y = 430;

// demo constants that structure the choreography
const DIP_DROP = 0.225; // dip segments hold, then drop over the last 0.225s
const DIP_AMBER = 0.35; // counter stays amber this long after entering a dip

// ---------------------------------------------------------------------------
// deriveFrame(scene, t) — every animated number at screen second t. Pure:
// deterministic scene data + deterministic calendar math only.
function deriveFrame(scene: GrowthScene, t: number) {
  const acts = scene.acts;
  const samples = scene.samples;
  const n = samples.length;
  const lastIdx = n - 1;
  const isCompact = scene.variant === "compact";
  const dataStart = acts.data.startTime; // demo 1.2
  const dataEnd = acts.data.endTime; // demo 8.5
  const mStart = acts.morph.startTime; // demo 8.55
  const mEnd = acts.morph.endTime; // demo 9.3
  const fStart = acts.finale.startTime; // demo 9.3
  const staticFrom = acts.finale.staticFrom; // demo 9.6
  const collapseDur = 0.3; // demo 8.55-8.85 bars -> stacked bar
  const wrapStart = mStart + collapseDur; // demo 8.85: arcs start growing

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
  const langNow = (name: string) =>
    lerp(samples[i0].languageCode[name] ?? 0, samples[i1].languageCode[name] ?? 0, f);

  // -- date scaffolding (ticks, chip, dip labels, hook copy) --
  const epoch = epochOf(samples[0].date);
  const firstYear = dateAtDay(epoch, 0).getUTCFullYear();
  const lastYear = new Date(epochOf(samples[lastIdx].date)).getUTCFullYear();
  const years = Math.max(lastYear - firstYear, 1);
  const rangeLabel = `${firstYear} → ${lastYear}`;

  // -- ranks: order within the six race languages, interpolated with the
  // demo's smoothstep glide so rows swap places without a FLIP. --
  const order = acts.morph.stackOrder;
  const rankAt = (idx: number) => {
    const sorted = [...order].sort(
      (a, b) => (samples[idx].languageCode[b] ?? 0) - (samples[idx].languageCode[a] ?? 0) || order.indexOf(a) - order.indexOf(b),
    );
    const rank = new Map(sorted.map((name, pos) => [name, pos]));
    return order.map((name) => rank.get(name) ?? 0);
  };
  const ranks0 = rankAt(i0);
  const ranks1 = rankAt(i1);
  const rankNow = order.map((_, l) => lerp(ranks0[l], ranks1[l], smoothstep(f)));
  const finalRanks = rankAt(lastIdx);

  // -- race rows (value = interpolated languageCode; width = value / leader
  // at that time, per the growth-animation spec) --
  const valuesNow = order.map((name) => langNow(name));
  const maxCode = Math.max(...valuesNow, 0);
  const langColor = new Map(scene.languages.map((l) => [l.name, l.color]));
  const entersAt = new Map(scene.languages.map((l) => [l.name, l.entersAtSample]));
  const raceRows = order.map((name, l) => {
    const enterSample = entersAt.get(name) ?? 0;
    // sample-0 rows stagger by initial rank; later entrants appear AT their
    // entry sample's beat (demo: TS 2.7s, TSX 5.6s, Rust 7.0s)
    const enterT = enterSample <= 0 ? dataStart + ranks0[l] * 0.055 : timeOf(enterSample);
    const dur = enterSample <= 0 ? 0.275 : 0.25;
    const k = quartOut(w01(t, enterT, enterT + dur));
    const fromX = enterSample <= 0 ? -37 : -27; // demo -56 / -40
    const value = valuesNow[l];
    const sharePct = codeNow > 0 ? (value / codeNow) * 100 : 0;
    const widthPx = maxCode > 0 ? (value / maxCode) * TRACK_W : 0;
    // value label rides the bar end; flips INSIDE the leader bar when it
    // would overflow the track (demo: exact 0.6em char advance, no reads)
    const valText = `${formatNumber(Math.round(value))} · ${sharePct.toFixed(1)}%`;
    const valW = valText.length * (0.6 * 13);
    const valInside = widthPx + 8 + valW > TRACK_W - 4;
    const valX = valInside ? Math.max(widthPx - 8 - valW, 3) : widthPx + 8;
    return {
      name,
      color: langColor.get(name) ?? "var(--accent)",
      value,
      sharePct,
      widthPx,
      valText,
      valX,
      valInside,
      top: rankNow[l] * ROW_H,
      enterAlpha: k,
      enterX: fromX * (1 - k),
      // names/values dissolve at morph start, 0.12s staggered (demo 8.55)
      labelAlpha: 1 - w01(t, mStart + l * 0.03, mStart + l * 0.03 + 0.12),
      trackAlpha: 1 - w01(t, mStart, mStart + 0.2),
    };
  });

  // -- dips: amber window on the counter + annotation band under it --
  const dipBeats = scene.dips.map((d) => {
    const t0 = timeOf(d.sampleIndex);
    const kIn = w01(t, t0, t0 + 0.11);
    const kOut = w01(t, t0 + 0.25, t0 + 0.35);
    return {
      amber: t >= t0 && t < t0 + DIP_AMBER,
      alpha: kIn * (1 - kOut),
      y: 7 * (1 - quartOut(kIn)) - 4 * kOut, // demo y10 -> 0 -> y-6 (x 2/3)
      label: `↘ repo restructure · ${monthYear(samples[d.sampleIndex].date)}`,
    };
  });
  const amber = dipBeats.some((d) => d.amber);

  // -- hook: typewriter tables + word reveal, all anchored to dataStart --
  const prompt = acts.hook.prompt;
  const outText = `scanning ${years} years of commits · ${rangeLabel}`;
  const promptEnd = dataStart - 0.5; // demo 0.7 of 1.2
  const outputEnd = dataStart - 0.1; // demo 1.1
  const promptTable = buildTypeTable(prompt, 0, promptEnd);
  const outputTable = buildTypeTable(outText, promptEnd, outputEnd);
  // word reveal: owner/repo split with the slash as its own span (demo .rw)
  const words = scene.repoFullName
    .split("/")
    .flatMap((w, i) => (i > 0 ? [{ text: "/", own: false }, { text: w, own: true }] : [{ text: w, own: true }]))
    .map((word, i) => {
      const t0 = dataStart - 0.95 + i * 0.06; // demo 0.25 + i*0.06
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
    kickerAlpha: w01(t, dataStart - 0.675, dataStart - 0.425), // demo 0.525-0.775
    // the whole block settles DOWN and away (never up into the counter band)
    exitAlpha: 1 - w01(t, dataStart, dataStart + 0.15),
    exitY: 9 * cubicIn(w01(t, dataStart, dataStart + 0.15)),
    exitScale: 1 - 0.03 * cubicIn(w01(t, dataStart, dataStart + 0.15)),
    titleText: `${years} years of code — ${rangeLabel}`,
  };

  // -- hero counter: boot ramp 0 -> first sample over the hook (demo
  // power3.out, scale 0.55 -> 1, same ease so the growth is the value),
  // then the sample clock; one restrained pulse at the final lock. --
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

  // -- timeline strip: playhead is dayOffset progress; ticks + dip carets --
  const tlFrac = clamp(dayNow / totalDays, 0, 1);
  const ticks: Array<{ label: string; left: number; alpha: number }> = [];
  for (let y = firstYear; y <= lastYear; y += 1) {
    const dayY = daysSinceEpoch(epoch, y);
    // A year whose Jan 1 predates the first sample has no spot on the axis —
    // pinning it to the left edge collides with the next year's centered
    // label (e.g. an Aug-2014 start stacked "2014" onto "2015").
    if (dayY < 0) continue;
    const x = (dayY / totalDays) * (STAGE_W - 2 * PAD);
    ticks.push({
      label: String(y),
      left: x,
      alpha: w01(t, dataStart + 0.1 + ticks.length * 0.015, dataStart + 0.25 + ticks.length * 0.015),
    });
  }
  const tl = {
    wipe: quartOut(w01(t, dataStart, dataStart + 0.25)),
    frac: tlFrac,
    date: isoDate(epoch, dayNow),
    playheadAlpha: w01(t, dataStart + 0.175, dataStart + 0.325),
    chipAlpha: w01(t, dataStart + 0.2, dataStart + 0.35),
    exitAlpha: 1 - w01(t, fStart - 0.05, fStart + 0.1),
    carets: scene.dips.map((d) => ({
      left: (samples[d.sampleIndex].dayOffset / totalDays) * (STAGE_W - 2 * PAD),
      alpha: w01(t, dataStart + 0.175, dataStart + 0.3),
    })),
  };

  // -- morph: bars FLIP-free interpolate from their final race geometry to
  // the stacked bar centered on the ring (demo 8.55-8.85 power3.inOut),
  // then dissolve while the arcs grow (8.85-9.3, JS first). --
  const finalMax = Math.max(...order.map((name) => samples[lastIdx].languageCode[name] ?? 0), 0);
  const morphSegs = acts.morph.ringShares.map((share, k) => {
    const frac = share.share / 100;
    // source geometry at morph start: the locked race bar (or, in compact,
    // the single full-width bar); absolute stage coords in both cases
    const from = isCompact
      ? { left: PAD, top: COMPACT_BAR_Y, width: STAGE_W - 2 * PAD }
      : {
          left: RACE_LEFT + NAME_W,
          top: PLOT_TOP + finalRanks[k] * ROW_H + (ROW_H - BAR_H) / 2,
          width: finalMax > 0 ? ((samples[lastIdx].languageCode[share.name] ?? 0) / finalMax) * TRACK_W : 0,
        };
    const stackAcc = acts.morph.ringShares.slice(0, k).reduce((acc, s) => acc + (s.share / 100) * STACK_W, 0);
    const u = quartInOut(w01(t, mStart, wrapStart));
    return {
      color: share.color,
      left: lerp(from.left, STACK_X0 + stackAcc, u),
      top: lerp(from.top, STACK_TOP, u),
      width: lerp(from.width, frac * STACK_W, u),
      alpha: 1 - w01(t, wrapStart, wrapStart + 0.15),
    };
  });

  // arc growth windows: quad-eased starts across [wrapStart, mEnd-0.04]
  // with shrinking durations — reproduces the demo's JS-first stagger
  // (8.85/.2, 9.0/.15, 9.1/.12, 9.2/.1, 9.23/.07, 9.26/.04).
  const arcCount = acts.morph.ringShares.length;
  const arcs = acts.morph.ringShares.map((share, k) => {
    const uk = arcCount > 1 ? k / (arcCount - 1) : 0;
    let start = wrapStart + (mEnd - 0.04 - wrapStart) * (1 - (1 - uk) * (1 - uk));
    let dur = 0.2 * (1 - 0.8 * uk);
    dur = Math.min(dur, Math.max(mEnd - start, 0.02));
    if (k === arcCount - 1) start = Math.min(start, mEnd - dur);
    const growth = cubicInOut(w01(t, start, start + dur));
    const acc = acts.morph.ringShares.slice(0, k).reduce((a, s) => a + s.share, 0) / 100;
    return {
      color: share.color,
      dash: (share.share / 100) * RING_C * growth,
      rotate: -90 + 360 * acc,
    };
  });

  // -- stars HUD: fades in at the first sample that carries stars (demo
  // 7.75s), value interpolates across the starred samples to starsNow. --
  let stars: { alpha: number; value: number; brackets: [number, number] } | null = null;
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
    stars = {
      alpha: w01(t, tIn, tIn + 0.15),
      value,
      // corner brackets draw on 0.025s after the fade-in, 0.04s apart
      brackets: [0, 1].map((k) => cubicInOut(w01(t, tIn + 0.025 + k * 0.04, tIn + 0.225 + k * 0.04))) as [number, number],
    };
  }

  // -- finale cascade: furniture rises y+11->0 power2.out (head 9.3, rule
  // 9.35, summary 9.4, donut readout 9.35); table rows (thead + rows +
  // TOTAL) cascade from 9.35, stagger derived so all settle by staticFrom. --
  const rise = (t0: number, dur = 0.2) => {
    const k = cubicOut(w01(t, t0, t0 + dur));
    return { alpha: k, y: 11 * (1 - k) };
  };
  const rowsCount = scene.finale.tableRows.length + 2; // + thead + TOTAL
  const rowStagger = Math.min(0.02, Math.max((staticFrom - 0.1 - (fStart + 0.05)) / Math.max(rowsCount - 1, 1), 0.005));
  const finale = {
    head: rise(fStart),
    rule: rise(fStart + 0.05),
    summary: rise(fStart + 0.1),
    centerAlpha: w01(t, fStart + 0.05, fStart + 0.2),
    caption: { ...rise(fStart + 0.05, 0.1), y: 5 * (1 - cubicOut(w01(t, fStart + 0.05, fStart + 0.15))) },
    rows: Array.from({ length: rowsCount }, (_, k) => {
      const t0 = fStart + 0.05 + k * rowStagger;
      const kk = cubicOut(w01(t, t0, t0 + 0.1));
      return { alpha: kk, y: 5 * (1 - kk) };
    }),
  };

  const firstCode = samples[0].code;
  const lastCode = samples[lastIdx].code;
  return {
    isCompact,
    t,
    dataStart,
    mStart,
    raceRows,
    hero,
    hook,
    words,
    dipBeats,
    stars,
    tl,
    ticks,
    morphSegs,
    arcs,
    finale,
    ringVisible: t >= wrapStart,
    // data-layer exits (hero + timeline 9.25, stars 9.3 — demo card handoff)
    heroExit: 1 - w01(t, fStart - 0.05, fStart + 0.1),
    starsExit: 1 - w01(t, fStart, fStart + 0.15),
    raceTitleAlpha: quartOut(w01(t, dataStart, dataStart + 0.25)) * (1 - w01(t, mStart, mStart + 0.15)),
    raceTitleX: -16 * (1 - quartOut(w01(t, dataStart, dataStart + 0.25))),
    ariaLabel: `Growth animation: ${scene.repoFullName} code lines ${formatNumber(firstCode)}→${formatNumber(lastCode)}, ${years} years`,
    summary: `${scene.repoFullName} grew from ${formatNumber(firstCode)} code lines on ${samples[0].date} to ${formatNumber(lastCode)} code lines on ${samples[lastIdx].date}.`,
  };
}

export type GrowthFrame = ReturnType<typeof deriveFrame>;

// ---------------------------------------------------------------------------
// Component: one pure render of the frame at `progress`. `playing` only
// suppresses the pause affordance — the player (Wave 2) owns all timing.
export function GrowthAnimation({
  scene,
  progress,
  playing,
}: {
  scene: GrowthScene;
  progress: number;
  playing?: boolean;
}) {
  const wrapRef = useGrowthScale(STAGE_W);
  const seconds = clamp(progress, 0, 1) * (scene.durationMs / 1000);
  const f = deriveFrame(scene, seconds);
  return (
    <div className="growth-wrap" ref={wrapRef}>
      <p className="visually-hidden">{f.summary}</p>
      <div className="growth-stage" role="img" aria-label={f.ariaLabel}>
        <DataAct scene={scene} f={f} />
        <FinaleCard scene={scene} f={f} />
        <RingLayer scene={scene} f={f} />
        <MorphLayer f={f} />
        <HookAct f={f} />
        {playing === false ? (
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

// Act 2 — data: hero counter + dip annotations (left), language race
// (right), timeline strip (bottom), stars HUD (top-right).
function DataAct({ scene, f }: { scene: GrowthScene; f: GrowthFrame }) {
  const tlW = STAGE_W - 2 * PAD;
  const px = f.tl.frac * tlW;
  const chipMax = STAGE_W - PAD - 100 - (PAD - 50);
  const barsOwnedByMorph = f.t >= f.mStart;
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
              {d.label}
            </span>
          ))}
        </div>
      </div>

      {/* language race */}
      {!f.isCompact && (
        <div className="growth-race-zone">
          <div
            className="growth-race-title"
            style={{ ...autoAlpha(f.raceTitleAlpha), transform: `translateX(${f.raceTitleX}px)` }}
          >
            CODE LINES BY LANGUAGE
          </div>
          <div className="growth-race-plot">
            {f.raceRows.map((row) => (
              <div
                key={row.name}
                className="growth-race-row"
                style={{ top: row.top, ...autoAlpha(row.enterAlpha), transform: `translateX(${row.enterX}px)` }}
              >
                <span className="growth-race-name" style={autoAlpha(row.labelAlpha)}>
                  {row.name}
                </span>
                <span className="growth-race-track" style={autoAlpha(row.trackAlpha)}>
                  <span
                    className="growth-race-bar"
                    style={{
                      width: Math.max(row.widthPx, 0),
                      background: row.color,
                      ...(barsOwnedByMorph ? autoAlpha(0) : autoAlpha(1)),
                    }}
                  />
                  <span
                    className="growth-race-val growth-num"
                    style={{
                      transform: `translate(${row.valX}px, -50%)`,
                      color: row.valInside ? "#0d1117" : undefined,
                      ...autoAlpha(row.labelAlpha),
                    }}
                  >
                    {row.valText}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* compact variant: one full-width bar instead of the race */}
      {f.isCompact && (
        <div
          className="growth-compact-bar"
          style={{
            background: scene.acts.morph.ringShares[0]?.color ?? "var(--accent)",
            ...autoAlpha(quartOut(w01(f.t, f.dataStart, f.dataStart + 0.25)) * (barsOwnedByMorph ? 0 : 1)),
          }}
        />
      )}

      {/* timeline strip */}
      {!f.isCompact && (
        <div className="growth-tl-zone" style={autoAlpha(f.tl.exitAlpha)}>
          <div className="growth-tl-track" style={{ transform: `scaleX(${f.tl.wipe})` }} />
          <div className="growth-tl-fill" style={{ width: `${f.tl.frac * 100}%` }} />
          <div className="growth-tl-playhead" style={{ left: PAD + px - 1, ...autoAlpha(f.tl.playheadAlpha) }} />
          <div className="growth-tl-chip growth-num" style={{ transform: `translateX(${Math.min(px, chipMax)}px)`, ...autoAlpha(f.tl.chipAlpha) }}>
            {f.tl.date}
          </div>
          {f.ticks.map((tick) => (
            <span
              key={tick.label}
              className="growth-tl-tick"
              style={{
                left: PAD + tick.left,
                transform: "translateX(-50%)",
                ...autoAlpha(tick.alpha),
              }}
            >
              {tick.label}
            </span>
          ))}
          {f.tl.carets.map((c, i) => (
            <span key={i} className="growth-tl-caret" style={{ left: PAD + c.left, ...autoAlpha(c.alpha) }} />
          ))}
        </div>
      )}

      {/* stars HUD */}
      {f.stars && (
        <div className="growth-stars" style={autoAlpha(f.stars.alpha * f.starsExit)}>
          <svg className="growth-star-bracket growth-sb-tl" viewBox="0 0 32 32" aria-hidden="true">
            <path
              d="M 30 2 L 12 2 Q 2 2 2 12 L 2 30"
              pathLength={100}
              strokeDasharray={100}
              strokeDashoffset={100 * (1 - f.stars.brackets[0])}
            />
          </svg>
          <svg className="growth-star-bracket growth-sb-br" viewBox="0 0 32 32" aria-hidden="true">
            <path
              d="M 2 30 L 20 30 Q 30 30 30 20 L 30 2"
              pathLength={100}
              strokeDasharray={100}
              strokeDashoffset={100 * (1 - f.stars.brackets[1])}
            />
          </svg>
          <span className="growth-star-glyph">★</span>
          <span className="growth-star-label">STARS</span>
          <span className="growth-star-value growth-num">{formatNumber(Math.round(f.stars.value))}</span>
        </div>
      )}
    </div>
  );
}

// Act 3 — the collapse: bars interpolate from their locked race geometry to
// the stacked bar centered on the ring, then dissolve into the arcs.
function MorphLayer({ f }: { f: GrowthFrame }) {
  return (
    <div className="growth-layer">
      {f.morphSegs.map((seg, k) => (
        <div
          key={k}
          className="growth-stack-seg"
          style={{
            left: seg.left,
            top: seg.top,
            width: Math.max(seg.width, 0),
            background: seg.color,
            ...autoAlpha(seg.alpha),
          }}
        />
      ))}
    </div>
  );
}

// The ring — stage-level and never moving, so the morph handoff and the
// finale donut are pixel-continuous by construction. The center readout is
// the finale's donut center.
function RingLayer({ scene, f }: { scene: GrowthScene; f: GrowthFrame }) {
  return (
    <>
      <svg
        className="growth-ring"
        width={RING_BOX}
        height={RING_BOX}
        viewBox="0 0 520 520"
        style={{ left: RING_LEFT, top: RING_TOP, ...autoAlpha(f.ringVisible ? 1 : 0) }}
        aria-hidden="true"
      >
        {f.arcs.map((arc, k) => (
          <circle
            key={k}
            cx={260}
            cy={260}
            r={RING_R}
            fill="none"
            stroke={arc.color}
            strokeWidth={RING_SW}
            strokeDasharray={`${arc.dash.toFixed(2)} ${RING_C.toFixed(2)}`}
            transform={`rotate(${arc.rotate.toFixed(3)} 260 260)`}
          />
        ))}
      </svg>
      <div className="growth-ring-center" style={{ left: RING_CX, top: RING_CY, ...autoAlpha(f.finale.centerAlpha) }}>
        <span className="lbl">code</span>
        <strong className="growth-num">{formatCompactNumber(scene.finale.metrics.code)}</strong>
      </div>
    </>
  );
}

// Act 4 — the report-stats finale assembling around the ring: header with
// meta + accent rule, compact metrics row, and the top-N table cascading in
// row by row until staticFrom.
function FinaleCard({ scene, f }: { scene: GrowthScene; f: GrowthFrame }) {
  const fin = scene.finale;
  const rowStyle = (k: number) => ({
    ...autoAlpha(f.finale.rows[k].alpha),
    transform: `translateY(${f.finale.rows[k].y}px)`,
  });
  const metric = (label: string, value: number, accent = false) => (
    <div className={accent ? "growth-fin-metric accent" : "growth-fin-metric"} key={label}>
      <span className="lbl">{label}</span>
      <span className="val growth-num">{formatCompactNumber(value)}</span>
    </div>
  );
  const cell = (value: number, cls?: string) => (
    <span className={cls ? `growth-fin-td growth-num ${cls}` : "growth-fin-td growth-num"}>{formatNumber(value)}</span>
  );
  return (
    <div className="growth-fin-card">
      <div
        className="growth-fin-head"
        style={{ ...autoAlpha(f.finale.head.alpha), transform: `translateY(${f.finale.head.y}px)` }}
      >
        <h2 className="growth-fin-repo">{scene.repoFullName}</h2>
        <span className="growth-fin-meta growth-num">
          {fin.refName} · {fin.commitSha12} · {fin.generatedDate}
        </span>
      </div>
      <div
        className="growth-fin-rule"
        style={{ ...autoAlpha(f.finale.rule.alpha), transform: `translateY(${f.finale.rule.y}px)` }}
      />
      <div
        className="growth-fin-summary"
        style={{ ...autoAlpha(f.finale.summary.alpha), transform: `translateY(${f.finale.summary.y}px)` }}
      >
        {metric("Code", fin.metrics.code, true)}
        {metric("Files", fin.metrics.files)}
        {metric("Lines", fin.metrics.lines)}
        {metric("Comments", fin.metrics.comments)}
        {metric("Blanks", fin.metrics.blanks)}
      </div>
      <div className="growth-fin-body">
        {/* the donut column is reserved space — the ring itself is a
            stage-level element at the exact same coordinates (RingLayer) */}
        <div className="growth-fin-donut-col" />
        <div className="growth-fin-table-col">
          <div
            className="growth-fin-caption"
            style={{ ...autoAlpha(f.finale.caption.alpha), transform: `translateY(${f.finale.caption.y}px)` }}
          >
            {fin.tableCaption}
          </div>
          <div className="growth-fin-tr growth-fin-thead" style={rowStyle(0)}>
            <span className="growth-fin-th lang">Language</span>
            <span className="growth-fin-th">Files</span>
            <span className="growth-fin-th">Lines</span>
            <span className="growth-fin-th">Code</span>
            <span className="growth-fin-th">Comments</span>
            <span className="growth-fin-th">Blanks</span>
          </div>
          {fin.tableRows.map((r, k) => (
            <div className={r.merged ? "growth-fin-tr other" : "growth-fin-tr"} key={r.name} style={rowStyle(k + 1)}>
              <span className="growth-fin-lang">
                <span className="growth-fin-swatch" style={{ background: r.color }} />
                {r.name}
              </span>
              {cell(r.files)}
              {cell(r.lines)}
              {cell(r.code, "code")}
              {cell(r.comments)}
              {cell(r.blanks)}
            </div>
          ))}
          <div className="growth-fin-tr total" style={rowStyle(fin.tableRows.length + 1)}>
            <span className="growth-fin-lang">TOTAL</span>
            {cell(fin.totalRow.files)}
            {cell(fin.totalRow.lines)}
            {cell(fin.totalRow.code, "code")}
            {cell(fin.totalRow.comments)}
            {cell(fin.totalRow.blanks)}
          </div>
        </div>
      </div>
    </div>
  );
}
