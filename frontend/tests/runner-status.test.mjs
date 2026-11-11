import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

// Same transpile-to-node_modules-cache pattern as github-status.test.mjs: a
// data: URL has no parent directory to resolve specifiers from. reportUtils
// imports ./i18n (which drags in the whole i18next runtime and its
// window-dependent language detection) and re-exports from ./colorContrast,
// so the compiled copy lands in the node_modules cache with the i18n import
// rewritten to a deterministic stub. The logic under test is the decode —
// which status, which log line, which progress — not the locale copy.
const cacheDir = new URL("../node_modules/.cache/octocounts-tests/", import.meta.url);
const compiled = await transform(await readFile(new URL("../src/reportUtils.ts", import.meta.url), "utf8"), { loader: "ts", format: "esm", target: "es2020" });
await mkdir(cacheDir, { recursive: true });
// t() returns the key (plus its interpolation values) so assertions pin the
// exact key the decode picked without embedding locale copy here.
await writeFile(new URL("i18n-stub.mjs", cacheDir), `export default {
  language: "en",
  t(key, options) {
    if (!options) return key;
    const vars = Object.entries(options).map(([name, value]) => name + "=" + value).join(",");
    return key + "(" + vars + ")";
  },
};
`);
const colorContrast = await transform(await readFile(new URL("../src/colorContrast.ts", import.meta.url), "utf8"), { loader: "ts", format: "esm", target: "es2020" });
await writeFile(new URL("colorContrast.mjs", cacheDir), colorContrast.code);
// reportUtils also imports the canonical-options predicate from the shared
// functions/ source (summaryScopeLabel); compile that peer alongside so its
// relative specifier survives the move into the cache.
const reportCopy = await transform(await readFile(new URL("../functions/report-copy.js", import.meta.url), "utf8"), { loader: "js", format: "esm", target: "es2020" });
await writeFile(new URL("report-copy.mjs", cacheDir), reportCopy.code);
await writeFile(
  new URL("report-utils.mjs", cacheDir),
  compiled.code.replace('from "./i18n"', 'from "./i18n-stub.mjs"').replace('from "./colorContrast"', 'from "./colorContrast.mjs"').replace('from "../functions/report-copy.js"', 'from "./report-copy.mjs"'),
);
const { runnerStatus, logLines, progressValue } = await import(new URL("report-utils.mjs", cacheDir).href);

const report = (overrides = {}) => ({
  refName: "main",
  commitSha: "abcdef1234567890",
  cached: false,
  languages: [{ name: "Rust", stats: { code: 10 } }],
  total: { lines: 12 },
  durationMs: 345,
  ...overrides,
});

test("runnerStatus keeps the existing ladder and decodes only the deadline code as timedOut", () => {
  assert.equal(runnerStatus({ error: null, report: null, jobStatus: undefined, pending: false }), "idle");
  // pending covers both a submitted POST and an accepted jobId.
  assert.equal(runnerStatus({ error: null, report: null, jobStatus: undefined, pending: true }), "queued");
  assert.equal(runnerStatus({ error: null, report: null, jobStatus: "queued", pending: true }), "queued");
  assert.equal(runnerStatus({ error: null, report: null, jobStatus: "running", pending: true }), "running");
  assert.equal(runnerStatus({ error: null, report: report({ cached: true }), jobStatus: "completed", pending: false }), "cached");
  assert.equal(runnerStatus({ error: null, report: report(), jobStatus: "completed", pending: false }), "completed");
  // The gap this guards: job poll says completed, report not downloaded yet.
  assert.equal(runnerStatus({ error: null, report: null, jobStatus: "completed", pending: true }), "completed");
  assert.equal(runnerStatus({ error: { code: "private_repo", message: "nope" }, report: null, jobStatus: "failed", pending: false }), "failed");
  assert.equal(runnerStatus({ error: { message: "no code at all" }, report: null, jobStatus: "running", pending: true }), "failed");
});

test("the 300s deadline's stamped code is the only path to timedOut, and it outranks a leftover report", () => {
  assert.equal(runnerStatus({ error: { code: "timed_out", message: "too slow" }, report: null, jobStatus: "running", pending: true }), "timedOut");
  // A seed/stale report must not mask a deadline failure of the current run.
  assert.equal(runnerStatus({ error: { code: "timed_out", message: "too slow" }, report: report(), jobStatus: undefined, pending: false }), "timedOut");
  // Server-side codes never collide with it.
  assert.notEqual(runnerStatus({ error: { code: "analysis_failed", message: "x" }, report: null, jobStatus: "failed", pending: false }), "timedOut");
});

test("the completed-without-report gap logs a fetching line instead of an empty log", () => {
  const lines = logLines("completed", null, null, 7);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], { ts: "00:07", kind: "ok", text: "runner.log.fetchingReport" });
});

test("a loaded report still renders the full four-line log, cached or fresh", () => {
  assert.deepEqual(logLines("completed", report(), null), [
    { ts: "00:01", kind: "ok", text: "runner.log.resolvedRef(ref=main,sha=abcdef123456)" },
    { ts: "00:02", kind: "ok", text: "runner.log.freshReport" },
    { ts: "00:03", kind: "ok", text: "runner.log.languageRows(count=1)" },
    { ts: "00:04", kind: "ok", text: "runner.log.counted(lines=12,duration=345)" },
  ]);
  const cached = logLines("completed", report({ cached: true }), null);
  assert.equal(cached[1].text, "runner.log.cacheHit");
});

test("timedOut renders its own error log line and terminal progress", () => {
  assert.deepEqual(logLines("timedOut", null, null), [{ ts: "00:00", kind: "err", text: "runner.status.timedOut" }]);
  assert.deepEqual(logLines("timedOut", null, "deadline hit after 5m"), [{ ts: "00:00", kind: "err", text: "deadline hit after 5m" }]);
  assert.equal(progressValue("timedOut"), 100);
});

test("progress stays pinned across every status", () => {
  assert.equal(progressValue("idle"), 0);
  assert.equal(progressValue("queued"), 30);
  assert.equal(progressValue("running"), 64);
  assert.equal(progressValue("failed"), 100);
  assert.equal(progressValue("timedOut"), 100);
  assert.equal(progressValue("completed"), 100);
  assert.equal(progressValue("cached"), 100);
});

test("every status the decoders can emit has copy in both locales", async () => {
  // Runner renders runner.status.<status> and runner.statusShort.<status> for
  // whatever AppStatus arrives; a missing key would leak the raw key string
  // into the UI (i18next has no fallbackLng gap protection for this in tests).
  for (const locale of ["en", "zh"]) {
    const bundle = JSON.parse(await readFile(new URL(`../src/locales/${locale}.json`, import.meta.url), "utf8"));
    for (const status of ["idle", "queued", "running", "completed", "cached", "failed", "timedOut"]) {
      assert.ok(bundle.runner.status[status], `${locale} runner.status.${status}`);
      assert.ok(bundle.runner.statusShort[status], `${locale} runner.statusShort.${status}`);
    }
    assert.ok(bundle.runner.log.fetchingReport, `${locale} runner.log.fetchingReport`);
    assert.ok(bundle.errorHelp.timed_out, `${locale} errorHelp.timed_out`);
  }
});
