#!/usr/bin/env node
// Build-time homepage prerender (S1: unify the homepage's server and client
// output). Runs after `vite build` (chained in package.json's build script)
// and emits the homepage as separate deployment assets:
//
//   dist/home.html     English homepage: full first-paint React markup
//   dist/home-zh.html  Chinese homepage (same tree, zh locale)
//
// dist/index.html is NOT modified — every other route keeps the plain SPA
// shell with an empty #root, and the Pages Function (functions/[[path]].js)
// serves the prerendered asset only for "/" (/?lng=zh picks the zh variant).
//
// Marker contract between this script, the function, and src/main.tsx:
//   <div id="root" data-oc-prerender="home" data-oc-locale="en|zh">…</div>
// The function keys its asset choice off the URL; main.tsx keys hydrateRoot
// (instead of createRoot) off the stamped attributes. No string surgery at
// request time, no arbitrary marker sniffing.
//
// The head (title/description/canonical/OG/JSON-LD/boot script/hashed asset
// tags) is inherited verbatim from the built dist/index.html — the exact page
// the browser loads — with two build-time-only adjustments:
//   - the <noscript> fallback is removed (the prerendered body already carries
//     the real, crawler-visible content; a second h1 would duplicate it), and
//   - the zh variant swaps <html lang> and the title/description/OG strings
//     for the zh locale's app.title/app.description.
//
// No new runtime dependencies: esbuild ships with vite, react-dom/server with
// react-dom. The SSR bundle is written to the OS temp dir, never into dist.
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const distIndex = path.join(root, "dist", "index.html");

if (process.argv.includes("--help")) {
  console.log("usage: node scripts/prerender-home.mjs   # after `vite build`");
  process.exit(0);
}

// The app tree reads window.location.pathname during render. Install the
// smallest possible home-route shim BEFORE importing the bundle so module
// init and render both see it; effects (the only place anything heavier is
// touched) never run under renderToString. The origin exists so absolute-URL
// builders degrade to the production origin instead of the string
// "undefined" — but rendered hrefs use the path builders (no origin), which
// is what keeps prerender and hydration output identical.
globalThis.window = { location: { pathname: "/", search: "", hash: "", origin: "https://octocounts.com" } };

// CJS, not ESM: react-dom/server's Node build `require`s core modules, and an
// ESM-format esbuild bundle cannot express that. A .cjs bundle keeps `require`
// native. Node's ESM-CJS interop still lets this script import it.
const bundlePath = path.join(tmpdir(), "octocounts-home-prerender.cjs");
await build({
  entryPoints: [path.join(root, "src", "prerender-entry.tsx")],
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  outfile: bundlePath,
  loader: { ".css": "empty" },
  // Vite injects import.meta.env at build time; in the Node bundle it is an
  // empty object, so every `import.meta.env.X ?? fallback` keeps its fallback.
  define: { "import.meta.env": "{}" },
  logLevel: "silent",
});

const bundle = await import(pathToFileURL(bundlePath).href);
const { renderHome } = bundle.default ?? bundle;
const index = await readFile(distIndex, "utf8");

const rootMarker = '<div id="root"></div>';
if (!index.includes(rootMarker)) {
  console.error("prerender-home: dist/index.html has no `<div id=\"root\"></div>` marker — did the build change?");
  process.exit(1);
}
// The SPA shell keeps its noscript fallback for JS-off visitors on non-home
// routes (the Pages Function strips it on SSR routes); the prerendered home
// replaces it with the real body, so a second h1 inside noscript must go.
const stripped = index.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>\s*/gi, "");
if (stripped === index) {
  console.error("prerender-home: dist/index.html has no <noscript> block to strip — template drift?");
  process.exit(1);
}

const escapeAttr = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The zh variant carries a coherent zh head: <html lang>, title/description,
// and the OG/Twitter mirror swap to the zh locale strings read from source.
// Canonical stays https://octocounts.com/ — the zh view is a URL-param variant
// of the one canonical homepage, not a separate page.
const zhLocale = JSON.parse(await readFile(path.join(root, "src", "locales", "zh.json"), "utf8"));
function zhHead(html) {
  const title = escapeAttr(zhLocale.app.title);
  const description = escapeAttr(zhLocale.app.description);
  const replaceMeta = (prefix) => new RegExp(`${prefix} content="[^"]*" />`);
  return html
    .replace('<html lang="en">', '<html lang="zh">')
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(replaceMeta('<meta name="description"'), `<meta name="description" content="${description}" />`)
    .replace(replaceMeta('<meta property="og:title"'), `<meta property="og:title" content="${title}" />`)
    .replace(replaceMeta('<meta property="og:description"'), `<meta property="og:description" content="${description}" />`)
    .replace(replaceMeta('<meta property="og:locale"'), `<meta property="og:locale" content="zh_CN" />`)
    .replace(replaceMeta('<meta name="twitter:title"'), `<meta name="twitter:title" content="${title}" />`)
    .replace(replaceMeta('<meta name="twitter:description"'), `<meta name="twitter:description" content="${description}" />`);
}

for (const locale of ["en", "zh"]) {
  const body = await renderHome(locale);
  if (!body.includes('id="hero-title"') || !body.includes('id="repo-url"')) {
    console.error(`prerender-home: ${locale} render looks wrong (no hero title / repo input in output)`);
    process.exit(1);
  }
  // The deterministic tree must not contain UNRESOLVED Suspense machinery:
  // a pending marker means something suspended, and hydrating a
  // renderToString fallback against real client content regenerates the whole
  // tree — the exact server/client divergence this prerender exists to
  // eliminate. (Completed boundaries inline their content behind a harmless
  // <!--$-->…<!--/$--> pair, which is what hydrateRoot expects.)
  if (/<!--\$\?|<!--\$!|\$RC|<div hidden/.test(body)) {
    console.error(`prerender-home: ${locale} render contains unresolved Suspense boundary output; the first-paint tree must not suspend (see prerenderContext.ts)`);
    process.exit(1);
  }
  if (!body.includes("extension-panel-compact")) {
    console.error(`prerender-home: ${locale} render is missing the eagerly injected extension promo`);
    process.exit(1);
  }
  const stamped = `<div id="root" data-oc-prerender="home" data-oc-locale="${locale}">${body}</div>`;
  const page = (locale === "zh" ? zhHead(stripped) : stripped).replace(rootMarker, stamped);
  const outFile = path.join(root, "dist", locale === "zh" ? "home-zh.html" : "home.html");
  await writeFile(outFile, page);
  console.log(`prerender-home: wrote ${path.relative(root, outFile)} (${page.length} bytes, locale ${locale})`);
}
