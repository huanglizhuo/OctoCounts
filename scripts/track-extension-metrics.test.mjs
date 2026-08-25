import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecord,
  parseEdgeHtml,
  parseRatingValue,
  parseShieldMetric,
  parseUsersValue,
  parseVersionValue,
  toJsonlLine,
} from "./track-extension-metrics.mjs";

test("parses shields users badge values", () => {
  assert.equal(parseShieldMetric('{"label":"users","value":"118"}', "users"), 118);
  assert.equal(parseShieldMetric('{"label":"users","value":"1.2k"}', "users"), 12);
  assert.equal(parseShieldMetric('{"value":"not found"}', "users"), null);
  assert.equal(parseShieldMetric("not json", "users"), null);
});

test("parses shields rating and version badge values", () => {
  assert.equal(parseShieldMetric('{"value":"5/5"}', "rating"), 5);
  assert.equal(parseShieldMetric('{"value":"4.5/5"}', "rating"), 4.5);
  assert.equal(parseShieldMetric('{"value":"v0.4.6"}', "version"), "0.4.6");
  assert.equal(parseShieldMetric('{"value":"inaccessible"}', "version"), null);
});

test("parses Edge Add-ons schema.org microdata", () => {
  const html = `
    <div itemscope itemtype="http://schema.org/WebApplication">
      <span itemProp="interactionStatistic" itemscope itemType="http://schema.org/InteractionCounter">
        <meta itemProp="userInteractionCount" content="42" />
      </span>
    </div>
    <span itemprop="aggregateRating" itemscope itemtype="http://schema.org/AggregateRating">
      <meta itemprop="ratingValue" content="4.5">
      <meta itemProp="bestRating" content="5" />
      <meta itemprop="ratingCount" content="7">
    </span>`;

  assert.deepEqual(parseEdgeHtml(html), { users: 42, rating: 4.5, ratingCount: 7, version: null });
  assert.deepEqual(parseEdgeHtml("<html></html>"), { users: null, rating: null, ratingCount: null, version: null });
});

test("value parsers tolerate missing or malformed input", () => {
  assert.equal(parseUsersValue(undefined), null);
  assert.equal(parseUsersValue("0"), 0);
  assert.equal(parseRatingValue("0"), 0);
  assert.equal(parseRatingValue("no rating"), null);
  assert.equal(parseVersionValue("0.4.6"), "0.4.6");
  assert.equal(parseVersionValue(null), null);
});

test("builds null-safe jsonl records", () => {
  const record = buildRecord("2026-08-24", "chrome", { users: 118, rating: 5, version: "0.4.6" });
  assert.deepEqual(record, {
    date: "2026-08-24",
    store: "chrome",
    users: 118,
    rating: 5,
    ratingCount: null,
    version: "0.4.6",
  });

  const line = toJsonlLine(buildRecord("2026-08-24", "edge"));
  assert.equal(line.includes("\n"), false);
  assert.deepEqual(JSON.parse(line), {
    date: "2026-08-24",
    store: "edge",
    users: null,
    rating: null,
    ratingCount: null,
    version: null,
  });
});
