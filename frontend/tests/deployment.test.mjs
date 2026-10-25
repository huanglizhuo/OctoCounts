import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
