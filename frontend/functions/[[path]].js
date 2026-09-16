import { COMPARE_REGISTRY, findCuratedComparison } from "./compare-registry.js";
import { COMPARE_EDITORIAL } from "./compare-editorial.js";

const API_BASE = "https://api.octocounts.com";
const BOOT_SCRIPT_HASH = "'sha256-WRZoCRpV9YaIG5sPOijC2jelInnwDvYw9BYBSfp3VQY='";
// Per-URL content lastmod, mirroring frontend/content/content-manifest.json
// (seo.test.mjs asserts the two stay in sync). A date moves ONLY when that
// page's content really changes — never blanket-refresh all of them (SG-07).
const STATIC_SITEMAP_ENTRIES = [
  { loc: "https://octocounts.com/", lastmod: "2026-09-16" },
  { loc: "https://octocounts.com/stats", lastmod: "2026-09-05" },
  { loc: "https://octocounts.com/recent", lastmod: "2026-09-05" },
  { loc: "https://octocounts.com/popular", lastmod: "2026-09-05" },
  { loc: "https://octocounts.com/trending", lastmod: "2026-09-05" },
  { loc: "https://octocounts.com/hall-of-monoliths", lastmod: "2026-09-05" },
  { loc: "https://octocounts.com/badges", lastmod: "2026-09-05" },
  { loc: "https://octocounts.com/extension", lastmod: "2026-09-08" },
  { loc: "https://octocounts.com/docs/github-sloc-counter", lastmod: "2026-09-16" },
  { loc: "https://octocounts.com/docs/api", lastmod: "2026-09-16" },
  { loc: "https://octocounts.com/docs/methodology", lastmod: "2026-09-16" },
  { loc: "https://octocounts.com/docs/glossary", lastmod: "2026-09-16" },
  { loc: "https://octocounts.com/docs/faq", lastmod: "2026-09-16" },
  { loc: "https://octocounts.com/docs/octocounts-vs-cloc", lastmod: "2026-09-16" },
  { loc: "https://octocounts.com/docs/github-language-bar-alternative", lastmod: "2026-09-16" },
  { loc: "https://octocounts.com/docs/best-sloc-counter-tools", lastmod: "2026-09-16" },
  { loc: "https://octocounts.com/research", lastmod: "2026-09-16" },
  { loc: "https://octocounts.com/about", lastmod: "2026-09-16" },
  { loc: "https://octocounts.com/llms.txt", lastmod: "2026-09-16" },
  { loc: "https://octocounts.com/llms-full.txt", lastmod: "2026-09-16" },
  { loc: "https://octocounts.com/privacy", lastmod: "2026-09-05" },
  { loc: "https://octocounts.com/contact", lastmod: "2026-09-05" },
];
// The homepage's own visible freshness line and the curated /compare/* pages
// follow the manifest too.
const HOME_CONTENT_LASTMOD = "2026-09-16";
const COMPARE_CONTENT_LASTMOD = "2026-09-16";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  // The launch kit is an internal repository resource. Preserve a legacy
  // language query while directing both historic public paths to the stable
  // extension section in one hop, including a trailing slash.
  if (["/launch-kit", "/launch-kit/", "/launch-kit.html"].includes(url.pathname)) {
    const target = new URL("/#extension", url.origin);
    target.search = url.search;
    return Response.redirect(target, 308);
  }

  // Every canonical URL on this site is extensionless and slash-free (see
  // STATIC_SITEMAP_ENTRIES and every canonical: below). Without this, dynamic
  // routes like /github/:owner/:repo/ and /compare/:slug/ served 200s instead
  // of redirecting, leaving duplicate crawlable URLs with only a soft
  // rel=canonical signal; static routes 404'd instead, inconsistently. A
  // single hard redirect here covers both.
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    const target = new URL(url);
    target.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return Response.redirect(target, 308);
  }
  // A trailing .md suffix selects the markdown twin of the same page
  // (/github/o/r.md, /compare/x-vs-y.md, /docs/methodology.md, ...); route
  // matching below runs on the stripped path so every ref variant resolves.
  const routePath = url.pathname.endsWith(".md") ? url.pathname.slice(0, -3) : url.pathname;
  const parts = routePath.split("/").filter(Boolean).map(decodeURIComponent);
  // ?format=md is the explicit opt-in for any client (browsers included); the
  // .md suffix is the linkable form. Neither depends on the user agent.
  const markdownRequested = routePath !== url.pathname || url.searchParams.get("format") === "md";
  // Retrieval-time AI crawlers (search/answer grounding for a waiting user,
  // not training) get the markdown twin without asking: it is cheaper to
  // parse and safer to quote than SSR HTML. Search engine crawlers
  // (Googlebot, Bingbot, ...) are deliberately excluded — serving them
  // different content than users would be cloaking — and pure training
  // crawlers (GPTBot, CCBot, anthropic-ai) keep receiving HTML.
  // Rollback switch (SG-08): set AI_MARKDOWN_UA=0 in the Pages environment to
  // stop serving markdown by user agent while keeping explicit .md/?format=md
  // URLs working. Defaults on; see docs/ai-crawling-policy.md.
  const aiMarkdown = context.env.AI_MARKDOWN_UA !== "0" && isAiRetrievalBot(context.request.headers.get("user-agent"));

  const legacyDoc = LEGACY_DOC_REDIRECTS[url.pathname];
  if (legacyDoc) {
    return Response.redirect(new URL(legacyDoc, url.origin), 308);
  }

  const legacyQueryReport = legacyQueryReportPath(url);
  if (legacyQueryReport) {
    return Response.redirect(new URL(legacyQueryReport, url.origin), 308);
  }

  const legacyReport = LEGACY_REPORT_REDIRECTS[parts.slice(0, 3).join("/").toLowerCase()];
  if (legacyReport) {
    return Response.redirect(new URL(legacyReport, url.origin), 308);
  }

  // IndexNow key verification file. The backend submits URLs with this key;
  // both the Pages and backend environments must share the same INDEXNOW_KEY.
  const indexNowKey = context.env.INDEXNOW_KEY;
  if (indexNowKey && url.pathname === `/${indexNowKey}.txt`) {
    return new Response(indexNowKey, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (url.pathname === "/sitemap.xml") {
    return sitemapResponse(context);
  }

  if (parts[0] === "github" && parts.length >= 3) {
    const route = parseGitHubRoute(parts);
    return reportResponse(context, route, { markdown: markdownRequested || aiMarkdown, uaOnly: aiMarkdown && !markdownRequested });
  }

  if (url.pathname === "/recent" || url.pathname === "/popular") {
    return listPageResponse(context, url.pathname.slice(1), url);
  }

  if (url.pathname === "/trending.xml") {
    return trendingFeedResponse(context);
  }

  if (routePath === "/trending") {
    return trendingPageResponse(context, { markdown: markdownRequested });
  }

  if (routePath === "/stats") {
    return statsPageResponse(context, { markdown: markdownRequested });
  }

  if (url.pathname === "/hall-of-monoliths") {
    return listPageResponse(context, "monoliths", url);
  }

  if (parts[0] === "compare" && parts.length === 2) {
    const curated = findCuratedComparison(parts[1].toLowerCase());
    if (curated) return curatedCompareResponse(context, curated, { markdown: markdownRequested || aiMarkdown, uaOnly: aiMarkdown && !markdownRequested });
    // Unknown comparison slugs are not curated content; they fall through to
    // static asset handling, which answers 404 in production.
  }

  if (url.pathname === "/compare" || url.pathname === "/diff") {
    return comparePageResponse(context, url.pathname);
  }

  if (url.pathname === "/badges") {
    return badgesPageResponse(context);
  }

  if (routePath === "/extension") {
    return extensionPageResponse(context, { markdown: markdownRequested || aiMarkdown, uaOnly: aiMarkdown && !markdownRequested });
  }

  // Embeddable iframe cards: served from the same SPA bundle but with
  // frame-ancestors relaxed (only for /embed/) and noindex — embeds are for
  // humans on third-party pages, not for crawlers.
  if (parts[0] === "embed" && parts[1] === "github" && parts.length >= 4) {
    return embedPageResponse(context, parts);
  }

  // The three docs articles are static HTML; their markdown twins are
  // pre-generated files in public/docs/. Served through the function (rather
  // than relying on the bare .md asset) so ?format=md and retrieval-bot
  // requests get a guaranteed text/markdown type and the /docs/* cache policy.
  if (parts[0] === "docs" && parts.length === 2 && DOC_MARKDOWN_PAGES.has(parts[1]) && (markdownRequested || aiMarkdown)) {
    return docsMarkdownResponse(context, parts[1], { uaOnly: aiMarkdown && !markdownRequested });
  }

  // /research is a static article pair (public/research/index.html plus its
  // pre-generated index.md), served through the function — like the docs
  // articles — so ?format=md and retrieval-bot requests get a guaranteed
  // text/markdown type instead of relying on the bare .md asset.
  if (parts[0] === "research" && parts.length === 1 && (markdownRequested || aiMarkdown)) {
    return researchMarkdownResponse(context, { uaOnly: aiMarkdown && !markdownRequested });
  }

  if (url.pathname === "/") {
    return homePageResponse(context);
  }

  return withHtmlSecurity(await context.env.ASSETS.fetch(context.request));
}

const LEGACY_DOC_REDIRECTS = {
  "/docs/github-sloc-counter.html": "/docs/github-sloc-counter",
  "/docs/methodology.html": "/docs/methodology",
  "/docs/api.html": "/docs/api",
};

const LEGACY_REPORT_REDIRECTS = {
  "github/huanglizhuo/octocount": "/github/huanglizhuo/OctoCounts",
};

// See the user-agent split note in onRequest. Substring match on the bot
// token so versioned agents ("PerplexityBot/1.0", "Applebot/0.1") match;
// nothing here collides with Googlebot/Bingbot or with GPTBot/CCBot.
const AI_RETRIEVAL_BOT_UA = /OAI-SearchBot|ChatGPT-User|PerplexityBot|Perplexity-User|ClaudeBot|Claude-User|Google-Extended|Applebot/i;

function isAiRetrievalBot(userAgent) {
  return Boolean(userAgent) && AI_RETRIEVAL_BOT_UA.test(userAgent);
}

const DOC_MARKDOWN_PAGES = new Set(["github-sloc-counter", "api", "methodology", "glossary", "faq", "octocounts-vs-cloc", "github-language-bar-alternative", "best-sloc-counter-tools"]);

async function docsMarkdownResponse(context, slug, options = {}) {
  const url = new URL(context.request.url);
  url.pathname = `/docs/${slug}.md`;
  url.search = "";
  const asset = await context.env.ASSETS.fetch(new Request(url.toString(), context.request));
  if (!asset.ok) return asset;
  return markdownResponse(asset.body, "public, max-age=3600", options);
}

async function researchMarkdownResponse(context, options = {}) {
  const url = new URL(context.request.url);
  url.pathname = "/research/index.md";
  url.search = "";
  const asset = await context.env.ASSETS.fetch(new Request(url.toString(), context.request));
  if (!asset.ok) return asset;
  return markdownResponse(asset.body, "public, max-age=3600", options);
}

function legacyQueryReportPath(url) {
  if (url.pathname !== "/") return "";
  const rawRepository = url.searchParams.get("q") ?? url.searchParams.get("url");
  if (!rawRepository) return "";

  try {
    const normalized = rawRepository.startsWith("git@github.com:")
      ? rawRepository.replace("git@github.com:", "https://github.com/")
      : rawRepository;
    const repository = new URL(normalized);
    if (repository.hostname.toLowerCase() !== "github.com") return "";

    const segments = repository.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (segments.length < 2 || !isGitHubPathPart(segments[0]) || !isGitHubPathPart(segments[1])) return "";

    const owner = encodeURIComponent(segments[0]);
    const repo = encodeURIComponent(segments[1].replace(/\.git$/i, ""));
    const embeddedRef = segments[2] === "tree" || segments[2] === "commit" ? segments.slice(3).join("/") : "";
    const refName = (url.searchParams.get("ref") ?? embeddedRef).trim();
    const extras = new URLSearchParams(url.search);
    extras.delete("q");
    extras.delete("url");
    extras.delete("ref");
    const suffix = extras.toString() ? `?${extras.toString()}` : "";
    if (!refName) return `/github/${owner}/${repo}${suffix}`;

    const marker = /^[a-f0-9]{7,40}$/i.test(refName) ? "commit" : "tree";
    const encodedRef = refName.split("/").map(encodeURIComponent).join("/");
    return `/github/${owner}/${repo}/${marker}/${encodedRef}${suffix}`;
  } catch {
    return "";
  }
}

function isGitHubPathPart(value) {
  return /^[a-z0-9_.-]+$/i.test(value);
}

function parseGitHubRoute(parts) {
  const marker = parts[3];
  const refName = marker === "tree" || marker === "commit" ? parts.slice(4).join("/") : "";
  return {
    provider: "github",
    owner: parts[1],
    repo: parts[2],
    refName,
  };
}

async function reportResponse(context, route, options = {}) {
  // A 404 from the report API means the repository genuinely has no cached
  // report: serve the noindex fallback. A 5xx, network error, or timeout is
  // transient — answering 503 + no-store keeps crawlers retrying instead of
  // caching a noindex (or letting the CDN cache one) for an indexable page.
  const result = await fetchSeoReport(context, route);
  if (result.state === "missing") {
    if (options.markdown) return markdownResponse(reportMissingMarkdown(route), "public, max-age=60", options);
    return htmlResponse(injectFallback(await indexHtml(context), route), "public, max-age=60");
  }
  if (result.state === "unavailable") {
    return serviceUnavailableResponse(await indexHtml(context), reportUnavailableMeta(route));
  }

  const report = await result.response.json();
  // The report must belong to the URL that requested it. Any upstream mixup
  // (a mis-keyed cache tier serving one repo's payload for another) would
  // otherwise SSR one repository's numbers under a different repository's
  // URL — a 200 with a wrong, page-identical meta description, which is
  // exactly the "duplicate meta descriptions" class Bing Webmaster Tools
  // flagged across /github/* pages. Fail closed: 503 + no-store (never
  // cached) asks crawlers to retry instead of indexing wrong content.
  if (!reportMatchesRoute(report, route)) {
    return serviceUnavailableResponse(await indexHtml(context), reportUnavailableMeta(route));
  }
  // The similar-repositories panel is an enhancement: the page must render
  // identically whether or not the related endpoint answers.
  const relatedReports = await fetchRelatedReports(context, route);
  // The store matches owner/repo case-sensitively, so a mistyped or
  // mixed-case external link (e.g. /github/Facebook/React) resolves to the
  // canonical casing only via the report itself. 308 it so link equity lands
  // on the URL the canonical tag and sitemap use. Markdown requests redirect
  // to the canonical casing with their .md suffix preserved.
  const requestUrl = new URL(context.request.url);
  const comparePath = requestUrl.pathname.endsWith(".md") ? requestUrl.pathname.slice(0, -3) : requestUrl.pathname;
  if (report.publicPath && report.publicPath.toLowerCase() === comparePath.toLowerCase() && report.publicPath !== comparePath) {
    const suffix = requestUrl.pathname.endsWith(".md") ? ".md" : "";
    return Response.redirect(new URL(report.publicPath + suffix + requestUrl.search, requestUrl.origin), 308);
  }
  // 1h, not 24h: report titles/descriptions carry live line counts, and the
  // SEO report API behind this page already serves s-maxage=3600. Caching the
  // HTML a day longer than its own data source left stale counts in SERP
  // titles for up to a day after a big push. SWR keeps origin load low.
  if (options.markdown) {
    return markdownResponse(reportMarkdown(report, relatedReports), "public, s-maxage=3600, stale-while-revalidate=86400", options);
  }
  // Conditional GET for crawlers: the report corpus is tens of thousands of
  // URLs and Googlebot/Bingbot both send If-Modified-Since. generatedAt is
  // the page's own data date, so Last-Modified is the report's, not a
  // synthetic response time, and a matching conditional request costs the
  // crawler no body transfer (crawl-budget efficiency per Google's crawling
  // docs; freshness signals per every 2026 GEO study).
  const lastModified = httpDate(report.generatedAt);
  const cacheControl = "public, s-maxage=300, stale-while-revalidate=600";
  if (lastModified && notModifiedSince(context.request, lastModified)) {
    return new Response(null, {
      status: 304,
      headers: { "cache-control": cacheControl, "last-modified": lastModified, ...securityHeaders() },
    });
  }
  return htmlResponse(injectReport(await indexHtml(context), report, apiBase(context), relatedReports), cacheControl, { lastModified });
}

/// Markdown twin of injectReport: same report payload, same facts, serialized
/// as headings, a pipe table, FAQ, and absolute internal links so the text is
/// quotable without the surrounding page.
function reportMarkdown(report, relatedReports = []) {
  const top = report.topLanguage ? ` (${report.topLanguage.name} ${report.topLanguage.percent.toFixed(1)}%)` : "";
  const table = [
    "| Language | Files | Lines | Code | Comments | Blanks |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...report.languages.map(
      (language) =>
        `| ${language.name} | ${formatNumber(language.stats.files)} | ${formatNumber(language.stats.lines)} | ${formatNumber(language.stats.code)} | ${formatNumber(language.stats.comments)} | ${formatNumber(language.stats.blanks)} |`
    ),
  ].join("\n");
  const faq = reportFaq(report)
    .map((item) => `### ${item.question}\n\n${item.answer}`)
    .join("\n\n");
  const relatedCompare = relatedComparisons(report.topLanguage?.name);
  const links = [
    "- [Recently analyzed repositories](https://octocounts.com/recent)",
    "- [Popular SLOC reports](https://octocounts.com/popular)",
    "- [Trending GitHub repositories](https://octocounts.com/trending)",
    "- [Hall of Monoliths](https://octocounts.com/hall-of-monoliths)",
    ...relatedCompare.map((entry) => `- [${entry.name}](https://octocounts.com/compare/${entry.slug})`),
    "- [GitHub SLOC counter guide](https://octocounts.com/docs/github-sloc-counter)",
    "- [Counting methodology](https://octocounts.com/docs/methodology)",
    "- [OctoCounts API docs](https://octocounts.com/docs/api)",
  ].join("\n");
  const similar = relatedReports.length
    ? `\n## Similar repository reports\n\n${relatedReports
        .map((item) => `- [${item.repoFullName}](https://octocounts.com${item.publicPath}) — ${item.topLanguage || "mixed"}, ${formatNumber(item.totalCode)} code lines`)
        .join("\n")}\n`
    : "";
  return `# ${report.repoFullName} SLOC report

> ${report.citation}

${reportCapsuleText(report)}

${reportLeadText(report)}

## Repository size insights

${reportInsightsText(report)}

${table}

Top language${top}. Generated at ${report.generatedAt}. Canonical report: ${report.canonicalUrl}

${reportReproduceMarkdown(report)}

## Report FAQ

${faq}
${similar}
## Related OctoCounts pages

${links}
`;
}

function reportMissingMarkdown(route) {
  const fullName = `${route.owner}/${route.repo}`;
  return `# ${fullName} SLOC report\n\nNo cached report exists yet for ${fullName}. Open https://octocounts.com/${route.provider}/${route.owner}/${route.repo} with JavaScript enabled to run an analysis.\n`;
}

