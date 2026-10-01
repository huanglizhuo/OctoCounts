// The growth-animation scene contract: a fully-resolved, deterministic
// description of every animated element at every beat. buildScene() produces
// it from a Report plus its RepoHistory; GrowthAnimation's render(p) and the
// GIF exporter both consume it. No clocks live here — the player owns
// playback time and the exporter steps p frame by frame, so the same scene
// renders identically in both.
//
// Data honesty (mirrors the shipped demo): the SLOC series, dips, and the
// finale stats view are real API data; historical per-language split is
// MODELED from the latest commit's language mix until the backend samples
// per-language history (v2). `modeledLanguageSplit` drives the UI disclosure
// line so the animation never overstates its provenance.
import type { Report, RepoHistory } from "../types";

// A language track across the animation. `currentCode`/`currentShare` are
// real (latest commit); historical values are modeled by scaling the share
// against each sample's real total — see buildScene.
export type GrowthLanguage = {
  name: string;
  // Resolved visible color for the active scheme (matrix/paper) — baked into
  // the scene so the GIF palette derives from the scene alone.
  color: string;
  currentCode: number;
  currentShare: number; // 0..100 of total code, real
  // Sample index at which the language's bar first renders. v1 models every
  // language from sample 0; the field exists so v2 real entrance dates swap
  // in without touching the renderer.
  entersAtSample: number;
};

// A detected drawdown between adjacent samples (threshold in buildScene).
export type GrowthDip = {
  sampleIndex: number; // the sample the count drops TO
  fromValue: number;
  toValue: number;
};

export type GrowthSample = {
  date: string; // YYYY-MM-DD, real
  dayOffset: number; // days since the first sample
  code: number; // real code lines at this sample
  stars: number | null; // real star count if sampled by this date
  // Modeled per-language code lines at this sample (share × code,
  // renormalized so the values sum to `code`).
  languageCode: Record<string, number>;
};

// The finale stats view mirrors the report page's table semantics (top N by
// code with the tail merged into one Other row, TOTAL row separate).
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
  durationMs: number; // template length, 10000
  // "full" plays the four-act template; "compact" is the low-sample
  // degradation (<3 samples): count-up + morph + finale, race bars omitted.
  variant: "full" | "compact";
  languages: GrowthLanguage[]; // sorted by currentCode desc; race order derives per-sample
  samples: GrowthSample[]; // ≥1, sorted by date asc; last = latest commit
  dips: GrowthDip[];
  starsNow: number | null;
  leadingLanguage: string;
  modeledLanguageSplit: boolean;
  // True when the finale report's analysis options diverge from the profile
  // the history series was sampled under (>5% code-line gap vs the last
  // sample) — e.g. a visitor's include-all re-analysis became the canonical
  // report. The renderer shows a one-line disclosure instead of letting the
  // counter and the finale table silently disagree.
  finaleDiverged: boolean;
  // Stats-view payload for the finale act (acts.finale carries only timing).
  finale: GrowthFinale;
  acts: {
    hook: { prompt: string }; // e.g. "octocounts facebook/react"
    data: { startTime: number; endTime: number; finalLock: number };
    morph: {
      startTime: number;
      endTime: number;
      stackOrder: string[]; // top 6 language names, final order
      ringShares: Array<{ name: string; share: number; color: string }>; // renormalized over the six, sums to 100
    };
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
};
