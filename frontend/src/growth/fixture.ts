// Dev/QA fixture — never imported by product code except tests.
//
// The canonical facebook/react scene: every value is the real, verified data
// the approved demo (octocounts-growth-demo) was built from — the SLOC
// series beats, the two restructure dips, the latest-commit language mix,
// stars and the canonical exclude-all report stats. Historical per-language
// splits are the demo's MODELED share tables scaled onto each sample's real
// total and renormalized (largest-remainder) so they sum to the sample's
// code exactly, as types.ts promises. v1.1: city layouts and face colors are
// built through the same exported helpers buildScene uses, so the fixture
// can never drift from the product geometry.
import { deriveFaceColors, layoutCity, MAX_BUILDING_H } from "./buildScene";
import type { GrowthLanguage, GrowthSample, GrowthScene } from "./types";

const EPOCH = Date.UTC(2014, 7, 8); // first sample: 2014-08-08
const DAY_MS = 86_400_000;
const isoDate = (day: number) => new Date(EPOCH + day * DAY_MS).toISOString().slice(0, 10);

// Real latest-commit code mix (canonical report, Markdown excluded):
// sums to 365,001 = the real total code.
const REAL_MIX: Array<[string, number]> = [
  ["JavaScript", 231679],
  ["Rust", 64164],
  ["TypeScript", 60048],
  ["JSON", 3529],
  ["CSS", 3283],
  ["TSX", 1333],
  ["HTML", 416],
  ["Shell", 316],
  ["TOML", 223],
  ["SVG", 10],
];

// Demo share tables per sample (percent of code, modeled). The last two
// samples instead use the real mix as weights, renormalized onto that
// sample's code (365,009 / 365,001). Dips at indices 4 and 7.
const SERIES: Array<{ day: number; code: number; stars: number | null; shares: Record<string, number> }> = [
  { day: 0, code: 14035, stars: null, shares: { JavaScript: 78, CSS: 14, JSON: 8 } },
  { day: 442, code: 17011, stars: null, shares: { JavaScript: 79, CSS: 12, JSON: 9 } },
  { day: 883, code: 49415, stars: null, shares: { JavaScript: 82, CSS: 9, JSON: 5, TypeScript: 4 } },
  { day: 1324, code: 50433, stars: null, shares: { JavaScript: 81, CSS: 8, JSON: 5, TypeScript: 6 } },
  { day: 1765, code: 19134, stars: null, shares: { JavaScript: 80, TypeScript: 9, CSS: 6, JSON: 5 } },
  { day: 2206, code: 133038, stars: null, shares: { JavaScript: 75, TypeScript: 16, CSS: 4, JSON: 3.5, TSX: 1.5 } },
  { day: 2647, code: 160195, stars: null, shares: { JavaScript: 74, TypeScript: 18, CSS: 3, JSON: 3, TSX: 2 } },
  { day: 3089, code: 17952, stars: null, shares: { JavaScript: 76, TypeScript: 16, CSS: 3, JSON: 3, TSX: 2 } },
  { day: 3530, code: 172894, stars: null, shares: { JavaScript: 70, TypeScript: 19, Rust: 5, CSS: 2, JSON: 2, TSX: 2 } },
  { day: 3971, code: 254981, stars: 244000, shares: { JavaScript: 66, TypeScript: 19, Rust: 10, CSS: 2, JSON: 2, TSX: 1 } },
  { day: 4412, code: 364248, stars: null, shares: { JavaScript: 64, Rust: 17, TypeScript: 16.5, JSON: 1, CSS: 1, TSX: 0.5 } },
  {
    day: 4431,
    code: 365009,
    stars: null,
    shares: Object.fromEntries(REAL_MIX),
  },
  {
    day: 4435,
    code: 365001,
    stars: 250841,
    shares: Object.fromEntries(REAL_MIX),
  },
];

// Largest-remainder allocation: integers proportional to `weights` summing
// to exactly `total` (types.ts: languageCode sums to the sample's code).
function alloc(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (w / sum) * total);
  const out = exact.map(Math.floor);
  let rem = total - out.reduce((a, b) => a + b, 0);
  const order = exact
    .map((_, i) => i)
    .sort((a, b) => exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a])) || a - b);
  for (let k = 0; k < rem; k += 1) out[order[k % order.length]] += 1;
  return out;
}

const LANG_COLORS: Record<string, string> = {
  JavaScript: "#3fb950",
  Rust: "#dea584",
  TypeScript: "#3178c6",
  JSON: "#79c0ff",
  CSS: "#a371f7",
  TSX: "#f778ba",
  HTML: "#e34c26",
  Shell: "#89e051",
  TOML: "#bc7d4b",
  SVG: "#f2cc60",
};

const TOTAL_CODE = 365001;

// Round to 6 decimals, same rule as buildScene, so the fixture's share
// series stays frame-stable too.
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

