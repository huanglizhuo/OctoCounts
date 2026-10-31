import { reportJsonLd } from "./report-schema.js";
import { MIN_INDEXABLE_REPORT_FILES, analysisOptionsLabel, isCanonicalAnalysisOptions, primaryLanguage, primaryLanguagePhrase, reportPageDescription, reportPageTitle } from "./report-copy.js";
import { comparePolicies } from "./counting-policy.js";
import { COMPARE_REGISTRY, findCuratedComparison } from "./compare-registry.js";

// The editorial corpus (~150 KB) is only read on curated /compare/* routes,
// so load it on first use instead of parsing it on every isolate boot for
// every route (reports, sitemap, trending, ...). The promise is shared so
// concurrent compare requests still trigger a single module load.
let compareEditorialPromise;
function loadCompareEditorial() {
  compareEditorialPromise ??= import("./compare-editorial.js").then((module) => module.COMPARE_EDITORIAL);
  return compareEditorialPromise;
}

const API_BASE = "https://api.octocounts.com";
const BOOT_SCRIPT_HASH = "'sha256-2mUsir+xXgBNxPOKDMVv/T0CDFNTPTwA4NyqXmyIU4Y='";
// Per-URL content lastmod, mirroring frontend/content/content-manifest.json
// (seo.test.mjs asserts the two stay in sync). A date moves ONLY when that
// page's content really changes — never blanket-refresh all of them (SG-07).
const STATIC_SITEMAP_ENTRIES = [
  { loc: "https://octocounts.com/zh/docs/methodology", lastmod: "2026-10-30" },
  { loc: "https://octocounts.com/zh/docs/github-sloc-counter", lastmod: "2026-10-18" },
  { loc: "https://octocounts.com/zh", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/compare", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/diff", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/stats", lastmod: "2026-10-15" },
  { loc: "https://octocounts.com/recent", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/popular", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/trending", lastmod: "2026-09-05" },
  { loc: "https://octocounts.com/hall-of-monoliths", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/badges", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/extension", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/docs", lastmod: "2026-10-29" },
  { loc: "https://octocounts.com/docs/github-sloc-counter", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/docs/api", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/docs/methodology", lastmod: "2026-10-30" },
  { loc: "https://octocounts.com/docs/glossary", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/docs/faq", lastmod: "2026-10-31" },
  { loc: "https://octocounts.com/docs/octocounts-vs-cloc", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/docs/github-language-bar-alternative", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/docs/best-sloc-counter-tools", lastmod: "2026-10-29" },
  { loc: "https://octocounts.com/docs/tokei-online", lastmod: "2026-10-31" },
  { loc: "https://octocounts.com/docs/count-lines-of-code-github", lastmod: "2026-10-27" },
  { loc: "https://octocounts.com/docs/github-repository-size-checker", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/docs/octocounts-vs-tokei", lastmod: "2026-10-30" },
  { loc: "https://octocounts.com/docs/octocounts-vs-scc", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/docs/count-lines-without-cloning", lastmod: "2026-10-27" },
  { loc: "https://octocounts.com/docs/github-api-count-lines", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/docs/tokei-vs-cloc-vs-scc", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/docs/largest-codebases", lastmod: "2026-10-29" },
  { loc: "https://octocounts.com/research", lastmod: "2026-10-27" },
  { loc: "https://octocounts.com/about", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/privacy", lastmod: "2026-10-25" },
  { loc: "https://octocounts.com/contact", lastmod: "2026-09-30" },
];

// llms.txt / llms-full.txt are intentionally absent from every XML sitemap:
// sitemaps enumerate indexable web pages, and text/plain resources surface in
// Search Console as unindexable. Answer engines fetch llms.txt directly via
// the robots.txt pointer, so it loses nothing by staying out of the sitemaps.
// The homepage's own visible freshness line and the curated /compare/* pages
// follow the manifest too.
const COMPARE_CONTENT_LASTMOD = "2026-10-29";
const REPORT_CONTENT_LASTMOD = "2026-10-29";
const LIVE_COLLECTION_PATHS = new Set(["/stats", "/recent", "/popular", "/hall-of-monoliths"]);

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
  if (url.pathname !== "/" && (url.pathname.endsWith("/") || url.pathname.includes("//"))) {
    const target = new URL(url);
    target.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    return Response.redirect(target, 308);
  }
  // Pages also exposes .html assets without their extension.
  if (["/home", "/home-zh", "/index"].includes(url.pathname)) {
    const target = new URL(url);
    target.pathname = url.pathname === "/home-zh" || url.searchParams.get("lng") === "zh" ? "/zh" : "/";
    target.searchParams.delete("lng");
    return Response.redirect(target, 308);
  }
  // A trailing .md suffix selects the markdown twin of the same page
  // (/github/o/r.md, /compare/x-vs-y.md, /docs/methodology.md, ...); route
  // matching below runs on the stripped path so every ref variant resolves.
  const routePath = url.pathname.endsWith(".md") ? url.pathname.slice(0, -3) : url.pathname;
  let parts;
  try {
    parts = routePath.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  // ?format=md is the explicit opt-in for any client (browsers included); the
  // .md suffix is the linkable form. Neither depends on the user agent.
  const markdownRequested = routePath !== url.pathname || url.searchParams.get("format") === "md";
  // Canonical URLs serve the same indexable HTML to every user agent.

  const legacyQueryReport = legacyQueryReportPath(url);
  if (legacyQueryReport) {
    return Response.redirect(new URL(legacyQueryReport, url.origin), 308);
  }

  if (url.pathname === "/" && url.searchParams.get("lng") === "zh") {
    const target = new URL(url);
    target.pathname = "/zh";
    target.searchParams.delete("lng");
    return Response.redirect(target, 308);
  }

  // Static HTML assets are canonically served extensionless — same defect
  // class as the trailing-slash rule above: a 200 at /about.html leaves a
  // duplicate crawlable URL behind only a soft rel=canonical. 308 every
  // .html path to its extensionless form. 404.html is excluded: it is the
  // platform error document, not a canonical page. The prerendered home
  // assets are internal deployment files: /home and /home-zh have no
  // extensionless page of their own, so they redirect to the real canonical
  // URLs (the Chinese homepage lives at /zh).
  if (url.pathname.endsWith(".html") && url.pathname !== "/404.html" && parts[0] !== "github") {
    const target = new URL(url);
    const stripped = url.pathname.slice(0, -5);
    if (stripped === "/home") target.pathname = "/";
    else if (stripped === "/home-zh") {
      target.pathname = "/zh";
      target.searchParams.delete("lng");
    } else target.pathname = stripped === "/index" ? "/" : stripped;
    return Response.redirect(target, 308);
  }

  const legacyReport = LEGACY_REPORT_REDIRECTS[parts.slice(0, 3).join("/").toLowerCase()];
  if (legacyReport && !url.searchParams.has("reportId")) {
    if (!parseGitHubRoute(parts)) return new Response("Not found", { status: 404 });
    const suffix = routePath.split("/").slice(4).join("/");
    return Response.redirect(new URL(`${legacyReport}${suffix ? `/${suffix}` : ""}${url.pathname.endsWith(".md") ? ".md" : ""}${url.search}`, url.origin), 308);
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
    return sitemapIndexResponse(context);
  }

  if (url.pathname === "/sitemap-static.xml") {
    return staticSitemapResponse(context);
  }

  if (url.pathname === "/sitemap-compare.xml") {
    return compareSitemapResponse(context);
  }

  const reportsSitemapPage = url.pathname.match(/^\/sitemap-reports-(\d+)\.xml$/);
  if (reportsSitemapPage) {
    return reportsSitemapResponse(context, Number(reportsSitemapPage[1]));
  }

  if (parts[0] === "github") {
    const route = parseGitHubRoute(parts);
    if (!route) return new Response("Not found", { status: 404 });
    return reportResponse(context, route, { markdown: markdownRequested });
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
    if (curated) {
      const canonicalPath = `/compare/${curated.slug}${url.pathname.endsWith(".md") ? ".md" : ""}`;
      if (url.pathname !== canonicalPath) {
        const target = new URL(url);
        target.pathname = canonicalPath;
        return Response.redirect(target, 308);
      }
      return curatedCompareResponse(context, curated, { markdown: markdownRequested });
    }
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
    return extensionPageResponse(context, { markdown: markdownRequested });
  }

  // Standalone growth replay: /growth/:owner/:repo. The animation itself is
  // client-rendered (same bundle as the report page's growth section); the
  // indexable facts live on the full report, so this route canonicalizes
  // there instead of competing in the SERP.
  if (parts[0] === "growth" && parts.length === 3) {
    return growthPageResponse(context, parts[1], parts[2]);
  }

  // Embeddable iframe cards: served from the same SPA bundle but with
  // frame-ancestors relaxed (only for /embed/) and noindex — embeds are for
  // humans on third-party pages, not for crawlers.
  if (parts[0] === "embed" && parts[1] === "github" && parts.length >= 4) {
    return embedPageResponse(context, parts);
  }

  // The three docs articles are static HTML; their markdown twins are
  // pre-generated files in public/docs/. Served through the function (rather
  // than relying on the bare .md asset) so ?format=md and explicit
  // requests get a guaranteed text/markdown type and the /docs/* cache policy.
  if (parts[0] === "docs" && parts.length === 2 && DOC_MARKDOWN_PAGES.has(parts[1]) && markdownRequested) {
    return docsMarkdownResponse(context, parts[1]);
  }

  // /research is a static article pair (public/research.html plus its
  // pre-generated research.md), served through the function — like the docs
  // articles — so ?format=md and explicit markdown requests get a guaranteed
  // text/markdown type instead of relying on the bare .md asset.
  if (parts[0] === "research" && parts.length === 1 && markdownRequested) {
    return researchMarkdownResponse(context);
  }

  if (url.pathname === "/" || url.pathname === "/zh") {
    return homePageResponse(context);
  }

  if (parts[0] === "zh") {
    if (parts.length !== 3 || parts[1] !== "docs" || !["github-sloc-counter", "methodology"].includes(parts[2])) {
      return new Response("Not found", { status: 404 });
    }
    if (markdownRequested) return docsMarkdownResponse(context, parts[2], { locale: "zh" });
    return withHtmlSecurity(await context.env.ASSETS.fetch(context.request));
  }

  // Bare .md assets with no function route of their own (public/about.md).
  // Every function-rendered twin returned above; this catches the rest so
  // they go out through markdownResponse with the same text/markdown type
  // and noindex X-Robots-Tag as every other twin. Function-served responses
  // bypass the asset layer's _headers, so that file cannot be relied on for
  // this. A miss or an HTML fallback returns a real 404.
  if (markdownRequested) {
    const assetUrl = new URL(url);
    assetUrl.pathname = `${routePath}.md`;
    assetUrl.search = "";
    const asset = await context.env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
    if (asset.ok && !asset.headers.get("content-type")?.includes("text/html")) return markdownResponse(asset.body, "public, max-age=3600");
    return new Response("Markdown not found", { status: 404 });
  }

  return withHtmlSecurity(await context.env.ASSETS.fetch(context.request));
}

// Fallback for pre-migration databases only: the report API's canonicalSlug
// (see reportResponse) is now the primary rename-redirect mechanism.
const LEGACY_REPORT_REDIRECTS = {
  "github/huanglizhuo/octocount": "/github/huanglizhuo/OctoCounts",
};

const DOC_MARKDOWN_PAGES = new Set(["github-sloc-counter", "api", "methodology", "glossary", "faq", "octocounts-vs-cloc", "github-language-bar-alternative", "best-sloc-counter-tools", "tokei-online", "count-lines-of-code-github", "github-repository-size-checker", "octocounts-vs-tokei", "octocounts-vs-scc", "count-lines-without-cloning", "github-api-count-lines", "tokei-vs-cloc-vs-scc", "largest-codebases"]);

async function docsMarkdownResponse(context, slug, options = {}) {
  const url = new URL(context.request.url);
  url.pathname = `${options.locale === "zh" ? "/zh" : ""}/docs/${slug}.md`;
  url.search = "";
  const asset = await context.env.ASSETS.fetch(new Request(url.toString(), context.request));
  if (!asset.ok) return asset;
  if (asset.headers.get("content-type")?.includes("text/html")) return new Response("Markdown not found", { status: 404 });
  return markdownResponse(asset.body, "public, max-age=3600", options);
}

async function researchMarkdownResponse(context, options = {}) {
  const url = new URL(context.request.url);
  url.pathname = "/research.md";
  url.search = "";
  const asset = await context.env.ASSETS.fetch(new Request(url.toString(), context.request));
  if (!asset.ok) return asset;
  if (asset.headers.get("content-type")?.includes("text/html")) return new Response("Markdown not found", { status: 404 });
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
  if (parts.length < 3 || !isGitHubPathPart(parts[1]) || !isGitHubPathPart(parts[2])) return null;
  const marker = parts[3];
  if (parts.length > 3 && (parts.length < 5 || !["tree", "commit"].includes(marker))) return null;
  if (marker === "commit" && (parts.length !== 5 || !/^[a-f0-9]{7,40}$/i.test(parts[4]))) return null;
  const refName = marker === "tree" || marker === "commit" ? parts.slice(4).join("/") : "";
  if (refName && /[\x00-\x20\x7f]/.test(refName)) return null;
  return {
    provider: "github",
    owner: parts[1],
    repo: parts[2],
    refName,
    refKind: marker,
  };
}

async function reportResponse(context, route, options = {}) {
  const requestUrl = new URL(context.request.url);
  // The SEO cache has its own counting options; custom links need a saved ID
  // before it can safely supply their counts to HTML or social previews.
  if (requestUrl.searchParams.has("analysis") && !requestUrl.searchParams.has("reportId")) {
    const message = "Open this page with JavaScript enabled to analyze the requested counting options. Share the saved result for matching HTML and markdown counts.";
    if (options.markdown) return markdownResponse(message, "private, no-store", options);
    return htmlResponse(injectHeadAndNoscript(await indexHtml(context), { ...reportUnavailableMeta(route), description: message, robots: "noindex,follow", bodyContent: `<p>${escapeHtml(message)}</p>` }), "private, no-store");
  }
  // A 404 from the report API means the repository genuinely has no cached
  // report: serve the noindex fallback WITH HTTP 404. It used to answer 200,
  // which made every un-analyzed /github/* URL a soft 404 — crawlers saw a
  // successful, crawlable page carrying only boilerplate. Browsers still
  // render a 404 body, so the JS analysis flow on the fallback page keeps
  // working; only the status line changed. A 5xx, network error, or timeout is
  // transient — answering 503 + no-store keeps crawlers retrying instead of
  // caching a noindex (or letting the CDN cache one) for an indexable page.
  // The related-repositories endpoint depends only on the route, so start it
  // alongside the report fetch instead of paying its full latency after the
  // report answers. It never throws (returns [] on any failure), so the early
  // "missing"/"unavailable" exits below simply leave its promise unresolved
  // without rejection risk.
  const relatedPromise = fetchRelatedReports(context, route);
  const result = await fetchSeoReport(context, route);
  if (result.state === "missing") {
    if (requestUrl.searchParams.has("reportId")) {
      const message = "This saved result is no longer available. Open the repository report to request a new analysis.";
      if (options.markdown) return markdownResponse(message, "private, no-store", { ...options, status: 404 });
      const meta = reportUnavailableMeta(route);
      return htmlResponse(injectHeadAndNoscript(await indexHtml(context), { ...meta, robots: "noindex,follow", title: `${route.owner}/${route.repo}: saved result unavailable | OctoCounts`, description: message, bodyContent: `<p>${escapeHtml(message)}</p>` }), "private, no-store", { status: 404 });
    }
    if (options.markdown) return markdownResponse(reportMissingMarkdown(route), "public, max-age=60", { ...options, status: 404 });
    return htmlResponse(injectFallback(await indexHtml(context), route), "public, max-age=60", { status: 404 });
  }
  if (result.state === "unavailable") {
    return serviceUnavailableResponse(await indexHtml(context), reportUnavailableMeta(route), options);
  }

  const report = await result.response.json();
  // A renamed repository still answers here: the API resolves the requested
  // slug through its recorded redirect chain and returns the row's payload
  // with `canonicalSlug` ("react/react" for a /github/facebook/react request)
  // naming the key that row is actually filed under. 308 to that spelling so
  // link equity consolidates on one page per repository. This runs BEFORE the
  // integrity guard below — a renamed repo's payload legitimately carries a
  // repoFullName the route does not spell — and before the casing-only check
  // further down, with the same mechanics: the .md twin's suffix and the query
  // string are preserved and the plain Response.redirect sets no cache
  // headers. The slug must cohere with the payload it rode in on (the API
  // derives both from one row), so a mangled or foreign body falls through to
  // the guard instead of redirecting somewhere unverified.
  const canonicalSlug = typeof report.canonicalSlug === "string" ? report.canonicalSlug : "";
  const [canonicalOwner, canonicalRepo] = canonicalSlug.split("/");
  if (
    canonicalSlug &&
    isGitHubPathPart(canonicalOwner) &&
    isGitHubPathPart(canonicalRepo) &&
    canonicalSlug.toLowerCase() === String(report.repoFullName ?? "").toLowerCase() &&
    canonicalSlug.toLowerCase() !== `${route.owner}/${route.repo}`.toLowerCase()
  ) {
    const suffix = requestUrl.pathname.endsWith(".md") ? ".md" : "";
    const refPath = route.refName ? `/${requestUrl.pathname.split("/")[4]}/${route.refName.split("/").map(encodeURIComponent).join("/")}` : "";
    return Response.redirect(new URL(`/github/${canonicalOwner}/${canonicalRepo}${refPath}${suffix}${requestUrl.search}`, requestUrl.origin), 308);
  }
  // The report must belong to the URL that requested it. Any upstream mixup
  // (a mis-keyed cache tier serving one repo's payload for another) would
  // otherwise SSR one repository's numbers under a different repository's
  // URL — a 200 with a wrong, page-identical meta description, which is
  // exactly the "duplicate meta descriptions" class Bing Webmaster Tools
  // flagged across /github/* pages. Fail closed: 503 + no-store (never
  // cached) asks crawlers to retry instead of indexing wrong content.
  if (!reportMatchesRoute(report, route)) {
    return serviceUnavailableResponse(await indexHtml(context), reportUnavailableMeta(route), options);
  }
  if (route.refName && !report.isSnapshot) {
    const refPath = route.refName.split("/").map(encodeURIComponent).join("/");
    report.publicPath = `/github/${encodeURIComponent(report.owner)}/${encodeURIComponent(report.repo)}/${route.refKind}/${refPath}`;
    report.canonicalUrl = `https://octocounts.com${report.publicPath}`;
    report.refKind = route.refKind;
    report.requestedRef = route.refName;
  }
  // Title and description come from the module the hydrated page also uses,
  // so the server and client metadata agree; options narrower than the
  // canonical public set are labelled in both.
  report.title = reportPageTitle(report);
  report.description = reportPageDescription(report);
  // Below the indexable floor the page would be a thin URL Google crawls and
  // drops; answer the same hard 404 the missing branch does so the URL leaves
  // the index (and stop paying the render). Totals live in the same payload
  // the guard above just validated, so no second fetch is needed. The 404
  // body is still the working SPA shell, and the interactive app continues to
  // serve the analysis itself — only the indexable report page retires.
  const reportFiles = report.total?.files;
  if (!report.isSnapshot && typeof reportFiles === "number" && reportFiles < MIN_INDEXABLE_REPORT_FILES) {
    if (options.markdown) return markdownResponse(reportMissingMarkdown(route), "public, max-age=60", { ...options, status: 404 });
    return htmlResponse(injectFallback(await indexHtml(context), route), "public, max-age=60", { status: 404 });
  }
  // The similar-repositories panel is an enhancement: the page must render
  // identically whether or not the related endpoint answers.
  const relatedReports = await relatedPromise;
  // The store matches owner/repo case-sensitively, so a mistyped or
  // mixed-case external link (e.g. /github/Facebook/React) resolves to the
  // canonical casing only via the report itself. 308 it so link equity lands
  // on the URL the canonical tag and sitemap use. Markdown requests redirect
  // to the canonical casing with their .md suffix preserved.
  const comparePath = requestUrl.pathname.endsWith(".md") ? requestUrl.pathname.slice(0, -3) : requestUrl.pathname;
  if (report.publicPath && report.publicPath.toLowerCase() === comparePath.toLowerCase() && report.publicPath !== comparePath) {
    const suffix = requestUrl.pathname.endsWith(".md") ? ".md" : "";
    return Response.redirect(new URL(report.publicPath + suffix + requestUrl.search, requestUrl.origin), 308);
  }
  // Keep live HTML and Markdown on the same freshness window. A report only
  // changes when it is re-analyzed, so an hour at the edge (a day of stale
  // serving while revalidating) lets most crawler hits skip the API round trip.
  const cacheControl = "public, s-maxage=3600, stale-while-revalidate=86400";
  if (options.markdown) {
    return markdownResponse(reportMarkdown(report, relatedReports), report.isSnapshot ? "private, no-store" : cacheControl, options);
  }
  const html = injectReport(await indexHtml(context), report, apiBase(context), relatedReports);
  if (report.isSnapshot) {
    return htmlResponse(html, "private, no-store", {});
  }
  // Validate the whole representation: templates and related links can change without a new analysis.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html));
  const etag = `W/"${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
  const validators = context.request.headers.get("if-none-match")?.split(",") ?? [];
  if (validators.some((value) => value.trim() === "*" || value.trim().replace(/^W\//, "") === etag.slice(2))) {
    return new Response(null, {
      status: 304,
      headers: { "cache-control": cacheControl, etag, ...securityHeaders() },
    });
  }
  const response = htmlResponse(html, cacheControl);
  response.headers.set("etag", etag);
  return response;
}

/// Markdown twin of injectReport: same report payload, same facts, serialized
/// as headings, a pipe table, FAQ, and absolute internal links so the text is
/// quotable without the surrounding page.
function reportMarkdown(report, relatedReports = []) {
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
  const relatedCompare = relatedComparisons(report);
  const links = [
    "- [Recently analyzed repositories](https://octocounts.com/recent)",
    "- [Popular SLOC reports](https://octocounts.com/popular)",
    "- [Trending GitHub repositories](https://octocounts.com/trending)",
    "- [Hall of Monoliths](https://octocounts.com/hall-of-monoliths)",
    ...relatedCompare.map((entry) => `- [${entry.name}](https://octocounts.com/compare/${entry.slug})`),
    "- [How to count lines of code in a GitHub repository](https://octocounts.com/docs/count-lines-of-code-github)",
    "- [GitHub SLOC counter guide](https://octocounts.com/docs/github-sloc-counter)",
    "- [Counting methodology](https://octocounts.com/docs/methodology)",
    "- [SLOC and code metrics glossary](https://octocounts.com/docs/glossary)",
    "- [Original research: how filtering changes SLOC counts](https://octocounts.com/research)",
    "- [OctoCounts API docs](https://octocounts.com/docs/api)",
    "- [All OctoCounts guides](https://octocounts.com/docs)",
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

## Counting rules and retention

${reportPolicyText(report)}

Saved reports remain subject to cache cleanup and replacement. Export the JSON or text for durable citation; live repository URLs can change.

## Repository size insights

${reportInsightsText(report)}

${table}

${reportLanguageLine(report)} Generated on ${readableDate(report.generatedAt)}. Canonical report: ${report.canonicalUrl}

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

// Peers below this many code lines are the junk tail of the similarity
// ranking (placeholder and toy repositories surfaced as size-peers of large
// ones). RelatedReport carries only totals — no stars — so an absolute code
// floor is the simplest honest filter; when fewer peers qualify the section
// renders fewer links, and at zero it omits (both renderers already do).
const MIN_RELATED_PEER_CODE_LINES = 10_000;

async function fetchRelatedReports(context, route) {
  try {
    const params = new URLSearchParams({
      provider: route.provider,
      owner: route.owner,
      repo: route.repo,
    });
    const response = await fetch(`${apiBase(context)}/api/seo/related?${params.toString()}`, {
      headers: { accept: "application/json" },
      // Optional links must not hold the report open when this endpoint stalls;
      // the backend finishes and caches a slow lookup for the next request.
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload?.reports)
      ? payload.reports.filter((item) => (Number(item?.totalCode) || 0) >= MIN_RELATED_PEER_CODE_LINES).slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

async function listPageResponse(context, kind, url) {
  const page = url.searchParams.get("page") || "1";
  if (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) return new Response("Not found", { status: 404 });
  // Neither API fetch needs the SPA shell, so start both before reading the
  // asset and overlap all three instead of paying them serially.
  const apiResponse = fetch(`${apiBase(context)}/api/seo/${kind}?limit=36&page=${encodeURIComponent(page)}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(SEO_REPORT_TIMEOUT_MS),
  }).then(async (response) => response.ok ? response.json() : null).catch(() => null);
  const rotatingPromise = fetchRotatingReportLocs(context);
  const index = await indexHtml(context);
  const payload = await apiResponse;
  const pageMeta = listPageMeta(kind);
  if (!Array.isArray(payload?.reports) || !payload.reports.every((report) => ["repoFullName", "publicPath", "description"].every((key) => typeof report?.[key] === "string"))) return serviceUnavailableResponse(index, pageMeta);
  // Page >1 is noindex,follow; pairing that with a canonical back to page 1
  // sends conflicting signals (Google: pick one). A self-referencing
  // canonical with the page parameter keeps the URL shape unambiguous.
  const canonical = page === "1" ? pageMeta.canonical : `${pageMeta.canonical}?page=${encodeURIComponent(page)}`;
  if (page !== "1" && payload.reports.length === 0) {
    return htmlResponse(injectHeadAndNoscript(index, {
      ...pageMeta, canonical, robots: "noindex,follow", ogImage: "https://octocounts.com/og-image.jpg",
      bodyContent: `<section><h1>Report page not found</h1><p>There are no reports on this page. <a href="${escapeAttr(pageMeta.canonical)}">Browse the first page</a>.</p></section>`,
    }), "public, max-age=60", { status: 404 });
  }
  const title = pageMeta.title;
  const description = pageMeta.description;
  const rows = payload.reports
    .map(
      (report, index) =>
        `<li><span>${index + 1}.</span> <a href="${escapeAttr(report.publicPath)}">${escapeHtml(report.repoFullName)}</a> — ${escapeHtml(report.description)}</li>`
    )
    .join("");
  // A successful empty inventory still explains the collection; failures return 503 above.
  const body = rows ? `<ul>${rows}</ul>` : listPageFallback(kind);
  const moreReports = moreReportsHtml(await rotatingPromise);
  const pagination = `<nav aria-label="Report pages">${Number(page) > 1 ? `<a href="${escapeAttr(pageMeta.canonical)}${page === "2" ? "" : `?page=${Number(page) - 1}`}">Previous page</a>` : ""}${payload.reports.length === 36 ? ` <a href="${escapeAttr(pageMeta.canonical)}?page=${Number(page) + 1}">Next page</a>` : ""}</nav>`;

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
        url: canonical,
        breadcrumb: breadcrumbItemList(pageMeta.breadcrumbLabel, pageMeta.canonical),
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
      bodyContent: `<section><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>${body}${pagination}</section>${moreReports}`,
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
      ${kind === "monoliths" ? '<li><a href="/docs/largest-codebases">How many lines of code? The largest codebases, counted</a></li>' : ""}
      <li><a href="/trending">Trending GitHub repositories today</a></li>
      <li><a href="/docs/methodology">How OctoCounts counts lines of code</a></li>
    </ul></nav>`;
}

/// Rotating "More repository reports" block for the hub pages: roughly 4,400
/// of the ~4,500 report pages are orphans (no internal link reaches them), so
/// each hub page carries a crawlable slice of the report corpus that rotates
/// by UTC day. The slice is a pure function of (entries, day), so the whole
/// day serves the same links and the edge cache stays coherent.
const ROTATING_REPORT_LINK_COUNT = 64;

function rotatingReportLocs(entries, dayNumber) {
  const locs = entries.map((entry) => entry.loc).sort();
  if (!locs.length) return [];
  const start = dayNumber % locs.length;
  const picked = [];
  for (let i = 0; i < Math.min(ROTATING_REPORT_LINK_COUNT, locs.length); i++) {
    picked.push(locs[(start + i) % locs.length]);
  }
  return picked;
}

/// One /api/seo/sitemap fetch per isolate per day (the rotating slice only
/// changes at the day boundary, so caching it longer than the hub pages'
/// own 5-minute TTL is safe). Empty on any failure — the block just omits.
async function fetchRotatingReportLocs(context) {
  const dayNumber = Math.floor(Date.now() / 86_400_000);
  const cache = envScratchMap(context.env); // shared per-env scratch Map
  const cacheKey = `rotating-reports:${dayNumber}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  try {
    const response = await fetch(`${apiBase(context)}/api/seo/sitemap`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(SEO_REPORT_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const locs = rotatingReportLocs(filterReportSitemapEntries(await response.json()), dayNumber);
    cache.set(cacheKey, locs);
    return locs;
  } catch {
    return [];
  }
}

function reportLocName(loc) {
  return decodeURIComponent(loc.replace("https://octocounts.com/github/", ""));
}

function moreReportsHtml(locs) {
  if (!locs.length) return "";
  const items = locs.map((loc) => `<li><a href="${escapeAttr(loc)}">${escapeHtml(reportLocName(loc))}</a></li>`).join("");
  return `<section><h2>More repository reports</h2><ul>${items}</ul></section>`;
}

function moreReportsMarkdown(locs) {
  if (!locs.length) return "";
  return `\n## More repository reports\n\n${locs.map((loc) => `- [${reportLocName(loc)}](${loc})`).join("\n")}\n`;
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
  if (!snapshot) return collectionUnavailableResponse(context, "/trending", TRENDING_TITLE, options);
  const rotatingPromise = fetchRotatingReportLocs(context);
  if (options.markdown) {
    return markdownResponse(trendingMarkdown(snapshot) + moreReportsMarkdown(await rotatingPromise), "public, s-maxage=300, stale-while-revalidate=600", options);
  }
  const index = await indexHtml(context);
  const title = TRENDING_TITLE;
  const description = trendingDescription(snapshot);
  const body = snapshot.repositories
    .map((repo) => `<li><span>${repo.rank}.</span> <a href="${escapeAttr(repo.publicPath)}">${escapeHtml(repo.fullName)}</a> — ${escapeHtml(repo.description || "GitHub Trending repository")} (${formatNumber(repo.starsToday)} stars today${repo.language ? `, ${escapeHtml(repo.language)}` : ""})</li>`)
    .join("");
  const moreReports = moreReportsHtml(await rotatingPromise);

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
        // Publisher is a bare @id reference to the Organization the homepage
        // defines — attribution without re-inlining a second copy of the
        // entity on every daily page (H4). The object shape (not a bare
        // string) is what schema.org validators expect for a node reference.
        publisher: { "@id": ORGANIZATION_ID },
        breadcrumb: breadcrumbItemList("Trending repositories", "https://octocounts.com/trending"),
        // The daily snapshot is both created and modified on its snapshot
        // date; there is no earlier publication moment to report.
        datePublished: snapshot.date,
        dateModified: isoMilliseconds(snapshot.generatedAt),
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
      bodyContent: `<section><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p>Source: <a href="https://github.com/trending">GitHub Trending</a>. Snapshot updated <time datetime="${escapeAttr(snapshot.generatedAt)}">${escapeHtml(snapshot.date)}</time>.</p><ol>${body}</ol></section>${moreReports}`,
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
  if (!snapshot) return collectionUnavailableResponse(context, "/trending", TRENDING_TITLE, { feed: true });
  const pubDate = new Date(snapshot.generatedAt).toUTCString();
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
  const totals = `- ${formatNumber(stats.totals.reportsGenerated)} reports generated
- ${formatNumber(stats.totals.repositoriesAnalyzed)} public repositories analyzed
- ${formatNumber(stats.totals.linesCounted)} total lines counted (${formatNumber(stats.totals.codeLinesCounted)} code)
- ${formatNumber(stats.totals.languagesDetected)} languages detected`;
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
- [How many lines of code? The largest codebases, counted](https://octocounts.com/docs/largest-codebases)
- [How OctoCounts counts lines of code](https://octocounts.com/docs/methodology)
`;
}

async function statsPageResponse(context, options = {}) {
  const response = await fetch(`${apiBase(context)}/api/stats`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(SEO_REPORT_TIMEOUT_MS),
  }).catch(() => null);
  const fresh = response?.ok ? await response.json().catch(() => null) : null;
  // Stale-while-error, like curated comparisons: a slow or failed upstream
  // answers with this isolate's last validated totals under a short TTL, so
  // the next good pass replaces them; only a never-rendered isolate 503s.
  const scratch = envScratchMap(context.env);
  if (validStats(fresh)) scratch.set("stats:last-good", fresh);
  const stats = validStats(fresh) ? fresh : scratch.get("stats:last-good");
  if (!stats) return collectionUnavailableResponse(context, "/stats", STATS_TITLE, options);
  const cacheControl = stats === fresh ? "public, s-maxage=300, stale-while-revalidate=600" : "public, max-age=60, stale-while-revalidate=600";
  if (options.markdown) {
    return markdownResponse(statsMarkdown(stats), cacheControl, options);
  }
  const index = await indexHtml(context);
  const title = STATS_TITLE;
  const description = STATS_DESCRIPTION;
  const totals = `<ul>
      <li>${formatNumber(stats.totals.reportsGenerated)} reports generated</li>
      <li>${formatNumber(stats.totals.repositoriesAnalyzed)} public repositories analyzed</li>
      <li>${formatNumber(stats.totals.linesCounted)} total lines counted (${formatNumber(stats.totals.codeLinesCounted)} code)</li>
      <li>${formatNumber(stats.totals.languagesDetected)} languages detected</li>
    </ul>`;
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
      <li><a href="/docs/largest-codebases">How many lines of code? The largest codebases, counted</a></li>
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
      // breadcrumb is a WebPage property, so the page node carries it and the
      // Dataset rides along as its main entity.
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "@id": "https://octocounts.com/stats#webpage",
        url: "https://octocounts.com/stats",
        name: title,
        breadcrumb: breadcrumbItemList("Site stats", "https://octocounts.com/stats"),
        mainEntity: {
          "@type": "Dataset",
          "@id": "https://octocounts.com/stats#dataset",
          name: title,
          description,
          url: "https://octocounts.com/stats",
          // The stats dashboard shipped on 2026-07-10 (backend fd456cb, edge
          // function 82ed24a); the API exposes no earlier creation timestamp.
          datePublished: "2026-07-10",
          creator: { "@type": "Organization", "@id": ORGANIZATION_ID, name: "OctoCounts", url: "https://octocounts.com/" },
          measurementTechnique: "Aggregate public OctoCounts report activity",
          variableMeasured: ["reports", "repositories", "lines", "languages", "sources"],
        },
      },
      bodyContent: `<section><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>${totals}${sources}${languages}${largest}${body}</section>`,
    }),
    cacheControl
  );
}

/// Home → page breadcrumb, nested as the page node's own `breadcrumb`
/// property so each page keeps one JSON-LD script and no second copy of the
/// Organization entity (H4 discipline applies to breadcrumbs too).
function breadcrumbItemList(label, canonicalUrl) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "OctoCounts", item: "https://octocounts.com/" },
      { "@type": "ListItem", position: 2, name: label, item: canonicalUrl },
    ],
  };
}

async function comparePageResponse(context, pathname) {
  const index = await indexHtml(context);
  const isCompare = pathname === "/compare";
  const title = isCompare ? "Compare repository SLOC | OctoCounts" : "Compare branch SLOC diff | OctoCounts";
  const description = isCompare
    ? "Compare files, code lines, comments, blanks, and language mix between two public repositories or refs."
    : "Compare source line count changes between two branches, tags, or commits in a public repository.";
  // Example links use the repository's current canonical spelling. The React
  // repository lives at react/react since GitHub's 2026 transfer; the old
  // facebook/react paths still answer (308 via the rename-follow chain), but
  // the site's own pages should not make crawlers spend a hop on them.
  const example = isCompare
    ? `<p>Example: <a href="/compare?left=https%3A%2F%2Fgithub.com%2Freact%2Freact&amp;right=https%3A%2F%2Fgithub.com%2Fvuejs%2Fcore">react/react vs vuejs/core</a>. Example reports: <a href="/github/react/react">react/react</a>, <a href="/github/vitejs/vite">vitejs/vite</a>.</p>`
    : `<p>Example: <a href="/diff?repo=https%3A%2F%2Fgithub.com%2Freact%2Freact&amp;base=v18.0.0&amp;head=main">react/react v18.0.0 to main</a>. Example reports: <a href="/github/react/react">react/react</a>, <a href="/github/vitejs/vite">vitejs/vite</a>.</p>`;
  const internalLinks = `<nav aria-label="Related OctoCounts pages"><ul>
    <li><a href="/recent">Recently analyzed repositories</a></li>
    <li><a href="/popular">Popular SLOC reports</a></li>
    <li><a href="/trending">Trending GitHub repositories</a></li>
    <li><a href="/hall-of-monoliths">Hall of Monoliths</a></li>
    <li><a href="/docs/github-sloc-counter">GitHub SLOC counter guide</a></li>
    <li><a href="/docs/methodology">Counting methodology</a></li>
    <li><a href="/docs/glossary">SLOC and code metrics glossary</a></li>
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
      // The compare/diff pair was the last zero-schema template (SEO audit
      // M14): WebPage + the interactive WebApplication, author merged with
      // the homepage Person via @id. Visible facts only — no usage counts.
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "WebPage",
            "@id": `https://octocounts.com${pathname}#webpage`,
            name: title,
            description,
            url: `https://octocounts.com${pathname}`,
            breadcrumb: breadcrumbItemList(isCompare ? "Compare repositories" : "Branch SLOC diff", `https://octocounts.com${pathname}`),
          },
          {
            "@type": "WebApplication",
            name: isCompare ? "OctoCounts repository SLOC comparison" : "OctoCounts branch SLOC diff",
            url: `https://octocounts.com${pathname}`,
            operatingSystem: "Web",
            applicationCategory: "DeveloperApplication",
            description,
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            author: {
              "@type": "Person",
              "@id": PERSON_ID,
              name: "huanglizhuo",
              url: "https://github.com/huanglizhuo",
              sameAs: PERSON_SAME_AS,
            },
          },
        ],
      },
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
  // 159 chars (SEO audit H5): the old 214-char description enumerated every
  // badge type; this keeps the primary README-badges keyword, the main badge
  // types, and the badge API attribution inside the 70–160 band.
  const description = "Live README badges showing lines of code, code lines, files, comments, top language, or code share for a public GitHub repository via the OctoCounts badge API.";
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
      bodyContent: `<section><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p>JavaScript runs the interactive builder in your browser; this summary exists so the link preview and crawlers see a real page.</p><h2>How to add a badge</h2><ol><li>Open the badge builder above and choose a badge type: summary, code lines, total lines, files, comments, language count, top language, code share, or a single language.</li><li>Enter a public GitHub repository URL and copy the generated markdown snippet.</li><li>Paste the markdown into <code>README.md</code>. The badge renders live line counts from the OctoCounts badge API and links to a live SLOC report; saved report IDs and exports preserve the measured version subject to cache retention.</li></ol><h2>Badge types and URLs</h2><ul>${badgeTypeRows}</ul><h2>Example markdown</h2><pre><code>${escapeHtml(exampleMarkdown)}</code></pre><p>Badges can be pinned to a branch, tag, or commit: <code>${escapeHtml(`${badgeBase}/branch/:branch`)}</code>. Example report: <a href="/github/huanglizhuo/OctoCounts">huanglizhuo/OctoCounts</a>.</p>${badgeFaqHtml}${internalLinks}</section>`,
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

// Canonical entity identities from the homepage's JSON-LD (frontend/
// index.html): the Organization is defined once as
// "https://octocounts.com/#organization" and the author Person once as
// "https://github.com/huanglizhuo". Pages that re-state those entities
// (report and compare Dataset creator, extension SoftwareApplication author)
// must carry the SAME @id and sameAs set so consumers merge each page's copy
// with the homepage node instead of recording a duplicate Organization/Person
// per URL. Product listings identify the product; Person.sameAs contains only personal profiles.
const ORGANIZATION_ID = "https://octocounts.com/#organization";
const PERSON_ID = "https://github.com/huanglizhuo";
// Official package and third-party profiles that describe this same product;
// mirrored by the Organization node in index.html.
const ORGANIZATION_SAME_AS = [
  "https://github.com/huanglizhuo/OctoCounts",
  ...EXTENSION_STORES.map((store) => store.url),
  "https://www.npmjs.com/package/octocounts",
  "https://glama.ai/mcp/servers/huanglizhuo/OctoCounts",
  "https://alternativeto.net/software/octocounts/about/",
];
const PERSON_SAME_AS = [PERSON_ID];

const EXTENSION_CONTENT = {
  // Title ≤60 chars including the "| OctoCounts" suffix, description in the
  // 70–160 band (SEO audit H5): the old pair was an 80-char title (truncated
  // mid-word in SERPs) and a 199-char description; both keep the primary
  // "GitHub SLOC extension" / browser-extension keywords and the browser list.
  title: "GitHub SLOC extension for Chrome, Edge, Firefox | OctoCounts",
  heading: "See GitHub code statistics in your browser",
  description:
    "Install the OctoCounts extension for Chrome, Edge, or Firefox to see files, code, comments, and per-language line counts in the GitHub repository sidebar.",
  intro:
    "OctoCounts is a free browser extension that adds a SLOC (source lines of code) card to public GitHub repository pages. The card shows the repository's total line count at a glance; clicking it opens a full panel with files, code lines, comment lines, blank lines, and a per-language breakdown — the same counts the OctoCounts web app produces with tokei, pinned to an exact commit.",
  steps: [
    "Install OctoCounts from the Chrome Web Store, Microsoft Edge Add-ons, or Firefox Add-ons — one click, no account.",
    "Open any public GitHub repository page in your browser.",
    "The SLOC card appears in the repository sidebar automatically. Click it to open the full panel with the per-language line breakdown.",
  ],
  permissions:
    "The extension reads the public GitHub repository page you are viewing to detect the owner and repository name, and runs the count against public data through the OctoCounts API. Counting public repositories needs no GitHub login or API token. Chrome builds also offer optional GitHub sign-in for star history; the extension stores the login and token locally and uses the backend during token exchange. See the privacy policy for details. Retained local results for the repository and ref can be reused on repeat visits; a missing or expired entry requires a new request.",
  faq: [
    {
      question: "Why does the SLOC card not appear on a repository page?",
      answer:
        "The card renders on public GitHub repository pages. It does not appear on private repositories (OctoCounts analyzes public repositories only), non-repository pages, or while GitHub ships layout changes. Reload the page first; if the card is still missing on a public repository, check the extension is enabled and report the GitHub URL via the OctoCounts repository.",
    },
    {
      question: "Are the numbers live or cached?",
      answer:
        "Local counts are cached by repository and ref, and each report identifies the exact commit counted. A retained entry can be reused; missing or expired entries need a new request. A refreshed count can change when the commit, engine, or effective counting rules change. The full panel shows the measured commit.",
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
    return markdownResponse(extensionMarkdown(), "public, s-maxage=300, stale-while-revalidate=600", options);
  }
  const index = await indexHtml(context);
  const content = EXTENSION_CONTENT;
  // The "Install from …" copy must stay identical to the client
  // ExtensionPage's en labels (src/locales/en.json extensionSection.install*)
  // so hydration does not swap the button text. The markdown twin below keeps
  // the fuller "Install OctoCounts from …" sentence.
  const installButtons = EXTENSION_STORES.map(
    (store) => `<a href="${escapeAttr(store.url)}" data-store="${store.store}" data-placement="extension_page" rel="noreferrer">Install from ${escapeHtml(store.label)}</a>`
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
            // url is the primary (Chrome Web Store) listing; downloadUrl lists
            // one URL per store so it agrees with operatingSystem instead of
            // advertising Chrome, Edge, and Firefox while linking only Chrome.
            url: EXTENSION_STORES[0].url,
            downloadUrl: EXTENSION_STORES.map((store) => store.url),
            screenshot: "https://octocounts.com/og-image.jpg",
            description: content.description,
            // The homepage Person (@id https://github.com/huanglizhuo) with
            // personal identity links only — product listings belong to the product —
            // so this author merges with every other statement of it (H4).
            author: {
              "@type": "Person",
              "@id": PERSON_ID,
              name: "huanglizhuo",
              url: "https://github.com/huanglizhuo",
              sameAs: PERSON_SAME_AS,
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

/// Homepage: served from the build-time prerender (dist/home.html and
/// dist/home-zh.html, emitted by scripts/prerender-home.mjs from the same
/// React tree the client hydrates). No request-time HTML surgery: the
/// prerendered body IS the app's first paint (hero, form, example report,
/// how-it-works, FAQ — user-visible content and crawler content are one and
/// the same), and the marker #root[data-oc-prerender="home"] tells
/// src/main.tsx to hydrate instead of re-mounting.
///
/// The locale is pinned by the canonical path, independent of browser preferences.
async function homePageResponse(context) {
  const url = new URL(context.request.url);
  const assetPath = url.pathname === "/zh" ? "/home-zh.html" : "/home.html";
  const assetUrl = new URL(url);
  assetUrl.pathname = assetPath;
  assetUrl.search = "";
  const asset = await context.env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
  if (asset.ok) {
    return htmlResponse(await asset.text(), "public, s-maxage=300, stale-while-revalidate=600");
  }
  if (url.pathname === "/zh") {
    return new Response("中文页面暂时不可用，请稍后重试。", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "retry-after": "60" },
    });
  }
  // Degraded path (a deploy somehow missing its prerendered assets): the
  // plain SPA shell still works once JS runs, but it is NOT the good page —
  // serve it uncached so no shared cache pins the shell over the real home.
  return htmlResponse(await indexHtml(context), "no-store");
}

/// "React vs Vue: lines of code compared | OctoCounts". The brand suffix is
/// dropped when it would push the title past the ~60 characters a SERP shows,
/// so the pair names and "lines of code" are never the truncated part.
function compareTitle(name) {
  const title = `${name}: lines of code compared`;
  return title.length + " | OctoCounts".length > 60 ? title : `${title} | OctoCounts`;
}

/// Degraded-state response for curated compare pages: backend down or an
/// integrity-guard mismatch. Stale-while-error first — a slug with a last-good
/// render gets that render back with a normal 200 and a short TTL so the next
/// good pass replaces it; only a never-rendered slug falls through to the 503.
/// Not noindex — see reportUnavailableMeta.
async function compareUnavailableResponse(context, entry, options = {}) {
  const cached = envScratchMap(context.env).get(entry.slug);
  if (cached) {
    if (options.markdown && cached.markdown) return markdownResponse(cached.markdown, "public, max-age=60, stale-while-revalidate=600");
    if (!options.markdown && cached.html) return htmlResponse(cached.html, "public, max-age=60, stale-while-revalidate=600");
  }
  return serviceUnavailableResponse(await indexHtml(context), {
    title: compareTitle(entry.name),
    description: `The ${entry.name} source line count comparison is temporarily unavailable. Please try again shortly.`,
    canonical: `https://octocounts.com/compare/${entry.slug}`,
    robots: "index,follow,max-image-preview:large,max-snippet:-1",
    ogImage: "https://octocounts.com/og-image.jpg",
    jsonLd: null,
    extraHead: `<script type="application/json" id="octocounts-compare-data">${escapeScriptJson(compareFallbackViewModel(entry, "unavailable"))}</script>`,
    bodyContent: `<section><h1>${escapeHtml(entry.name)}: source lines of code compared</h1><p>This comparison is temporarily unavailable. Please try again in a moment.</p></section>`,
  }, options);
}

async function curatedCompareResponse(context, entry, options = {}) {
  const [leftResult, rightResult] = await Promise.all([
    fetchSeoReport(context, entry.left),
    fetchSeoReport(context, entry.right),
  ]);

  if (leftResult.state === "unavailable" || rightResult.state === "unavailable") {
    return compareUnavailableResponse(context, entry, options);
  }

  if (leftResult.state === "missing" || rightResult.state === "missing") {
    // Same 404 rationale as missing reports: the fallback body still renders
    // (the JS app re-runs the analysis), but crawlers get the true status
    // instead of counting another soft-200 against the site.
    if (options.markdown) return markdownResponse(compareMissingMarkdown(entry), "public, max-age=60", { ...options, status: 404 });
    return htmlResponse(injectCompareFallback(await indexHtml(context), entry), "public, max-age=60", { status: 404 });
  }

  const [left, right] = await Promise.all([leftResult.response.json(), rightResult.response.json()]);
  // Same integrity guard as report pages: a compare page's title, description,
  // and table all derive from these two payloads, so a mis-keyed cache tier
  // would publish one repository's numbers under another's name. Fail closed —
  // unless the mismatch is a GitHub rename the store itself confirms. The
  // report routes 308 through the recorded redirect chain, but a curated
  // /compare/<slug> route is fixed, so its payloads would otherwise trip this
  // guard forever (facebook/react → react/react served 503s on every page
  // whose registry side still spelled the old name). resolveRenamedCompareEntry
  // accepts a canonical name only when the store's redirect endpoint — a
  // different query path than the report lookup — states it for the requested
  // spelling; anything else keeps failing closed below.
  if (!reportMatchesRoute(left, entry.left) || !reportMatchesRoute(right, entry.right)) {
    const healedEntry = await resolveRenamedCompareEntry(context, entry, left, right);
    if (!healedEntry) return compareUnavailableResponse(context, entry, options);
    entry = healedEntry;
  }
  const model = await buildCompareViewModel(entry, left, right);
  // Record the good render for stale-while-error before answering. Each
  // representation is cached as it is produced; the other (if any) survives.
  const stale = envScratchMap(context.env);
  if (options.markdown) {
    const markdown = compareMarkdown(model);
    stale.set(entry.slug, { ...stale.get(entry.slug), markdown });
    return markdownResponse(markdown, "public, s-maxage=300, stale-while-revalidate=600", options);
  }
  const html = injectCuratedCompare(await indexHtml(context), model);
  stale.set(entry.slug, { ...stale.get(entry.slug), html });
  return htmlResponse(html, "public, s-maxage=300, stale-while-revalidate=600");
}

/// Serializable view model shared by three renderers of the same comparison:
/// the SSR HTML body, the client React page (#octocounts-compare-data), and
/// the markdown twin. Every reader-visible value — display strings included —
/// is derived here exactly once, so the representations cannot drift.
async function buildCompareViewModel(entry, left, right) {
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
    ["Languages counted", languageCount(left), languageCount(right)],
  ];
  const compatibility = comparePolicies(left, right).status;
  const editorial = (await loadCompareEditorial())[entry.slug];
  const side = (report, date) => ({
    repoFullName: report.repoFullName,
    publicPath: report.publicPath,
    snapshotUrl: report.snapshotUrl,
    canonicalUrl: report.canonicalUrl,
    htmlUrl: report.htmlUrl,
    refName: report.refName,
    commitSha: report.commitSha,
    generatedAt: report.generatedAt,
    date,
    totals: { ...report.total, languages: languageCount(report) },
    topLanguages: topLanguages(report, 5).map((language) => ({ name: language.name, code: language.stats.code })),
  });
  return {
    state: "ready",
    slug: entry.slug,
    name: entry.name,
    canonical,
    title: compareTitle(entry.name),
    heading: `${entry.name}: source lines of code compared`,
    // Meta description ~120-140 chars for typical registry names (SEO audit
    // H5): the old template's closing clause ("Totals, language mix, and
    // methodology compared.") pushed every /compare/* page to 174-178 chars.
    // Both headline number pairs and the tokei attribution stay.
    description: `${left.repoFullName} has ${formatNumber(left.total.lines)} total lines (${formatNumber(left.total.code)} code); ${right.repoFullName} has ${formatNumber(right.total.lines)} total lines (${formatNumber(right.total.code)} code), counted with tokei.`,
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
    capsuleText: `The ${entry.name} comparison on OctoCounts shows side-by-side source line counts for ${left.repoFullName} and ${right.repoFullName}, counted under the rules and on the dates stated below: files, total lines, code lines, comment lines, blank lines, and per-language totals, pinned to the exact commits listed below.`,
    summaryText: compareSummaryText(left, right, leftDate, rightDate),
    languageMixText: compareLanguageMixText(left, right),
    methodologyText: compareMethodologyText(left, right, leftDate, rightDate),
    compatibility,
    policyText: `${compatibility === "same" ? "Both reports use the same engine and effective counting rules. Repository declarations, when enabled, are specific to each repository." : compatibility === "different" ? "These reports use different engines or counting rules; do not interpret their ratio as a like-for-like comparison." : "Counting rules are unknown for at least one report; comparability cannot be verified."} ${reportPolicyText(left)} ${reportPolicyText(right)}`,
    retentionText: "Saved reports remain subject to cache cleanup and replacement. Export their JSON for durable citation; live report URLs can change.",
    disclaimerText: "Note: code size is not code quality. OctoCounts only reports reproducible line counts and makes no claim that either project is better.",
    editorial: editorial ? {
      ...editorial,
      scope: `Background observations recorded on ${editorial.verifiedAt}; language descriptions here are historical context, not claims about the current filtered shares. Use this page's measured language breakdown for current counts. ${editorial.scope}`,
    } : null,
    faq: compareFaq(entry, left, right, leftDate, rightDate),
    relatedLinks: [
      { href: "/compare", label: "Interactive repository comparison" },
      { href: "/recent", label: "Recently analyzed repositories" },
      { href: "/popular", label: "Popular SLOC reports" },
      { href: "/trending", label: "Trending GitHub repositories" },
      { href: "/hall-of-monoliths", label: "Hall of Monoliths" },
      { href: "/research", label: "Original research: how filtering changes SLOC counts" },
      { href: "/docs/count-lines-of-code-github", label: "How to count lines of code in a GitHub repository" },
      { href: "/docs/largest-codebases", label: "Largest codebases by lines of code" },
      { href: "/docs/github-sloc-counter", label: "GitHub SLOC counter guide" },
      { href: "/docs/methodology", label: "Counting methodology" },
      { href: "/docs/glossary", label: "SLOC and code metrics glossary" },
      { href: "/docs/api", label: "OctoCounts API docs" },
      { href: "/docs", label: "All OctoCounts guides" },
    ],
    updatedAt: [left.generatedAt, right.generatedAt, COMPARE_CONTENT_LASTMOD].sort().at(-1),
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
    title: compareTitle(entry.name),
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

${model.policyText}
${model.editorial ? `## About this comparison

${model.editorial.scope}

${model.editorial.insights.join("\n\n")}

_${model.editorial.caution}_

Sources: ${model.editorial.sources.map((source) => `[${source.label}](${source.url})`).join(" · ")}. Statements verified ${model.editorial.verifiedAt}.

` : ""}Evidence and next steps:

- [${model.left.repoFullName} SLOC report](https://octocounts.com${model.left.publicPath})
- [${model.right.repoFullName} SLOC report](https://octocounts.com${model.right.publicPath})
${[model.left, model.right].filter((side) => side.snapshotUrl).map((side) => `- [${side.repoFullName} saved report](${side.snapshotUrl})`).join("\n")}

${model.retentionText}

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
// isolate, so one sitemap regeneration asks the backend for the whole
// indexable-repository set at most once per TTL. The old check fired one
// /api/seo/report fetch per unique registry repository — roughly 200
// subrequests against a Workers budget of 50 on the free plan.
const COMPARE_EXISTENCE_TTL_MS = 3_600_000;
const compareExistenceCache = new Map();

/// Test hook: the existence cache would otherwise leak between test cases.
export function __resetCompareExistenceCacheForTests() {
  compareExistenceCache.clear();
  compareRedirectCache.clear();
}

// Rename confirmations per registry spelling ("owner/repo" lowercased →
// canonical slug or null). Renames only ever grow, so a confirmed answer is
// cached for a long TTL; a failed lookup is cached briefly so one broken page
// does not spend extra subrequests on every hit.
const COMPARE_REDIRECT_TTL_MS = 24 * 3_600_000;
const COMPARE_REDIRECT_MISS_TTL_MS = 600_000;
const compareRedirectCache = new Map();

/// Ask the store's redirect endpoint where a registry spelling lives now.
/// Returns the canonical "owner/repo" slug, or null when no redirect is
/// recorded (the answer is cached for the short miss TTL) or the lookup fails
/// transiently (not cached; the next pass retries).
async function redirectConfirmedSlug(context, target) {
  const key = `${target.owner}/${target.repo}`.toLowerCase();
  const cached = compareRedirectCache.get(key);
  if (cached) {
    const ttl = cached.slug ? COMPARE_REDIRECT_TTL_MS : COMPARE_REDIRECT_MISS_TTL_MS;
    if (Date.now() - cached.checkedAt < ttl) return cached.slug;
  }
  try {
    const params = new URLSearchParams({ provider: "github", owner: target.owner, repo: target.repo });
    const response = await fetch(`${apiBase(context)}/api/seo/redirect?${params.toString()}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(SEO_REPORT_TIMEOUT_MS),
    });
    let slug = null;
    if (response.ok) {
      const payload = await response.json().catch(() => null);
      slug = typeof payload?.redirectSlug === "string" && payload.redirectSlug.includes("/")
        ? payload.redirectSlug
        : null;
    }
    compareRedirectCache.set(key, { slug, checkedAt: Date.now() });
    return slug;
  } catch {
    return null;
  }
}

/// Replace registry sides whose report payload answered under a different
/// name with the redirect-confirmed canonical spelling. Returns the healed
/// entry, or null when any mismatched side stays unexplained — a mismatch is
/// also the signature of a mis-keyed cache tier, so an unconfirmed canonical
/// name never stands in for the registry spelling.
async function resolveRenamedCompareEntry(context, entry, left, right) {
  const healed = { ...entry };
  for (const [key, target, report] of [["left", entry.left, left], ["right", entry.right, right]]) {
    if (reportMatchesRoute(report, target)) continue;
    const slug = await redirectConfirmedSlug(context, target);
    if (!slug) return null;
    const slash = slug.indexOf("/");
    const owner = slug.slice(0, slash);
    const repo = slug.slice(slash + 1);
    if (!owner || !repo) return null;
    healed[key] = { ...target, owner, repo };
  }
  return healed;
}

/// Per-request-env scratch caches, keyed per env the way indexHtmlCache is so
/// test contexts (fresh env objects) never share state with each other while a
/// production isolate (one env for its lifetime) does. Holds:
/// - "<compare slug>" -> { html, markdown }: last-good curated-compare
///   renders for stale-while-error (see compareUnavailableResponse).
/// - "rotating-reports:<day>" -> [loc]: the hub pages' daily report slice
///   (see fetchRotatingReportLocs).
/// - "stats:last-good" -> validated /api/stats payload (see statsPageResponse).
/// Key namespaces cannot collide: registry slugs contain no ":".
const lastGoodEnvCache = new WeakMap();

function envScratchMap(env) {
  let store = lastGoodEnvCache.get(env);
  if (!store) {
    store = new Map();
    lastGoodEnvCache.set(env, store);
  }
  return store;
}

/// Fetch an /api/seo/report and classify the outcome:
/// - "ok": report exists (response attached, unread)
/// - "missing": 404 — the repository has no cached report
/// - "unavailable": 5xx, network error, or timeout — transient backend trouble
async function fetchSeoReport(context, target) {
  try {
    const reportId = new URL(context.request.url).searchParams.get("reportId");
    const response = await fetch(reportId ? `${apiBase(context)}/api/reports/${encodeURIComponent(reportId)}` : seoReportUrl(context, target), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(SEO_REPORT_TIMEOUT_MS),
    });
    if (response.ok) {
      const stored = await response.json();
      if (reportId && (stored?.id !== reportId || stored.repository?.provider !== "github")) return { state: "unavailable" };
      const report = reportId ? snapshotSeoReport(stored) : stored;
      const validStats = (stats) => ["files", "lines", "code", "comments", "blanks"].every((key) => Number.isFinite(stats?.[key]) && stats[key] >= 0);
      if (!report || !["repoFullName", "refName", "commitSha", "generatedAt", "publicPath", "canonicalUrl", "title", "description"].every((key) => typeof report[key] === "string")
        || !Number.isFinite(Date.parse(report.generatedAt)) || !validStats(report.total)
        || !Array.isArray(report.languages) || !report.languages.every((language) => typeof language?.name === "string" && validStats(language.stats))) return { state: "unavailable" };
      const policy = report.countingPolicy;
      if (policy && (typeof policy.version !== "string" || typeof policy.repositoryAttributes?.status !== "string"
        || !["includeDocs", "includeTests", "includeGenerated"].every((key) => typeof policy[key] === "boolean")
        || !["ignoredDirs", "ignoredLanguages"].every((key) => Array.isArray(policy[key]) && policy[key].every((value) => typeof value === "string")))) return { state: "unavailable" };
      return { state: "ok", response: Response.json(report) };
    }
    if (response.status === 404) return { state: "missing" };
    return { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}

function snapshotSeoReport(report) {
  const { owner, name: repo, htmlUrl } = report.repository;
  const repoFullName = `${owner}/${repo}`;
  const publicPath = `/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commit/${encodeURIComponent(report.commitSha)}`;
  const params = new URLSearchParams({ reportId: report.id });
  if (report.analysisOptions) params.set("analysis", JSON.stringify(report.analysisOptions));
  const canonicalUrl = `https://octocounts.com${publicPath}?${params}`;
  const top = report.languages[0];
  return {
    ...report, isSnapshot: true, reportId: report.id, provider: "github", owner, repo, repoFullName, htmlUrl, canonicalSlug: repoFullName,
    publicPath, canonicalUrl, snapshotUrl: canonicalUrl,
    title: `${repoFullName}: ${formatNumber(report.total.code)} lines of code | OctoCounts`,
    description: `${repoFullName} contains ${formatNumber(report.total.code)} code lines across ${formatNumber(report.total.files)} files and ${report.languages.length} languages at commit ${report.commitSha.slice(0, 12)}.`,
    citation: `${repoFullName}: ${formatNumber(report.total.code)} code lines at commit ${report.commitSha.slice(0, 12)}, counted with ${report.tokeiVersion} on ${report.generatedAt.slice(0, 10)}. Saved result ${report.id}.`,
    topLanguage: top ? { name: top.name, code: top.stats.code, percent: report.total.code ? top.stats.code / report.total.code * 100 : 0 } : null,
  };
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
function serviceUnavailableResponse(index, meta, options = {}) {
  if (options.markdown) {
    const response = markdownResponse(`# ${meta.title}\n\n${meta.description}\n`, "no-store", { status: 503 });
    response.headers.set("retry-after", "60");
    return response;
  }
  const html = meta ? injectHeadAndNoscript(index, meta) : index;
  return new Response(html, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "60",
      ...securityHeaders(),
    },
  });
}

async function collectionUnavailableResponse(context, path, title, options = {}) {
  const message = "Live data is temporarily unavailable. Please try again shortly.";
  if (options.markdown || options.feed) {
    return new Response(`${title}\n\n${message}\n`, {
      status: 503,
      headers: { "content-type": `${options.markdown ? "text/markdown" : "text/plain"}; charset=utf-8`, "cache-control": "no-store", "retry-after": "60", ...securityHeaders() },
    });
  }
  return serviceUnavailableResponse(await indexHtml(context), {
    title, description: message, canonical: `https://octocounts.com${path}`,
    robots: "index,follow", ogImage: "https://octocounts.com/og-image.jpg",
    bodyContent: `<section><h1>${escapeHtml(title)}</h1><p>${message}</p></section>`,
  });
}

function validStats(stats) {
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  return stats && ["reportsGenerated", "repositoriesAnalyzed", "linesCounted", "codeLinesCounted", "languagesDetected"].every((key) => count(stats.totals?.[key]))
    && Array.isArray(stats.sources) && stats.sources.every((row) => typeof row?.source === "string" && count(row.reports))
    && Array.isArray(stats.languages) && stats.languages.every((row) => typeof row?.language === "string" && count(row.code) && count(row.reports))
    && Array.isArray(stats.topRepositories) && stats.topRepositories.every((repo) => typeof repo?.owner === "string" && typeof repo.repo === "string"
      && REPORT_SITEMAP_LOC_PATTERN.test(`https://octocounts.com${repo.publicPath}`) && count(repo.total?.lines) && count(repo.total?.code));
}

/// Sitemap entries for curated comparisons whose both sides have cached
/// reports. The backend answers for the whole registry in one query; a
/// definitive "no reports for this repo" drops the slug (its SSR page is
/// noindex, so listing it would teach Google to ignore the sitemap). An
/// unreachable backend returns null so the sitemap can respond with 503.
async function indexableCompareEntries(context) {
  const uniqueRepos = new Map();
  for (const entry of COMPARE_REGISTRY) {
    for (const target of [entry.left, entry.right]) {
      uniqueRepos.set(`${target.owner.toLowerCase()}/${target.repo.toLowerCase()}`, { owner: target.owner, repo: target.repo });
    }
  }

  const cached = compareExistenceCache.get("indexable-pairs");
  let indexable = cached && Date.now() - cached.checkedAt < COMPARE_EXISTENCE_TTL_MS ? cached.pairs : null;
  if (!indexable) {
    indexable = await fetchIndexablePairs(context, [...uniqueRepos.values()]);
    if (!indexable) return null;
    compareExistenceCache.set("indexable-pairs", { pairs: indexable, checkedAt: Date.now() });
  }

  return COMPARE_REGISTRY.filter((entry) => {
    const left = indexable.has(`${entry.left.owner.toLowerCase()}/${entry.left.repo.toLowerCase()}`);
    const right = indexable.has(`${entry.right.owner.toLowerCase()}/${entry.right.repo.toLowerCase()}`);
    return left && right;
  }).map((entry) => ({
    slug: entry.slug,
    loc: `https://octocounts.com/compare/${entry.slug}`,
  }));
}

/// One POST to /api/seo/repos-indexable returns the subset of repositories
/// with an indexable cached report. Returns null on any failure.
async function fetchIndexablePairs(context, repos) {
  try {
    const response = await fetch(`${apiBase(context)}/api/seo/repos-indexable`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ repos }),
      signal: AbortSignal.timeout(SEO_REPORT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.repos) || !payload.repos.every((repo) => isGitHubPathPart(repo?.owner) && isGitHubPathPart(repo?.repo))) return null;
    return new Set(payload.repos.map((repo) => `${String(repo.owner).toLowerCase()}/${String(repo.repo).toLowerCase()}`));
  } catch {
    return null;
  }
}

function seoReportUrl(context, target) {
  const params = new URLSearchParams({ provider: "github", owner: target.owner, repo: target.repo });
  const ref = target.ref || target.refName;
  if (ref) params.set("refName", ref);
  if (target.refKind) params.set("refKind", target.refKind);
  return `${apiBase(context)}/api/seo/report?${params.toString()}`;
}

/// JSON-LD dateModified values are ISO 8601 instants; the backend serializes
/// generatedAt with nanosecond precision (e.g. ...T13:57:14.791200737+00:00),
/// which schema consumers do not all parse. Truncate fractional seconds to
/// milliseconds; values already at ms/second precision pass through.
function isoMilliseconds(value) {
  return typeof value === "string" ? value.replace(/(\.\d{3})\d+/, "$1") : value;
}

/// A fetched report is usable for a route only when it describes that route's
/// repository. Case-insensitive on purpose: the store returns the canonical
/// casing for a differently-cased URL, which the caller then 308s to — that is
/// a redirect, not contamination. A genuinely different repo means some tier
/// between this function and the store answered with the wrong payload.
function reportMatchesRoute(report, target) {
  return (
    typeof report?.repoFullName === "string" &&
    report.repoFullName.toLowerCase() === `${target.owner}/${target.repo}`.toLowerCase() &&
    (target.refKind !== "commit" || report.commitSha.toLowerCase().startsWith(target.refName.toLowerCase()))
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
    // The h1 is the repository itself (owner/repo), matching the client-side
    // hero on /github/ routes — page identity, not the product name.
    bodyContent: `<section><h1>${escapeHtml(fullName)}</h1><p>This report is temporarily unavailable. Please try again in a moment.</p></section>`,
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
  const bodyContent = `<section><h1>${escapeHtml(model.heading)}</h1><p>${escapeHtml(model.capsuleText)}</p><p>${escapeHtml(model.definitionText)}</p><p id="octocounts-compare-summary">${escapeHtml(model.summaryText)}</p>${table}<p>${escapeHtml(model.languageMixText)}</p>${methodology}<p>${escapeHtml(model.policyText)}</p>${editorialHtml}<p>Evidence and next steps:</p><ul>
    <li><a href="${escapeAttr(model.left.publicPath)}">${escapeHtml(model.left.repoFullName)} SLOC report</a></li>
    <li><a href="${escapeAttr(model.right.publicPath)}">${escapeHtml(model.right.repoFullName)} SLOC report</a></li>
    <li><a href="${escapeAttr(model.interactiveHref)}">Compare ${escapeHtml(model.left.repoFullName)} and ${escapeHtml(model.right.repoFullName)} interactively</a></li>
    ${[model.left, model.right].filter((side) => side.snapshotUrl).map((side) => `<li><a href="${escapeAttr(side.snapshotUrl)}">${escapeHtml(side.repoFullName)} saved report</a></li>`).join("")}
  </ul><p>${escapeHtml(model.retentionText)}</p><p>${escapeHtml(model.disclaimerText)}</p>${compareFaqHtml(model.faq)}${internalLinks}</section>`;

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
  const compatibility = comparePolicies(left, right).status;
  const leftCode = Number(left.total.code);
  const rightCode = Number(right.total.code);
  let sizePhrase = "Counting rules are unknown for at least one report; no like-for-like size ratio is stated";
  if (compatibility === "different") {
    sizePhrase = "These reports use different engines or counting rules; no like-for-like size ratio is stated";
  } else if (compatibility === "same") {
    if (leftCode === 0 || rightCode === 0) {
      sizePhrase = "At least one report has zero counted code lines; a relative size ratio is not defined";
    } else {
      const ratio = Math.max(leftCode, rightCode) / Math.min(leftCode, rightCode);
      sizePhrase = ratio < 1.15
        ? `${left.repoFullName} and ${right.repoFullName} are similar in size under the same engine and counting rules`
        : `${leftCode >= rightCode ? left.repoFullName : right.repoFullName} has about ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}x the counted code lines of ${leftCode >= rightCode ? right.repoFullName : left.repoFullName} under the same engine and counting rules`;
    }
  }
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

function reportPolicyText(report) {
  const policy = report.countingPolicy;
  if (!policy) return `${report.repoFullName}: counting rules unknown; engine ${report.tokeiVersion || "unknown"}.`;
  const toggles = [["docs", policy.includeDocs], ["tests", policy.includeTests], ["generated", policy.includeGenerated]]
    .map(([name, included]) => `${name} ${included ? "included" : "excluded"}`).join(", ");
  return `${report.repoFullName}: ${report.tokeiVersion || "unknown engine"}, policy ${policy.version}; ${toggles}. Excluded directory names: ${policy.ignoredDirs.join(", ") || "none"}. Ignored languages: ${policy.ignoredLanguages.join(", ") || "none"}. Repository declarations: ${policy.repositoryAttributes.status}. Exclusions are rule-based; they do not prove that every test, document or generated file was removed.`;
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
  return [
    {
      question: `Which has more lines of code, ${left.repoFullName} or ${right.repoFullName}?`,
      answer: compareSummaryText(left, right, leftDate, rightDate),
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
        dateModified: isoMilliseconds(model.updatedAt),
        measurementTechnique: model.policyText,
        variableMeasured: ["files", "lines", "code", "comments", "blanks", "languages"],
        // Same merge rule as the report pages' Dataset: inline for standalone
        // validity, keyed to the homepage Organization @id with its sameAs (H4).
        creator: {
          "@type": "Organization",
          "@id": ORGANIZATION_ID,
          name: "OctoCounts",
          url: "https://octocounts.com/",
          sameAs: ORGANIZATION_SAME_AS,
        },
        isBasedOn: [model.left.snapshotUrl || model.left.canonicalUrl, model.right.snapshotUrl || model.right.canonicalUrl],
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
    title: compareTitle(entry.name),
    description: `Source line count comparison of ${fullNames}. Analyze these public GitHub repositories with OctoCounts.`,
    canonical: `https://octocounts.com/compare/${entry.slug}`,
    robots: "noindex,follow,max-image-preview:large",
    ogImage: "https://octocounts.com/og-image.jpg",
    jsonLd: null,
    extraHead: `<script type="application/json" id="octocounts-compare-data">${escapeScriptJson(compareFallbackViewModel(entry, "missing"))}</script>`,
    bodyContent: `<section><h1>${escapeHtml(entry.name)}: source lines of code compared</h1><p>A cached OctoCounts report is not available for both repositories yet, so this comparison cannot be rendered. Open this page with JavaScript enabled to run the analyses, then revisit this page.</p></section>`,
  });
}

// Sitemap layout: /sitemap.xml is a sitemap index over three child files so
// the ~4k programmatic /github/* report pages cannot bury the 20-odd core
// pages and 100-odd curated comparisons in one 4,000-entry URL list. Search
// engines report and crawl each child independently, which keeps crawl budget
// on the pages that actually need indexing. Report pages are chunked because
// that set keeps growing.
const REPORTS_SITEMAP_PAGE_SIZE = 10_000;

function sitemapCacheHeaders() {
  return {
    "content-type": "application/xml; charset=utf-8",
    "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
    ...securityHeaders(),
  };
}

function urlsetResponse(entries) {
  const urls = entries
    .map(
      (entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
${entry.lastmod ? `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>\n` : ""}  </url>`
    )
    .join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: sitemapCacheHeaders(),
  });
}

async function fetchReportSitemapEntries(context) {
  try {
    const response = await fetch(`${apiBase(context)}/api/seo/sitemap`, {
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(SEO_REPORT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const entries = await response.json();
    return Array.isArray(entries) ? filterReportSitemapEntries(entries) : null;
  } catch {
    return null;
  }
}

function sitemapUnavailableResponse() {
  return new Response("Sitemap temporarily unavailable\n", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "retry-after": "60", ...securityHeaders() },
  });
}

/// Quality gate on the /api/seo/sitemap payload (SEO audit H2). Each entry
/// carries exactly {loc, lastmod} today — no measured totals, no canonical
/// owner/repo casing marker — so only what those two fields can prove is
/// filtered here:
/// - loc must be the canonical report shape this function itself serves,
///   https://octocounts.com/github/:owner/:repo (percent-encoded segments
///   allowed): anything else (another provider's path, a ref URL, a malformed
///   string) is a URL the edge would redirect or 404, not a sitemap entry.
/// - locs that duplicate another entry case-insensitively collapse to the
///   first occurrence: the store keys owner/repo case-sensitively, so one
///   repository analyzed under two casings ships two rows while at most one
///   casing is canonical (the other 308s at report time).
/// - entries that provably measured nothing ("0 code lines across 0 files")
/// or measured fewer files than MIN_INDEXABLE_REPORT_FILES are dropped, but
/// only when the payload actually carries totals: the check
/// reads the total shapes the other SEO endpoints already use (nested
/// total.{files,lines,code} like /api/seo/report, or flat camelCase
/// totalFiles/totalLines/totalCode like /api/seo/related), so the moment the
/// backend adds any of them to the sitemap rows, empty analyses stop being
/// published without another edge change.
/// What this gate CANNOT do, and the backend must: detect a renamed or
/// re-cased repository whose stored owner/repo no longer matches GitHub's
/// live canonical name (e.g. the OctoPoint -> OctoCounts rename entry that
/// 308s). Nothing in {loc, lastmod} reveals that; it needs a store-side
/// canonicalization or a live-name check before the rows are returned.
const REPORT_SITEMAP_LOC_PATTERN = /^https:\/\/octocounts\.com\/github\/[A-Za-z0-9_.~-]+(?:%[0-9A-Fa-f]{2})*\/[A-Za-z0-9_.~-]+(?:%[0-9A-Fa-f]{2})*$/;

// Analyses measuring fewer than this many files are near-zero-value URLs
// (typo owners, markdown-only placeholder repos): Google crawls them and
// drops them ("Crawled - currently not indexed"), spending report-page crawl
// budget on pages that will never rank. Below the floor the sitemap drops
// the entry and the report page itself answers 404, so the URL leaves the
// index instead of sitting in it as thin content. The analysis itself stays
// reachable through the web app, and the floor is deliberately conservative:
// real two-file gists are rare, and a repo that grows past the floor is
// re-listed on its next analysis.

function filterReportSitemapEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const seenLocs = new Set();
  const kept = [];
  for (const entry of entries) {
    if (typeof entry?.loc !== "string" || !REPORT_SITEMAP_LOC_PATTERN.test(entry.loc)) continue;
    const dedupeKey = entry.loc.toLowerCase();
    if (seenLocs.has(dedupeKey)) continue;
    seenLocs.add(dedupeKey);
    if (!sitemapEntryMeasuredAnything(entry)) continue;
    kept.push({ ...entry, dataLastmod: entry.lastmod, lastmod: entry.lastmod > REPORT_CONTENT_LASTMOD ? entry.lastmod : REPORT_CONTENT_LASTMOD });
  }
  return kept;
}

/// Per-slug lastmod for curated comparisons: the newer of the two reports'
/// data dates and the comparison template date, the same day the page's
/// visible updatedAt names. A slug with a side missing from the report
/// inventory gets no date rather than an invented one.
function compareLastmods(reportEntries) {
  const dates = new Map(reportEntries.map((entry) => [entry.loc.toLowerCase(), entry.dataLastmod ?? entry.lastmod]));
  const side = (target) => dates.get(`https://octocounts.com/github/${target.owner}/${target.repo}`.toLowerCase());
  return new Map(COMPARE_REGISTRY.map((entry) => {
    const [left, right] = [side(entry.left), side(entry.right)];
    return [entry.slug, typeof left === "string" && typeof right === "string" ? [left, right, COMPARE_CONTENT_LASTMOD].sort().at(-1) : undefined];
  }));
}

/// True unless the entry's own totals prove it is not worth indexing: an
/// analysis that measured nothing at all (every total zero), or one whose
/// file count sits below the indexable floor. An entry with no totals at all
/// stays: absence of data is not proof of an empty analysis.
function sitemapEntryMeasuredAnything(entry) {
  const files = entry.total?.files ?? entry.totalFiles;
  if (typeof files === "number" && files < MIN_INDEXABLE_REPORT_FILES) return false;
  const totals = [
    entry.total?.files,
    entry.total?.lines,
    entry.total?.code,
    entry.totalFiles,
    entry.totalLines,
    entry.totalCode,
  ].filter((value) => typeof value === "number");
  return totals.length === 0 || totals.some((value) => value > 0);
}

/// Greatest W3C date among entry lastmods, or null when none carries one.
/// All lastmod values on this site are YYYY-MM-DD, so lexicographic order is
/// chronological order.
function maxLastmod(entries) {
  let max = null;
  for (const entry of entries) {
    if (typeof entry?.lastmod === "string" && entry.lastmod > (max ?? "")) max = entry.lastmod;
  }
  return max;
}

async function sitemapIndexResponse(context) {
  // Only the report-page count is unknown up front (compare is a single file
  // and the static list is compiled in), so skip the compare-existence scan
  // here: the index is the hottest sitemap request crawlers make.
  const dynamicEntries = await fetchReportSitemapEntries(context);
  if (dynamicEntries === null) return sitemapUnavailableResponse();
  const reportPages = Math.ceil(dynamicEntries.length / REPORTS_SITEMAP_PAGE_SIZE);
  // Include a child's freshest lastmod only when its underlying dates are known.
  const snapshot = await trendingSnapshot(context);
  const staticLastmod = maxLastmod(
    STATIC_SITEMAP_ENTRIES.map((entry) =>
      entry.loc.endsWith("/trending") ? { lastmod: snapshot?.date } : entry
    )
  );
  const pageSize = REPORTS_SITEMAP_PAGE_SIZE;
  const children = [
    { loc: "https://octocounts.com/sitemap-static.xml", lastmod: snapshot ? staticLastmod : undefined },
    { loc: "https://octocounts.com/sitemap-compare.xml", lastmod: maxLastmod([...compareLastmods(dynamicEntries).values()].map((lastmod) => ({ lastmod }))) },
    ...Array.from({ length: reportPages }, (_, i) => ({
      loc: `https://octocounts.com/sitemap-reports-${i + 1}.xml`,
      lastmod: maxLastmod(dynamicEntries.slice(i * pageSize, (i + 1) * pageSize)),
    })),
  ];
  const sitemaps = children
    .map(
      (child) => `  <sitemap>\n    <loc>${escapeXml(child.loc)}</loc>\n${child.lastmod ? `    <lastmod>${escapeXml(child.lastmod)}</lastmod>\n` : ""}  </sitemap>`
    )
    .join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemaps}\n</sitemapindex>\n`,
    { headers: sitemapCacheHeaders() }
  );
}

async function staticSitemapResponse(context) {
  const snapshot = await trendingSnapshot(context);
  const entries = STATIC_SITEMAP_ENTRIES.map((entry) =>
    entry.loc.endsWith("/trending") ? { ...entry, lastmod: snapshot?.date } :
      LIVE_COLLECTION_PATHS.has(new URL(entry.loc).pathname) ? { loc: entry.loc } : entry
  );
  return urlsetResponse(entries);
}

async function compareSitemapResponse(context) {
  const [entries, reportEntries] = await Promise.all([indexableCompareEntries(context), fetchReportSitemapEntries(context)]);
  if (entries === null) return sitemapUnavailableResponse();
  // Dates are optional: without the report inventory the URLs still list.
  const lastmods = reportEntries ? compareLastmods(reportEntries) : new Map();
  return urlsetResponse(entries.map((entry) => ({ loc: entry.loc, lastmod: lastmods.get(entry.slug) })));
}

/// An out-of-range or empty reports chunk used to answer 200 with an empty
/// <urlset> — a dead artifact Search Console indexed as a valid-but-empty
/// sitemap (and which nothing referenced). 404 instead: the sitemap index
/// only ever lists non-empty pages, so an empty page is a URL that should
/// not exist.
function sitemapNotFoundResponse() {
  return new Response("Not found\n", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
      ...securityHeaders(),
    },
  });
}

async function reportsSitemapResponse(context, page) {
  if (!Number.isInteger(page) || page < 1) return sitemapNotFoundResponse();
  const dynamicEntries = await fetchReportSitemapEntries(context);
  if (dynamicEntries === null) return sitemapUnavailableResponse();
  const slice = dynamicEntries
    .slice((page - 1) * REPORTS_SITEMAP_PAGE_SIZE, page * REPORTS_SITEMAP_PAGE_SIZE)
    .map((entry) => ({ loc: entry.loc, lastmod: entry.lastmod }));
  if (!slice.length) return sitemapNotFoundResponse();
  return urlsetResponse(slice);
}

async function trendingSnapshot(context) {
  const url = new URL(context.request.url);
  url.pathname = "/github-trending.json";
  url.search = "";
  const response = await context.env.ASSETS.fetch(new Request(url.toString(), { method: "GET", signal: AbortSignal.timeout(SEO_REPORT_TIMEOUT_MS) })).catch(() => null);
  if (!response?.ok) return null;
  const snapshot = await response.json().catch(() => null);
  return snapshot && snapshot.source === "https://github.com/trending"
    && typeof snapshot.generatedAt === "string" && Number.isFinite(Date.parse(snapshot.generatedAt))
    && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.date) && new Date(snapshot.generatedAt).toISOString().slice(0, 10) === snapshot.date
    && Array.isArray(snapshot.repositories) && snapshot.repositories.every((repo) =>
      typeof repo?.fullName === "string" && typeof repo.description === "string"
      && (repo.language === null || typeof repo.language === "string")
      && Number.isSafeInteger(repo.rank) && repo.rank > 0
      && Number.isSafeInteger(repo.starsToday) && repo.starsToday >= 0
      && REPORT_SITEMAP_LOC_PATTERN.test(`https://octocounts.com${repo.publicPath}`))
    ? snapshot
    : null;
}

// The SPA shell is immutable for a deployment, so memoize its text per
// ASSETS binding (WeakMap: each isolate has one binding; each test context
// has its own, so memoization never leaks between test fixtures).
const indexHtmlCache = new WeakMap();

async function indexHtml(context) {
  const assets = context.env.ASSETS;
  let html = indexHtmlCache.get(assets);
  if (html === undefined) {
    const url = new URL(context.request.url);
    url.pathname = "/";
    url.search = "";
    // Page validators and HEAD requests must not turn the internal template fetch into an empty body.
    const response = await assets.fetch(new Request(url.toString(), { method: "GET" }));
    html = await response.text();
    indexHtmlCache.set(assets, html);
  }
  return html;
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
      breadcrumbLabel: "Recent reports",
    };
  }
  if (kind === "monoliths") {
    return {
      // Exactly 60 chars with the suffix (SEO audit H5): the old 76-char
      // title spelled out "largest GitHub repositories by lines of code";
      // "largest repositories by SLOC" keeps the ranking keyword and the
      // site's core term without SERP truncation.
      title: "Hall of Monoliths: largest repositories by SLOC | OctoCounts",
      description: "A live OctoCounts leaderboard of large public GitHub repositories ranked by total source lines of code.",
      canonical: "https://octocounts.com/hall-of-monoliths",
      breadcrumbLabel: "Hall of Monoliths",
    };
  }
  return {
    title: "Popular SLOC reports | OctoCounts",
    description: "Popular OctoCounts source line count reports for public GitHub repositories.",
    canonical: "https://octocounts.com/popular",
    breadcrumbLabel: "Popular reports",
  };
}

/// Curated comparisons for a report page: first every comparison this
/// repository is part of (react/react -> React vs Vue, ...), then ones
/// matching its top programming language, so every long-tail /github/* page
/// links into the compare corpus with topical anchors.
function relatedComparisons(report) {
  const fullName = String(report.repoFullName ?? "").toLowerCase();
  const own = COMPARE_REGISTRY.filter((entry) => [entry.left, entry.right].some((side) => `${side.owner}/${side.repo}`.toLowerCase() === fullName));
  const byLanguage = comparisonsForLanguage(primaryLanguage(report.languages, report.total?.code)?.name);
  return [...new Set([...own, ...byLanguage])].slice(0, 4);
}

function comparisonsForLanguage(topLanguageName) {
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
  // led by the comparisons this repository itself appears in.
  const relatedCompare = relatedComparisons(report);
  const relatedCompareHtml = relatedCompare.length
    ? `<li>${relatedCompare
        .map((entry) => `<a href="/compare/${entry.slug}">${escapeHtml(entry.name)}</a>`)
        .join(" · ")}</li>`
    : "";
  // Per-repo CTAs (SEO audit H8): a reader landing on a report already has
  // the repo name in mind, so the badge builder and the diff tool are linked
  // with that context — same li style as the rest of the nav, repo name
  // escaped like every other payload-derived string on the page.
  const repoBadgesCta = `<li><a href="https://octocounts.com/badges">Get README badges for ${escapeHtml(report.repoFullName)}</a></li>`;
  const repoDiffCta = `<li><a href="https://octocounts.com/diff">Diff ${escapeHtml(report.repoFullName)} between refs</a></li>`;
  const internalLinks = `<nav aria-label="Related OctoCounts pages"><ul>
    <li><a href="/recent">Recently analyzed repositories</a></li>
    <li><a href="/popular">Popular SLOC reports</a></li>
    <li><a href="/trending">Trending GitHub repositories</a></li>
    <li><a href="/hall-of-monoliths">Hall of Monoliths</a></li>${relatedCompareHtml}
    ${repoBadgesCta}
    ${repoDiffCta}
    <li><a href="/docs/count-lines-of-code-github">How to count lines of code in a GitHub repository</a></li>
    <li><a href="/docs/github-sloc-counter">GitHub SLOC counter guide</a></li>
    <li><a href="/docs/methodology">Counting methodology</a></li>
    <li><a href="/docs/glossary">SLOC and code metrics glossary</a></li>
    <li><a href="/research">How test, docs, and generated-file filtering changes SLOC counts</a></li>
    <li><a href="/docs/api">OctoCounts API docs</a></li>
    <li><a href="/docs">All OctoCounts guides</a></li>
  </ul></nav>`;
  // Visible, not just linked from <meta property="og:image">: a crawler that
  // never executes JavaScript otherwise sees a text-only page even though a
  // per-repo chart image already exists at this URL. AI answer engines weigh
  // multi-modal pages more heavily, and the alt text doubles as another
  // self-contained citable summary next to the one in #octocounts-citation.
  const ogImageUrl = report.isSnapshot ? "https://octocounts.com/og-image.jpg" : `${apiBaseUrl}/og/${encodeURIComponent(report.provider)}/${encodeURIComponent(report.owner)}/${encodeURIComponent(report.repo)}`;
  // The OG card sits right under the h1 and is the page's LCP element (a
  // ~39 KB cross-origin PNG, ~1s cold). fetchpriority plus a head preload
  // starts the cross-origin fetch with the first bytes of the document
  // instead of after HTML/CSS parsing discovers the <img>.
  const ogImageHtml = report.isSnapshot ? "" : `<img src="${escapeAttr(ogImageUrl)}" width="1200" height="630" alt="${escapeAttr(report.citation)}" fetchpriority="high" />`;
  // The h1 is the repository (owner/repo): the page's subject and the value
  // the client-side hero renders on /github/ routes — semantically consistent
  // pre- and post-hydration, and never a second "OctoCounts" h1.
  const table = `<section><h1>${escapeHtml(report.repoFullName)}</h1><p>${escapeHtml(reportCapsuleText(report))}</p><p id="octocounts-citation">${escapeHtml(report.citation)}</p>${ogImageHtml}${lead}${reportInsights(report)}<table><thead><tr><th>Language</th><th>Files</th><th>Lines</th><th>Code</th><th>Comments</th><th>Blanks</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  // Peer links between report pages: every long-tail /github/* URL both
  // receives and hands out crawl paths, so the report corpus is a web instead
  // of a list of dead ends reachable only from /recent and /popular.
  const similarReposHtml = relatedReports.length
    ? `<section><h2>Similar repository reports</h2><p>Other public repositories with an OctoCounts report, ranked by top language and code size similarity:</p><ul>${relatedReports
        .map((item) => `<li><a href="${escapeAttr(item.publicPath)}">${escapeHtml(item.repoFullName)}</a> — ${escapeHtml(item.topLanguage || "mixed")}, ${formatNumber(item.totalCode)} code lines</li>`)
        .join("")}</ul></section>`
    : "";
  // Crawler-visible stand-in for the client-rendered growth-animation section
  // (plan §7): the report payload this function sees carries no SLOC history
  // samples, so the sentence sticks to what the report itself knows — the
  // first/last sample numbers render client-side and are never invented here.
  const growthSsrHtml = `<p class="growth-ssr">Play the growth animation for ${escapeHtml(report.repoFullName)} on this page — ${formatNumber(report.total.code)} code lines across ${formatNumber(languageCount(report))} languages, counted by tokei.</p>`;
  const jsonSummary = reportSummaryJson(report);
  return injectHeadAndNoscript(index, {
    title: report.title,
    description: report.description,
    canonical: report.canonicalUrl,
    robots: report.isSnapshot ? "noindex,follow" : "index,follow,max-image-preview:large,max-snippet:-1",
    ogImage: ogImageUrl,
    ogImageAlt: report.isSnapshot ? "OctoCounts" : report.citation,
    jsonLd: reportJsonLd(report),
    mdAlternate: report.isSnapshot ? `${report.canonicalUrl}&format=md` : `${report.canonicalUrl}.md`,
    extraHead: `<link rel="preload" as="image" href="${escapeAttr(ogImageUrl)}" fetchpriority="high" />
<script type="application/json" id="octocounts-report-summary">${escapeScriptJson(jsonSummary)}</script>`,
    bodyContent: table + `<p>${escapeHtml(reportLanguageLine(report))} Generated on <time datetime="${escapeAttr(isoMilliseconds(report.generatedAt))}">${escapeHtml(readableDate(report.generatedAt))}</time>.</p><section><h2>Counting rules and retention</h2><p>${escapeHtml(reportPolicyText(report))}</p><p>Saved reports remain subject to cache cleanup and replacement. Export the JSON or text for durable citation; live repository URLs can change.</p></section>` + reportReproduceHtml(report) + faqHtml + similarReposHtml + growthSsrHtml + internalLinks,
  });
}

/// Declarative answer capsule for report pages, rendered right after the h1
/// in the SSR body and as the first body paragraph of the markdown twin.
/// Every figure comes straight from the report payload so the capsule cannot
/// disagree with the table, FAQ, or client summary it sits next to.
function reportCapsuleText(report) {
  return `${report.repoFullName} has ${formatNumber(report.total.code)} source lines of code out of ${formatNumber(report.total.lines)} total lines across ${formatNumber(report.total.files)} files, counted with tokei from the ${report.refName} ref at commit ${report.commitSha.slice(0, 12)} on ${readableDate(report.generatedAt)}.${reportRulesSentence(report)}`;
}

/// One sentence naming the counting rules behind the capsule's figures, so
/// the quotable opening never implies a whole-repository count.
function reportRulesSentence(report) {
  if (!report.analysisOptions) return " The counting rules of this older report were not recorded.";
  if (isCanonicalAnalysisOptions(report.analysisOptions)) return " Tests, docs and generated files are excluded under OctoCounts' canonical public options.";
  const label = analysisOptionsLabel(report.analysisOptions);
  return label ? ` Counting options: ${label}.` : " Tests, docs and generated files are included.";
}

/// "Top language: Go 98.5%." (or "Top programming language: …" when data or
/// prose formats such as JSON hold a larger share), "" when nothing counted.
function reportLanguageLine(report) {
  const phrase = primaryLanguagePhrase(report.languages, report.total.code);
  return phrase ? `${phrase[0].toUpperCase()}${phrase.slice(1)}.` : "";
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/// "October 23, 2026" for an RFC 3339 instant: the UTC calendar date its
/// prefix names, the same day the docs pages' "Updated" lines use.
function readableDate(value) {
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return MONTH_NAMES[month - 1] && day ? `${MONTH_NAMES[month - 1]} ${day}, ${year}` : String(value).slice(0, 10);
}

/// Plain-text core of the report lead, shared by the HTML page and the
/// markdown twin. Answer engines quote self-contained opening sections; the
/// citation alone (~45 words) is the quotable core and this lead brings the
/// section to the ~150-word band that correlates with citation, covering
/// method and reproducibility without depending on the rest of the page.
function reportLeadText(report) {
  return `OctoCounts produced this report by resolving ${report.repoFullName} to commit ${report.commitSha.slice(0, 12)}, downloading the repository source archive, and counting files selected by the effective rules with tokei, the open-source line counter written in Rust. The table below breaks the count down by programming language into files, total lines, code lines, comment lines, and blank lines, so the figures can be compared across languages and projects. Results are cached by commit, tokei version, and analysis options; an exact reproduction needs the same commit, engine version, and effective counting rules.${report.analysisOptions ? "" : " Older reports with unknown rules cannot promise exact reproduction."}`;
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
  const primary = primaryLanguage(report.languages, report.total.code);
  const concentration = !primary
    ? "No single top language was identified"
    : primaryLanguagePhrase(report.languages, report.total.code).startsWith("top programming")
      ? `${primary.name} is the largest programming language at ${primary.percent.toFixed(1)}% of counted code; data and prose formats such as JSON or YAML hold a larger share`
      : `${primary.name} accounts for ${primary.percent.toFixed(1)}% of counted code`;
  return `This is a ${scale} codebase by counted code lines. Code represents ${codeRatio.toFixed(1)}% of all lines, comments represent ${commentRatio.toFixed(1)}%, and the repository averages ${formatNumber(Math.round(codePerFile))} code lines per file. ${concentration}.`;
}

/// The report's full language count: SEO payloads list only their first
/// twelve languages and state the total separately (older backends did not).
function languageCount(report) {
  return Number.isSafeInteger(report.languageCount) ? report.languageCount : report.languages.length;
}

function reportFaq(report) {
  const shortSha = report.commitSha.slice(0, 12);
  return [
    {
      question: `How many lines of code does ${report.repoFullName} have?`,
      answer: `${report.repoFullName} has ${formatNumber(report.total.code)} lines of code, plus ${formatNumber(report.total.comments)} comment lines and ${formatNumber(report.total.blanks)} blank lines, for ${formatNumber(report.total.lines)} total lines at commit ${shortSha} on ${readableDate(report.generatedAt)}.${reportRulesSentence(report)}`,
    },
    {
      question: `How was the ${report.repoFullName} line count measured?`,
      answer: `OctoCounts resolved the public GitHub repository to commit ${shortSha}, downloaded the source archive, counted it with tokei, and cached the report by commit, tokei version, and analysis options.`,
    },
    {
      question: `What commit was counted for ${report.repoFullName}?`,
      answer: `This OctoCounts report was generated from ${report.refName} at commit ${shortSha} on ${readableDate(report.generatedAt)}.`,
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
    reportId: report.reportId,
    countingPolicy: report.countingPolicy,
    snapshotUrl: report.snapshotUrl,
    totals: report.total,
    topLanguage: report.topLanguage,
    languageCount: languageCount(report),
    languages: report.languages,
    citation: report.citation,
    methodology: "https://octocounts.com/docs/methodology",
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
    bodyContent: `<section><h1>${escapeHtml(fullName)}</h1><p>No cached report exists yet. Open this page with JavaScript enabled to run an analysis.</p></section>`,
  });
}

/// /growth/:owner/:repo — the standalone growth-replay page. The animation is
/// client-rendered from the same bundle as the report page's growth section;
/// the indexable facts live on the full report, so this route is noindex and
/// canonicalizes there, carrying only a minimal visible summary for no-JS
/// fetchers (same discipline as the missing-report fallback).
async function growthPageResponse(context, owner, repo) {
  const fullName = `${owner}/${repo}`;
  const canonical = `https://octocounts.com/github/${owner}/${repo}`;
  const html = injectHeadAndNoscript(await indexHtml(context), {
    title: `${fullName} code growth replay | OctoCounts`,
    description: `Watch how ${fullName} grew over time — an animated replay of its code accumulation, language by language.`,
    canonical,
    robots: "noindex,follow",
    ogImage: "https://octocounts.com/og-image.jpg",
    jsonLd: null,
    bodyContent: `<section><h1>${escapeHtml(fullName)} — code growth</h1><p>Animated growth replay for the ${escapeHtml(fullName)} repository. Open this page with JavaScript enabled to watch the code city build, or see the <a href="${escapeAttr(canonical)}">full SLOC report</a>.</p></section>`,
  });
  return htmlResponse(html, "public, max-age=60", {});
}

// Every replacement below is a function, never a string: String.replace reads
// `$&`, `` $` `` and `$'` in a string replacement as splice directives, and the
// inserted text includes third-party prose (GitHub Trending descriptions).
// escapeHtml leaves `$` and backticks alone, so it cannot defuse them.
function injectHeadAndNoscript(index, meta) {
  let html = index
    .replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>\s*/gi, "");
  html = html.replace(/<title>.*?<\/title>/i, () => `<title>${escapeHtml(meta.title)}</title>`);
  html = setMeta(html, "name", "description", meta.description);
  html = setMeta(html, "name", "robots", meta.robots);
  html = setMeta(html, "property", "og:title", meta.title);
  html = setMeta(html, "property", "og:description", meta.description);
  html = setMeta(html, "property", "og:url", meta.canonical);
  html = setMeta(html, "property", "og:image", meta.ogImage);
  // Only overridden pages (per-repo report cards) carry a specific alt; the
  // static pages keep the homepage's generic og:image:alt, which matches
  // their unchanged og:image.
  if (meta.ogImageAlt) html = setMeta(html, "property", "og:image:alt", meta.ogImageAlt);
  html = setMeta(html, "name", "twitter:title", meta.title);
  html = setMeta(html, "name", "twitter:description", meta.description);
  html = setMeta(html, "name", "twitter:image", meta.ogImage);
  html = html.replace(/<link rel="canonical" href="[^"]*" \/>/i, () => `<link rel="canonical" href="${escapeAttr(meta.canonical)}" />`);
  if (meta.jsonLd) {
    html = html.replace("</head>", () => `<script type="application/ld+json">${escapeScriptJson(meta.jsonLd)}</script>\n</head>`);
  }
  // Crawler discovery for the markdown twin (?format=md / .md suffix).
  if (meta.mdAlternate) {
    html = html.replace("</head>", () => `<link rel="alternate" type="text/markdown" href="${escapeAttr(meta.mdAlternate)}" />\n</head>`);
  }
  if (meta.extraHead) {
    html = html.replace("</head>", () => `${meta.extraHead}\n</head>`);
  }
  // Server-rendered facts go INSIDE #root as regular visible HTML, not into a
  // <noscript> after it. Several AI fetchers (Perplexity's reader, some ChatGPT
  // fetch paths) strip or de-prioritize noscript, and Google weights noscript
  // content lower. React mounts with createRoot().render(), which discards the
  // container's existing children, so the app replaces this block on hydration
  // while no-JS crawlers keep the full facts, table, FAQ, and links.
  html = html.replace('<div id="root"></div>', () => `<div id="root">${meta.bodyContent}</div>`);
  return html;
}

function setMeta(html, attr, key, content) {
  const escaped = escapeAttr(content);
  const pattern = new RegExp(`<meta ${attr}="${escapeRegExp(key)}" content="[^"]*" \\/>`, "i");
  const replacement = `<meta ${attr}="${key}" content="${escaped}" />`;
  if (pattern.test(html)) return html.replace(pattern, () => replacement);
  return html.replace("</head>", () => `${replacement}\n</head>`);
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
  // status is set only by the missing-report fallback (404); every other
  // caller leaves it undefined, which the Response constructor reads as 200.
  return new Response(html, { status: options?.status, headers });
}

/// Markdown twins share the cache policy of their HTML page and the lockdown
/// header set; the body may be a string or a stream (static .md asset).
///
function markdownResponse(markdown, cacheControl, options = {}) {
  return new Response(markdown, {
    // status is set only by the missing-report markdown fallback (404).
    status: options.status,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      // Every markdown twin is a non-canonical serialization of its HTML page;
      // keep the .md URL out of the index while the links inside it stay
      // crawlable (follow). Covers report/compare/trending/stats/extension
      // twins and the docs/research .md assets served through this function.
      "x-robots-tag": "noindex, follow",
      "cache-control": cacheControl,
      ...securityHeaders(),
    },
  });
}

async function withHtmlSecurity(response) {
  if (!response.body) return response;
  if (!response.headers.get("content-type")?.includes("text/html")) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders())) headers.set(name, value);
  let html = await response.text();
  if (response.ok && !html.includes('src="/analytics.js"')) {
    html = html.replace(/<\/head>/i, '<script type="module" src="/analytics.js"></script></head>');
  }
  headers.delete("content-length");
  headers.delete("etag");
  headers.delete("last-modified");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
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
    "content-security-policy": `default-src 'self'; script-src 'self' ${BOOT_SCRIPT_HASH} https://cloud.umami.is https://plausible.io https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: https://www.google.com https://*.googleusercontent.com; font-src 'self'; connect-src 'self' https://api.octocounts.com https://www.githubstatus.com https://cloud.umami.is https://gateway.umami.is https://plausible.io https://cloudflareinsights.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors ${frameable ? "*" : "'none'"}; upgrade-insecure-requests`,
  };
}
