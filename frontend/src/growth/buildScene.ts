// buildScene(): Report + RepoHistory → GrowthScene. Pure and deterministic —
// no clocks, randomness, or network — so the in-page player and the GIF
// exporter step the exact same scene frame by frame (plan §2). Every rule
// below resolves data ONCE here: the renderer only interpolates.
//
// Data honesty (types.ts): SLOC samples, dips, stars and the finale stats are
// real API data. Historical per-language splits are MODELED by scaling each
// language's current share against every sample's real code total — v1 until
// the backend samples per-language history.
//
// v1.1 (code city): each sample additionally carries a squarified-treemap
// ground layout (footprint area ∝ code) and per-building heights in design
// px, plus per-face colors derived from the injected language palette — the
// renderer never runs color or layout math.
import type {
  GrowthCityBlock,
  GrowthDip,
  GrowthLanguage,
  GrowthSample,
  GrowthScene,
  GrowthTableRow,
  GrowthSceneInput,
} from "./types";
import type { Stats } from "../types";
import { languageLogo } from "./languageLogos";

// Fixed template beat sheet — plan §4. v1.1: the morph act is gone; the
// finale (rooftop labels + metric bar) starts right where the data act locks.
// The acts are fractions of the template length so a ?gdur= override stretches
// the whole choreography instead of padding a frozen finale: with the default
// 5s the boundaries land at (0.6 / 4.25 / 4.8).
const DEFAULT_DURATION_MS = 5000;
const HOOK_END_FRAC = 0.12;
const DATA_END_FRAC = 0.85;
const STATIC_FRAC = 0.96;
// Sane bounds for the ?gdur= URL override (seconds).
const MIN_DURATION_MS = 5000;
const MAX_DURATION_MS = 30000;

// A drop between adjacent samples counts as a dip only above this ratio
// (toValue < fromValue × 0.7 means more than 30% of the code vanished —
// typically a mass refactor or a relicense-era pruning).
const DIP_RATIO = 0.7;
// The finale table mirrors the report page's demo truncation semantics
// (DEMO_LANGUAGE_LIMIT in Charts.tsx): top N by code, tail merged into Other.
const TABLE_LIMIT = 10;
// The city caps its skyline at this many buildings; the tail merges into one
// gray "Other (N more)" block (same semantics as TABLE_LIMIT's Other row).
const CITY_LIMIT = 8;
// The ground plane is a normalized 100×100 grid; the renderer projects it
// isometrically. Building heights are design px on the 1280×720 stage.
const GROUND_SIZE = 100;
// The tallest building across the whole series tops out here (design px on
// the 1280×720 stage), so heights stay comparable frame to frame.
export const MAX_BUILDING_H = 180;
// Neutral GitHub-gray fallback for languages missing a resolved color, and
// for merged Other blocks (which are not a language at all).
const FALLBACK_COLOR = "#57606a";

// Face shading: roof lightened, right face darkened, left face is the
// language color verbatim. Derived here so the GIF palette is a function of
// the scene alone (the renderer does no color math).
const TOP_FACTOR = 1.28;
const RIGHT_FACTOR = 0.66;

