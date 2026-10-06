// The growth-animation scene contract: a fully-resolved, deterministic
// description of every animated element at every beat. buildScene() produces
// it from a Report plus its RepoHistory; GrowthAnimation's render(p) and the
// GIF exporter both consume it. No clocks live here — the player owns
// playback time and the exporter steps p frame by frame, so the same scene
// renders identically in both.
//
// Data honesty (mirrors the shipped demo): the SLOC series, dips, and the
// finale metrics are real API data; historical per-language split is MODELED
// from the latest commit's language mix until the backend samples
// per-language history (v2). `modeledLanguageSplit` drives the UI disclosure
// line so the animation never overstates its provenance.
//
// v1.1: the four-act bar race is replaced by an isometric code city — each
// language is a building (footprint ∝ share of code, height ∝ lines). Every
// sample carries its own squarified-treemap ground layout and baked building
// heights; per-face colors are derived here so the renderer (and the GIF
// palette) never computes a color.
import type { Report, RepoHistory, Stats } from "../types";

// A language track across the animation. `currentCode`/`currentShare` are
// real (latest commit); historical values are modeled by scaling the share
// against each sample's real total — see buildScene.
export type GrowthLanguage = {
  name: string;
  // Resolved visible color for the active scheme (matrix/paper) — baked into
  // the scene so the GIF palette derives from the scene alone. The building's
  // left face uses `color` verbatim; `colorTop`/`colorRight` are the
  // lightened/darkened derivatives for the roof and the shaded right face.
  color: string;
  colorTop: string;
  colorRight: string;
  currentCode: number;
  currentShare: number; // 0..100 of total code, real
  // This language's share of every sample (percent, 0..100, rounded to 6dp
  // so float drift never accumulates), one entry per scene.samples in date
  // order — the hover popup's per-language over-time series. The merged
  // "Other (N more)" block is not a language (no GrowthLanguage entry), so
  // it carries no share series.
  shares: number[];
  // Latest-commit per-language stats straight from the report — the hover
  // popup's detail payload for this language.
  stats: Stats;
};

// A detected drawdown between adjacent samples (threshold in buildScene).
export type GrowthDip = {
  sampleIndex: number; // the sample the count drops TO
  fromValue: number;
  toValue: number;
};

// One building on the ground plane: footprint rect in the normalized 100x100
// ground grid (squarified treemap, area ∝ the block's code at this sample)
// plus its full-rise height in design px. Face colors ride along so merged
// "Other (N more)" blocks (not a language, no GrowthLanguage entry) render
// identically to real ones.
export type GrowthCityBlock = {
  name: string; // language name, or "Other (N more)" for the merged tail
  value: number; // code lines this block represents at this sample
  rect: { x: number; y: number; w: number; h: number };
  height: number; // design px, 0..MAX_BUILDING_H (buildScene)
  color: string; // left face
  colorTop: string; // roof
  colorRight: string; // right face
  merged?: number; // set on the Other block: how many languages it folds in
  logo?: { path: string; color: string; textColor: string; valueColor: string };
};

export type GrowthSample = {
  date: string; // YYYY-MM-DD, real
  dayOffset: number; // days since the first sample
  code: number; // real code lines at this sample
  stars: number | null; // real star count if sampled by this date
  // Per-language code lines at this sample (real when the history row carries
  // per-language data — realSplit — otherwise modeled from the current share),
  // renormalized so the values always sum to `code`.
  languageCode: Record<string, number>;
  // True when `languageCode` came from the sample's real per-language payload
  // instead of the current-share model.
  realSplit?: boolean;
  // City layout at this sample: one block per language with code > 0 (tail
  // merged into Other past the limit), rects within the 100x100 ground and
  // non-overlapping. The renderer interpolates between adjacent samples'
  // layouts by block name.
  city: GrowthCityBlock[];
};

// The finale stats view mirrors the report page's table semantics (top N by
// code with the tail merged into one Other row, TOTAL row separate). v1.1
// renders only `metrics` on stage (the metric bar); the table payload stays
// in the contract for the page and tests.
export type GrowthTableRow = {
  name: string;
  color: string;
  files: number;
  lines: number;
  code: number;
  comments: number;
  blanks: number;
  merged?: boolean; // the "Other (N more)" row
};

export type GrowthFinale = {
  refName: string;
  commitSha12: string;
  generatedDate: string; // "2026-09-29"
  metrics: { files: number; lines: number; code: number; comments: number; blanks: number };
  tableCaption: string; // e.g. "top 10 of 11 languages"
  tableRows: GrowthTableRow[];
  totalRow: { files: number; lines: number; code: number; comments: number; blanks: number };
};

export type GrowthScene = {
  repoFullName: string;
  provider: string;
  durationMs: number; // template length, 5000
  // "full" paces the city's growth across the samples; "compact" is the
  // low-sample degradation (<3 samples): buildings rise straight to the
  // final skyline on the same beat sheet.
  variant: "full" | "compact";
  languages: GrowthLanguage[]; // sorted by currentCode desc; entrance stagger derives from this order
  // Latest-commit per-language stats keyed by name, for the hover popup.
  // Every language of the current report is present (zero-code ones too —
  // their buildings never rise, but the page may still surface them); the
  // merged "Other (N more)" tail is a display construct, not a language, so
  // it has no entry here.
  languageDetails: Record<string, Stats>;
  samples: GrowthSample[]; // ≥1, sorted by date asc; last = latest commit
  dips: GrowthDip[];
  starsNow: number | null;
  leadingLanguage: string;
  modeledLanguageSplit: boolean;
  // True when EVERY sample's language split came from real per-language
  // history (the per-language backfill) rather than the current-share model —
  // the disclosure line switches from "modeled" to "real" on this.
  realLanguageSplit: boolean;
  // True when the finale report's analysis options diverge from the profile
  // the history series was sampled under (>5% code-line gap vs the last
  // sample) — e.g. a visitor's include-all re-analysis became the canonical
  // report. The renderer shows a one-line disclosure instead of letting the
  // counter and the finale metrics silently disagree.
  finaleDiverged: boolean;
  // Stats payload for the finale act (acts.finale carries only timing).
  finale: GrowthFinale;
  acts: {
    hook: { prompt: string }; // e.g. "octocounts facebook/react"
    data: { startTime: number; endTime: number; finalLock: number };
    finale: { startTime: number; endTime: number; staticFrom: number };
  };
};

// Input contract for buildScene — everything it needs, nothing more, so the
// builder stays a pure function that is cheap to unit-test.
export type GrowthSceneInput = {
  report: Report;
  history: RepoHistory;
  // Resolved per-language visible colors (scheme-aware), keyed by name —
  // injected rather than imported so tests can pin the palette.
  languageColors: Record<string, string>;
  // Optional URL-driven config (?gdur= seconds, ?glang= buildings). Both are
  // clamped inside buildScene; absent overrides reproduce the 5s/8 defaults.
  overrides?: { durationMs?: number; cityLimit?: number };
};