export function buildFixtureScene(): GrowthScene {
  const samples: GrowthSample[] = SERIES.map((row) => {
    const names = Object.keys(row.shares);
    const counts = alloc(row.code, names.map((n) => row.shares[n]));
    const languageCode: Record<string, number> = {};
    names.forEach((name, i) => {
      languageCode[name] = counts[i];
    });
    // v1 models every language in every sample: languages missing from this
    // share table enter with 0 lines (their block stays flat until the model
    // gives them code).
    for (const [name] of REAL_MIX) {
      if (!(name in languageCode)) languageCode[name] = 0;
    }
    return { date: isoDate(row.day), dayOffset: row.day, code: row.code, stars: row.stars, languageCode, city: [] };
  });

  // City layouts through the product helper: entries per sample, a probe
  // pass at scale 1 to find the series peak, then the real scale.
  const entriesPerSample = samples.map((sample) =>
    Object.entries(sample.languageCode)
      .map(([name, value]) => ({ name, value, color: LANG_COLORS[name] }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value),
  );
  const probe = entriesPerSample.map((entries) => layoutCity(entries, 1));
  const peak = probe.flat().reduce((max, block) => Math.max(max, block.height), 0);
  const heightScale = peak > 0 ? MAX_BUILDING_H / peak : 0;
  samples.forEach((sample, i) => {
    sample.city = layoutCity(entriesPerSample[i], heightScale);
  });

  const finale: GrowthScene["finale"] = {
    refName: "main",
    commitSha12: "7c6ac13e19fe",
    generatedDate: "2026-09-29",
    metrics: { files: 2133, lines: 460755, code: 365001, comments: 59383, blanks: 36371 },
    tableCaption: "top 10 of 11 languages",
    tableRows: [
      { name: "JavaScript", color: "#3fb950", files: 1477, lines: 294019, code: 231679, comments: 38520, blanks: 23820 },
      { name: "Rust", color: "#dea584", files: 117, lines: 72880, code: 64164, comments: 3784, blanks: 4932 },
      { name: "TypeScript", color: "#3178c6", files: 219, lines: 74575, code: 60048, comments: 10201, blanks: 4326 },
      { name: "JSON", color: "#79c0ff", files: 86, lines: 3537, code: 3529, comments: 0, blanks: 8 },
      { name: "CSS", color: "#a371f7", files: 88, lines: 3828, code: 3283, comments: 61, blanks: 484 },
      { name: "TSX", color: "#f778ba", files: 15, lines: 1591, code: 1333, comments: 153, blanks: 105 },
      { name: "HTML", color: "#e34c26", files: 23, lines: 438, code: 416, comments: 9, blanks: 13 },
      { name: "Shell", color: "#89e051", files: 19, lines: 531, code: 316, comments: 118, blanks: 97 },
      { name: "TOML", color: "#bc7d4b", files: 14, lines: 247, code: 223, comments: 4, blanks: 20 },
      { name: "SVG", color: "#f2cc60", files: 7, lines: 10, code: 10, comments: 0, blanks: 0 },
      { name: "Other (1 more)", color: "#57606a", files: 68, lines: 9099, code: 0, comments: 6533, blanks: 2566, merged: true },
    ],
    totalRow: { files: 2133, lines: 460755, code: 365001, comments: 59383, blanks: 36371 },
  };

  // Per-language stats come from the same verified table rows the finale
  // uses, so the track stats and the detail payload can never drift apart.
  // Markdown has zero code so it rides in the merged Other row above, but
  // its stats are real report data and belong in the details map — buildScene
  // includes zero-code report languages the same way.
  const statsByName = Object.fromEntries(
    finale.tableRows
      .filter((row) => !row.merged)
      .map(({ name, files, lines, code, comments, blanks }) => [name, { files, lines, code, comments, blanks }]),
  );
  statsByName.Markdown = { files: 68, lines: 9099, code: 0, comments: 6533, blanks: 2566 };

  const languages: GrowthLanguage[] = REAL_MIX.map(([name, code]) => ({
    name,
    color: LANG_COLORS[name],
    ...deriveFaceColors(LANG_COLORS[name]),
    currentCode: code,
    currentShare: Math.round((code / TOTAL_CODE) * 1000) / 10,
    stats: statsByName[name],
    shares: samples.map((sample) =>
      sample.code > 0 ? round6(((sample.languageCode[name] ?? 0) / sample.code) * 100) : 0,
    ),
  }));

  return {
    repoFullName: "facebook/react",
    provider: "github",
    durationMs: 10000,
    variant: "full",
    languages,
    languageDetails: statsByName,
    samples,
    dips: [
      { sampleIndex: 4, fromValue: 50433, toValue: 19134 },
      { sampleIndex: 7, fromValue: 160195, toValue: 17952 },
    ],
    starsNow: 250841,
    leadingLanguage: "JavaScript",
    modeledLanguageSplit: true,
    realLanguageSplit: false,
    finaleDiverged: false,
    finale,
    acts: {
      hook: { prompt: "octocounts facebook/react" },
      data: { startTime: 1.2, endTime: 8.5, finalLock: 8.5 },
      finale: { startTime: 8.5, endTime: 10, staticFrom: 9.6 },
    },
  };
}