export function buildScene(input: GrowthSceneInput): GrowthScene {
  const { report, history, languageColors } = input;

  const owner = report.repository.owner;
  const repo = report.repository.name;
  const prompt = `octocounts ${owner}/${repo}`;

  // URL-overridable template config (?gdur= seconds, ?glang= buildings): the
  // defaults reproduce the shipped 5s / 8-building template exactly.
  const clampInt = (value: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, value)));
  const durationMs = input.overrides?.durationMs
    ? clampInt(input.overrides.durationMs, MIN_DURATION_MS, MAX_DURATION_MS)
    : DEFAULT_DURATION_MS;
  const cityLimit = input.overrides?.cityLimit ? clampInt(input.overrides.cityLimit, 4, 16) : CITY_LIMIT;
  const seconds = durationMs / 1000;
  // Round the scaled boundaries: fractions like 0.12×15 leave float dust that
  // would leak into every w01 division downstream.
  const at = (frac: number) => Math.round(frac * seconds * 1e6) / 1e6;
  const dataAct = {
    startTime: at(HOOK_END_FRAC),
    endTime: at(DATA_END_FRAC),
    finalLock: at(DATA_END_FRAC),
  };
  const finaleAct = {
    startTime: at(DATA_END_FRAC),
    endTime: seconds,
    staticFrom: at(STATIC_FRAC),
  };

  // --- Languages -----------------------------------------------------------
  // Zero-current-code languages (e.g. a Markdown-only docs dir) never rise:
  // their lines surface only in the finale's merged Other row, so they are
  // excluded from the tracks AND from the per-sample model below.
  const totalCode = report.total.code;
  const sortedByCode = [...report.languages].sort((a, b) => b.stats.code - a.stats.code);
  const languages: GrowthLanguage[] = sortedByCode
    .filter((language) => language.stats.code > 0)
    .map((language) => {
      const color = languageColors[language.name] ?? FALLBACK_COLOR;
      return {
        name: language.name,
        color,
        ...deriveFaceColors(color),
        currentCode: language.stats.code,
        // Real share of the latest commit's code; the model below
        // renormalizes against each sample so float drift never accumulates.
        currentShare: totalCode > 0 ? (language.stats.code / totalCode) * 100 : 0,
        // The per-sample series is filled once `samples` exist below.
        shares: [],
        stats: { ...language.stats },
      };
    });
  const leadingLanguage = languages.length > 0 ? languages[0].name : "";

  // --- Samples ---------------------------------------------------------------
  // Guard against unsorted input: the player maps elapsed time onto samples
  // by index, so the series must be date-ascending before anything else.
  const slocPoints = [...history.slocPoints].sort((a, b) => utcDay(a.date) - utcDay(b.date));
  const starPoints = [...history.starPoints].sort((a, b) => utcDay(a.date) - utcDay(b.date));
  const firstDay = slocPoints.length > 0 ? utcDay(slocPoints[0].date) : 0;

  const samples: GrowthSample[] = slocPoints.map((point) => {
    // Last star observation at or before this sample ("stars entered the
    // timeline late" is real: starPoints usually start after the first code).
    let stars: number | null = null;
    for (const star of starPoints) {
      if (utcDay(star.date) <= utcDay(point.date)) stars = star.stars;
      else break;
    }
    // Samples written after the per-language backfill carry the real split;
    // older rows fall back to the modeled share. realLanguageCode returns
    // null when the payload has nothing usable (e.g. every language in it
    // vanished from the current report).
    const real = point.languages ? realLanguageCode(languages, point.languages, point.totalLines) : null;
    return {
      date: point.date,
      dayOffset: utcDay(point.date) - firstDay,
      code: point.totalLines,
      stars,
      languageCode: real ?? modelLanguageCode(languages, point.totalLines),
      realSplit: real !== null,
      city: [], // laid out below, once the global height scale is known
    };
  });

  // --- City layouts -----------------------------------------------------------
  // Heights are anchored to the tallest block across the WHOLE series (a
  // merged Other block can out-tower any single language), so a building's
  // height is comparable frame to frame and dips visibly sink the skyline.
  const cityValues = samples.map((sample) => cityEntries(languages, sample.languageCode));
  const peak = cityValues.reduce((max, entries) => Math.max(max, ...entries.map((entry) => entry.value), 0), 0);
  const heightScale = peak > 0 ? MAX_BUILDING_H / peak : 0;
  samples.forEach((sample, i) => {
    sample.city = layoutCity(cityValues[i], heightScale, cityLimit);
  });

  // --- Per-language share series ----------------------------------------------
  // One share per sample (percent, 6dp so float drift never accumulates),
  // derived from the modeled split already baked into each sample. A zero-
  // total sample carries a 0 share.
  for (const language of languages) {
    language.shares = samples.map((sample) =>
      sample.code > 0 ? round6(((sample.languageCode[language.name] ?? 0) / sample.code) * 100) : 0,
    );
  }

  // --- Dips ------------------------------------------------------------------
  const dips: GrowthDip[] = [];
  for (let i = 1; i < samples.length; i++) {
    const fromValue = samples[i - 1].code;
    const toValue = samples[i].code;
    if (toValue < fromValue * DIP_RATIO) {
      dips.push({ sampleIndex: i, fromValue, toValue });
    }
  }

  // --- Finale stats payload ----------------------------------------------------
  const shownRows = sortedByCode.slice(0, TABLE_LIMIT);
  const tailRows = sortedByCode.slice(TABLE_LIMIT);
  const tableRows: GrowthTableRow[] = shownRows.map((language) => ({
    name: language.name,
    color: languageColors[language.name] ?? FALLBACK_COLOR,
    ...language.stats,
  }));
  if (report.languages.length > TABLE_LIMIT) {
    tableRows.push({
      name: `Other (${tailRows.length} more)`,
      color: FALLBACK_COLOR,
      ...sumStats(tailRows.map((language) => language.stats)),
      merged: true,
    });
  }

  return {
    repoFullName: `${owner}/${repo}`,
    provider: history.provider,
    durationMs,
    // <3 samples cannot pace a growth act; the renderer rises straight to the
    // final skyline on the same beat sheet (plan §10).
    variant: samples.length < 3 ? "compact" : "full",
    languages,
    languageDetails: Object.fromEntries(report.languages.map((language) => [language.name, { ...language.stats }])),
    samples,
    dips,
    starsNow: history.currentStars,
    leadingLanguage,
    modeledLanguageSplit: languages.length > 1,
    realLanguageSplit: samples.length > 0 && samples.every((sample) => sample.realSplit === true),
    finaleDiverged:
      samples.length > 0 && samples[samples.length - 1].code > 0
        ? Math.abs(report.total.code - samples[samples.length - 1].code) / samples[samples.length - 1].code > 0.05
        : false,
    finale: {
      refName: report.refName,
      commitSha12: report.commitSha.slice(0, 12),
      // ISO-8601 timestamps lead with the full date, so the prefix IS the date
      // — and slicing keeps it deterministic (no timezone reinterpretation).
      generatedDate: report.generatedAt.slice(0, 10),
      metrics: { ...report.total },
      tableCaption: `top ${Math.min(TABLE_LIMIT, report.languages.length)} of ${report.languages.length} languages`,
      tableRows,
      // Always the FULL report's totals, never the top-N sum, so the closing
      // metrics keep reporting the real repository (Charts.tsx semantics).
      totalRow: { ...report.total },
    },
    acts: {
      hook: { prompt },
      data: dataAct,
      finale: finaleAct,
    },
  };
}