async function fetchRelatedReports(context, route) {
  try {
    const params = new URLSearchParams({
      provider: route.provider,
      owner: route.owner,
      repo: route.repo,
    });
    const response = await fetch(`${apiBase(context)}/api/seo/related?${params.toString()}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload?.reports) ? payload.reports.slice(0, 6) : [];
  } catch {
    return [];
  }
}

async function listPageResponse(context, kind, url) {
  const index = await indexHtml(context);
  const page = url.searchParams.get("page") || "1";
  const response = await fetch(`${apiBase(context)}/api/seo/${kind}?page=${encodeURIComponent(page)}`, {
    headers: { accept: "application/json" },
  });
  const payload = response.ok ? await response.json() : { reports: [] };
  const pageMeta = listPageMeta(kind);
  // Page >1 is noindex,follow; pairing that with a canonical back to page 1
  // sends conflicting signals (Google: pick one). A self-referencing
  // canonical with the page parameter keeps the URL shape unambiguous.
  const canonical = page === "1" ? pageMeta.canonical : `${pageMeta.canonical}?page=${encodeURIComponent(page)}`;
  const title = pageMeta.title;
  const description = pageMeta.description;
  const rows = payload.reports
    .map(
      (report, index) =>
        `<li><span>${index + 1}.</span> <a href="${escapeAttr(report.publicPath)}">${escapeHtml(report.repoFullName)}</a> — ${escapeHtml(report.description)}</li>`
    )
    .join("");
  // These pages are in the sitemap and marked index,follow. If the API is
  // unreachable the list comes back empty, and an empty <ul> leaves a crawler
  // roughly fifteen words of boilerplate to work with -- an indexed page that
  // says nothing. Answer whatever the page is about instead, and keep the
  // internal links so the crawl continues.
  const body = rows ? `<ul>${rows}</ul>` : listPageFallback(kind);

  return htmlResponse(
    injectHeadAndNoscript(index, {
      title,
      description,
      canonical,
      robots: page === "1" ? "index,follow,max-image-preview:large,max-snippet:-1" : "noindex,follow,max-image-preview:large",
      ogImage: "https://octocounts.com/og-image.jpg",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: title,
        description,
        url: pageMeta.canonical,
        mainEntity: {
          "@type": "ItemList",
          itemListElement: payload.reports.map((report, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: report.canonicalUrl,
            name: report.repoFullName,
          })),
        },
      },
      bodyContent: `<section><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>${body}</section>`,
    }),
    "public, s-maxage=300, stale-while-revalidate=600"
  );
}

/// Substantive content for when the list is empty.
///
/// Sized as a self-contained block that answers the page's own question without
/// needing the surrounding page, which is the shape answer engines quote. The
/// navigation is repeated here because this is the state in which a crawler has
/// nothing else on the page to follow.
function listPageFallback(kind) {
  const intro = {
    recent:
      "This page lists the public GitHub repositories most recently measured by OctoCounts. Each entry links to a full report giving files, total lines, code lines, comments, blanks, and a per-language breakdown, pinned to the exact commit that was counted.",
    popular:
      "This page ranks the OctoCounts reports that are viewed most often. Each entry links to a full source line count for a public GitHub repository, giving files, total lines, code lines, comments, blanks, and a per-language breakdown, pinned to the exact commit that was counted.",
    monoliths:
      "The Hall of Monoliths ranks the largest public GitHub repositories OctoCounts has measured, ordered by total source lines. Each entry links to a full report giving files, total lines, code lines, comments, blanks, and a per-language breakdown, pinned to the exact commit that was counted.",
  }[kind];

  return `<p>${intro}</p>
    <p>OctoCounts counts lines of code without cloning: it downloads a repository's source archive, runs <a href="https://github.com/XAMPPRocky/tokei">tokei</a>, and caches the result by commit SHA and analysis options. Counting any public GitHub repository is free and needs no account &mdash; paste a repository URL on the <a href="/">OctoCounts home page</a>.</p>
    <p>The live ranking for this page is loading. In the meantime:</p>
    <nav aria-label="Related OctoCounts pages"><ul>
      <li><a href="/recent">Recently analyzed repositories</a></li>
      <li><a href="/popular">Popular SLOC reports</a></li>
      <li><a href="/hall-of-monoliths">Hall of Monoliths: largest repositories by lines of code</a></li>
      <li><a href="/trending">Trending GitHub repositories today</a></li>
      <li><a href="/docs/methodology">How OctoCounts counts lines of code</a></li>
    </ul></nav>`;
}

const TRENDING_TITLE = "Trending GitHub repositories today | OctoCounts";

function trendingDescription(snapshot) {
  return `Daily GitHub Trending repositories discovered on ${snapshot.date || "the latest snapshot"}, with stable OctoCounts source line count report links.`;
}

/// Markdown twin of the /trending SSR body: same daily snapshot, serialized
/// as a ranked list of absolute report links.
function trendingMarkdown(snapshot) {
  const items = snapshot.repositories
    .map(
      (repo) =>
        `${repo.rank}. [${repo.fullName}](https://octocounts.com${repo.publicPath}) — ${repo.description || "GitHub Trending repository"} (${formatNumber(repo.starsToday)} stars today${repo.language ? `, ${repo.language}` : ""})`
    )
    .join("\n");
  return `# Trending GitHub repositories today\n\n${trendingDescription(snapshot)}\n\nSource: [GitHub Trending](https://github.com/trending). Snapshot updated ${snapshot.date}.\n\n${items}\n`;
}

async function trendingPageResponse(context, options = {}) {
  const snapshot = await trendingSnapshot(context);
  if (options.markdown) {
    return markdownResponse(trendingMarkdown(snapshot), "public, s-maxage=3600, stale-while-revalidate=86400");
  }
  const index = await indexHtml(context);
  const title = TRENDING_TITLE;
  const description = trendingDescription(snapshot);
  const body = snapshot.repositories
    .map((repo) => `<li><span>${repo.rank}.</span> <a href="${escapeAttr(repo.publicPath)}">${escapeHtml(repo.fullName)}</a> — ${escapeHtml(repo.description || "GitHub Trending repository")} (${formatNumber(repo.starsToday)} stars today${repo.language ? `, ${escapeHtml(repo.language)}` : ""})</li>`)
    .join("");

  return htmlResponse(
    injectHeadAndNoscript(index, {
      title,
      description,
      canonical: "https://octocounts.com/trending",
      robots: "index,follow,max-image-preview:large,max-snippet:-1",
      ogImage: "https://octocounts.com/og-image.jpg",
      extraHead: `<link rel="alternate" type="application/rss+xml" title="${escapeAttr(title)}" href="https://octocounts.com/trending.xml" />`,
      mdAlternate: "https://octocounts.com/trending.md",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: title,
        description,
        url: "https://octocounts.com/trending",
        // The daily snapshot is both created and modified on its snapshot
        // date; there is no earlier publication moment to report.
        datePublished: snapshot.date,
        dateModified: snapshot.generatedAt,
        isBasedOn: snapshot.source,
        mainEntity: {
          "@type": "ItemList",
          itemListElement: snapshot.repositories.map((repo) => ({
            "@type": "ListItem",
            position: repo.rank,
            url: `https://octocounts.com${repo.publicPath}`,
            name: repo.fullName,
          })),
        },
      },
      bodyContent: `<section><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p>Source: <a href="https://github.com/trending">GitHub Trending</a>. Snapshot updated <time datetime="${escapeAttr(snapshot.generatedAt)}">${escapeHtml(snapshot.date)}</time>.</p><ol>${body}</ol></section>`,
    }),
    "public, s-maxage=300, stale-while-revalidate=600"
  );
}

/// RSS 2.0 rendering of the same daily trending snapshot the /trending page
/// serves. The snapshot carries no SLOC figures of its own, so each item's
/// description leads with the repository summary and links the stable
/// OctoCounts report page, where the counted lines live.
async function trendingFeedResponse(context) {
  const snapshot = await trendingSnapshot(context);
  const buildDate = new Date(snapshot.generatedAt || snapshot.date || Date.now());
  const pubDate = Number.isNaN(buildDate.getTime()) ? new Date().toUTCString() : buildDate.toUTCString();
  const title = TRENDING_TITLE;
  const items = snapshot.repositories
    .map((repo) => {
      const summary = repo.description || "GitHub Trending repository";
      const detail = `+${formatNumber(repo.starsToday)} stars today${repo.language ? `, ${repo.language}` : ""}. Source line count: OctoCounts report.`;
      return `  <item>
    <title>${escapeXml(repo.fullName)}</title>
    <link>https://octocounts.com${escapeXml(repo.publicPath)}</link>
    <guid isPermaLink="true">https://octocounts.com${escapeXml(repo.publicPath)}</guid>
    <description>${escapeXml(`${summary} (${detail})`)}</description>
    <pubDate>${pubDate}</pubDate>${repo.language ? `\n    <category>${escapeXml(repo.language)}</category>` : ""}
  </item>`;
    })
    .join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n  <title>${escapeXml(title)}</title>\n  <link>https://octocounts.com/trending</link>\n  <description>Daily GitHub Trending repositories with stable OctoCounts source line count report links.</description>\n  <language>en</language>\n  <lastBuildDate>${pubDate}</lastBuildDate>\n${items}\n</channel>\n</rss>\n`,
    {
      headers: {
        "content-type": "application/rss+xml; charset=utf-8",
        "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
        ...securityHeaders(),
      },
    }
  );
}

