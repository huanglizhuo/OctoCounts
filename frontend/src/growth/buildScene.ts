// buildScene(): Report + RepoHistory → GrowthScene. Pure and deterministic —
// no clocks, randomness, or network — so the in-page player and the GIF
// exporter step the exact same scene frame by frame (plan §2). Every rule
// below resolves data ONCE here: the renderer only interpolates.
//
// Data honesty (types.ts): SLOC samples, dips, stars and the finale stats are
// real API data. Historical per-language splits are MODELED by scaling each
// language's current share against every sample's real code total — v1 until
// the backend samples per-language history.
import type { GrowthDip, GrowthLanguage, GrowthSample, GrowthScene, GrowthTableRow, GrowthSceneInput } from "./types";
import type { Stats } from "../types";

// Fixed template beat sheet (seconds within durationMs) — plan §4. Compact
// scenes keep the same timings; the renderer simply omits the race bars.
const DURATION_MS = 10000;
const DATA_ACT = { startTime: 1.2, endTime: 8.5, finalLock: 8.5 };
const MORPH_ACT = { startTime: 8.55, endTime: 9.3 };
const FINALE_ACT = { startTime: 9.3, endTime: 10, staticFrom: 9.6 };

// A drop between adjacent samples counts as a dip only above this ratio
// (toValue < fromValue × 0.7 means more than 30% of the code vanished —
// typically a mass refactor or a relicense-era pruning).
const DIP_RATIO = 0.7;
// The finale table mirrors the report page's demo truncation semantics
// (DEMO_LANGUAGE_LIMIT in Charts.tsx): top N by code, tail merged into Other.
const TABLE_LIMIT = 10;
// The morph act's bar→ring geometry is built for six arcs.
const MORPH_ARCS = 6;
// Neutral GitHub-gray fallback for languages missing a resolved color, and
// for the merged Other row (which is not a language at all).
const FALLBACK_COLOR = "#57606a";

export function buildScene(input: GrowthSceneInput): GrowthScene {
  const { report, history, languageColors } = input;

  const owner = report.repository.owner;
  const repo = report.repository.name;
  const prompt = `octocounts ${owner}/${repo}`;

  // --- Languages -----------------------------------------------------------
  // Zero-current-code languages (e.g. a Markdown-only docs dir) never race:
  // their lines surface only in the finale's merged Other row, so they are
  // excluded from the tracks AND from the per-sample model below.
  const totalCode = report.total.code;
  const sortedByCode = [...report.languages].sort((a, b) => b.stats.code - a.stats.code);
  const languages: GrowthLanguage[] = sortedByCode
    .filter((language) => language.stats.code > 0)
    .map((language) => ({
      name: language.name,
      color: languageColors[language.name] ?? FALLBACK_COLOR,
      currentCode: language.stats.code,
      // Real share of the latest commit's code; the model below renormalizes
      // against each sample so float drift can never accumulate.
      currentShare: totalCode > 0 ? (language.stats.code / totalCode) * 100 : 0,
      // v1 models every language from sample 0; v2 real entrance dates swap
      // in here without touching the renderer.
      entersAtSample: 0,
    }));
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
    return {
      date: point.date,
      dayOffset: utcDay(point.date) - firstDay,
      code: point.totalLines,
      stars,
      languageCode: modelLanguageCode(languages, point.totalLines),
    };
  });

  // --- Dips ------------------------------------------------------------------
  const dips: GrowthDip[] = [];
  for (let i = 1; i < samples.length; i++) {
    const fromValue = samples[i - 1].code;
    const toValue = samples[i].code;
    if (toValue < fromValue * DIP_RATIO) {
      dips.push({ sampleIndex: i, fromValue, toValue });
    }
  }

  // --- Morph act: top-6 stack order and ring shares ---------------------------
  const topArcs = languages.slice(0, MORPH_ARCS);
  const arcTotal = topArcs.reduce((sum, language) => sum + language.currentCode, 0);
  const rawShares = topArcs.map((language) =>
    arcTotal > 0 ? (language.currentCode / arcTotal) * 100 : 100 / topArcs.length,
  );
  const ringShares = largestRemainder(rawShares, 100).map((share, i) => ({
    name: topArcs[i].name,
    share,
    color: topArcs[i].color,
  }));

  // --- Finale stats view -------------------------------------------------------
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
    durationMs: DURATION_MS,
    // <3 samples cannot pace a race act; the renderer degrades to
    // count-up + morph + finale with the same beat sheet (plan §10).
    variant: samples.length < 3 ? "compact" : "full",
    languages,
    samples,
    dips,
    starsNow: history.currentStars,
    leadingLanguage,
    modeledLanguageSplit: languages.length > 1,
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
      // TOTAL row keeps reporting the real repository (Charts.tsx semantics).
      totalRow: { ...report.total },
    },
    acts: {
      hook: { prompt },
      data: { ...DATA_ACT },
      morph: {
        ...MORPH_ACT,
        stackOrder: topArcs.map((language) => language.name),
        ringShares,
      },
      finale: { ...FINALE_ACT },
    },
  };
}

// Modeled per-language code at one sample: current share × the sample's real
// code total, then largest-remainder rounded so the tracks sum to the sample
// exactly — the counter and the stacked bars can never disagree by a line.
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

// UTC day number for a "YYYY-MM-DD" string: date-only strings parse the same
// in every timezone, and day arithmetic (dayOffset, ordering) stays exact.
function utcDay(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}
