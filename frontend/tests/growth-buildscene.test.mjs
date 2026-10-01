import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Same transpile-to-node_modules-cache pattern as github-status.test.mjs: a
// data: URL has no parent directory to resolve relative specifiers from, so
// the compiled copy lands under node_modules/ where git already ignores it.
// buildScene.ts imports only types from ./types, and `import type` is erased
// by the transpiler, so the emitted .mjs has zero module specifiers to resolve.
const cacheDir = new URL("../node_modules/.cache/octocounts-tests/", import.meta.url);
const source = await readFile(new URL("../src/growth/buildScene.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
await mkdir(cacheDir, { recursive: true });
const modulePath = new URL("growth-buildscene.mjs", cacheDir);
await writeFile(modulePath, compiled.outputText);
const { buildScene } = await import(modulePath.href);

// ---------------------------------------------------------------------------
// Fixtures: the verified facebook/react numbers (report totals, 11 languages,
// 13 SLOC samples, currentStars). Language stat rows sum to `reactTotal`
// exactly, so TOTAL assertions double as internal-consistency checks.
// ---------------------------------------------------------------------------

const lang = (name, files, lines, code, comments, blanks) => ({
  name,
  stats: { files, lines, code, comments, blanks },
  children: [],
});

const reactLanguages = [
  lang("JavaScript", 1477, 294019, 231679, 38520, 23820),
  lang("Rust", 117, 72880, 64164, 3784, 4932),
  lang("TypeScript", 219, 74575, 60048, 10201, 4326),
  lang("JSON", 86, 3537, 3529, 0, 8),
  lang("CSS", 88, 3828, 3283, 61, 484),
  lang("TSX", 15, 1591, 1333, 153, 105),
  lang("HTML", 23, 438, 416, 9, 13),
  lang("Shell", 19, 531, 316, 118, 97),
  lang("TOML", 14, 247, 223, 4, 20),
  lang("SVG", 7, 10, 10, 0, 0),
  lang("Markdown", 68, 9099, 0, 6533, 2566),
];

const reactTotal = { files: 2133, lines: 460755, code: 365001, comments: 59383, blanks: 36371 };

const reactSloc = [
  ["2014-08-08", 14035],
  ["2015-10-24", 17011],
  ["2017-01-07", 49415],
  ["2018-03-24", 50433],
  ["2019-06-08", 19134],
  ["2020-08-22", 133038],
  ["2021-11-06", 160195],
  ["2023-01-22", 17952],
  ["2024-04-07", 172894],
  ["2025-06-22", 254981],
  ["2026-09-06", 364248],
  ["2026-09-25", 365009],
  ["2026-09-29", 365001],
].map(([date, totalLines]) => ({ date, totalLines }));

const reactStars = [
  { date: "2015-06-01", stars: 20000 },
  { date: "2018-03-24", stars: 95000 },
  { date: "2020-08-22", stars: 143000 },
  { date: "2025-06-22", stars: 190000 },
  { date: "2026-09-29", stars: 250841 },
];

// TOML is deliberately absent: it must fall back to the neutral gray.
const reactColors = {
  JavaScript: "#f1e05a",
  Rust: "#dea584",
  TypeScript: "#3178c6",
  JSON: "#9cdcfe",
  CSS: "#563d7c",
  TSX: "#2f74c0",
  HTML: "#e34c26",
  Shell: "#89e051",
  SVG: "#ffb13b",
  Markdown: "#68707a",
};

const makeReport = (languages, total) => ({
  id: "rep-react",
  repository: {
    owner: "facebook",
    name: "react",
    htmlUrl: "https://github.com/facebook/react",
    provider: "github",
    stars: 250841,
  },
  refName: "main",
  commitSha: "e7a1b2c3d4f5a6b7c8d9e0f1a2b3c4d5e6f70818",
  generatedAt: "2026-09-29T10:11:12Z",
  durationMs: 4200,
  cached: false,
  tokeiVersion: "13.0.0-alpha.5",
  analysisKey: "github:facebook/react",
  analysisOptions: {
    ignoredDirs: [],
    ignoredLanguages: [],
    profile: "default",
    includeDocs: true,
    includeTests: true,
    includeGenerated: false,
  },
  languages,
  total,
});

const makeHistory = (slocPoints, starPoints = reactStars) => ({
  provider: "github",
  owner: "facebook",
  repo: "react",
  currentStars: 250841,
  starPoints,
  slocPoints,
  slocBackfillInProgress: false,
  starBackfillAvailable: false,
  starBackfillInProgress: false,
});

const reactScene = () =>
  buildScene({
    report: makeReport(reactLanguages, reactTotal),
    history: makeHistory(reactSloc),
    languageColors: reactColors,
  });

test("template timings are the fixed 10s beat sheet", () => {
  const scene = reactScene();
  assert.equal(scene.durationMs, 10000);
  assert.deepEqual(scene.acts.hook, { prompt: "octocounts facebook/react" });
  assert.deepEqual(scene.acts.data, { startTime: 1.2, endTime: 8.5, finalLock: 8.5 });
  assert.equal(scene.acts.morph.startTime, 8.55);
  assert.equal(scene.acts.morph.endTime, 9.3);
  assert.deepEqual(scene.acts.finale, { startTime: 9.3, endTime: 10, staticFrom: 9.6 });
});

test("builds 13 samples from the react history, first-to-last 4435 days", () => {
  const scene = reactScene();
  assert.equal(scene.variant, "full");
  assert.equal(scene.repoFullName, "facebook/react");
  assert.equal(scene.provider, "github");
  assert.equal(scene.samples.length, 13);
  assert.equal(scene.samples[0].date, "2014-08-08");
  assert.equal(scene.samples[0].dayOffset, 0);
  assert.equal(scene.samples[0].code, 14035);
  assert.equal(scene.samples[12].date, "2026-09-29");
  assert.equal(scene.samples[12].dayOffset, 4435);
  assert.equal(scene.samples[12].code, 365001);
  for (let i = 1; i < scene.samples.length; i++) {
    assert.ok(scene.samples[i - 1].date < scene.samples[i].date, `sample ${i} out of order`);
  }
});

test("detects both >30% dips and ignores the small final drop", () => {
  const scene = reactScene();
  // 50433 → 19134 (−62%) lands on sample 4; 160195 → 17952 (−89%) on sample 7.
  // The 365009 → 365001 tail-off is noise and must NOT register.
  assert.deepEqual(scene.dips, [
    { sampleIndex: 4, fromValue: 50433, toValue: 19134 },
    { sampleIndex: 7, fromValue: 160195, toValue: 17952 },
  ]);
  assert.ok(scene.dips.every((dip) => dip.fromValue !== 365009));
});

test("language tracks exclude zero-code Markdown and use injected colors", () => {
  const scene = reactScene();
  assert.equal(scene.languages.length, 10);
  assert.ok(scene.languages.every((language) => language.name !== "Markdown"));
  // Sorted by currentCode desc; every track enters at sample 0 (v1 model).
  assert.deepEqual(
    scene.languages.map((language) => language.name),
    ["JavaScript", "Rust", "TypeScript", "JSON", "CSS", "TSX", "HTML", "Shell", "TOML", "SVG"],
  );
  assert.ok(scene.languages.every((language) => language.entersAtSample === 0));
  assert.equal(scene.languages[0].currentCode, 231679);
  const expectedShare = (231679 / 365001) * 100;
  assert.ok(Math.abs(scene.languages[0].currentShare - expectedShare) < 1e-9);
  const shareSum = scene.languages.reduce((sum, language) => sum + language.currentShare, 0);
  assert.ok(Math.abs(shareSum - 100) < 1e-6);
  assert.equal(scene.languages[0].color, reactColors.JavaScript);
  // TOML has no injected color: neutral gray fallback.
  assert.equal(scene.languages[8].color, "#57606a");
  assert.equal(scene.leadingLanguage, "JavaScript");
  assert.equal(scene.modeledLanguageSplit, true);
  assert.equal(scene.starsNow, 250841);
});

test("modeled languageCode sums to the sample total exactly at every sample", () => {
  const scene = reactScene();
  for (const sample of scene.samples) {
    const values = Object.values(sample.languageCode);
    assert.equal(values.reduce((a, b) => a + b, 0), sample.code, `${sample.date} split must sum to ${sample.code}`);
    assert.equal(Object.keys(sample.languageCode).length, 10);
    assert.ok(!("Markdown" in sample.languageCode));
  }
  // The latest sample models the real current split: JavaScript's 231679 of
  // 365001 must survive the renormalization at full integer precision.
  const last = scene.samples[12];
  const expectedJavaScript = Math.round((231679 / 365001) * 365001);
  assert.ok(Math.abs(last.languageCode.JavaScript - expectedJavaScript) <= 1);
});

test("ring shares renormalize the top six to exactly 100", () => {
  const scene = reactScene();
  assert.deepEqual(scene.acts.morph.stackOrder, ["JavaScript", "Rust", "TypeScript", "JSON", "CSS", "TSX"]);
  const ring = scene.acts.morph.ringShares;
  assert.deepEqual(
    ring.map((arc) => arc.name),
    scene.acts.morph.stackOrder,
  );
  assert.equal(ring.reduce((sum, arc) => sum + arc.share, 0), 100);
  // Largest-remainder outcome over the six (code sum 364036): JS 63.64,
  // Rust 17.63, TS 16.50, JSON 0.97, CSS 0.90, TSX 0.37 → the four leftover
  // units go to the biggest fractions, so TSX's 0.37 floors to zero.
  assert.deepEqual(
    ring.map((arc) => arc.share),
    [64, 18, 16, 1, 1, 0],
  );
  assert.equal(ring[0].color, reactColors.JavaScript);
});

test("finale mirrors the report table: top 10 + merged Other, TOTAL untouched", () => {
  const scene = reactScene();
  const finale = scene.finale;
  assert.equal(finale.refName, "main");
  assert.equal(finale.commitSha12, "e7a1b2c3d4f5");
  assert.equal(finale.generatedDate, "2026-09-29");
  assert.deepEqual(finale.metrics, reactTotal);
  assert.deepEqual(finale.totalRow, reactTotal);
  assert.equal(finale.tableCaption, "top 10 of 11 languages");
  assert.equal(finale.tableRows.length, 11);
  const [head, other] = [finale.tableRows.slice(0, 10), finale.tableRows[10]];
  assert.ok(head.every((row) => row.name !== "Markdown" && !row.merged));
  assert.deepEqual(other, {
    name: "Other (1 more)",
    color: "#57606a",
    files: 68,
    lines: 9099,
    code: 0,
    comments: 6533,
    blanks: 2566,
    merged: true,
  });
  assert.deepEqual(head[0], {
    name: "JavaScript",
    color: reactColors.JavaScript,
    files: 1477,
    lines: 294019,
    code: 231679,
    comments: 38520,
    blanks: 23820,
  });
});

test("a 12-language report merges two tail rows into Other; TOTAL is the report total", () => {
  const yaml = lang("YAML", 9, 210, 150, 30, 30);
  const total12 = { files: 2142, lines: 460965, code: 365151, comments: 59413, blanks: 36401 };
  const scene = buildScene({
    report: makeReport([...reactLanguages, yaml], total12),
    history: makeHistory(reactSloc),
    languageColors: { ...reactColors, YAML: "#cb171e" },
  });
  const finale = scene.finale;
  assert.equal(finale.tableCaption, "top 10 of 12 languages");
  assert.equal(finale.tableRows.length, 11);
  const names = finale.tableRows.map((row) => row.name);
  // YAML (150 code) makes the top 10; SVG and zero-code Markdown fall to Other.
  assert.ok(names.includes("YAML"));
  assert.ok(!names.slice(0, 10).includes("SVG"));
  assert.ok(!names.slice(0, 10).includes("Markdown"));
  assert.deepEqual(finale.tableRows[10], {
    name: "Other (2 more)",
    color: "#57606a",
    files: 75, // SVG 7 + Markdown 68
    lines: 9109,
    code: 10,
    comments: 6533,
    blanks: 2566,
    merged: true,
  });
  assert.deepEqual(finale.totalRow, total12);
  assert.deepEqual(finale.metrics, total12);
});

test("fewer than 3 samples degrades to the compact variant, same beat sheet", () => {
  const scene = buildScene({
    report: makeReport(reactLanguages, reactTotal),
    history: makeHistory(reactSloc.slice(0, 2)),
    languageColors: reactColors,
  });
  assert.equal(scene.variant, "compact");
  assert.equal(scene.samples.length, 2);
  assert.equal(scene.starsNow, 250841);
  // Compact omits the race act in the RENDERER; the timings stay identical.
  assert.deepEqual(scene.acts.data, { startTime: 1.2, endTime: 8.5, finalLock: 8.5 });
  assert.deepEqual(scene.acts.finale, { startTime: 9.3, endTime: 10, staticFrom: 9.6 });
  assert.equal(scene.durationMs, 10000);
});

test("a single-language scene has no modeled split and one full ring", () => {
  const only = lang("JavaScript", 1477, 294019, 231679, 38520, 23820);
  const scene = buildScene({
    report: makeReport([only], { ...only.stats }),
    history: makeHistory(reactSloc),
    languageColors: reactColors,
  });
  assert.equal(scene.languages.length, 1);
  assert.equal(scene.modeledLanguageSplit, false);
  assert.equal(scene.leadingLanguage, "JavaScript");
  assert.deepEqual(scene.acts.morph.stackOrder, ["JavaScript"]);
  assert.deepEqual(scene.acts.morph.ringShares, [
    { name: "JavaScript", share: 100, color: reactColors.JavaScript },
  ]);
  for (const sample of scene.samples) {
    assert.deepEqual(sample.languageCode, { JavaScript: sample.code });
  }
});

test("unsorted history input is sorted by date before anything else", () => {
  const canonical = reactScene();
  const scene = buildScene({
    report: makeReport(reactLanguages, reactTotal),
    history: makeHistory([...reactSloc].reverse(), [...reactStars].reverse()),
    languageColors: reactColors,
  });
  assert.deepEqual(scene.samples, canonical.samples);
  assert.deepEqual(scene.dips, canonical.dips);
});

test("stars map through the date window: null before the first star point", () => {
  const scene = reactScene();
  assert.deepEqual(
    scene.samples.map((sample) => sample.stars),
    [
      null, // 2014-08-08: no star observation yet
      20000, // 2015-10-24 ← 2015-06-01
      20000, // 2017-01-07 ← 2015-06-01
      95000, // 2018-03-24 ← same day
      95000, // 2019-06-08
      143000, // 2020-08-22 ← same day
      143000,
      143000,
      143000,
      190000, // 2025-06-22 ← same day
      190000,
      190000,
      250841, // 2026-09-29 ← same day
    ],
  );
});
