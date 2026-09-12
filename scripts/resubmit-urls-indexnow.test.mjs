import assert from "node:assert/strict";
import test from "node:test";

import { buildPayload, parseCsvUrls, submitUrls } from "./resubmit-urls-indexnow.mjs";

test("parses Bing Webmaster Tools CSV exports, keeping only same-host URLs", () => {
  const csv = [
    "\ufeff\"URL\"",
    "\"https://octocounts.com/github/Flowseal/zapret-discord-youtube\",\"testerSunshine/12306 has 3,908 code lines across 68 files and 6 languages.\"",
    "\"https://octocounts.com/github/iptv-org/iptv\",\"testerSunshine/12306 has 3,908 code lines across 68 files and 6 languages.\"",
    "\"https://example.com/github/a/b\",\"other host\"",
    "\"https://octocounts.com/github/iptv-org/iptv\",\"duplicate row is dropped\"",
    "\"https://octocounts.com/\",\"bare homepage is not a URL worth resubmitting\"",
  ].join("\n");
  assert.deepEqual(parseCsvUrls(csv), [
    "https://octocounts.com/github/Flowseal/zapret-discord-youtube",
    "https://octocounts.com/github/iptv-org/iptv",
  ]);
});

test("parses plain one-URL-per-line lists and skips noise lines", () => {
  const text = [
    "# a comment",
    "https://octocounts.com/github/facebook/react",
    "",
    "not a url",
    "https://octocounts.com/recent",
  ].join("\n");
  assert.deepEqual(parseCsvUrls(text), [
    "https://octocounts.com/github/facebook/react",
    "https://octocounts.com/recent",
  ]);
});

test("builds the same payload shape the backend submits", () => {
  const payload = buildPayload({ host: "octocounts.com", key: "test-key", urls: ["https://octocounts.com/a"] });
  assert.equal(payload.host, "octocounts.com");
  assert.equal(payload.key, "test-key");
  assert.equal(payload.keyLocation, "https://octocounts.com/test-key.txt");
  assert.deepEqual(payload.urlList, ["https://octocounts.com/a"]);
});

test("submits in batches and reports failures without throwing", async () => {
  const calls = [];
  const fetchImpl = async (endpoint, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    // Fail the second batch like a quota hiccup; the rest must still go out.
    return new Response(null, { status: calls.length === 2 ? 429 : 202 });
  };
  const urls = Array.from({ length: 5 }, (_, i) => `https://octocounts.com/github/o/r${i}`);
  const result = await submitUrls({ urls, host: "octocounts.com", key: "k", endpoint: "https://idx.test", batch: 2, fetchImpl });

  assert.equal(calls.length, 3);
  assert.equal(result.batches, 3);
  assert.equal(result.submitted, 3);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [{ status: 429, sample: "https://octocounts.com/github/o/r2", count: 2 }]);
});

test("requires the key and handles an empty URL list", async () => {
  await assert.rejects(() => submitUrls({ urls: ["https://octocounts.com/a"], key: "" }), /INDEXNOW_KEY/);
  const empty = await submitUrls({ urls: [], host: "octocounts.com", key: "k", fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.deepEqual(empty, { batches: 0, submitted: 0, ok: true, failures: [] });
});