const STATS_TITLE = "OctoCounts public growth stats";
const STATS_DESCRIPTION = "Aggregate OctoCounts report totals, repository coverage, source breakdown, language totals, and largest public repositories.";

const STATS_SOURCE_LABELS = {
  github_action: "GitHub Action",
  cli: "CLI",
  mcp: "MCP",
  api: "API",
  extension: "Browser extension",
  seed: "Seed",
  github_trending: "GitHub Trending",
  web: "Web app",
  unknown: "Unknown",
};

/// Markdown twin of the /stats SSR body: same /api/stats payload, serialized
/// as lists with absolute report links.
function statsMarkdown(stats) {
  const totals = stats?.totals
    ? `- ${formatNumber(stats.totals.reportsGenerated)} reports generated
- ${formatNumber(stats.totals.repositoriesAnalyzed)} public repositories analyzed
- ${formatNumber(stats.totals.linesCounted)} total lines counted (${formatNumber(stats.totals.codeLinesCounted)} code)
- ${formatNumber(stats.totals.languagesDetected)} languages detected`
    : "The live figures are loading. OctoCounts is a free source lines of code counter for public GitHub repositories; the totals above are drawn from every report it has generated.";
  const sources = stats?.sources?.length
    ? `\n## Where analyses come from\n\n${stats.sources
        .map((row) => `- ${STATS_SOURCE_LABELS[row.source] ?? row.source}: ${formatNumber(row.reports)} reports`)
        .join("\n")}\n`
    : "";
  const languages = stats?.languages?.length
    ? `\n## Language coverage\n\n${stats.languages
        .map((row) => `- ${row.language}: ${formatNumber(row.code)} code lines across ${formatNumber(row.reports)} reports`)
        .join("\n")}\n`
    : "";
  const largest = stats?.topRepositories?.length
    ? `\n## Largest repositories measured\n\n${stats.topRepositories
        .map(
          (repo, index) =>
            `${index + 1}. [${repo.owner}/${repo.repo}](https://octocounts.com${repo.publicPath}) — ${formatNumber(repo.total.lines)} total lines (${formatNumber(repo.total.code)} code)`
        )
        .join("\n")}\n`
    : "";
  return `# ${STATS_TITLE}

${STATS_DESCRIPTION}

${totals}
${sources}${languages}${largest}
This page publishes OctoCounts' own operating totals: how many source line count reports have been generated, how many distinct public GitHub repositories have been analyzed, how many lines have been counted in total, how many programming languages have been detected, which client each analysis arrived from, and the largest repositories measured so far. The figures are aggregate only and contain no user-level analytics.

OctoCounts counts lines of code without cloning: it downloads a repository's source archive, runs [tokei](https://github.com/XAMPPRocky/tokei), and caches the result by commit SHA and analysis options.

## Related OctoCounts pages

- [Recently analyzed repositories](https://octocounts.com/recent)
- [Popular SLOC reports](https://octocounts.com/popular)
- [Hall of Monoliths: largest repositories by lines of code](https://octocounts.com/hall-of-monoliths)
- [How OctoCounts counts lines of code](https://octocounts.com/docs/methodology)
`;
}

async function statsPageResponse(context, options = {}) {
  const response = await fetch(`${apiBase(context)}/api/stats`, {
    headers: { accept: "application/json" },
  });
  const stats = response.ok ? await response.json() : null;
  if (options.markdown) {
    return markdownResponse(statsMarkdown(stats), "public, s-maxage=900, stale-while-revalidate=3600");
  }
  const index = await indexHtml(context);
  const title = STATS_TITLE;
  const description = STATS_DESCRIPTION;
  // An indexed page must never bottom out at a single "unavailable" sentence:
  // that is all a crawler would have to cite. When the numbers are missing,
  // explain what the page measures and where the figures come from instead —
  // and when the numbers are present, a bare four-item list still says nothing
  // about what they measure, so the explanation and links render in both states.
  const totals = stats?.totals
    ? `<ul>
      <li>${formatNumber(stats.totals.reportsGenerated)} reports generated</li>
      <li>${formatNumber(stats.totals.repositoriesAnalyzed)} public repositories analyzed</li>
      <li>${formatNumber(stats.totals.linesCounted)} total lines counted (${formatNumber(stats.totals.codeLinesCounted)} code)</li>
      <li>${formatNumber(stats.totals.languagesDetected)} languages detected</li>
    </ul>`
    : `<p>The live figures are loading. OctoCounts is a free source lines of code counter for public GitHub repositories; the totals above are drawn from every report it has generated.</p>`;
  // The aggregate sections below are the citable payload of this page; they
  // mirror the /api/stats fields the JS dashboard charts, as plain HTML.
  const sources = stats?.sources?.length
    ? `<section><h2>Where analyses come from</h2><ul>${stats.sources
        .map((row) => `<li>${escapeHtml(STATS_SOURCE_LABELS[row.source] ?? row.source)}: ${formatNumber(row.reports)} reports</li>`)
        .join("")}</ul></section>`
    : "";
  const languages = stats?.languages?.length
    ? `<section><h2>Language coverage</h2><ul>${stats.languages
        .map((row) => `<li>${escapeHtml(row.language)}: ${formatNumber(row.code)} code lines across ${formatNumber(row.reports)} reports</li>`)
        .join("")}</ul></section>`
    : "";
  const largest = stats?.topRepositories?.length
    ? `<section><h2>Largest repositories measured</h2><ol>${stats.topRepositories
        .map(
          (repo) =>
            `<li><a href="${escapeAttr(repo.publicPath)}">${escapeHtml(`${repo.owner}/${repo.repo}`)}</a> — ${formatNumber(repo.total.lines)} total lines (${formatNumber(repo.total.code)} code)</li>`
        )
        .join("")}</ol></section>`
    : "";
  const body = `<p>This page publishes OctoCounts' own operating totals: how many source line count reports have been generated, how many distinct public GitHub repositories have been analyzed, how many lines have been counted in total, how many programming languages have been detected, which client each analysis arrived from, and the largest repositories measured so far. The figures are aggregate only and contain no user-level analytics.</p>
    <p>OctoCounts counts lines of code without cloning: it downloads a repository's source archive, runs <a href="https://github.com/XAMPPRocky/tokei">tokei</a>, and caches the result by commit SHA and analysis options. The same underlying reports are browsable directly:</p>
    <nav aria-label="Related OctoCounts pages"><ul>
      <li><a href="/recent">Recently analyzed repositories</a></li>
      <li><a href="/popular">Popular SLOC reports</a></li>
      <li><a href="/hall-of-monoliths">Hall of Monoliths: largest repositories by lines of code</a></li>
      <li><a href="/docs/methodology">How OctoCounts counts lines of code</a></li>
    </ul></nav>`;

  return htmlResponse(
    injectHeadAndNoscript(index, {
      title,
      description,
      canonical: "https://octocounts.com/stats",
      robots: "index,follow,max-image-preview:large,max-snippet:-1",
      ogImage: "https://octocounts.com/og-image.jpg",
      mdAlternate: "https://octocounts.com/stats.md",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: title,
        description,
        url: "https://octocounts.com/stats",
        // The stats dashboard shipped on 2026-07-10 (backend fd456cb, edge
        // function 82ed24a); the API exposes no earlier creation timestamp.
        datePublished: "2026-07-10",
        measurementTechnique: "Aggregate public OctoCounts report activity",
        variableMeasured: ["reports", "repositories", "lines", "languages", "sources"],
      },
      bodyContent: `<section><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>${totals}${sources}${languages}${largest}${body}</section>`,
    }),
    "public, s-maxage=300, stale-while-revalidate=600"
  );
}

async function comparePageResponse(context, pathname) {
  const index = await indexHtml(context);
  const isCompare = pathname === "/compare";
  const title = isCompare ? "Compare repository SLOC | OctoCounts" : "Compare branch SLOC diff | OctoCounts";
  const description = isCompare
    ? "Compare files, code lines, comments, blanks, and language mix between two public repositories or refs."
    : "Compare source line count changes between two branches, tags, or commits in a public repository.";
  const example = isCompare
    ? `<p>Example: <a href="/compare?left=https%3A%2F%2Fgithub.com%2Ffacebook%2Freact&amp;right=https%3A%2F%2Fgithub.com%2Fvuejs%2Fcore">facebook/react vs vuejs/core</a>. Example reports: <a href="/github/facebook/react">facebook/react</a>, <a href="/github/vitejs/vite">vitejs/vite</a>.</p>`
    : `<p>Example: <a href="/diff?repo=https%3A%2F%2Fgithub.com%2Ffacebook%2Freact&amp;base=v18.0.0&amp;head=main">facebook/react v18.0.0 to main</a>. Example reports: <a href="/github/facebook/react">facebook/react</a>, <a href="/github/vitejs/vite">vitejs/vite</a>.</p>`;
  const internalLinks = `<nav aria-label="Related OctoCounts pages"><ul>
    <li><a href="/recent">Recently analyzed repositories</a></li>
    <li><a href="/popular">Popular SLOC reports</a></li>
    <li><a href="/trending">Trending GitHub repositories</a></li>
    <li><a href="/hall-of-monoliths">Hall of Monoliths</a></li>
    <li><a href="/docs/github-sloc-counter">GitHub SLOC counter guide</a></li>
    <li><a href="/docs/methodology">Counting methodology</a></li>
    <li><a href="/docs/api">OctoCounts API docs</a></li>
  </ul></nav>`;
  const curatedLinks = isCompare
    ? `<section><h2>Curated comparisons</h2><p>Server-rendered source line count comparisons for popular frameworks and tools:</p><ul>${COMPARE_REGISTRY.map((entry) => `<li><a href="/compare/${entry.slug}">${escapeHtml(entry.name)}</a></li>`).join("")}</ul><p>OctoCounts also publishes original research on how measurement choices affect line counts: <a href="/research">How test, docs, and generated-file filtering changes SLOC counts</a> (pilot study, September 2026).</p></section>`
    : "";

  return htmlResponse(
    injectHeadAndNoscript(index, {
      title,
      description,
      canonical: `https://octocounts.com${pathname}`,
      robots: "index,follow,max-image-preview:large,max-snippet:-1",
      ogImage: "https://octocounts.com/og-image.jpg",
      jsonLd: null,
      bodyContent: `<section><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p>JavaScript runs the comparison in your browser; this summary exists so the link preview and crawlers see a real page.</p>${example}${curatedLinks}${internalLinks}</section>`,
    }),
    "public, s-maxage=300, stale-while-revalidate=600"
  );
}

async function embedPageResponse(context, parts) {
  const index = await indexHtml(context);
  const provider = parts[1];
  const owner = parts.slice(2, -1).join("/");
  const repo = parts[parts.length - 1];
  const fullName = `${owner}/${repo}`;
  const reportPath = `/${provider}/${parts.slice(2).map(encodeURIComponent).join("/")}`;
  return htmlResponse(
    injectHeadAndNoscript(index, {
      title: `${fullName} SLOC card embed | OctoCounts`,
      description: `Embeddable OctoCounts card with source line counts and language mix for ${fullName}.`,
      canonical: `https://octocounts.com${reportPath}`,
      robots: "noindex,nofollow",
      ogImage: "https://octocounts.com/og-image.jpg",
      jsonLd: null,
      bodyContent: `<section><h1>${escapeHtml(fullName)} SLOC card</h1><p>Loading the embeddable OctoCounts card… <a href="${escapeAttr(reportPath)}">Open the full ${escapeHtml(fullName)} SLOC report</a>.</p></section>`,
    }),
    "public, s-maxage=300, stale-while-revalidate=600",
    { frameable: true }
  );
}

