#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const TRENDING_URL = "https://github.com/trending?since=daily";
const DEFAULT_OUTPUT = new URL("../frontend/public/github-trending.json", import.meta.url);
const DEFAULT_REPO_FILE = new URL("../data/github-trending-repos.txt", import.meta.url);

export function parseTrendingHtml(html, limit = 20) {
  const articles = [...String(html).matchAll(/<article\s+class="Box-row">([\s\S]*?)<\/article>/gi)];
  const repositories = [];

  for (const [, article] of articles) {
    const heading = article.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="\/([^"/]+)\/([^"/]+)"/i);
    if (!heading) continue;

    const owner = decodePathPart(heading[1]);
    const name = decodePathPart(heading[2]);
    const descriptionMatch = article.match(/<p\s+class="[^"]*\bcol-9\b[^"]*">([\s\S]*?)<\/p>/i);
    const languageMatch = article.match(/<span\s+itemprop="programmingLanguage">([\s\S]*?)<\/span>/i);
    const starsTodayMatch = article.match(/([\d,]+)\s+stars today/i);
    const starsLink = article.match(new RegExp(`href="/${escapeRegExp(heading[1])}/${escapeRegExp(heading[2])}/stargazers"[^>]*>([\\s\\S]*?)<\\/a>`, "i"));

    repositories.push({
      rank: repositories.length + 1,
      owner,
      name,
      fullName: `${owner}/${name}`,
      description: cleanText(descriptionMatch?.[1] ?? ""),
      language: cleanText(languageMatch?.[1] ?? "") || null,
      starsToday: parseCount(starsTodayMatch?.[1]),
      totalStars: parseCount(cleanText(starsLink?.[1] ?? "")),
      htmlUrl: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      publicPath: `/github/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    });

    if (repositories.length >= limit) break;
  }

  return repositories;
}

export async function fetchTrending(fetchImpl = fetch, limit = 20) {
  const response = await fetchImpl(TRENDING_URL, {
    headers: {
      accept: "text/html",
      "user-agent": "OctoCounts trending cache (+https://octocounts.com)",
    },
  });
  if (!response.ok) throw new Error(`GitHub Trending returned ${response.status} ${response.statusText}`);

  const repositories = parseTrendingHtml(await response.text(), limit);
  if (repositories.length < Math.min(5, limit)) {
    throw new Error(`GitHub Trending parser found only ${repositories.length} repositories; refusing to publish a partial snapshot`);
  }
  return repositories;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = numberArg(args.limit, 20);
  const output = args.output ?? DEFAULT_OUTPUT;
  const repoFile = args["repo-file"] ?? DEFAULT_REPO_FILE;
  const repositories = await fetchTrending(fetch, limit);
  const generatedAt = new Date().toISOString();
  const snapshot = {
    source: "https://github.com/trending",
    period: "daily",
    generatedAt,
    date: generatedAt.slice(0, 10),
    repositories,
  };

  await mkdir(new URL(".", toFileUrl(output)), { recursive: true });
  await mkdir(new URL(".", toFileUrl(repoFile)), { recursive: true });
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
  await writeFile(repoFile, `# GitHub Trending daily snapshot generated ${generatedAt}\n${repositories.map((repo) => repo.fullName).join("\n")}\n`);
  console.log(`Saved ${repositories.length} GitHub Trending repositories for ${snapshot.date}`);
}

function cleanText(value) {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function decodePathPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCount(value) {
  const parsed = Number(String(value ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toFileUrl(value) {
  return value instanceof URL ? value : pathToFileURL(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
