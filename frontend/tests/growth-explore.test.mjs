import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

const source = await readFile(new URL("../src/growth/exploreData.ts", import.meta.url), "utf8");
const compiled = await transform(source, { loader: "ts", format: "esm" });
const { validateExploreList, validateExploreStats, languageShares } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
const repo = { owner: "octo", repo: "example", publicPath: "/github/octo/example", generatedAt: "2026-11-03T00:00:00Z", total: { code: 100, files: 20 }, languages: [
  { name: "Rust", stats: { code: 40 } }, { name: "JSON", stats: { code: 25 } }, { name: "Shell", stats: { code: 15 } },
] };

test("list snapshots validate navigation and measurements, including zero and legacy pagination", () => {
  const list = { page: 2, limit: 36, hasNext: false, reports: [repo] };
  assert.equal(validateExploreList(list), list);
  assert.ok(validateExploreList({ ...list, hasNext: undefined, reports: [{ ...repo, total: { code: 0 } }] }));
  for (const patch of [{ publicPath: "javascript:alert(1)" }, { publicPath: "//example.com" }, { generatedAt: "invalid" }, { total: { code: -1 } }, { languages: [{ name: "Rust", stats: { code: null } }] }]) {
    assert.equal(validateExploreList({ ...list, reports: [{ ...repo, ...patch }] }), undefined);
  }
  assert.equal(validateExploreList({ ...list, hasNext: "false" }), undefined);
  assert.equal(validateExploreList({ ...list, page: 0 }), undefined);
  assert.equal(validateExploreStats({ totals: {}, windows: {} }), undefined);
});

test("language bars include the unreturned tail without inflating small or zero counts", () => {
  assert.deepEqual(languageShares(repo), [{ name: "Rust", code: 40 }, { name: "JSON", code: 25 }, { name: "Shell", code: 15 }, { name: "", code: 20 }]);
  assert.deepEqual(languageShares({ ...repo, total: { code: 0 } }), []);
  assert.deepEqual(languageShares({ ...repo, total: { code: 30 } }), []);
  assert.deepEqual(languageShares({ ...repo, languages: undefined }), []);
});