async function badgesPageResponse(context) {
  const index = await indexHtml(context);
  const title = "GitHub SLOC badges for your README | OctoCounts";
  const description = "Live README badges that show source lines of code, code lines, files, comments, language count, top language, code share, or a single language for any public GitHub repository, rendered by the OctoCounts badge API.";
  const badgeBase = "https://api.octocounts.com/badge/:owner/:repo";
  const badgeTypeRows = [
    ["Summary: total lines and code lines", badgeBase],
    ["Code lines only", `${badgeBase}?type=code`],
    ["Total lines", `${badgeBase}?type=lines`],
    ["File count", `${badgeBase}?type=files`],
    ["Comment lines", `${badgeBase}?type=comments`],
    ["Language count", `${badgeBase}?type=languages`],
    ["Top language", `${badgeBase}?type=top-language`],
    ["Code share percentage", `${badgeBase}?type=ratio`],
    ["Single language lines", `${badgeBase}?lang=rust`],
  ]
    .map(([label, url]) => `<li>${escapeHtml(label)}: <code>${escapeHtml(url)}</code></li>`)
    .join("");
  const exampleMarkdown = "[![OctoCounts](https://api.octocounts.com/badge/huanglizhuo/OctoCounts)](https://octocounts.com/github/huanglizhuo/OctoCounts)";
  const internalLinks = `<nav aria-label="Related OctoCounts pages"><ul>
    <li><a href="/">OctoCounts home: count any public GitHub repository</a></li>
    <li><a href="/recent">Recently analyzed repositories</a></li>
    <li><a href="/popular">Popular SLOC reports</a></li>
    <li><a href="/docs/github-sloc-counter">GitHub SLOC counter guide</a></li>
    <li><a href="/docs/api">OctoCounts API docs</a></li>
  </ul></nav>`;
  const badgeFaq = [
    {
      question: "Will the badge slow down my README?",
      answer: "No. Default-branch and branch badges are served with a 1-hour edge cache and a 24-hour stale-while-revalidate window, and tag or commit badges are cached forever as immutable. GitHub's own image proxy (camo) caches the response again on top of that, so repeat views rarely reach the OctoCounts API at all.",
    },
    {
      question: "Can I badge a single language instead of the whole repository?",
      answer: 'Yes. Add a `?lang=<language>` query parameter to any badge URL, for example `?lang=rust`, to get a per-language line-count badge instead of the full summary. Language names are case-insensitive.',
    },
    {
      question: "Does the badge update automatically as the repository changes?",
      answer: "Default-branch and branch badges re-analyze on a cache miss, so they reflect new commits once the cache window expires. Tag and commit badges are pinned to that exact ref and never change, which is the right choice for a release README that should show historical numbers.",
    },
  ];
  const badgeFaqHtml = `<h2>Badge FAQ</h2>${badgeFaq
    .map((item) => `<h3>${escapeHtml(item.question)}</h3>${answerHtml(item.answer)}`)
    .join("")}`;

  return htmlResponse(
    injectHeadAndNoscript(index, {
      title,
      description,
      canonical: "https://octocounts.com/badges",
      robots: "index,follow,max-image-preview:large,max-snippet:-1",
      ogImage: "https://octocounts.com/og-image.jpg",
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "WebPage",
            "@id": "https://octocounts.com/badges#webpage",
            name: title,
            description,
            url: "https://octocounts.com/badges",
          },
          {
            "@type": "FAQPage",
            "@id": "https://octocounts.com/badges#faq",
            mainEntity: badgeFaq.map((item) => ({
              "@type": "Question",
              name: item.question,
              acceptedAnswer: { "@type": "Answer", text: item.answer },
            })),
          },
        ],
      },
      bodyContent: `<section><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p>JavaScript runs the interactive builder in your browser; this summary exists so the link preview and crawlers see a real page.</p><h2>How to add a badge</h2><ol><li>Open the badge builder above and choose a badge type: summary, code lines, total lines, files, comments, language count, top language, code share, or a single language.</li><li>Enter a public GitHub repository URL and copy the generated markdown snippet.</li><li>Paste the markdown into <code>README.md</code>. The badge renders live line counts from the OctoCounts badge API and links to a permanent, commit-pinned SLOC report.</li></ol><h2>Badge types and URLs</h2><ul>${badgeTypeRows}</ul><h2>Example markdown</h2><pre><code>${escapeHtml(exampleMarkdown)}</code></pre><p>Badges can be pinned to a branch, tag, or commit: <code>${escapeHtml(`${badgeBase}/branch/:branch`)}</code>. Example report: <a href="/github/huanglizhuo/OctoCounts">huanglizhuo/OctoCounts</a>.</p>${badgeFaqHtml}${internalLinks}</section>`,
    }),
    "public, s-maxage=300, stale-while-revalidate=600"
  );
}

/// Extension landing page (SG-03). One content object feeds the SSR body, the
/// client React page, and the markdown twin so the three cannot drift. Facts
/// only: store links, what the extension does, permissions, and scope — no
/// ratings, user counts, or other figures this page cannot verify.
const EXTENSION_STORES = [
  { store: "chrome", label: "Chrome Web Store", url: "https://chromewebstore.google.com/detail/octocounts-%E2%80%94-github-sloc/gkgjpjdnaklagijmekoolhcpebmoldbj" },
  { store: "edge", label: "Microsoft Edge Add-ons", url: "https://microsoftedge.microsoft.com/addons/detail/octocounts-%E2%80%93-github-sloc-/ehifednhpbpekkadndaipnngopbhpoim" },
  { store: "firefox", label: "Firefox Add-ons", url: "https://addons.mozilla.org/en-US/firefox/addon/octocounts-github-sloc/" },
];

const EXTENSION_CONTENT = {
  title: "OctoCounts GitHub Line Counter Extension for Chrome, Edge & Firefox | OctoCounts",
  heading: "See GitHub code statistics in your browser",
  description:
    "Install the OctoCounts browser extension for Chrome, Edge, or Firefox to see source lines of code — files, code, comments, blanks, and per-language totals — directly in the GitHub repository sidebar.",
  intro:
    "OctoCounts is a free browser extension that adds a SLOC (source lines of code) card to public GitHub repository pages. The card shows the repository's total line count at a glance; clicking it opens a full panel with files, code lines, comment lines, blank lines, and a per-language breakdown — the same counts the OctoCounts web app produces with tokei, pinned to an exact commit.",
  steps: [
    "Install OctoCounts from the Chrome Web Store, Microsoft Edge Add-ons, or Firefox Add-ons — one click, no account.",
    "Open any public GitHub repository page in your browser.",
    "The SLOC card appears in the repository sidebar automatically. Click it to open the full panel with the per-language line breakdown.",
  ],
  permissions:
    "The extension reads the public GitHub repository page you are viewing to detect the owner and repository name, and runs the count against public data through the OctoCounts API. It does not request GitHub account access, needs no API token, works on public repositories only, and collects no personal data. Results are cached locally and by repository and ref so repeat visits load instantly.",
  faq: [
    {
      question: "Why does the SLOC card not appear on a repository page?",
      answer:
        "The card renders on public GitHub repository pages. It does not appear on private repositories (OctoCounts analyzes public repositories only), non-repository pages, or while GitHub ships layout changes. Reload the page first; if the card is still missing on a public repository, check the extension is enabled and report the GitHub URL via the OctoCounts repository.",
    },
    {
      question: "Are the numbers live or cached?",
      answer:
        "Counts are cached by repository and ref, and each report is pinned to the exact commit that was counted, so the same page shows the same numbers until the repository moves on and the cache refreshes. The full panel shows the commit the count comes from.",
    },
    {
      question: "Which browsers are supported?",
      answer:
        "Chrome, Edge, and Firefox, via their official extension stores. The extension source code is open and publicly available.",
    },
  ],
  sourceUrl: "https://github.com/huanglizhuo/OctoCounts",
};

async function extensionPageResponse(context, options = {}) {
  if (options.markdown) {
    return markdownResponse(extensionMarkdown(), "public, s-maxage=3600, stale-while-revalidate=86400", options);
  }
  const index = await indexHtml(context);
  const content = EXTENSION_CONTENT;
  const installButtons = EXTENSION_STORES.map(
    (store) => `<a href="${escapeAttr(store.url)}" data-store="${store.store}" data-placement="extension_page" rel="noreferrer">Install OctoCounts from ${escapeHtml(store.label)}</a>`
  ).join(" ");
  const steps = `<ol>${content.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>`;
  const faqHtml = `<h2>Extension FAQ</h2>${content.faq
    .map((item) => `<h3>${escapeHtml(item.question)}</h3>${answerHtml(item.answer)}`)
    .join("")}`;
  const internalLinks = `<nav aria-label="Related OctoCounts pages"><ul>
    <li><a href="/">OctoCounts web app: count any public GitHub repository</a></li>
    <li><a href="/compare">Compare two repositories</a></li>
    <li><a href="/badges">GitHub SLOC badges for your README</a></li>
    <li><a href="/docs/github-sloc-counter">GitHub SLOC counter guide</a></li>
    <li><a href="/docs/methodology">Counting methodology</a></li>
    <li><a href="/docs/api">OctoCounts API docs</a></li>
  </ul></nav>`;

  return htmlResponse(
    injectHeadAndNoscript(index, {
      title: content.title,
      description: content.description,
      canonical: "https://octocounts.com/extension",
      robots: "index,follow,max-image-preview:large,max-snippet:-1",
      ogImage: "https://octocounts.com/og-image.jpg",
      mdAlternate: "https://octocounts.com/extension.md",
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "WebPage",
            "@id": "https://octocounts.com/extension#webpage",
            name: content.title,
            description: content.description,
            url: "https://octocounts.com/extension",
          },
          {
            // Visible facts only: name, price, browsers, store link, author.
            // No aggregateRating or user counts — none of that shows here.
            "@type": "SoftwareApplication",
            "@id": "https://octocounts.com/extension#extension",
            name: "OctoCounts – GitHub SLOC & Code Statistics",
            operatingSystem: "Chrome, Edge, Firefox",
            applicationCategory: "BrowserApplication",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            url: EXTENSION_STORES[0].url,
            downloadUrl: EXTENSION_STORES[0].url,
            screenshot: "https://octocounts.com/og-image.jpg",
            description: content.description,
            author: {
              "@type": "Person",
              "@id": "https://github.com/huanglizhuo",
              name: "huanglizhuo",
              url: "https://github.com/huanglizhuo",
            },
          },
          {
            "@type": "FAQPage",
            "@id": "https://octocounts.com/extension#faq",
            mainEntity: content.faq.map((item) => ({
              "@type": "Question",
              name: item.question,
              acceptedAnswer: { "@type": "Answer", text: item.answer },
            })),
          },
        ],
      },
      bodyContent: `<section><h1>${escapeHtml(content.heading)}</h1><p>${escapeHtml(content.intro)}</p><p>${installButtons}</p><h2>Install in three steps</h2>${steps}<h2>Permissions and data handling</h2><p>${escapeHtml(content.permissions)}</p><h2>Supported repositories</h2><p>Public GitHub repositories. Private repositories and source-code uploads are not supported; to count private code, run <a href="https://github.com/XAMPPRocky/tokei">tokei</a> locally.</p>${faqHtml}<p>Extension source code: <a href="${escapeAttr(content.sourceUrl)}" rel="noreferrer">${escapeHtml(content.sourceUrl)}</a>.</p>${internalLinks}</section>`,
    }),
    "public, s-maxage=300, stale-while-revalidate=600"
  );
}

/// Markdown twin of the extension landing page: same stores, steps,
/// permissions, and FAQ sentences, serialized with absolute links.
function extensionMarkdown() {
  const content = EXTENSION_CONTENT;
  const stores = EXTENSION_STORES.map((store) => `- [Install OctoCounts from ${store.label}](${store.url})`).join("\n");
  const steps = content.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  const faq = content.faq.map((item) => `### ${item.question}\n\n${item.answer}`).join("\n\n");
  return `# ${content.heading}

${content.description}

${content.intro}

## Install

${stores}

## Install in three steps

${steps}

## Permissions and data handling

${content.permissions}

## Supported repositories

Public GitHub repositories. Private repositories and source-code uploads are not supported; to count private code, run [tokei](https://github.com/XAMPPRocky/tokei) locally.

## Extension FAQ

${faq}

Extension source code: [${content.sourceUrl}](${content.sourceUrl}).

## Related OctoCounts pages

- [OctoCounts web app](https://octocounts.com/)
- [Compare two repositories](https://octocounts.com/compare)
- [GitHub SLOC badges for your README](https://octocounts.com/badges)
- [GitHub SLOC counter guide](https://octocounts.com/docs/github-sloc-counter)
- [Counting methodology](https://octocounts.com/docs/methodology)
- [OctoCounts API docs](https://octocounts.com/docs/api)
`;
}

/// Homepage SSR. Unlike the other routes this does not go through
/// injectHeadAndNoscript: the index.html head already carries the canonical
/// homepage title, description, canonical link, and the full JSON-LD set
/// (WebApplication, FAQPage, WebSite, Organization, SoftwareApplication,
/// Person), none of which should be stripped. Only #root needs
/// crawler-visible content; React discards it on hydration as everywhere else.
async function homePageResponse(context) {
  const index = await indexHtml(context);
  return htmlResponse(injectHome(index), "public, s-maxage=300, stale-while-revalidate=600");
}

