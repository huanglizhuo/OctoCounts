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

async function main(argv) {
  const files = argv.filter((arg) => !arg.startsWith("--"));
  if (!files.length) {
    console.error("usage: node scripts/resubmit-urls-indexnow.mjs <bing-export.csv | url-list.txt> [more files...]");
    console.error("env: INDEXNOW_KEY (required), INDEXNOW_HOST, INDEXNOW_ENDPOINT, DRY_RUN=1");
    process.exitCode = 1;
    return;
  }
  const key = process.env.INDEXNOW_KEY;
  const host = process.env.INDEXNOW_HOST || DEFAULT_HOST;
  const endpoint = process.env.INDEXNOW_ENDPOINT || DEFAULT_ENDPOINT;

  const urls = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const parsed = parseCsvUrls(text, { host });
    console.error(`${file}: ${parsed.length} ${host} URLs`);
    urls.push(...parsed);
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
