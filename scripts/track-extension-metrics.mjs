#!/usr/bin/env node

import { appendFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_OUTPUT = new URL("../data/extension-metrics.jsonl", import.meta.url);

const SOURCES = [
  {
    store: "chrome",
    kind: "shields",
    base: "https://img.shields.io/chrome-web-store",
    id: "gkgjpjdnaklagijmekoolhcpebmoldbj",
  },
  {
    store: "firefox",
    kind: "shields",
    base: "https://img.shields.io/amo",
    id: "octocounts-github-sloc",
  },
  {
    store: "edge",
    kind: "edge-html",
    url: "https://microsoftedge.microsoft.com/addons/detail/ehifednhpbpekkadndaipnngopbhpoim",
  },
];

const FETCH_HEADERS = {
  accept: "application/json, text/html",
  "user-agent": "OctoCounts extension metrics tracker (+https://octocounts.com)",
};

export function parseUsersValue(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

export function parseRatingValue(value) {
  // Accepts shields-style "4.5/5" and plain numbers like Edge's ratingValue="0".
  const match = String(value ?? "").match(/([\d.]+)\s*(?:\/\s*5)?/);
  if (!match || !match[1]) return null;
  const rating = Number.parseFloat(match[1]);
  return Number.isFinite(rating) ? rating : null;
}

export function parseVersionValue(value) {
  const match = String(value ?? "").trim().match(/^v?(\d+(?:\.\d+)*)$/i);
  return match ? match[1] : null;
}

export function parseShieldMetric(body, metric) {
  let badge;
  try {
    badge = JSON.parse(body);
  } catch {
    return null;
  }
  const value = badge?.value ?? badge?.message;
  if (metric === "users") return parseUsersValue(value);
  if (metric === "rating") return parseRatingValue(value);
  if (metric === "version") return parseVersionValue(value);
  return null;
}

// The Edge Add-ons detail page exposes schema.org microdata for rating and
// interaction counts; the published version is not in the page HTML.
export function parseEdgeHtml(html) {
  const meta = (prop) => {
    const match = String(html).match(new RegExp(`<meta\\s+itemprop="${prop}"\\s+content="([^"]*)"`, "i"));
    return match?.[1];
  };
  return {
    users: parseUsersValue(meta("userInteractionCount")),
    rating: parseRatingValue(meta("ratingValue")),
    ratingCount: parseUsersValue(meta("ratingCount")),
    version: null,
  };
}

export function buildRecord(date, store, metrics = {}) {
  return {
    date,
    store,
    users: metrics.users ?? null,
    rating: metrics.rating ?? null,
    ratingCount: metrics.ratingCount ?? null,
    version: metrics.version ?? null,
  };
}

export function toJsonlLine(record) {
  return JSON.stringify(record);
}

async function fetchShieldMetric(source, segment, metric, fetchImpl) {
  try {
    const response = await fetchImpl(`${source.base}/${segment}/${source.id}.json`, { headers: FETCH_HEADERS });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = parseShieldMetric(await response.text(), metric);
    if (parsed === null) console.warn(`warn: shields ${source.store} ${metric} returned no usable value`);
    return parsed;
  } catch (error) {
    console.warn(`warn: shields ${source.store} ${metric} failed: ${error.message}`);
    return null;
  }
}

async function fetchShieldsMetrics(source, fetchImpl) {
  const [users, rating, version] = await Promise.all([
    fetchShieldMetric(source, "users", "users", fetchImpl),
    fetchShieldMetric(source, "rating", "rating", fetchImpl),
    fetchShieldMetric(source, "v", "version", fetchImpl),
  ]);
  return { users, rating, ratingCount: null, version };
}

async function fetchEdgeMetrics(source, fetchImpl) {
  const response = await fetchImpl(source.url, { headers: FETCH_HEADERS });
  if (!response.ok) throw new Error(`Edge Add-ons page returned HTTP ${response.status}`);
  return parseEdgeHtml(await response.text());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = args.output ?? DEFAULT_OUTPUT;
  const date = new Date().toISOString().slice(0, 10);

  const lines = [];
  let failures = 0;
  for (const source of SOURCES) {
    let metrics;
    try {
      metrics = source.kind === "shields" ? await fetchShieldsMetrics(source, fetch) : await fetchEdgeMetrics(source, fetch);
    } catch (error) {
      console.warn(`warn: ${source.store} metrics unavailable: ${error.message}`);
      metrics = {};
    }
    if (Object.values(metrics).every((value) => value === null || value === undefined)) failures += 1;
    const record = buildRecord(date, source.store, metrics);
    lines.push(toJsonlLine(record));
    console.log(`${source.store}: ${toJsonlLine(record)}`);
  }

  await mkdir(new URL(".", toFileUrl(output)), { recursive: true });
  await appendFile(output, `${lines.join("\n")}\n`);
  console.log(`Appended ${lines.length} records for ${date} to ${toFileUrl(output).pathname}`);

  if (failures === SOURCES.length) {
    console.error("error: every store failed; check network or upstream changes");
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) parsed[key] = inlineValue;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) parsed[key] = argv[++index];
    else parsed[key] = true;
  }
  return parsed;
}

function toFileUrl(value) {
  return value instanceof URL ? value : pathToFileURL(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
