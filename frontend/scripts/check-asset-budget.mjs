import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const dist = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL(".vite/manifest.json", dist), "utf8"));

function assetsFor(entries, graph = manifest) {
  const visited = new Set();
  const assets = new Set(["analytics-runtime.js"]);
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = graph[key];
    assert.ok(!/(?:^|\/)node_modules\/(?:html-to-image|gifenc)\//.test(key)
      && !key.startsWith("_react-dom-server-"), `exporter must remain deferred: ${key}`);
    assert.ok(chunk, `missing manifest entry: ${key}`);
    assets.add(chunk.file);
    for (const css of chunk.css ?? []) assets.add(css);
    for (const dependency of chunk.imports ?? []) visit(dependency);
  }
  entries.forEach(visit);
  return assets;
}

// Manifest identity survives hashed or generic output names such as index-abc.js.
for (const exporter of ["node_modules/html-to-image/es/index.js", "node_modules/gifenc/dist/gifenc.esm.js", "_react-dom-server-abc.js"]) {
  assert.throws(() => assetsFor(["entry"], {
    entry: { file: "assets/main.js", imports: [exporter] },
    [exporter]: { file: "assets/index-abc.js" },
  }), /exporter must remain deferred/);
}
assert.deepEqual([...assetsFor(["entry"], {
  entry: { file: "assets/main.js", dynamicImports: ["node_modules/html-to-image/es/index.js"] },
})], ["analytics-runtime.js", "assets/main.js"]);

// October 2026 build baseline: EN home ~142 KiB JS / 15 KiB CSS gzip.
// These transfer budgets catch regressions; they do not measure real-user CWV.
const pages = [
  ["home", ["index.html", "src/BrowserExtensionSection.tsx"], 165],
  ["home zh", ["index.html", "src/BrowserExtensionSection.tsx", "src/locales/zh.json"], 180],
  ["report", ["index.html", "src/report/Share.tsx", "src/report/Insights.tsx", "src/report/SimilarRepos.tsx", "src/report/GrowthSection.tsx"], 200],
  ["tools", ["index.html", "src/pages/marketing.tsx"], 175],
];
for (const [name, entries, jsKiB] of pages) {
  let js = 0, css = 0;
  const assets = assetsFor(entries);
  for (const file of assets) {
    const bytes = gzipSync(await readFile(new URL(file, dist))).byteLength;
    if (file.endsWith(".css")) css += bytes;
    else js += bytes;
  }
  console.log(`${name}: JS ${(js / 1024).toFixed(1)}/${jsKiB} KiB, CSS ${(css / 1024).toFixed(1)}/18 KiB gzip`);
  assert.ok(js <= jsKiB * 1024, `${name}: JavaScript transfer budget exceeded`);
  assert.ok(css <= 18 * 1024, `${name}: stylesheet transfer budget exceeded`);
}
