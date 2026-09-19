#!/usr/bin/env node

// Resubmit already-known URLs to IndexNow so search engines recrawl them
// promptly. Built for Bing Webmaster Tools exports ("Duplicate meta
// descriptions" etc. list the affected URLs), but accepts any text file with
// one octocounts.com URL per line, quoted or bare. The key file at
// https://<host>/<key>.txt is served by the Cloudflare Pages function from
// the same INDEXNOW_KEY variable this script reads — the two must match.

import { readFile } from "node:fs/promises";

const DEFAULT_HOST = "octocounts.com";
const DEFAULT_ENDPOINT = "https://api.indexnow.org/indexnow";
// IndexNow allows 10,000 URLs per request; smaller batches keep one bad
// batch from blocking the rest and match the backend's conservative size.
const DEFAULT_BATCH = 100;

export function parseCsvUrls(text, { host = DEFAULT_HOST } = {}) {
  const prefix = `https://${host}/`;
  const seen = new Set();
  const urls = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    // First quoted field of the line, or a bare URL: either way the value
    // cannot contain a quote, so this stays correct even when later fields
    // (Bing's description column) contain commas or escaped quotes.
    const match = line.match(/^\ufeff?"(https:\/\/[^"]+)"|^?(https:\/\/\S+)/);
    const url = match?.[1] ?? match?.[2];
    if (!url || !url.startsWith(prefix) || url === prefix) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export function buildPayload({ host, key, urls }) {
  return {
    host,
    key,
    keyLocation: `https://${host}/${key}.txt`,
    urlList: urls,
  };
}

export async function submitUrls({
  urls,
  host = DEFAULT_HOST,
  key,
  endpoint = DEFAULT_ENDPOINT,
  batch = DEFAULT_BATCH,
  fetchImpl = fetch,
  dryRun = false,
}) {
  if (!key) throw new Error("INDEXNOW_KEY is required (must match the Pages env var serving the key file)");
  if (!urls.length) return { batches: 0, submitted: 0, ok: true, failures: [] };

  const failures = [];
  let submitted = 0;
  const batches = [];
  for (let i = 0; i < urls.length; i += batch) batches.push(urls.slice(i, i + batch));

  for (const chunk of batches) {
    const payload = buildPayload({ host, key, urls: chunk });
    if (dryRun) {
      console.log(`[dry-run] would submit ${chunk.length} URLs (${chunk[0]} … ${chunk[chunk.length - 1]})`);
      submitted += chunk.length;
      continue;
    }
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    // IndexNow answers 200/202 on acceptance; anything else (403 bad key,
    // 422 malformed list, 429 quota) is reported per batch, not thrown, so
    // one bad batch cannot block the remaining URLs.
    if (response.ok || response.status === 202) {
      submitted += chunk.length;
      console.log(`submitted ${chunk.length} URLs -> ${response.status}`);
    } else {
      failures.push({ status: response.status, sample: chunk[0], count: chunk.length });
      console.error(`batch failed (${response.status}): ${chunk[0]} … (${chunk.length} URLs)`);
    }
  }
  return { batches: batches.length, submitted, ok: failures.length === 0, failures };
}

// FIX-4 (SG-08 leftover): prove the key file the edge function serves from
// INDEXNOW_KEY is actually reachable and byte-identical to the key we submit.
// IndexNow rejects submissions whose keyLocation cannot be fetched, so a
// mismatch here silently voids every ping — check it before blaming quotas.
export async function verifyKeyLocation({ host = DEFAULT_HOST, key, fetchImpl = fetch }) {
  if (!key) throw new Error("INDEXNOW_KEY is required (must match the Pages env var serving the key file)");
  const keyLocation = `https://${host}/${key}.txt`;
  try {
    const response = await fetchImpl(keyLocation);
    const body = response.ok ? (await response.text()).trim() : "";
    return {
      ok: response.ok && body === key,
      status: response.status,
      keyLocation,
      detail: !response.ok
        ? `key file answered ${response.status}`
        : body === key
          ? "key file matches INDEXNOW_KEY"
          : `key file content mismatch (served ${JSON.stringify(body.slice(0, 40))})`,
    };
  } catch (error) {
    return { ok: false, status: 0, keyLocation, detail: `key file unreachable: ${error.message}` };
  }
}

export function extractSitemapLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((match) => match[1]);
}

// FIX-5: the core sitemap children are the canonical "pages worth indexing"
// list (static pages + curated comparisons, no /github/* report pages).
// Submitting them once after a deploy nudges IndexNow engines to recrawl the
// pages that actually rank, instead of waiting for organic rediscovery.
export async function fetchCoreUrls({ host = DEFAULT_HOST, fetchImpl = fetch } = {}) {
  const urls = [];
  for (const path of ["/sitemap-static.xml", "/sitemap-compare.xml"]) {
    const response = await fetchImpl(`https://${host}${path}`);
    if (!response.ok) throw new Error(`${path} answered ${response.status} — deploy the split sitemap first`);
    const locs = extractSitemapLocs(await response.text());
    if (!locs.length) throw new Error(`${path} contains no URLs`);
    urls.push(...locs);
  }
  return [...new Set(urls)];
}

async function main(argv) {
  const flags = argv.filter((arg) => arg.startsWith("--"));
  const files = argv.filter((arg) => !arg.startsWith("--"));
  const key = process.env.INDEXNOW_KEY;
  const host = process.env.INDEXNOW_HOST || DEFAULT_HOST;
  const endpoint = process.env.INDEXNOW_ENDPOINT || DEFAULT_ENDPOINT;

  if (flags.includes("--verify-key")) {
    const result = await verifyKeyLocation({ host, key });
    console.error(`${result.keyLocation} -> ${result.status}: ${result.detail}`);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (!files.length && !flags.includes("--core")) {
    console.error("usage: node scripts/resubmit-urls-indexnow.mjs <bing-export.csv | url-list.txt> [more files...]");
    console.error("       node scripts/resubmit-urls-indexnow.mjs --core        # submit the static+compare sitemap URLs");
    console.error("       node scripts/resubmit-urls-indexnow.mjs --verify-key  # check https://<host>/<key>.txt serves INDEXNOW_KEY");
    console.error("env: INDEXNOW_KEY (required), INDEXNOW_HOST, INDEXNOW_ENDPOINT, DRY_RUN=1");
    process.exitCode = 1;
    return;
  }

  const urls = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const parsed = parseCsvUrls(text, { host });
    console.error(`${file}: ${parsed.length} ${host} URLs`);
    urls.push(...parsed);
  }
  if (flags.includes("--core")) {
    const core = await fetchCoreUrls({ host });
    console.error(`--core: ${core.length} URLs from ${host}/sitemap-static.xml + /sitemap-compare.xml`);
    urls.push(...core);
  }
  const unique = [...new Set(urls)];
  console.error(`resubmitting ${unique.length} unique URLs to ${endpoint}`);

  const result = await submitUrls({ urls: unique, host, key, endpoint, dryRun: process.env.DRY_RUN === "1" });
  console.error(`done: ${result.submitted}/${unique.length} URLs accepted across ${result.batches} batch(es)`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("resubmit-urls-indexnow.mjs")) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
