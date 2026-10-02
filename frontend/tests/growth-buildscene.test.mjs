import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Same transpile-to-node_modules-cache pattern as github-status.test.mjs: a
// data: URL has no parent directory to resolve relative specifiers from, so
// the compiled copies land under node_modules/ where git already ignores
// them. fixture.ts joins the party for the share-series-over-time checks.
const cacheDir = new URL("../node_modules/.cache/octocounts-tests/", import.meta.url);
await mkdir(cacheDir, { recursive: true });
const modulePath = new URL("growth-buildscene.mjs", cacheDir);
for (const [name, target] of [
  ["languageLogos", "languageLogos.mjs"],
  ["buildScene", "growth-buildscene.mjs"],
  ["fixture", "growth-fixture.mjs"],
]) {
  const source = await readFile(new URL(`../src/growth/${name}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  await writeFile(
    new URL(target, cacheDir),
    compiled.outputText
      .replace('"./languageLogos"', '"./languageLogos.mjs"')
      .replace('"./buildScene"', '"./growth-buildscene.mjs"'),
  );
}
const { buildScene } = await import(modulePath.href);
const { buildFixtureScene } = await import(new URL("growth-fixture.mjs", cacheDir).href);

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
  // v1.1: the morph act is gone — the finale starts where the data act locks.
  assert.deepEqual(scene.acts.finale, { startTime: 8.5, endTime: 10, staticFrom: 9.6 });
  assert.ok(!("morph" in scene.acts));
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
  // Sorted by currentCode desc.
  assert.deepEqual(
    scene.languages.map((language) => language.name),
    ["JavaScript", "Rust", "TypeScript", "JSON", "CSS", "TSX", "HTML", "Shell", "TOML", "SVG"],
  );
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

test("city logos use language aliases and contrast against their roof", async () => {
  const { languageLogo } = await import(new URL("languageLogos.mjs", cacheDir).href);
  const city = reactScene().samples.at(-1).city;
  assert.ok(city.find((block) => block.name === "JavaScript").logo.path.length > 0);
  assert.equal(city.find((block) => block.name === "JavaScript").logo.color, "#000000");
  assert.equal(city.find((block) => block.name === "CSS").logo.color, "#ffffff");
  assert.equal(city.find((block) => block.merged).logo, undefined);
  assert.deepEqual(languageLogo("TSX", "#ffffff"), languageLogo("JSX", "#ffffff"));
  assert.deepEqual(languageLogo("Shell", "#ffffff"), languageLogo("Bash", "#ffffff"));
  assert.equal(languageLogo("Unknown language", "#ffffff"), undefined);
  assert.equal(languageLogo("constructor", "#ffffff"), undefined);
  assert.equal(languageLogo("Rust", "#000000").color, "#ffffff");
});

test("face colors are baked: roof lighter than base, right face darker", () => {
  const scene = reactScene();
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
  };
  for (const language of scene.languages) {
    assert.match(language.colorTop, /^#[0-9a-f]{6}$/);
    assert.match(language.colorRight, /^#[0-9a-f]{6}$/);
    assert.ok(lum(language.colorTop) > lum(language.color), `${language.name} roof must be lighter`);
    assert.ok(lum(language.colorRight) < lum(language.color), `${language.name} right face must be darker`);
  }
  // JavaScript #f1e05a: roof channels scale 1.28 (R/G clamp at 255, B 90→115).
  assert.equal(scene.languages[0].colorTop, "#ffff73");
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

test("city: every sample lays out blocks inside the 100x100 ground, non-overlapping, area ∝ code", () => {
  const scene = reactScene();
  const overlap = (a, b) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  for (const sample of scene.samples) {
    assert.ok(sample.city.length >= 1 && sample.city.length <= 8, `${sample.date} block count within the cap`);
    let areaSum = 0;
    for (const block of sample.city) {
      const { x, y, w, h } = block.rect;
      assert.ok(x >= -1e-9 && y >= -1e-9 && x + w <= 100 + 1e-9 && y + h <= 100 + 1e-9, `${sample.date} ${block.name} in bounds`);
      assert.ok(w > 0 && h > 0, `${sample.date} ${block.name} has a real footprint`);
      // Footprint area is proportional to the block's code at this sample.
      const expected = (block.value / sample.code) * 10000;
      assert.ok(Math.abs(w * h - expected) < 0.5, `${sample.date} ${block.name} area ∝ value`);
      areaSum += w * h;
    }
    // The layout tiles the whole plane (every language has modeled code).
    assert.ok(Math.abs(areaSum - 10000) < 1, `${sample.date} footprints tile the ground`);
    for (let a = 0; a < sample.city.length; a++) {
      for (let b = a + 1; b < sample.city.length; b++) {
        assert.ok(overlap(sample.city[a].rect, sample.city[b].rect) < 1e-6, `${sample.date} blocks ${a}/${b} overlap`);
      }
    }
    // Face colors ride on every block (merged Other blocks included).
    for (const block of sample.city) {
      assert.match(block.colorTop, /^#[0-9a-f]{6}$/);
      assert.match(block.colorRight, /^#[0-9a-f]{6}$/);
    }
  }
});

test("city: the tail merges into one gray Other block past 8 buildings", () => {
  const scene = reactScene();
  // 10 languages with code at the final sample → top 7 + Other (3 more).
  const final = scene.samples[12].city;
  assert.equal(final.length, 8);
  const other = final.find((block) => block.merged);
  assert.ok(other, "a merged Other block exists");
  assert.equal(other.name, "Other (3 more)");
  assert.equal(other.merged, 3);
  assert.equal(other.color, "#57606a");
  // The merged block folds in exactly Shell + TOML + SVG (the tail by code).
  assert.equal(other.value, 316 + 223 + 10);
  assert.ok(!final.some((block) => block.name === "SVG"));
  assert.ok(final.some((block) => block.name === "HTML"));
});

test("city: heights scale so the tallest block across the series is 180px", () => {
  const scene = reactScene();
  let max = 0;
  for (const sample of scene.samples) {
    for (const block of sample.city) {
      assert.ok(block.height > 0 && block.height <= 180 + 1e-9);
      max = Math.max(max, block.height);
    }
  }
  assert.ok(Math.abs(max - 180) < 1e-6, `peak height ${max} must be 180`);
  // JavaScript at the final sample is within a hair of the peak (the peak
  // itself is the same share of sample 11's slightly larger total).
  const js = scene.samples[12].city.find((block) => block.name === "JavaScript");
  assert.ok(Math.abs(js.height - 180) < 0.1);
  // The first sample's JavaScript rides the same global scale.
  const first = scene.samples[0].city.find((block) => block.name === "JavaScript");
  const peakValue = Math.max(...scene.samples.flatMap((s) => s.city.map((b) => b.value)));
  assert.ok(Math.abs(first.height - (first.value * 180) / peakValue) < 1e-6);
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
  // The city merges one more tail language: 11 code-carrying languages →
  // top 7 + Other (4 more) at the final sample.
  const final = scene.samples[scene.samples.length - 1].city;
  assert.equal(final.length, 8);
  const other = final.find((block) => block.merged);
  assert.equal(other.name, "Other (4 more)");
  assert.equal(other.merged, 4);
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
  // Compact skips the growth pacing in the RENDERER; the timings and the
  // per-sample city layouts stay identical in shape.
  assert.deepEqual(scene.acts.data, { startTime: 1.2, endTime: 8.5, finalLock: 8.5 });
  assert.deepEqual(scene.acts.finale, { startTime: 8.5, endTime: 10, staticFrom: 9.6 });
  assert.equal(scene.durationMs, 10000);
  assert.ok(scene.samples.every((sample) => sample.city.length >= 1));
});

test("a single-language scene has no modeled split and one full-plane block", () => {
  const only = lang("JavaScript", 1477, 294019, 231679, 38520, 23820);
  const scene = buildScene({
    report: makeReport([only], { ...only.stats }),
    history: makeHistory(reactSloc),
    languageColors: reactColors,
  });
  assert.equal(scene.languages.length, 1);
  assert.equal(scene.modeledLanguageSplit, false);
  assert.equal(scene.leadingLanguage, "JavaScript");
  for (const sample of scene.samples) {
    assert.deepEqual(sample.languageCode, { JavaScript: sample.code });
    // One language tiles the whole ground plane; height keeps the global scale.
    assert.equal(sample.city.length, 1);
    const block = sample.city[0];
    assert.equal(block.name, "JavaScript");
    assert.ok(Math.abs(block.rect.x) < 1e-9 && Math.abs(block.rect.y) < 1e-9);
    assert.ok(Math.abs(block.rect.w - 100) < 1e-6 && Math.abs(block.rect.h - 100) < 1e-6);
    assert.ok(Math.abs(block.height - (sample.code / 365009) * 180) < 1e-6);
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

test("languages carry a per-sample share series matching the modeled split", () => {
  const scene = reactScene();
  const lastIndex = scene.samples.length - 1;
  for (const language of scene.languages) {
    assert.equal(language.shares.length, scene.samples.length, `${language.name} shares cover every sample`);
    assert.ok(language.shares.every((share) => share >= 0 && share <= 100), `${language.name} shares stay in 0..100`);
    // The last sample renormalizes onto the real current mix, so its share
    // lands on currentShare (largest-remainder rounding wiggles < 3e-4).
    assert.ok(
      Math.abs(language.shares[lastIndex] - language.currentShare) < 1e-3,
      `${language.name} last share ${language.shares[lastIndex]} ≈ currentShare ${language.currentShare}`,
    );
  }
  // The modeled split renormalizes against each sample's real total, so the
  // per-language shares of every sample sum to ~100.
  for (let i = 0; i < scene.samples.length; i += 1) {
    const sum = scene.languages.reduce((acc, language) => acc + language.shares[i], 0);
    assert.ok(Math.abs(sum - 100) < 1e-3, `sample ${i} shares sum to ${sum}`);
  }
});

test("shares move over time in the dev fixture's modeled history", () => {
  // buildScene's v1 model scales one fixed share across every sample, so its
  // series is flat by construction — the fixture carries the demo's real
  // per-sample share tables, where JavaScript drifts from 78% down to ~63.5%
  // and Rust only enters halfway through.
  const scene = buildFixtureScene();
  const js = scene.languages.find((language) => language.name === "JavaScript");
  assert.equal(js.shares.length, scene.samples.length);
  assert.ok(Math.max(...js.shares) - Math.min(...js.shares) > 1, "JavaScript share varies across samples");
  const rust = scene.languages.find((language) => language.name === "Rust");
  assert.equal(rust.shares[0], 0);
  assert.ok(rust.shares.at(-1) > 0, "Rust enters the series later");
  // Fixture shares cover the same verified tables: last sample = real mix.
  assert.ok(Math.abs(js.shares.at(-1) - (231679 / 365001) * 100) < 1e-3);
});

test("languageDetails and track stats mirror the report's per-language stats", () => {
  const scene = reactScene();
  // The hover-popup fields come straight from the report rows.
  assert.deepEqual(scene.languageDetails.JavaScript, {
    files: 1477,
    lines: 294019,
    code: 231679,
    comments: 38520,
    blanks: 23820,
  });
  assert.deepEqual(scene.languageDetails.Rust, { files: 117, lines: 72880, code: 64164, comments: 3784, blanks: 4932 });
  assert.deepEqual(scene.languages[0].stats, scene.languageDetails.JavaScript);
  // Zero-code Markdown gets details (it is a report language) but no track.
  assert.deepEqual(scene.languageDetails.Markdown, { files: 68, lines: 9099, code: 0, comments: 6533, blanks: 2566 });
  assert.ok(scene.languages.every((language) => language.name !== "Markdown"));
  // The merged Other tail is a display construct, not a language: no entry.
  assert.equal(Object.keys(scene.languageDetails).length, reactLanguages.length);
  assert.ok(!Object.keys(scene.languageDetails).some((name) => name.startsWith("Other")));
  // The fixture's detail map agrees with its verified table rows.
  const fixtureScene = buildFixtureScene();
  assert.deepEqual(fixtureScene.languageDetails.TypeScript, {
    files: 219,
    lines: 74575,
    code: 60048,
    comments: 10201,
    blanks: 4326,
  });
  assert.deepEqual(fixtureScene.languageDetails.Markdown, { files: 68, lines: 9099, code: 0, comments: 6533, blanks: 2566 });
  assert.equal(Object.keys(fixtureScene.languageDetails).length, reactLanguages.length);
});

test("url overrides scale the beat sheet and the skyline cap", () => {
  const scaled = buildScene({
    report: makeReport(reactLanguages, reactTotal),
    history: makeHistory(reactSloc),
    languageColors: reactColors,
    overrides: { durationMs: 15000 },
  });
  assert.equal(scaled.durationMs, 15000);
  assert.deepEqual(scaled.acts.data, { startTime: 1.8, endTime: 12.75, finalLock: 12.75 });
  assert.deepEqual(scaled.acts.finale, { startTime: 12.75, endTime: 15, staticFrom: 14.4 });
  // Clamped to the 5s..30s window.
  const clamped = buildScene({
    report: makeReport(reactLanguages, reactTotal),
    history: makeHistory(reactSloc),
    languageColors: reactColors,
    overrides: { durationMs: 1000 },
  });
  assert.equal(clamped.durationMs, 5000);
  // A raised skyline cap stops merging the tail (react has 10 code languages).
  const wide = buildScene({
    report: makeReport(reactLanguages, reactTotal),
    history: makeHistory(reactSloc),
    languageColors: reactColors,
    overrides: { cityLimit: 12 },
  });
  assert.ok(wide.samples.at(-1).city.every((block) => !block.merged));
  assert.equal(reactScene().samples.at(-1).city.some((block) => block.merged), true);
});

test("per-language history payloads drive the real split when present", () => {
  // Give every sample a real language mix: Rust dominates early (a rewrite
  // story the modeled split could never tell), JS dominates late.
  const slocPoints = reactSloc.map((point, i) => ({
    ...point,
    languages: i < 6
      ? { Rust: Math.round(point.totalLines * 0.7), JavaScript: Math.round(point.totalLines * 0.3) }
      : { JavaScript: Math.round(point.totalLines * 0.8), Rust: Math.round(point.totalLines * 0.2) },
  }));
  const scene = buildScene({
    report: makeReport(reactLanguages, reactTotal),
    history: makeHistory(slocPoints),
    languageColors: reactColors,
  });
  assert.equal(scene.realLanguageSplit, true);
  assert.equal(scene.samples[0].realSplit, true);
  const earlyRust = scene.samples[0].languageCode.Rust;
  const lateRust = scene.samples.at(-1).languageCode.Rust;
  assert.ok(earlyRust > scene.samples[0].code * 0.65, `early Rust ${earlyRust} should dominate`);
  assert.ok(lateRust < scene.samples.at(-1).code * 0.25, `late Rust ${lateRust} should shrink`);
  for (const sample of scene.samples) {
    const sum = Object.values(sample.languageCode).reduce((a, b) => a + b, 0);
    assert.equal(sum, sample.code, "split must sum to the sample total");
  }
  // A partially-real series stays disclosed as modeled.
  const mixed = buildScene({
    report: makeReport(reactLanguages, reactTotal),
    history: makeHistory([slocPoints[0], ...reactSloc.slice(1)]),
    languageColors: reactColors,
  });
  assert.equal(mixed.realLanguageSplit, false);
  assert.equal(mixed.samples[0].realSplit, true);
  assert.equal(mixed.samples[1].realSplit, false);
});