function injectHome(index) {
  const faq = homeFaq(index);
  const faqHtml = faq.length
    ? `<h2>Frequently Asked Questions</h2>${faq
        .map((item) => `<h3>${escapeHtml(item.question)}</h3>${answerHtml(item.answer)}`)
        .join("")}`
    : "";
  const internalLinks = `<nav aria-label="Related OctoCounts pages"><ul>
    <li><a href="/extension">OctoCounts browser extension for GitHub SLOC</a></li>
    <li><a href="/badges">GitHub SLOC badges for your README</a></li>
    <li><a href="/compare">Compare two repositories</a></li>
    <li><a href="/trending">Trending GitHub repositories</a></li>
    <li><a href="/stats">OctoCounts public growth stats</a></li>
    <li><a href="/recent">Recently analyzed repositories</a></li>
    <li><a href="/popular">Popular SLOC reports</a></li>
    <li><a href="/hall-of-monoliths">Hall of Monoliths: largest repositories by SLOC</a></li>
    <li><a href="/docs/github-sloc-counter">GitHub SLOC counter guide</a></li>
    <li><a href="/docs/methodology">Counting methodology</a></li>
    <li><a href="/docs/api">OctoCounts API docs</a></li>
    <li><a href="/docs/github-language-bar-alternative">GitHub language bar alternative</a></li>
    <li><a href="/docs/best-sloc-counter-tools">Best SLOC counter tools compared</a></li>
  </ul></nav>`;
  const bodyContent = `<section><h1>OctoCounts – GitHub SLOC Counter</h1>
    <p>OctoCounts is a free SLOC counter for public GitHub repositories. It counts files, code lines, comments, blanks, and per-language totals without cloning: the backend downloads the repository source archive, runs <a href="https://github.com/XAMPPRocky/tokei">tokei</a>, and caches the result by commit SHA. Neither the web app nor the Chrome, Edge, and Firefox browser extensions require an account.</p>
    <img src="/og-image.jpg" width="1200" height="630" alt="OctoCounts mascot next to a terminal card reading Total LOC 5,505 with Code, Comments, and Blanks counts, and the tagline: Making your code count (literally)." />
    <p><small>Last updated: ${HOME_CONTENT_LASTMOD} &middot; Maintained by <a href="https://github.com/huanglizhuo">huanglizhuo</a></small></p>
    <h2>How it works</h2>
    <ol>
      <li>OctoCounts resolves the requested branch, tag, or commit and pins the analysis to an exact commit SHA.</li>
      <li>It downloads the repository's source archive tarball — never a full git clone with history.</li>
      <li>tokei, the open-source line counter written in Rust, counts every source file into files, total lines, code, comments, and blanks per language.</li>
      <li>The report is cached by commit SHA, tokei version, and analysis options, so counting the same revision again is instant and reproduces exactly the same numbers.</li>
    </ol>
    ${faqHtml}
    <h2>Explore OctoCounts</h2>
    ${internalLinks}
    <p>Example reports: <a href="/github/facebook/react">facebook/react</a>, <a href="/github/vitejs/vite">vitejs/vite</a>, <a href="/github/torvalds/linux">torvalds/linux</a>.</p>
  </section>`;
  // The SSR body inside #root is visible without JavaScript, so the noscript
  // block would only duplicate the same content (and a second h1) for
  // crawlers. Strip it like the other SSR routes do; the head stays intact.
  return index
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>\s*/gi, "")
    .replace('<div id="root"></div>', `<div id="root">${bodyContent}</div>`);
}

/// The crawler-visible FAQ is rendered from the homepage's own FAQPage
/// JSON-LD block, so the visible answers and the structured data share one
/// source and cannot drift. If the block is missing or unparseable the
/// section is simply omitted — the rest of the SSR body still stands.
function homeFaq(index) {
  const blocks = index.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  for (const block of blocks) {
    try {
      const json = JSON.parse(block.replace(/<\/?script\b[^>]*>/gi, ""));
      if (json["@type"] === "FAQPage" && Array.isArray(json.mainEntity)) {
        return json.mainEntity
          .map((item) => ({ question: String(item?.name ?? ""), answer: String(item?.acceptedAnswer?.text ?? "") }))
          .filter((item) => item.question && item.answer);
      }
    } catch {
      // Not the FAQ block, or not JSON at all; try the next script.
    }
  }
  return [];
}

/// Per-URL 503 for curated compare pages: backend down or an integrity-guard
/// mismatch. Not noindex — see reportUnavailableMeta.
async function compareUnavailableResponse(context, entry) {
  return serviceUnavailableResponse(await indexHtml(context), {
    title: `${entry.name}: source lines of code compared | OctoCounts`,
    description: `The ${entry.name} source line count comparison is temporarily unavailable. Please try again shortly.`,
    canonical: `https://octocounts.com/compare/${entry.slug}`,
    robots: "index,follow,max-image-preview:large,max-snippet:-1",
    ogImage: "https://octocounts.com/og-image.jpg",
    jsonLd: null,
    extraHead: `<script type="application/json" id="octocounts-compare-data">${escapeScriptJson(compareFallbackViewModel(entry, "unavailable"))}</script>`,
    bodyContent: `<section><h1>${escapeHtml(entry.name)}: source lines of code compared</h1><p>This comparison is temporarily unavailable. Please try again in a moment.</p></section>`,
  });
}

async function curatedCompareResponse(context, entry, options = {}) {
  const [leftResult, rightResult] = await Promise.all([
    fetchSeoReport(context, entry.left),
    fetchSeoReport(context, entry.right),
  ]);

  if (leftResult.state === "unavailable" || rightResult.state === "unavailable") {
    return compareUnavailableResponse(context, entry);
  }

  if (leftResult.state === "missing" || rightResult.state === "missing") {
    if (options.markdown) return markdownResponse(compareMissingMarkdown(entry), "public, max-age=60", options);
    return htmlResponse(injectCompareFallback(await indexHtml(context), entry), "public, max-age=60");
  }

  const [left, right] = await Promise.all([leftResult.response.json(), rightResult.response.json()]);
  // Same integrity guard as report pages: a compare page's title, description,
  // and table all derive from these two payloads, so a mis-keyed cache tier
  // would publish one repository's numbers under another's name. Fail closed.
  if (!reportMatchesRoute(left, entry.left) || !reportMatchesRoute(right, entry.right)) {
    return compareUnavailableResponse(context, entry);
  }
  const model = buildCompareViewModel(entry, left, right);
  if (options.markdown) {
    return markdownResponse(compareMarkdown(model), "public, s-maxage=3600, stale-while-revalidate=86400", options);
  }
  return htmlResponse(injectCuratedCompare(await indexHtml(context), model), "public, s-maxage=300, stale-while-revalidate=600");
}

/// Serializable view model shared by three renderers of the same comparison:
/// the SSR HTML body, the client React page (#octocounts-compare-data), and
/// the markdown twin. Every reader-visible value — display strings included —
/// is derived here exactly once, so the representations cannot drift.
function buildCompareViewModel(entry, left, right) {
  const leftDate = left.generatedAt.slice(0, 10);
  const rightDate = right.generatedAt.slice(0, 10);
  const canonical = `https://octocounts.com/compare/${entry.slug}`;
  const interactiveParams = new URLSearchParams({ left: gitHubUrl(entry.left), right: gitHubUrl(entry.right) });
  if (entry.left.ref) interactiveParams.set("leftRef", entry.left.ref);
  if (entry.right.ref) interactiveParams.set("rightRef", entry.right.ref);
  const interactiveHref = `/compare?${interactiveParams.toString()}`;
  const prefill = { left: gitHubUrl(entry.left), right: gitHubUrl(entry.right) };
  if (entry.left.ref) prefill.leftRef = entry.left.ref;
  if (entry.right.ref) prefill.rightRef = entry.right.ref;
  const metrics = [
    ["Files", left.total.files, right.total.files],
    ["Total lines", left.total.lines, right.total.lines],
    ["Code lines", left.total.code, right.total.code],
    ["Comment lines", left.total.comments, right.total.comments],
    ["Blank lines", left.total.blanks, right.total.blanks],
    ["Languages counted", left.languages.length, right.languages.length],
  ];
  const side = (report, date) => ({
    repoFullName: report.repoFullName,
    publicPath: report.publicPath,
    canonicalUrl: report.canonicalUrl,
    htmlUrl: report.htmlUrl,
    refName: report.refName,
    commitSha: report.commitSha,
    generatedAt: report.generatedAt,
    date,
    totals: { ...report.total, languages: report.languages.length },
    topLanguages: topLanguages(report, 5).map((language) => ({ name: language.name, code: language.stats.code })),
  });
  return {
    state: "ready",
    slug: entry.slug,
    name: entry.name,
    canonical,
    title: `${entry.name}: source lines of code compared | OctoCounts`,
    heading: `${entry.name}: source lines of code compared`,
    description: `${left.repoFullName} has ${formatNumber(left.total.lines)} total lines (${formatNumber(left.total.code)} code) and ${right.repoFullName} has ${formatNumber(right.total.lines)} total lines (${formatNumber(right.total.code)} code), counted with tokei. Totals, language mix, and methodology compared.`,
    interactiveHref,
    prefill,
    left: side(left, leftDate),
    right: side(right, rightDate),
    // Display strings, not raw numbers: the client renders them verbatim so a
    // browser locale (Intl grouping) can never disagree with the SSR body.
    rows: metrics.map(([label, leftValue, rightValue]) => ({ label, left: formatNumber(leftValue), right: formatNumber(rightValue) })),
    definitionText: `This page compares the source lines of code (SLOC) of ${left.repoFullName} and ${right.repoFullName} using cached OctoCounts reports. Code size is not code quality: a larger count only means more source material, not a better or worse project.`,
    // Declarative answer capsule rendered right after the h1 in the SSR body
    // and as the first paragraph of the markdown twin. It names only real
    // repository names and defers every number to the methodology line, so
    // the three renderers stay consistent without restating figures here.
    capsuleText: `The ${entry.name} comparison on OctoCounts shows side-by-side source line counts for ${left.repoFullName} and ${right.repoFullName}, counted with the same engine and analysis options on the dates shown in the methodology line: files, total lines, code lines, comment lines, blank lines, and per-language totals, pinned to the exact commits listed below.`,
    summaryText: compareSummaryText(left, right, leftDate, rightDate),
    languageMixText: compareLanguageMixText(left, right),
    methodologyText: compareMethodologyText(left, right, leftDate, rightDate),
    disclaimerText: "Note: code size is not code quality. OctoCounts only reports reproducible line counts and makes no claim that either project is better.",
    editorial: COMPARE_EDITORIAL[entry.slug] ?? null,
    faq: compareFaq(entry, left, right, leftDate, rightDate),
    relatedLinks: [
      { href: "/compare", label: "Interactive repository comparison" },
      { href: "/recent", label: "Recently analyzed repositories" },
      { href: "/popular", label: "Popular SLOC reports" },
      { href: "/trending", label: "Trending GitHub repositories" },
      { href: "/hall-of-monoliths", label: "Hall of Monoliths" },
      { href: "/docs/github-sloc-counter", label: "GitHub SLOC counter guide" },
      { href: "/docs/methodology", label: "Counting methodology" },
      { href: "/docs/api", label: "OctoCounts API docs" },
    ],
    updatedAt: left.generatedAt > right.generatedAt ? left.generatedAt : right.generatedAt,
  };
}

/// Minimal view model for the two degraded states, so the client page keeps
/// the same heading and canonical identity as the SSR fallback it replaces.
function compareFallbackViewModel(entry, state) {
  return {
    state,
    slug: entry.slug,
    name: entry.name,
    canonical: `https://octocounts.com/compare/${entry.slug}`,
    title: `${entry.name}: source lines of code compared | OctoCounts`,
    heading: `${entry.name}: source lines of code compared`,
    interactiveHref: `/compare/${entry.slug}`,
  };
}

