import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the VPS web image and release workflow use an API origin without duplicating /api", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../../.github/workflows/build-images.yml", import.meta.url), "utf8");
  const base = dockerfile.match(/^ARG VITE_API_BASE=(.+)$/m)?.[1];
  assert.equal(new URL(`${base}/api/stats`).href, "https://api.octocounts.com/api/stats");
  assert.ok(workflow.includes(`default: "${base}"`));
  const defaults = [...workflow.matchAll(/vite_api_base \|\| '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(defaults, [base, base]);
});

test("the preview HTML cache policy retains inherited security and noindex headers", async () => {
  const config = await readFile(new URL("../nginx.conf", import.meta.url), "utf8");
  const indexLocation = config.match(/location = \/index\.html \{([^}]+)\}/)?.[1];
  assert.ok(indexLocation, "the SPA HTML needs an explicit revalidation policy");
  // Nginx 1.27 drops all parent add_header directives if a child defines any.
  assert.doesNotMatch(indexLocation, /^\s*add_header\s/m);
  assert.match(indexLocation, /^\s*expires -1;/m);
  const serverHeaders = config.slice(0, config.search(/^\s*location\s/m));
  for (const header of ["Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options", "X-Robots-Tag"]) {
    assert.match(serverHeaders, new RegExp(`add_header ${header} `));
  }
});
