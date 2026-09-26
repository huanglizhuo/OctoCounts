#!/usr/bin/env node
// Guards the CSP hash of the inline theme boot <script> in index.html.
//
// The boot script must run before first paint (it picks the color scheme and
// the document language), so it is inlined and allow-listed in TWO places
// that a browser enforces:
//   - frontend/nginx.conf            (Docker / nginx deployments)
//   - frontend/functions/[[path]].js (Cloudflare Pages, BOOT_SCRIPT_HASH)
// Editing index.html without updating those pins silently breaks the boot
// script (the browser refuses to execute an unlisted inline script), so this
// check recomputes the hash from index.html's exact bytes and compares it
// against every pin. No dependencies, no build — it runs in `npm test`.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function fail(message) {
  failures.push(message);
}

// --- 1. Extract the boot script and compute its hash -----------------------
//
// The boot script is the one attribute-less inline <script> element in
// index.html; every other script tag carries src/type/defer attributes.
const html = readFileSync(join(root, "index.html"), "utf8");
const bootBodies = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
  (match) => match[1],
);
if (bootBodies.length !== 1) {
  fail(
    `expected exactly one attribute-less inline <script> in index.html (the theme boot script), found ${bootBodies.length}`,
  );
}
const bootScript = bootBodies[0] ?? "";
// CSP hashes the exact bytes between <script> and </script>; index.html is
// UTF-8, so hashing the decoded string as UTF-8 is byte-identical.
const expected = `'sha256-${createHash("sha256").update(bootScript, "utf8").digest("base64")}'`;

// --- 2. nginx.conf ----------------------------------------------------------
const nginx = readFileSync(join(root, "nginx.conf"), "utf8");
const nginxCspLines = nginx
  .split("\n")
  .filter((line) => line.includes("Content-Security-Policy"));
if (nginxCspLines.length === 0) {
  fail("frontend/nginx.conf has no Content-Security-Policy header to check");
}
for (const line of nginxCspLines) {
  const scriptSrc = line.split("script-src")[1]?.split(";")[0];
  if (!scriptSrc) {
    fail(`frontend/nginx.conf CSP has no script-src directive: ${line.trim()}`);
    continue;
  }
  const pinned = [...scriptSrc.matchAll(/'sha256-[^']+'/g)].map((m) => m[0]);
  if (!pinned.includes(expected)) {
    fail(
      `frontend/nginx.conf script-src does not include the boot script hash ${expected}` +
        (pinned.length ? ` (found ${pinned.join(", ")})` : " (no sha256 hash pinned)"),
    );
  }
  for (const stale of pinned.filter((hash) => hash !== expected)) {
    fail(`frontend/nginx.conf script-src pins stale hash ${stale}`);
  }
}

// --- 3. Cloudflare Pages function -------------------------------------------
const functionsPath = join(root, "functions", "[[path]].js");
const functions = readFileSync(functionsPath, "utf8");
// The declaration is double-quoted with single quotes inside:
// const BOOT_SCRIPT_HASH = "'sha256-…'";
const bootHashDecl = functions.match(
  /BOOT_SCRIPT_HASH\s*=\s*(["'])((?:[^\\]|\\.)*?)\1/,
);
if (!bootHashDecl) {
  fail(`frontend/functions/[[path]].js has no BOOT_SCRIPT_HASH declaration`);
} else if (bootHashDecl[2] !== expected) {
  fail(
    `frontend/functions/[[path]].js BOOT_SCRIPT_HASH is ${bootHashDecl[2]}, expected ${expected}`,
  );
}

// --- Report ------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`check-csp-hash: FAILED (${failures.length})`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error(
    "\nThe CSP hash is sha256 over the exact bytes of the inline boot <script> in index.html.",
  );
  console.error(
    "Edit the script in index.html, then update every pin it lists above to the new hash:",
  );
  console.error(`  ${expected}`);
  process.exit(1);
}

console.log(`check-csp-hash: OK (boot script hash ${expected} matches nginx.conf and functions/[[path]].js)`);