/// Markdown twin of injectCuratedCompare: rendered from the same view model,
/// so summary/mix/methodology sentences, the pipe table, and absolute links
/// carry identical facts to the HTML page and the client React page.
function compareMarkdown(model) {
  const table = [
    `| Metric | [${model.left.repoFullName}](https://octocounts.com${model.left.publicPath}) | [${model.right.repoFullName}](https://octocounts.com${model.right.publicPath}) |`,
    "| --- | ---: | ---: |",
    ...model.rows.map((row) => `| ${row.label} | ${row.left} | ${row.right} |`),
  ].join("\n");
  const methodology = model.methodologyText.replace(
    "See the counting methodology",
    "See the [counting methodology](https://octocounts.com/docs/methodology)"
  );
  return `# ${model.name}: source lines of code compared

${model.capsuleText}

${model.summaryText}

${table}

${model.languageMixText}

${methodology}
${model.editorial ? `## About this comparison

${model.editorial.scope}

${model.editorial.insights.join("\n\n")}

_${model.editorial.caution}_

Sources: ${model.editorial.sources.map((source) => `[${source.label}](${source.url})`).join(" · ")}. Statements verified ${model.editorial.verifiedAt}.

` : ""}Evidence and next steps:

- [${model.left.repoFullName} SLOC report](https://octocounts.com${model.left.publicPath})
- [${model.right.repoFullName} SLOC report](https://octocounts.com${model.right.publicPath})
- [Compare ${model.left.repoFullName} and ${model.right.repoFullName} interactively](https://octocounts.com${model.interactiveHref})

${model.disclaimerText}

## Compare FAQ

${compareFaqMarkdown(model.faq)}

## Related OctoCounts pages

${model.relatedLinks.map((link) => `- [${link.label}](https://octocounts.com${link.href})`).join("\n")}
`;
}

function compareMissingMarkdown(entry) {
  const fullNames = `${entry.left.owner}/${entry.left.repo} and ${entry.right.owner}/${entry.right.repo}`;
  return `# ${entry.name}: source lines of code compared\n\nA cached OctoCounts report is not available for both repositories yet (${fullNames}), so this comparison cannot be rendered. Open https://octocounts.com/compare/${entry.slug} with JavaScript enabled to run the analyses, then revisit this page.\n`;
}

const SEO_REPORT_TIMEOUT_MS = 8_000;
// Module-level state survives across requests within a Cloudflare Workers
// isolate, so one sitemap request does not re-fire ~200 report checks.
const COMPARE_EXISTENCE_TTL_MS = 3_600_000;
const compareExistenceCache = new Map();

/// Test hook: the existence cache would otherwise leak between test cases.
export function __resetCompareExistenceCacheForTests() {
  compareExistenceCache.clear();
}

/// Fetch an /api/seo/report and classify the outcome:
/// - "ok": report exists (response attached, unread)
/// - "missing": 404 — the repository has no cached report
/// - "unavailable": 5xx, network error, or timeout — transient backend trouble
async function fetchSeoReport(context, target) {
  try {
    const response = await fetch(seoReportUrl(context, target), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(SEO_REPORT_TIMEOUT_MS),
    });
    if (response.ok) return { state: "ok", response };
    if (response.status === 404) return { state: "missing" };
    return { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}

/// 503 + no-store: ask crawlers to retry later. The body is the plain SPA
/// shell — no noindex injection and nothing the CDN is allowed to cache.
/// A transient backend failure used to serve the bare, generic index.html
/// shell here — same <title>, same meta description, and its only <h1>
/// sitting inside a <noscript> block search-engine H1 detection typically
/// ignores. Every report/compare URL hit by the same outage therefore
/// looked byte-identical to a crawler, which is exactly what surfaced as
/// "duplicate title tag" / "duplicate meta description" across unrelated
/// repo pages (and "missing <h1>") in Bing Webmaster Tools. `meta` gives
/// each URL its own real title/description/H1 even while unavailable; the
/// 503 + no-store still tell crawlers not to index or cache this response.
function serviceUnavailableResponse(index, meta) {
  const html = meta ? injectHeadAndNoscript(index, meta) : index;
  return new Response(html, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...securityHeaders(),
    },
  });
}

function compareTargetKey(target) {
  return `${target.owner.toLowerCase()}/${target.repo.toLowerCase()}@${target.ref || ""}`;
}

async function cachedReportState(context, target) {
  const key = compareTargetKey(target);
  const cached = compareExistenceCache.get(key);
  if (cached && Date.now() - cached.checkedAt < COMPARE_EXISTENCE_TTL_MS) return cached.state;
  const result = await fetchSeoReport(context, target);
  // "unavailable" results are never cached: a network blip must not filter a
  // sitemap entry out (or keep one in) for the next hour.
  if (result.state !== "unavailable") {
    compareExistenceCache.set(key, { state: result.state, checkedAt: Date.now() });
  }
  return result.state;
}

/// Sitemap entries for curated comparisons whose both sides have cached
/// reports. A definitive 404 on either side drops the slug (its SSR page is
/// noindex, so listing it would teach Google to ignore the sitemap); any
/// transient failure keeps the entry.
async function indexableCompareEntries(context) {
  const targets = new Map();
  for (const entry of COMPARE_REGISTRY) {
    for (const target of [entry.left, entry.right]) targets.set(compareTargetKey(target), target);
  }
  const states = new Map();
  await Promise.all(
    [...targets.entries()].map(async ([key, target]) => {
      states.set(key, await cachedReportState(context, target));
    })
  );
  return COMPARE_REGISTRY.filter((entry) => {
    const left = states.get(compareTargetKey(entry.left));
    const right = states.get(compareTargetKey(entry.right));
    return left !== "missing" && right !== "missing";
  }).map((entry) => ({
    loc: `https://octocounts.com/compare/${entry.slug}`,
    lastmod: COMPARE_CONTENT_LASTMOD,
  }));
}

function seoReportUrl(context, target) {
  const params = new URLSearchParams({ provider: "github", owner: target.owner, repo: target.repo });
  const ref = target.ref || target.refName;
  if (ref) params.set("refName", ref);
  return `${apiBase(context)}/api/seo/report?${params.toString()}`;
}

/// RFC 1123 date for Last-Modified, or null when the source date is absent
/// or unparseable (never invent one).
function httpDate(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toUTCString();
}

/// If-Modified-Since has second granularity while generatedAt carries
/// fractional seconds; compare truncated to whole seconds so a same-second
/// conditional request still earns its 304. Invalid dates never match.
function notModifiedSince(request, lastModified) {
  const header = request.headers.get("if-modified-since");
  if (!header) return false;
  const headerMs = Date.parse(header);
  const lastMs = Date.parse(lastModified);
  return !Number.isNaN(headerMs) && !Number.isNaN(lastMs) && Math.floor(headerMs / 1000) >= Math.floor(lastMs / 1000);
}

/// A fetched report is usable for a route only when it describes that route's
/// repository. Case-insensitive on purpose: the store returns the canonical
/// casing for a differently-cased URL, which the caller then 308s to — that is
/// a redirect, not contamination. A genuinely different repo means some tier
/// between this function and the store answered with the wrong payload.
function reportMatchesRoute(report, target) {
  return (
    typeof report?.repoFullName === "string" &&
    report.repoFullName.toLowerCase() === `${target.owner}/${target.repo}`.toLowerCase()
  );
}

/// Per-URL metadata for the 503 branch (backend down) and the integrity
/// guard (wrong-repo payload). Not noindex: the 503 status alone tells
/// crawlers this is transient and to retry later. Stacking noindex on top
/// risks a crawler deindexing a normally-indexable URL over a passing blip.
function reportUnavailableMeta(route) {
  const fullName = `${route.owner}/${route.repo}`;
  return {
    title: `${fullName} SLOC report | OctoCounts`,
    description: `Source line count report for ${fullName} is temporarily unavailable. Please try again shortly.`,
    canonical: `https://octocounts.com/${route.provider}/${route.owner}/${route.repo}`,
    robots: "index,follow,max-image-preview:large,max-snippet:-1",
    ogImage: "https://octocounts.com/og-image.jpg",
    jsonLd: null,
    bodyContent: `<section><h1>${escapeHtml(fullName)} SLOC report</h1><p>This report is temporarily unavailable. Please try again in a moment.</p></section>`,
  };
}

function injectCuratedCompare(index, model) {
  const table = `<table><thead><tr><th>Metric</th><th><a href="${escapeAttr(model.left.publicPath)}">${escapeHtml(model.left.repoFullName)}</a></th><th><a href="${escapeAttr(model.right.publicPath)}">${escapeHtml(model.right.repoFullName)}</a></th></tr></thead><tbody>${model.rows
    .map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.left)}</td><td>${escapeHtml(row.right)}</td></tr>`)
    .join("")}</tbody></table>`;
  const internalLinks = `<nav aria-label="Related OctoCounts pages"><ul>${model.relatedLinks
    .map((link) => `<li><a href="${escapeAttr(link.href)}">${escapeHtml(link.label)}</a></li>`)
    .join("")}</ul></nav>`;
  // The methodology sentence keeps its inline /docs/methodology link in HTML;
  // the client splits the same plain string on the same anchor phrase.
  const methodology = `<p>${escapeHtml(model.methodologyText).replace("See the counting methodology", 'See the <a href="/docs/methodology">counting methodology</a>')}</p>`;
  const editorialHtml = model.editorial
    ? `<section aria-label="About this comparison"><h2>About this comparison</h2><p>${escapeHtml(model.editorial.scope)}</p>${model.editorial.insights
        .map((insight) => `<p>${escapeHtml(insight)}</p>`)
        .join("")}<p><em>${escapeHtml(model.editorial.caution)}</em></p><p>Sources: ${model.editorial.sources
        .map((source) => `<a href="${escapeAttr(source.url)}" rel="noreferrer">${escapeHtml(source.label)}</a>`)
        .join(" · ")}. Statements verified ${escapeHtml(model.editorial.verifiedAt)}.</p></section>`
    : "";
  const bodyContent = `<section><h1>${escapeHtml(model.heading)}</h1><p>${escapeHtml(model.capsuleText)}</p><p>${escapeHtml(model.definitionText)}</p><p id="octocounts-compare-summary">${escapeHtml(model.summaryText)}</p>${table}<p>${escapeHtml(model.languageMixText)}</p>${methodology}${editorialHtml}<p>Evidence and next steps:</p><ul>
    <li><a href="${escapeAttr(model.left.publicPath)}">${escapeHtml(model.left.repoFullName)} SLOC report</a></li>
    <li><a href="${escapeAttr(model.right.publicPath)}">${escapeHtml(model.right.repoFullName)} SLOC report</a></li>
    <li><a href="${escapeAttr(model.interactiveHref)}">Compare ${escapeHtml(model.left.repoFullName)} and ${escapeHtml(model.right.repoFullName)} interactively</a></li>
  </ul><p>${escapeHtml(model.disclaimerText)}</p>${compareFaqHtml(model.faq)}${internalLinks}</section>`;

  return injectHeadAndNoscript(index, {
    title: model.title,
    description: model.description,
    canonical: model.canonical,
    robots: "index,follow,max-image-preview:large,max-snippet:-1",
    ogImage: "https://octocounts.com/og-image.jpg",
    jsonLd: compareJsonLd(model),
    mdAlternate: `${model.canonical}.md`,
    // Two machine-readable payloads for the client page: the full view model
    // it renders (SG-01: JS readers keep the comparison instead of losing it
    // to the generic tool) and the prefill the embedded interactive tool
    // starts from.
    extraHead: `<script type="application/json" id="octocounts-compare-data">${escapeScriptJson(model)}</script>
<script type="application/json" id="octocounts-compare-prefill">${escapeScriptJson(model.prefill)}</script>`,
    bodyContent,
  });
}

function gitHubUrl(target) {
  return `https://github.com/${target.owner}/${target.repo}`;
}

function compareSummaryText(left, right, leftDate, rightDate) {
  const leftCode = Math.max(Number(left.total.code) || 0, 1);
  const rightCode = Math.max(Number(right.total.code) || 0, 1);
  const ratio = leftCode >= rightCode ? leftCode / rightCode : rightCode / leftCode;
  const sizePhrase = ratio < 1.15
    ? `${left.repoFullName} and ${right.repoFullName} are similar in size by code lines`
    : `${leftCode >= rightCode ? left.repoFullName : right.repoFullName} is about ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}x the size of ${leftCode >= rightCode ? right.repoFullName : left.repoFullName} by code lines`;
  return `As of ${leftDate}, ${left.repoFullName} contains ${formatNumber(left.total.lines)} total lines (${formatNumber(left.total.code)} code) across ${formatNumber(left.total.files)} files, while ${right.repoFullName} contains ${formatNumber(right.total.lines)} total lines (${formatNumber(right.total.code)} code) across ${formatNumber(right.total.files)} files as of ${rightDate}. ${sizePhrase}. Code size is not code quality: a larger count only means more source material, not a better or worse project.`;
}

function compareLanguageMixText(left, right) {
  const leftTop = topLanguages(left, 5);
  const rightTop = topLanguages(right, 5);
  const format = (report, languages) => languages
    .slice(0, 3)
    .map((language) => `${language.name} (${((language.stats.code / Math.max(Number(report.total.code) || 0, 1)) * 100).toFixed(1)}% of code)`)
    .join(", ");
  const leftNames = new Set(leftTop.map((language) => language.name));
  const rightNames = new Set(rightTop.map((language) => language.name));
  const shared = [...leftNames].filter((name) => rightNames.has(name));
  const leftOnly = [...leftNames].filter((name) => !rightNames.has(name));
  const rightOnly = [...rightNames].filter((name) => !leftNames.has(name));
  const clauses = [];
  if (shared.length) clauses.push(`${shared.join(", ")} ${shared.length > 1 ? "appear" : "appears"} in both top language lists`);
  if (leftOnly.length) clauses.push(`${leftOnly.join(", ")} ${leftOnly.length > 1 ? "appear" : "appears"} only in ${left.repoFullName}'s top languages`);
  if (rightOnly.length) clauses.push(`${rightOnly.join(", ")} ${rightOnly.length > 1 ? "appear" : "appears"} only in ${right.repoFullName}'s top languages`);
  const difference = clauses.length ? `${clauses.join("; ")}.` : "No language ranks in the top five of both repositories.";
  return `Top languages in ${left.repoFullName}: ${format(left, leftTop)}. Top languages in ${right.repoFullName}: ${format(right, rightTop)}. ${difference}`;
}

function topLanguages(report, count) {
  return [...report.languages].sort((a, b) => b.stats.code - a.stats.code).slice(0, count);
}

function compareMethodologyText(left, right, leftDate, rightDate) {
  return `Methodology: both counts come from cached OctoCounts reports generated with tokei. ${left.repoFullName} was counted at ref ${left.refName} (commit ${left.commitSha.slice(0, 12)}) on ${leftDate}; ${right.repoFullName} was counted at ref ${right.refName} (commit ${right.commitSha.slice(0, 12)}) on ${rightDate}. See the counting methodology for ignored directories and analysis options.`;
}