// ---------------------------------------------------------------------------
// City layout. Two exported helpers so fixture.ts builds scenes through the
// exact same geometry the product uses (no duplicated treemap to drift).

// The shading trio for one base color: the roof is lightened, the right face
// darkened, the left face is the base verbatim. Non-hex input (defensive —
// callers inject resolved hex) falls back to the base on all faces.
export function deriveFaceColors(color: string): { colorTop: string; colorRight: string } {
  const rgb = /^#([0-9a-f]{6})$/i.exec(color);
  if (!rgb) return { colorTop: color, colorRight: color };
  const channels = [0, 2, 4].map((i) => parseInt(rgb[1].slice(i, i + 2), 16));
  const scale = (factor: number) =>
    `#${channels.map((c) => Math.round(Math.min(255, c * factor)).toString(16).padStart(2, "0")).join("")}`;
  return { colorTop: scale(TOP_FACTOR), colorRight: scale(RIGHT_FACTOR) };
}

// One block per language with code > 0, tail merged into "Other (N more)"
// past CITY_LIMIT, then squarified over the 100×100 ground with footprints
// ∝ value and heights = value × heightScale (design px).
export function layoutCity(
  entries: Array<{ name: string; value: number; color: string }>,
  heightScale: number,
  limit: number = CITY_LIMIT,
): GrowthCityBlock[] {
  const positive = entries.filter((entry) => entry.value > 0);
  const tail = positive.slice(limit - 1);
  const blocks = (
    positive.length > limit
      ? [
          ...positive.slice(0, limit - 1),
          {
            name: `Other (${tail.length} more)`,
            value: tail.reduce((sum, entry) => sum + entry.value, 0),
            color: FALLBACK_COLOR,
            merged: tail.length,
          },
        ]
      : positive
  ).sort((a, b) => b.value - a.value); // squarify wants desc; Other ranks by its merged sum
  const rects = squarify(blocks.map((block) => block.value));
  return blocks.map((block, i) => {
    const faces = deriveFaceColors(block.color);
    const logo = languageLogo(block.name, faces.colorTop);
    return {
      name: block.name,
      value: block.value,
      rect: rects[i],
      height: block.value * heightScale,
      color: block.color,
      ...faces,
      ...(logo ? { logo } : {}),
      ...("merged" in block ? { merged: block.merged } : {}),
    };
  });
}

