import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// seo.test.mjs imports its transpiled module from a data: URL, which works
// there because colorContrast.ts imports nothing. githubStatus.ts imports React
// for its hook, and a data: URL has no parent directory to resolve a bare
// specifier from, so the compiled copy is written under node_modules/ instead:
// somewhere "react" resolves from, and somewhere git already ignores.
const cacheDir = new URL("../node_modules/.cache/octocounts-tests/", import.meta.url);
const source = await readFile(new URL("../src/githubStatus.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
await mkdir(cacheDir, { recursive: true });
const modulePath = new URL("github-status.mjs", cacheDir);
await writeFile(modulePath, compiled.outputText);
const { isHostDegraded } = await import(modulePath.href);

// The exact payload https://www.githubstatus.com/api/v2/status.json serves when
// nothing is wrong. The pairing is the trap this file exists for: the indicator
// says "none" while the description says "All Systems Operational", and the
// shipped bug was a comparison against the word from the description.
const HEALTHY = { indicator: "none", description: "All Systems Operational" };

test("GitHub's healthy payload is not degraded", () => {
  assert.equal(isHostDegraded(HEALTHY), false);
});

test('"operational" is not a statuspage indicator', () => {
  // If this ever asserts true, the homepage is back to telling every visitor
  // that analyses may fail while quoting "All Systems Operational" at them.
  assert.notEqual(HEALTHY.indicator, "operational");
  assert.equal(isHostDegraded({ indicator: "operational", description: "All Systems Operational" }), false);
});

test("real outage indicators are degraded", () => {
  for (const indicator of ["minor", "major", "critical", "maintenance"]) {
    assert.equal(isHostDegraded({ indicator, description: "Partial outage" }), true, indicator);
  }
});

test("an absent or unrecognised status is treated as healthy", () => {
  // Deliberate: the hint is supplementary, so a renamed indicator should cost a
  // missing warning during an outage rather than a permanent one at all times.
  assert.equal(isHostDegraded(null), false);
  assert.equal(isHostDegraded({ indicator: "", description: "" }), false);
  assert.equal(isHostDegraded({ indicator: "some_future_indicator", description: "?" }), false);
});