/// Question-answer cluster every /compare/* page renders, matching the
/// question-shaped fan-out ("which is bigger", "does more SLOC mean more
/// complex", "is this fair", "can I use a different ref") that AI answer
/// engines and Google's "People also ask" surface for a comparison query.
/// Compare pages had zero question-based headings before this; it was the
/// single largest AEO gap on the site given there are 90+ of these pages.
function compareFaq(entry, left, right, leftDate, rightDate) {
  const leftCode = Math.max(Number(left.total.code) || 0, 1);
  const rightCode = Math.max(Number(right.total.code) || 0, 1);
  const bigger = leftCode >= rightCode ? left.repoFullName : right.repoFullName;
  const smaller = leftCode >= rightCode ? right.repoFullName : left.repoFullName;
  const ratio = leftCode >= rightCode ? leftCode / rightCode : rightCode / leftCode;
  const closeCall = ratio < 1.15;
  return [
    {
      question: `Which has more lines of code, ${left.repoFullName} or ${right.repoFullName}?`,
      answer: closeCall
        ? `As of ${leftDate > rightDate ? leftDate : rightDate}, ${left.repoFullName} and ${right.repoFullName} are close in size: ${formatNumber(left.total.code)} vs ${formatNumber(right.total.code)} code lines, a difference of less than 15%. Neither clearly outsizes the other by this metric.`
        : `${bigger} has more code: ${formatNumber(leftCode >= rightCode ? leftCode : rightCode)} code lines versus ${formatNumber(leftCode >= rightCode ? rightCode : leftCode)} for ${smaller}, about ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}x as much, based on cached OctoCounts reports as of ${leftDate > rightDate ? leftDate : rightDate}.`,
    },
    {
      question: "Does more source lines of code mean more complexity?",
      answer: `Not necessarily. SLOC measures size, not complexity, quality, or maintainability. A larger codebase can mean more features, more generated or vendored code, more verbose language idioms, or more tests — none of which imply the code is harder to work with. Use SLOC to gauge the scale of what you'd be reading or maintaining, not as a quality signal for ${left.repoFullName}, ${right.repoFullName}, or any repository.`,
    },
    {
      question: "How is this comparison calculated?",
      answer: compareMethodologyText(left, right, leftDate, rightDate),
    },
    {
      question: "Can I compare a different branch, tag, or commit?",
      answer: `Yes. This page shows the default branch for each repository. Use the interactive comparison tool to pick any public GitHub repository, branch, tag, or commit SHA for both sides and get a fresh side-by-side report.`,
    },
  ];
}

function compareFaqHtml(faq) {
  return `<h2>Compare FAQ</h2>${faq.map((item) => `<h3>${escapeHtml(item.question)}</h3>${answerHtml(item.answer)}`).join("")}`;
}

function compareFaqMarkdown(faq) {
  return faq.map((item) => `### ${item.question}\n\n${item.answer}`).join("\n\n");
}

function compareFaqJsonLd(canonical, faq) {
  return {
    "@type": "FAQPage",
    "@id": `${canonical}#faq`,
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

function compareJsonLd(model) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      compareFaqJsonLd(model.canonical, model.faq),
      {
        "@type": "Dataset",
        "@id": `${model.canonical}#dataset`,
        name: `${model.name} source line count comparison`,
        description: model.description,
        url: model.canonical,
        dateModified: model.updatedAt,
        // Mirrors the report pages: the h1 plus the summary sentence are the
        // self-contained block an answer engine would read aloud or quote.
        speakable: {
          "@type": "SpeakableSpecification",
          cssSelector: ["#root h1", "#octocounts-compare-summary"],
        },
        measurementTechnique: "tokei via OctoCounts",
        variableMeasured: ["files", "lines", "code", "comments", "blanks", "languages"],
        creator: {
          "@type": "Organization",
          name: "OctoCounts",
          url: "https://octocounts.com/",
        },
        isBasedOn: [model.left.canonicalUrl, model.right.canonicalUrl],
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${model.canonical}#breadcrumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "OctoCounts", item: "https://octocounts.com/" },
          { "@type": "ListItem", position: 2, name: "Compare", item: "https://octocounts.com/compare" },
          { "@type": "ListItem", position: 3, name: model.name, item: model.canonical },
        ],
      },
    ],
  };
}

function injectCompareFallback(index, entry) {
  const fullNames = `${entry.left.owner}/${entry.left.repo} and ${entry.right.owner}/${entry.right.repo}`;
  return injectHeadAndNoscript(index, {
    title: `${entry.name}: source lines of code compared | OctoCounts`,
    description: `Source line count comparison of ${fullNames}. Analyze these public GitHub repositories with OctoCounts.`,
    canonical: `https://octocounts.com/compare/${entry.slug}`,
    robots: "noindex,follow,max-image-preview:large",
    ogImage: "https://octocounts.com/og-image.jpg",
    jsonLd: null,
    extraHead: `<script type="application/json" id="octocounts-compare-data">${escapeScriptJson(compareFallbackViewModel(entry, "missing"))}</script>`,
    bodyContent: `<section><h1>${escapeHtml(entry.name)}: source lines of code compared</h1><p>A cached OctoCounts report is not available for both repositories yet, so this comparison cannot be rendered. Open this page with JavaScript enabled to run the analyses, then revisit this page.</p></section>`,
  });
}

async function sitemapResponse(context) {
  const response = await fetch(`${apiBase(context)}/api/seo/sitemap`, {
    headers: { accept: "application/json" },
  });
  const dynamicEntries = response.ok ? await response.json() : [];
  const snapshot = await trendingSnapshot(context);
  // Only comparisons whose both sides have cached reports: the rest SSR as
  // noindex fallbacks, and a sitemap full of noindex URLs trains crawlers to
  // distrust it.
  const curatedEntries = await indexableCompareEntries(context);
  const entries = STATIC_SITEMAP_ENTRIES.map((entry) => entry.loc.endsWith("/trending") ? { ...entry, lastmod: snapshot.date } : entry)
    .concat(curatedEntries)
    .concat(dynamicEntries.map((entry) => ({ loc: entry.loc, lastmod: entry.lastmod })));
  const urls = entries
    .map(
      (entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
${entry.lastmod ? `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>\n` : ""}  </url>`
    )
    .join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
      ...securityHeaders(),
    },
  });
}

async function trendingSnapshot(context) {
  const url = new URL(context.request.url);
  url.pathname = "/github-trending.json";
  url.search = "";
  const response = await context.env.ASSETS.fetch(new Request(url.toString(), context.request));
  if (!response.ok) return { source: "https://github.com/trending", generatedAt: "", date: "", repositories: [] };
  const snapshot = await response.json().catch(() => null);
  return snapshot && Array.isArray(snapshot.repositories)
    ? snapshot
    : { source: "https://github.com/trending", generatedAt: "", date: "", repositories: [] };
}

async function indexHtml(context) {
  const url = new URL(context.request.url);
  url.pathname = "/";
  url.search = "";
  const response = await context.env.ASSETS.fetch(new Request(url.toString(), context.request));
  return response.text();
}

function apiBase(context) {
  return (context.env.SEO_API_BASE || API_BASE).replace(/\/+$/, "");
}

function listPageMeta(kind) {
  if (kind === "recent") {
    return {
      title: "Recently analyzed repositories | OctoCounts",
      description: "Recently analyzed public GitHub repositories with source line count reports.",
      canonical: "https://octocounts.com/recent",
    };
  }
  if (kind === "monoliths") {
    return {
      title: "Hall of Monoliths: largest GitHub repositories by lines of code | OctoCounts",
      description: "A live OctoCounts leaderboard of large public GitHub repositories ranked by total source lines of code.",
      canonical: "https://octocounts.com/hall-of-monoliths",
    };
  }
  return {
    title: "Popular SLOC reports | OctoCounts",
    description: "Popular OctoCounts source line count reports for public GitHub repositories.",
    canonical: "https://octocounts.com/popular",
  };
}

/// Curated comparisons relevant to a report's dominant language, so every
/// long-tail /github/* page links into the compare corpus with topical
/// anchors instead of an identical link list on every page.
function relatedComparisons(topLanguageName) {
  const byLanguage = {
    JavaScript: ["react-vs-vue", "nextjs-vs-vite", "vite-vs-webpack", "angular-vs-vue"],
    TypeScript: ["nextjs-vs-vite", "angular-vs-vue", "svelte-vs-vue", "react-vs-vue"],
    Rust: ["rust-vs-go", "electron-vs-tauri", "deno-vs-node"],
    Go: ["rust-vs-go", "deno-vs-node", "kubernetes-vs-terraform"],
    Python: ["tensorflow-vs-pytorch", "django-vs-rails", "laravel-vs-django"],
    "C++": ["tensorflow-vs-pytorch", "electron-vs-tauri", "godot-vs-bevy"],
    "C": ["neovim-vs-vscode", "mongodb-vs-postgres"],
    Java: ["mongodb-vs-postgres", "kubernetes-vs-docker-compose", "kubernetes-vs-terraform"],
    Kotlin: ["react-native-vs-flutter"],
    Dart: ["react-native-vs-flutter"],
    Ruby: ["django-vs-rails", "laravel-vs-django"],
    PHP: ["laravel-vs-django", "django-vs-rails"],
    Shell: ["deno-vs-node", "bun-vs-node"],
    Zig: ["rust-vs-go", "bun-vs-deno"],
    Lua: ["neovim-vs-vscode", "godot-vs-bevy"],
    HTML: ["bootstrap-vs-tailwind"],
    CSS: ["bootstrap-vs-tailwind"],
  };
  const slugs = byLanguage[topLanguageName] || [];
  return slugs
    .map((slug) => COMPARE_REGISTRY.find((entry) => entry.slug === slug))
    .filter(Boolean)
    .slice(0, 3);
}

function injectReport(index, report, apiBaseUrl, relatedReports = []) {
  const top = report.topLanguage ? ` (${report.topLanguage.name} ${report.topLanguage.percent.toFixed(1)}%)` : "";
  const lead = `<p>${escapeHtml(reportLeadText(report))}</p>`;
  const rows = report.languages
    .map(
      (language) => `<tr><td>${escapeHtml(language.name)}</td><td>${language.stats.files}</td><td>${language.stats.lines}</td><td>${language.stats.code}</td><td>${language.stats.comments}</td><td>${language.stats.blanks}</td></tr>`
    )
    .join("");
  const faq = reportFaq(report);
  const faqHtml = `<section><h2>Report FAQ</h2>${faq
    .map((item) => `<h3>${escapeHtml(item.question)}</h3>${answerHtml(item.answer)}`)
    .join("")}</section>`;
  // Contextual links out of every report page: crawlers get a path from any
  // long-tail /github/* URL into the curated compare corpus (and vice versa),
  // and each link is relevant to the repository's dominant language.
  const relatedCompare = relatedComparisons(report.topLanguage?.name);
  const relatedCompareHtml = relatedCompare.length
    ? `<li>${relatedCompare
        .map((entry) => `<a href="/compare/${entry.slug}">${escapeHtml(entry.name)}</a>`)
        .join(" · ")}</li>`
    : "";
  const internalLinks = `<nav aria-label="Related OctoCounts pages"><ul>
    <li><a href="/recent">Recently analyzed repositories</a></li>
    <li><a href="/popular">Popular SLOC reports</a></li>
    <li><a href="/trending">Trending GitHub repositories</a></li>
    <li><a href="/hall-of-monoliths">Hall of Monoliths</a></li>${relatedCompareHtml}
    <li><a href="/docs/github-sloc-counter">GitHub SLOC counter guide</a></li>
    <li><a href="/docs/methodology">Counting methodology</a></li>
    <li><a href="/docs/api">OctoCounts API docs</a></li>
  </ul></nav>`;
  // Visible, not just linked from <meta property="og:image">: a crawler that
  // never executes JavaScript otherwise sees a text-only page even though a
  // per-repo chart image already exists at this URL. AI answer engines weigh
  // multi-modal pages more heavily, and the alt text doubles as another
  // self-contained citable summary next to the one in #octocounts-citation.
  const ogImageUrl = `${apiBaseUrl}/og/${encodeURIComponent(report.provider)}/${encodeURIComponent(report.owner)}/${encodeURIComponent(report.repo)}`;
  const ogImageHtml = `<img src="${escapeAttr(ogImageUrl)}" width="1200" height="630" alt="${escapeAttr(report.citation)}" />`;
  const table = `<section><h1>${escapeHtml(report.repoFullName)} SLOC report</h1><p>${escapeHtml(reportCapsuleText(report))}</p><p id="octocounts-citation">${escapeHtml(report.citation)}</p>${ogImageHtml}${lead}${reportInsights(report)}<table><thead><tr><th>Language</th><th>Files</th><th>Lines</th><th>Code</th><th>Comments</th><th>Blanks</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  // Peer links between report pages: every long-tail /github/* URL both
  // receives and hands out crawl paths, so the report corpus is a web instead
  // of a list of dead ends reachable only from /recent and /popular.
  const similarReposHtml = relatedReports.length
    ? `<section><h2>Similar repository reports</h2><p>Other public repositories with an OctoCounts report, ranked by top language and code size similarity:</p><ul>${relatedReports
        .map((item) => `<li><a href="${escapeAttr(item.publicPath)}">${escapeHtml(item.repoFullName)}</a> — ${escapeHtml(item.topLanguage || "mixed")}, ${formatNumber(item.totalCode)} code lines</li>`)
        .join("")}</ul></section>`
    : "";
  const jsonSummary = reportSummaryJson(report);
  return injectHeadAndNoscript(index, {
    title: report.title,
    description: report.description,
    canonical: report.canonicalUrl,
    robots: "index,follow,max-image-preview:large,max-snippet:-1",
    ogImage: ogImageUrl,
    jsonLd: reportJsonLd(report),
    mdAlternate: `${report.canonicalUrl}.md`,
    extraHead: `<script type="application/json" id="octocounts-report-summary">${escapeScriptJson(jsonSummary)}</script>`,
    bodyContent: table + `<p>Top language${escapeHtml(top)}. Generated at <time datetime="${escapeAttr(report.generatedAt)}">${escapeHtml(report.generatedAt)}</time>.</p>` + reportReproduceHtml(report) + faqHtml + similarReposHtml + internalLinks,
  });
}

/// Declarative answer capsule for report pages, rendered right after the h1
/// in the SSR body and as the first body paragraph of the markdown twin.
/// Every figure comes straight from the report payload so the capsule cannot
/// disagree with the table, FAQ, or client summary it sits next to.
function reportCapsuleText(report) {
  return `${report.repoFullName} has ${formatNumber(report.total.code)} source lines of code out of ${formatNumber(report.total.lines)} total lines across ${formatNumber(report.total.files)} files, counted from the ${report.refName} ref at commit ${report.commitSha.slice(0, 12)} by the OctoCounts tokei engine on ${report.generatedAt.slice(0, 10)}. The report is cached by commit, tokei version, and analysis options, so recounting the same revision returns exactly these numbers.`;
}

/// Plain-text core of the report lead, shared by the HTML page and the
/// markdown twin. Answer engines quote self-contained opening sections; the
/// citation alone (~45 words) is the quotable core and this lead brings the
/// section to the ~150-word band that correlates with citation, covering
/// method and reproducibility without depending on the rest of the page.
function reportLeadText(report) {
  return `OctoCounts produced this report by resolving ${report.repoFullName} to commit ${report.commitSha.slice(0, 12)}, downloading the repository source archive, and counting every source file with tokei, the open-source line counter written in Rust. The table below breaks the count down by programming language into files, total lines, code lines, comment lines, and blank lines, so the figures can be compared across languages and projects. Results are cached by commit, tokei version, and analysis options, so counting the same revision again reproduces exactly these numbers.`;
}

/// Reproducibility block for report pages, rendered by the HTML page and the
/// markdown twin with identical wording. The backend only sends snapshotUrl
/// when the configuration is known; pre-tracking reports must say "unknown"
/// explicitly and never fall back to claiming a default configuration.
function reportReproduceHtml(report) {
  if (report.snapshotUrl) {
    return `<section><h2>Reproduce this report</h2><p><a href="${escapeAttr(report.snapshotUrl)}">Reproduce this exact report and configuration</a>.</p></section>`;
  }
  return `<section><h2>Reproduce this report</h2><p>Configuration unknown; this report predates option tracking.</p></section>`;
}

function reportReproduceMarkdown(report) {
  if (report.snapshotUrl) {
    return `## Reproduce this report\n\n[Reproduce this exact report and configuration](${report.snapshotUrl}).`;
  }
  return `## Reproduce this report\n\nConfiguration unknown; this report predates option tracking.`;
}

function reportInsights(report) {
  return `<section><h2>Repository size insights</h2><p>${escapeHtml(reportInsightsText(report))}</p></section>`;
}

function reportInsightsText(report) {
  const lines = Math.max(Number(report.total.lines) || 0, 1);
  const files = Math.max(Number(report.total.files) || 0, 1);
  const codeRatio = ((Number(report.total.code) || 0) / lines) * 100;
  const commentRatio = ((Number(report.total.comments) || 0) / lines) * 100;
  const codePerFile = (Number(report.total.code) || 0) / files;
  const scale = report.total.code >= 1_000_000 ? "very large" : report.total.code >= 100_000 ? "large" : report.total.code >= 10_000 ? "medium-sized" : "small";
  const concentration = report.topLanguage ? `${report.topLanguage.name} accounts for ${report.topLanguage.percent.toFixed(1)}% of counted code` : "No single top language was identified";
  return `This is a ${scale} codebase by counted code lines. Code represents ${codeRatio.toFixed(1)}% of all lines, comments represent ${commentRatio.toFixed(1)}%, and the repository averages ${formatNumber(Math.round(codePerFile))} code lines per file. ${concentration}.`;
}

function reportFaq(report) {
  const shortSha = report.commitSha.slice(0, 12);
  return [
    {
      question: `How many lines of code does ${report.repoFullName} have?`,
      answer: `${report.repoFullName} has ${formatNumber(report.total.lines)} total lines, including ${formatNumber(report.total.code)} code lines, ${formatNumber(report.total.comments)} comment lines, and ${formatNumber(report.total.blanks)} blank lines.`,
    },
    {
      question: `How was the ${report.repoFullName} line count measured?`,
      answer: `OctoCounts resolved the public GitHub repository to commit ${shortSha}, downloaded the source archive, counted it with tokei, and cached the report by commit, tokei version, and analysis options.`,
    },
    {
      question: `What commit was counted for ${report.repoFullName}?`,
      answer: `This OctoCounts report was generated from ${report.refName} at commit ${shortSha} on ${report.generatedAt}.`,
    },
  ];
}

function reportSummaryJson(report) {
  return {
    product: "OctoCounts",
    reportType: "source-line-count",
    repository: {
      provider: report.provider,
      fullName: report.repoFullName,
      owner: report.owner,
      repo: report.repo,
      htmlUrl: report.htmlUrl,
    },
    canonicalUrl: report.canonicalUrl,
    generatedAt: report.generatedAt,
    refName: report.refName,
    commitSha: report.commitSha,
    tokeiVersion: report.tokeiVersion,
    durationMs: report.durationMs,
    analysisKey: report.analysisKey,
    analysisOptions: report.analysisOptions,
    snapshotUrl: report.snapshotUrl,
    totals: report.total,
    topLanguage: report.topLanguage,
    languages: report.languages,
    citation: report.citation,
    methodology: "https://octocounts.com/docs/methodology",
  };
}

function reportJsonLd(report) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Dataset",
        "@id": `${report.canonicalUrl}#dataset`,
        name: `${report.repoFullName} source line count`,
        description: report.description,
        url: report.canonicalUrl,
        dateModified: report.generatedAt,
        // The backend's stable configuration digest; absent on reports stored
        // before option tracking, matching analysisKey in the JSON payload.
        ...(report.analysisKey ? { identifier: report.analysisKey } : {}),
        // No datePublished: the SEO report payload carries only generatedAt
        // (the latest regeneration), not the report's first-creation time,
        // and inventing one would be worse than omitting the field.
        // Speakable targets the h1 and the citation sentence, which together
        // are the self-contained answer an engine would read aloud or quote.
        speakable: {
          "@type": "SpeakableSpecification",
          cssSelector: ["#root h1", "#octocounts-citation"],
        },
        measurementTechnique: "tokei via OctoCounts",
        variableMeasured: ["files", "lines", "code", "comments", "blanks", "languages"],
        creator: {
          "@type": "Organization",
          name: "OctoCounts",
          url: "https://octocounts.com/",
        },
        isBasedOn: report.htmlUrl,
        distribution: {
          "@type": "DataDownload",
          encodingFormat: "application/json",
          contentUrl: `https://api.octocounts.com/api/seo/report?provider=${encodeURIComponent(report.provider)}&owner=${encodeURIComponent(report.owner)}&repo=${encodeURIComponent(report.repo)}`,
        },
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": `${report.canonicalUrl}#source`,
        name: report.repoFullName,
        codeRepository: report.htmlUrl,
        url: report.htmlUrl,
        programmingLanguage: report.languages.map((language) => language.name),
        version: report.commitSha,
        dateModified: report.generatedAt,
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${report.canonicalUrl}#breadcrumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "OctoCounts", item: "https://octocounts.com/" },
          { "@type": "ListItem", position: 2, name: "GitHub reports", item: "https://octocounts.com/recent" },
          { "@type": "ListItem", position: 3, name: report.repoFullName, item: report.canonicalUrl },
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${report.canonicalUrl}#faq`,
        mainEntity: reportFaq(report).map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      },
    ],
  };
}