// The per-sample block list before layout: every modeled language with code,
// sorted desc (the city's visual hierarchy and the renderer's entrance
// stagger both follow this order).
function cityEntries(
  languages: GrowthLanguage[],
  languageCode: Record<string, number>,
): Array<{ name: string; value: number; color: string }> {
  return languages
    .map((language) => ({
      name: language.name,
      value: languageCode[language.name] ?? 0,
      color: language.color,
    }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
}

// Squarified treemap (Bruls–Huizing–van Wijk) over the GROUND_SIZE² plane:
// values are scaled to the plane area, packed into rows along the current
// rect's short side, and a row closes when adding the next item would worsen
// its worst aspect ratio. Output rects stay in input order, tile the plane
// exactly (float dust clamped back into bounds), and never overlap.
function squarify(values: number[]): Array<{ x: number; y: number; w: number; h: number }> {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || values.length === 0) return [];
  const areas = values.map((value) => (value / total) * GROUND_SIZE * GROUND_SIZE);
  const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  let x = 0;
  let y = 0;
  let w = GROUND_SIZE;
  let h = GROUND_SIZE;
  let row: number[] = [];

  // Worst (least square) aspect ratio a row would produce along `side`.
  const worst = (indices: number[], side: number) => {
    const sum = indices.reduce((acc, i) => acc + areas[i], 0);
    const max = Math.max(...indices.map((i) => areas[i]));
    const min = Math.min(...indices.map((i) => areas[i]));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  const layoutRow = () => {
    const rowArea = row.reduce((sum, i) => sum + areas[i], 0);
    if (w >= h) {
      // vertical strip on the left of the remaining rect
      const stripW = rowArea / h;
      let cy = y;
      for (const i of row) {
        const ih = areas[i] / stripW;
        rects[i] = { x, y: cy, w: stripW, h: ih };
        cy += ih;
      }
      x += stripW;
      w -= stripW;
    } else {
      // horizontal strip across the top
      const stripH = rowArea / w;
      let cx = x;
      for (const i of row) {
        const iw = areas[i] / stripH;
        rects[i] = { x: cx, y, w: iw, h: stripH };
        cx += iw;
      }
      y += stripH;
      h -= stripH;
    }
    row = [];
  };

  for (let i = 0; i < areas.length; i += 1) {
    const side = Math.min(w, h);
    if (row.length > 0 && worst([...row, i], side) > worst(row, side)) layoutRow();
    row.push(i);
  }
  if (row.length > 0) layoutRow();

  // Clamp float dust so every rect sits exactly inside the plane.
  return rects.map((rect) => {
    const cx = clamp(rect.x, 0, GROUND_SIZE);
    const cy = clamp(rect.y, 0, GROUND_SIZE);
    return {
      x: cx,
      y: cy,
      w: clamp(rect.w, 0, GROUND_SIZE - cx),
      h: clamp(rect.h, 0, GROUND_SIZE - cy),
    };
  });
}

// Real per-language code from a historical sample: keep only languages that
// still exist in the current report (others are dropped), then renormalize to
// the sample total via largest-remainder. Returns null when nothing survives
// so the caller falls back to the modeled split.
function realLanguageCode(
  languages: GrowthLanguage[],
  sampleLanguages: Record<string, number>,
  sampleCode: number,
): Record<string, number> | null {
  const raw: number[] = [];
  const names: string[] = [];
  for (const language of languages) {
    const value = sampleLanguages[language.name] ?? 0;
    if (value > 0) {
      raw.push(value);
      names.push(language.name);
    }
  }
  if (raw.length === 0) return null;
  const rounded = largestRemainder(raw, sampleCode);
  const out: Record<string, number> = {};
  names.forEach((name, i) => {
    out[name] = rounded[i];
  });
  return out;
}

// Modeled per-language code at one sample: current share × the sample's real
// code total, then largest-remainder rounded so the tracks sum to the sample
// exactly — the counter and the skyline can never disagree by a line.
function modelLanguageCode(languages: GrowthLanguage[], sampleCode: number): Record<string, number> {
  const raw = languages.map((language) => (language.currentShare / 100) * sampleCode);
  const rounded = largestRemainder(raw, sampleCode);
  const out: Record<string, number> = {};
  languages.forEach((language, i) => {
    out[language.name] = rounded[i];
  });
  return out;
}

// Largest-remainder rounding: floor everything, then hand the leftover units
// to the largest fractional parts (ties: larger raw value, then input order)
// so the result sums to `total` exactly. Handles the float-drift case where
// the floors overshoot by reclaiming from the smallest fractions.
function largestRemainder(raw: number[], total: number): number[] {
  const out = raw.map((value) => Math.floor(value));
  const byFractionDesc = raw
    .map((value, i) => ({ i, fraction: value - Math.floor(value), value }))
    .sort((a, b) => b.fraction - a.fraction || b.value - a.value || a.i - b.i);
  let remaining = total - out.reduce((sum, value) => sum + value, 0);
  let index = 0;
  while (remaining > 0) {
    out[byFractionDesc[index % byFractionDesc.length].i] += 1;
    remaining -= 1;
    index += 1;
  }
  index = 0;
  while (remaining < 0) {
    // Reclaim from the smallest fractions (walk the same order backwards).
    const slot = byFractionDesc[byFractionDesc.length - 1 - (index % byFractionDesc.length)];
    if (out[slot.i] > 0) out[slot.i] -= 1;
    remaining += 1;
    index += 1;
  }
  return out;
}

function sumStats(rows: Stats[]): Stats {
  return rows.reduce(
    (sum, row) => ({
      files: sum.files + row.files,
      lines: sum.lines + row.lines,
      code: sum.code + row.code,
      comments: sum.comments + row.comments,
      blanks: sum.blanks + row.blanks,
    }),
    { files: 0, lines: 0, code: 0, comments: 0, blanks: 0 },
  );
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// Round to 6 decimals: enough precision that re-derived shares stay stable
// frame to frame, coarse enough that float dust never accumulates in sums.
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

// UTC day number for a "YYYY-MM-DD" string: date-only strings parse the same
// in every timezone, and day arithmetic (dayOffset, ordering) stays exact.
function utcDay(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}
