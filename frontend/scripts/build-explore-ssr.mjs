import { build } from "esbuild";
import { readFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await build({
  absWorkingDir: root, entryPoints: ["src/growth/explore-server.tsx"],
  outfile: ".generated/explore-ssr.js", bundle: true, format: "esm", platform: "browser",
  conditions: ["workerd"], target: "es2022", jsx: "automatic", minify: true,
  define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
});
const manifest = JSON.parse(await readFile(new URL("../dist/.vite/manifest.json", import.meta.url), "utf8"));
const files = new Set();
function visit(key) {
  const chunk = manifest[key];
  if (!chunk || files.has(chunk.file)) return;
  files.add(chunk.file);
  for (const dependency of chunk.imports ?? []) visit(dependency);
}
visit("src/growth/ExploreApp.tsx");
if (!files.size) throw new Error("Explore entry missing from Vite manifest");
await appendFile(new URL("../.generated/explore-ssr.js", import.meta.url), `\nexport const explorePreloads = ${JSON.stringify([...files])};\n`);
console.log("Explore SSR bundle and preload manifest built");