function injectFallback(index, route) {
  const fullName = `${route.owner}/${route.repo}`;
  return injectHeadAndNoscript(index, {
    title: `${fullName} SLOC report | OctoCounts`,
    description: `Source line count report for ${fullName}. Analyze this public ${route.provider} repository with OctoCounts.`,
    canonical: `https://octocounts.com/${route.provider}/${route.owner}/${route.repo}`,
    robots: "noindex,follow,max-image-preview:large",
    ogImage: "https://octocounts.com/og-image.jpg",
    jsonLd: null,
    bodyContent: `<section><h1>${escapeHtml(fullName)} SLOC report</h1><p>No cached report exists yet. Open this page with JavaScript enabled to run an analysis.</p></section>`,
  });
}

function injectHeadAndNoscript(index, meta) {
  let html = index
    .replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>\s*/gi, "");
  html = html.replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`);
  html = setMeta(html, "name", "description", meta.description);
  html = setMeta(html, "name", "robots", meta.robots);
  html = setMeta(html, "property", "og:title", meta.title);
  html = setMeta(html, "property", "og:description", meta.description);
  html = setMeta(html, "property", "og:url", meta.canonical);
  html = setMeta(html, "property", "og:image", meta.ogImage);
  html = setMeta(html, "name", "twitter:title", meta.title);
  html = setMeta(html, "name", "twitter:description", meta.description);
  html = setMeta(html, "name", "twitter:image", meta.ogImage);
  html = html.replace(/<link rel="canonical" href="[^"]*" \/>/i, `<link rel="canonical" href="${escapeAttr(meta.canonical)}" />`);
  if (meta.jsonLd) {
    html = html.replace("</head>", `<script type="application/ld+json">${escapeScriptJson(meta.jsonLd)}</script>\n</head>`);
  }
  // Crawler discovery for the markdown twin (?format=md / .md suffix).
  if (meta.mdAlternate) {
    html = html.replace("</head>", `<link rel="alternate" type="text/markdown" href="${escapeAttr(meta.mdAlternate)}" />\n</head>`);
  }
  if (meta.extraHead) {
    html = html.replace("</head>", `${meta.extraHead}\n</head>`);
  }
  // Server-rendered facts go INSIDE #root as regular visible HTML, not into a
  // <noscript> after it. Several AI fetchers (Perplexity's reader, some ChatGPT
  // fetch paths) strip or de-prioritize noscript, and Google weights noscript
  // content lower. React mounts with createRoot().render(), which discards the
  // container's existing children, so the app replaces this block on hydration
  // while no-JS crawlers keep the full facts, table, FAQ, and links.
  html = html.replace('<div id="root"></div>', `<div id="root">${meta.bodyContent}</div>`);
  return html;
}

function setMeta(html, attr, key, content) {
  const escaped = escapeAttr(content);
  const pattern = new RegExp(`<meta ${attr}="${escapeRegExp(key)}" content="[^"]*" \\/>`, "i");
  const replacement = `<meta ${attr}="${key}" content="${escaped}" />`;
  if (pattern.test(html)) return html.replace(pattern, replacement);
  return html.replace("</head>", `${replacement}\n</head>`);
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/// Renders a Q&A answer as one <p> per blank-line-separated chunk. FAQ
/// answers are one Answer.text string in JSON-LD (schema.org has no
/// multi-paragraph answer type), so a long answer is written with internal
/// "\n\n" breaks and split here for humans reading the rendered page —
/// AI extraction still gets the single self-contained string it wants.
function answerHtml(text) {
  return text
    .split(/\n\n+/)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function escapeXml(value) {
  return escapeHtml(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatNumber(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function htmlResponse(html, cacheControl, options) {
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": cacheControl,
    ...securityHeaders(options),
  };
  if (options?.lastModified) headers["last-modified"] = options.lastModified;
  return new Response(html, { headers });
}

/// Markdown twins share the cache policy of their HTML page and the lockdown
/// header set; the body may be a string or a stream (static .md asset).
///
/// uaOnly (the response is markdown only because of the retrieval-bot user
/// agent, not an explicit ?format=md/.md URL): the zone cache rule in front of
/// this function keys purely on URL, so a UA-derived markdown body cached
/// under the HTML URL would be served to browsers and Googlebot (and vice
/// versa). Force private, no-store + Vary: User-Agent so the variant never
/// enters any shared cache. Explicit markdown URLs keep the shared headers —
/// their distinct URL cannot pollute the HTML entry.
function markdownResponse(markdown, cacheControl, options = {}) {
  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": options.uaOnly ? "private, no-store" : cacheControl,
      ...(options.uaOnly ? { vary: "User-Agent" } : {}),
      ...securityHeaders(),
    },
  });
}

function withHtmlSecurity(response) {
  if (!response.headers.get("content-type")?.includes("text/html")) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders())) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function securityHeaders(options) {
  // frameable is set only for /embed/ responses: those pages exist to be
  // iframed by third-party sites, so they drop X-Frame-Options and open
  // frame-ancestors. Every other page keeps the fully locked-down set.
  const frameable = Boolean(options && options.frameable);
  return {
    "x-content-type-options": "nosniff",
    ...(frameable ? {} : { "x-frame-options": "DENY" }),
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
    "cross-origin-opener-policy": "same-origin",
    "content-security-policy": `default-src 'self'; script-src 'self' ${BOOT_SCRIPT_HASH} https://cloud.umami.is https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.octocounts.com https://www.githubstatus.com https://cloud.umami.is https://gateway.umami.is https://cloudflareinsights.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors ${frameable ? "*" : "'none'"}; upgrade-insecure-requests`,
  };
}
