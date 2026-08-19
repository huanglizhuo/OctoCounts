import { COMPARE_REGISTRY, findCuratedComparison } from "./compare-registry.js";

const API_BASE = "https://api.octocounts.com";
const BOOT_SCRIPT_HASH = "'sha256-WRZoCRpV9YaIG5sPOijC2jelInnwDvYw9BYBSfp3VQY='";
const STATIC_SITEMAP_LASTMOD = "2026-08-19";
const STATIC_SITEMAP_ENTRIES = [
  { loc: "https://octocounts.com/", lastmod: STATIC_SITEMAP_LASTMOD },
  { loc: "https://octocounts.com/stats", lastmod: STATIC_SITEMAP_LASTMOD },
  { loc: "https://octocounts.com/recent", lastmod: STATIC_SITEMAP_LASTMOD },
  { loc: "https://octocounts.com/popular", lastmod: STATIC_SITEMAP_LASTMOD },
  { loc: "https://octocounts.com/trending", lastmod: STATIC_SITEMAP_LASTMOD },
  { loc: "https://octocounts.com/hall-of-monoliths", lastmod: STATIC_SITEMAP_LASTMOD },
  { loc: "https://octocounts.com/launch-kit.html", lastmod: STATIC_SITEMAP_LASTMOD },
  { loc: "https://octocounts.com/docs/github-sloc-counter", lastmod: STATIC_SITEMAP_LASTMOD },
  { loc: "https://octocounts.com/docs/api", lastmod: STATIC_SITEMAP_LASTMOD },
  { loc: "https://octocounts.com/docs/methodology", lastmod: STATIC_SITEMAP_LASTMOD },
  { loc: "https://octocounts.com/llms.txt", lastmod: STATIC_SITEMAP_LASTMOD },
  { loc: "https://octocounts.com/llms-full.txt", lastmod: STATIC_SITEMAP_LASTMOD },
  { loc: "https://octocounts.com/privacy", lastmod: STATIC_SITEMAP_LASTMOD },
  { loc: "https://octocounts.com/contact", lastmod: STATIC_SITEMAP_LASTMOD },
];

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

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
    return reportResponse(context, route);
  }

  if (url.pathname === "/recent" || url.pathname === "/popular") {
    return listPageResponse(context, url.pathname.slice(1), url);
  }

  if (url.pathname === "/trending") {
    return trendingPageResponse(context);
  }

  if (url.pathname === "/stats") {
    return statsPageResponse(context);
  }

  if (url.pathname === "/hall-of-monoliths") {
    return listPageResponse(context, "monoliths", url);
  }

  if (parts[0] === "compare" && parts.length === 2) {
    const curated = findCuratedComparison(parts[1].toLowerCase());
    if (curated) return curatedCompareResponse(context, curated);
    // Unknown comparison slugs are not curated content; they fall through to
    // static asset handling, which answers 404 in production.
  }

  if (url.pathname === "/compare" || url.pathname === "/diff") {
    return comparePageResponse(context, url.pathname);
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
    if (!refName) return `/github/${owner}/${repo}`;

    const marker = /^[a-f0-9]{7,40}$/i.test(refName) ? "commit" : "tree";
    const encodedRef = refName.split("/").map(encodeURIComponent).join("/");
    return `/github/${owner}/${repo}/${marker}/${encodedRef}`;
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

async function reportResponse(context, route) {
  const index = await indexHtml(context);
  const params = new URLSearchParams({
    provider: route.provider,
    owner: route.owner,
    repo: route.repo,
  });
  if (route.refName) params.set("refName", route.refName);

  const response = await fetch(`${apiBase(context)}/api/seo/report?${params.toString()}`, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    return htmlResponse(injectFallback(index, route), "public, max-age=60");
  }

  const report = await response.json();
  // The store matches owner/repo case-sensitively, so a mistyped or
  // mixed-case external link (e.g. /github/Facebook/React) resolves to the
  // canonical casing only via the report itself. 308 it so link equity lands
  // on the URL the canonical tag and sitemap use.
  const requestPath = new URL(context.request.url).pathname;
  if (report.publicPath && report.publicPath.toLowerCase() === requestPath.toLowerCase() && report.publicPath !== requestPath) {
    return Response.redirect(new URL(report.publicPath, new URL(context.request.url).origin), 308);
  }
  // 1h, not 24h: report titles/descriptions carry live line counts, and the
  // SEO report API behind this page already serves s-maxage=3600. Caching the
  // HTML a day longer than its own data source left stale counts in SERP
  // titles for up to a day after a big push. SWR keeps origin load low.
  return htmlResponse(injectReport(index, report, apiBase(context)), "public, s-maxage=3600, stale-while-revalidate=86400");
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
    "public, s-maxage=900, stale-while-revalidate=3600"
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

async function trendingPageResponse(context) {
  const index = await indexHtml(context);
  const snapshot = await trendingSnapshot(context);
  const title = "Trending GitHub repositories today | OctoCounts";
  const description = `Daily GitHub Trending repositories discovered on ${snapshot.date || "the latest snapshot"}, with stable OctoCounts source line count report links.`;
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
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: title,
        description,
        url: "https://octocounts.com/trending",
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
    "public, s-maxage=3600, stale-while-revalidate=86400"
  );
}

async function statsPageResponse(context) {
  const index = await indexHtml(context);
  const response = await fetch(`${apiBase(context)}/api/stats`, {
    headers: { accept: "application/json" },
  });
  const stats = response.ok ? await response.json() : null;
  const title = "OctoCounts public growth stats";
  const description = "Aggregate OctoCounts report totals, repository coverage, source breakdown, language totals, and largest public repositories.";
  // An indexed page must never bottom out at a single "unavailable" sentence:
  // that is all a crawler would have to cite. When the numbers are missing,
  // explain what the page measures and where the figures come from instead —
  // and when the numbers are present, a bare four-item list still says nothing
  // about what they measure, so the explanation and links render in both states.
  const totals = stats?.totals
    ? `<ul>
      <li>${formatNumber(stats.totals.reportsGenerated)} reports generated</li>
      <li>${formatNumber(stats.totals.repositoriesAnalyzed)} public repositories analyzed</li>
      <li>${formatNumber(stats.totals.linesCounted)} total lines counted</li>
      <li>${formatNumber(stats.totals.languagesDetected)} languages detected</li>
    </ul>`
    : `<p>The live figures are loading. OctoCounts is a free source lines of code counter for public GitHub repositories; the totals above are drawn from every report it has generated.</p>`;
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
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: title,
        description,
        url: "https://octocounts.com/stats",
        measurementTechnique: "Aggregate public OctoCounts report activity",
        variableMeasured: ["reports", "repositories", "lines", "languages", "sources"],
      },
      bodyContent: `<section><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>${totals}${body}</section>`,
    }),
    "public, s-maxage=900, stale-while-revalidate=3600"
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
    ? `<section><h2>Curated comparisons</h2><p>Server-rendered source line count comparisons for popular frameworks and tools:</p><ul>${COMPARE_REGISTRY.map((entry) => `<li><a href="/compare/${entry.slug}">${escapeHtml(entry.name)}</a></li>`).join("")}</ul></section>`
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
    "public, s-maxage=3600, stale-while-revalidate=86400"
  );
}

async function curatedCompareResponse(context, entry) {
  const index = await indexHtml(context);
  const [leftResponse, rightResponse] = await Promise.all([
    fetch(seoReportUrl(context, entry.left), { headers: { accept: "application/json" } }),
    fetch(seoReportUrl(context, entry.right), { headers: { accept: "application/json" } }),
  ]);

  if (!leftResponse.ok || !rightResponse.ok) {
    return htmlResponse(injectCompareFallback(index, entry), "public, max-age=60");
  }

  const [left, right] = await Promise.all([leftResponse.json(), rightResponse.json()]);
  return htmlResponse(injectCuratedCompare(index, entry, left, right), "public, s-maxage=3600, stale-while-revalidate=86400");
}

function seoReportUrl(context, target) {
  const params = new URLSearchParams({ provider: "github", owner: target.owner, repo: target.repo });
  if (target.ref) params.set("refName", target.ref);
  return `${apiBase(context)}/api/seo/report?${params.toString()}`;
}

function injectCuratedCompare(index, entry, left, right) {
  const canonical = `https://octocounts.com/compare/${entry.slug}`;
  const leftDate = left.generatedAt.slice(0, 10);
  const rightDate = right.generatedAt.slice(0, 10);
  const title = `${entry.name}: source lines of code compared | OctoCounts`;
  const description = `${left.repoFullName} has ${formatNumber(left.total.lines)} total lines (${formatNumber(left.total.code)} code) and ${right.repoFullName} has ${formatNumber(right.total.lines)} total lines (${formatNumber(right.total.code)} code), counted with tokei. Totals, language mix, and methodology compared.`;
  const interactiveParams = new URLSearchParams({ left: gitHubUrl(entry.left), right: gitHubUrl(entry.right) });
  if (entry.left.ref) interactiveParams.set("leftRef", entry.left.ref);
  if (entry.right.ref) interactiveParams.set("rightRef", entry.right.ref);
  const interactiveHref = `/compare?${interactiveParams.toString()}`;
  const prefill = { left: gitHubUrl(entry.left), right: gitHubUrl(entry.right) };
  if (entry.left.ref) prefill.leftRef = entry.left.ref;
  if (entry.right.ref) prefill.rightRef = entry.right.ref;

  const table = `<table><thead><tr><th>Metric</th><th><a href="${escapeAttr(left.publicPath)}">${escapeHtml(left.repoFullName)}</a></th><th><a href="${escapeAttr(right.publicPath)}">${escapeHtml(right.repoFullName)}</a></th></tr></thead><tbody>${[
    ["Files", left.total.files, right.total.files],
    ["Total lines", left.total.lines, right.total.lines],
    ["Code lines", left.total.code, right.total.code],
    ["Comment lines", left.total.comments, right.total.comments],
    ["Blank lines", left.total.blanks, right.total.blanks],
    ["Languages counted", left.languages.length, right.languages.length],
  ]
    .map(([label, leftValue, rightValue]) => `<tr><td>${label}</td><td>${formatNumber(leftValue)}</td><td>${formatNumber(rightValue)}</td></tr>`)
    .join("")}</tbody></table>`;
  const internalLinks = `<nav aria-label="Related OctoCounts pages"><ul>
    <li><a href="/compare">Interactive repository comparison</a></li>
    <li><a href="/recent">Recently analyzed repositories</a></li>
    <li><a href="/popular">Popular SLOC reports</a></li>
    <li><a href="/trending">Trending GitHub repositories</a></li>
    <li><a href="/hall-of-monoliths">Hall of Monoliths</a></li>
    <li><a href="/docs/github-sloc-counter">GitHub SLOC counter guide</a></li>
    <li><a href="/docs/methodology">Counting methodology</a></li>
    <li><a href="/docs/api">OctoCounts API docs</a></li>
  </ul></nav>`;
  const bodyContent = `<section><h1>${escapeHtml(entry.name)}: source lines of code compared</h1>${compareSummary(left, right, leftDate, rightDate)}${table}${compareLanguageMix(left, right)}${compareMethodology(left, right, leftDate, rightDate)}<p>Evidence and next steps:</p><ul>
    <li><a href="${escapeAttr(left.publicPath)}">${escapeHtml(left.repoFullName)} SLOC report</a></li>
    <li><a href="${escapeAttr(right.publicPath)}">${escapeHtml(right.repoFullName)} SLOC report</a></li>
    <li><a href="${escapeAttr(interactiveHref)}">Compare ${escapeHtml(left.repoFullName)} and ${escapeHtml(right.repoFullName)} interactively</a></li>
  </ul><p>Note: code size is not code quality. OctoCounts only reports reproducible line counts and makes no claim that either project is better.</p>${internalLinks}</section>`;

  return injectHeadAndNoscript(index, {
    title,
    description,
    canonical,
    robots: "index,follow,max-image-preview:large,max-snippet:-1",
    ogImage: "https://octocounts.com/og-image.jpg",
    jsonLd: compareJsonLd(entry, left, right, canonical, description),
    extraHead: `<script type="application/json" id="octocounts-compare-prefill">${escapeScriptJson(prefill)}</script>`,
    bodyContent,
  });
}

function gitHubUrl(target) {
  return `https://github.com/${target.owner}/${target.repo}`;
}

function compareSummary(left, right, leftDate, rightDate) {
  const leftCode = Math.max(Number(left.total.code) || 0, 1);
  const rightCode = Math.max(Number(right.total.code) || 0, 1);
  const ratio = leftCode >= rightCode ? leftCode / rightCode : rightCode / leftCode;
  const sizePhrase = ratio < 1.15
    ? `${left.repoFullName} and ${right.repoFullName} are similar in size by code lines`
    : `${leftCode >= rightCode ? left.repoFullName : right.repoFullName} is about ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}x the size of ${leftCode >= rightCode ? right.repoFullName : left.repoFullName} by code lines`;
  return `<p>As of ${escapeHtml(leftDate)}, ${escapeHtml(left.repoFullName)} contains ${formatNumber(left.total.lines)} total lines (${formatNumber(left.total.code)} code) across ${formatNumber(left.total.files)} files, while ${escapeHtml(right.repoFullName)} contains ${formatNumber(right.total.lines)} total lines (${formatNumber(right.total.code)} code) across ${formatNumber(right.total.files)} files as of ${escapeHtml(rightDate)}. ${escapeHtml(sizePhrase)}. Code size is not code quality: a larger count only means more source material, not a better or worse project.</p>`;
}

function compareLanguageMix(left, right) {
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
  return `<p>Top languages in ${escapeHtml(left.repoFullName)}: ${escapeHtml(format(left, leftTop))}. Top languages in ${escapeHtml(right.repoFullName)}: ${escapeHtml(format(right, rightTop))}. ${escapeHtml(difference)}</p>`;
}

function topLanguages(report, count) {
  return [...report.languages].sort((a, b) => b.stats.code - a.stats.code).slice(0, count);
}

function compareMethodology(left, right, leftDate, rightDate) {
  return `<p>Methodology: both counts come from cached OctoCounts reports generated with tokei. ${escapeHtml(left.repoFullName)} was counted at ref ${escapeHtml(left.refName)} (commit ${escapeHtml(left.commitSha.slice(0, 12))}) on ${escapeHtml(leftDate)}; ${escapeHtml(right.repoFullName)} was counted at ref ${escapeHtml(right.refName)} (commit ${escapeHtml(right.commitSha.slice(0, 12))}) on ${escapeHtml(rightDate)}. See the <a href="/docs/methodology">counting methodology</a> for ignored directories and analysis options.</p>`;
}

function compareJsonLd(entry, left, right, canonical, description) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Dataset",
        "@id": `${canonical}#dataset`,
        name: `${entry.name} source line count comparison`,
        description,
        url: canonical,
        dateModified: left.generatedAt > right.generatedAt ? left.generatedAt : right.generatedAt,
        measurementTechnique: "tokei via OctoCounts",
        variableMeasured: ["files", "lines", "code", "comments", "blanks", "languages"],
        creator: {
          "@type": "Organization",
          name: "OctoCounts",
          url: "https://octocounts.com/",
        },
        isBasedOn: [left.canonicalUrl, right.canonicalUrl],
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${canonical}#breadcrumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "OctoCounts", item: "https://octocounts.com/" },
          { "@type": "ListItem", position: 2, name: "Compare", item: "https://octocounts.com/compare" },
          { "@type": "ListItem", position: 3, name: entry.name, item: canonical },
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
    bodyContent: `<section><h1>${escapeHtml(entry.name)}: source lines of code compared</h1><p>A cached OctoCounts report is not available for both repositories yet, so this comparison cannot be rendered. Open this page with JavaScript enabled to run the analyses, then revisit this page.</p></section>`,
  });
}

async function sitemapResponse(context) {
  const response = await fetch(`${apiBase(context)}/api/seo/sitemap`, {
    headers: { accept: "application/json" },
  });
  const dynamicEntries = response.ok ? await response.json() : [];
  const snapshot = await trendingSnapshot(context);
  const curatedEntries = COMPARE_REGISTRY.map((entry) => ({
    loc: `https://octocounts.com/compare/${entry.slug}`,
    lastmod: STATIC_SITEMAP_LASTMOD,
  }));
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

function injectReport(index, report, apiBaseUrl) {
  const top = report.topLanguage ? ` (${report.topLanguage.name} ${report.topLanguage.percent.toFixed(1)}%)` : "";
  // Answer engines quote self-contained opening sections; the citation alone
  // (~45 words) is the quotable core and this lead brings the section to the
  // ~150-word band that correlates with citation, covering method and
  // reproducibility without depending on the rest of the page.
  const lead = `<p>OctoCounts produced this report by resolving ${escapeHtml(report.repoFullName)} to commit ${escapeHtml(report.commitSha.slice(0, 12))}, downloading the repository source archive, and counting every source file with tokei, the open-source line counter written in Rust. The table below breaks the count down by programming language into files, total lines, code lines, comment lines, and blank lines, so the figures can be compared across languages and projects. Results are cached by commit, tokei version, and analysis options, so counting the same revision again reproduces exactly these numbers.</p>`;
  const rows = report.languages
    .map(
      (language) => `<tr><td>${escapeHtml(language.name)}</td><td>${language.stats.files}</td><td>${language.stats.lines}</td><td>${language.stats.code}</td><td>${language.stats.comments}</td><td>${language.stats.blanks}</td></tr>`
    )
    .join("");
  const faq = reportFaq(report);
  const faqHtml = `<section><h2>Report FAQ</h2>${faq
    .map((item) => `<h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p>`)
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
  const table = `<section><h1>${escapeHtml(report.repoFullName)} SLOC report</h1><p>${escapeHtml(report.citation)}</p>${lead}${reportInsights(report)}<table><thead><tr><th>Language</th><th>Files</th><th>Lines</th><th>Code</th><th>Comments</th><th>Blanks</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  const jsonSummary = reportSummaryJson(report);
  return injectHeadAndNoscript(index, {
    title: report.title,
    description: report.description,
    canonical: report.canonicalUrl,
    robots: "index,follow,max-image-preview:large,max-snippet:-1",
    ogImage: `${apiBaseUrl}/og/${encodeURIComponent(report.provider)}/${encodeURIComponent(report.owner)}/${encodeURIComponent(report.repo)}`,
    jsonLd: reportJsonLd(report),
    extraHead: `<script type="application/json" id="octocounts-report-summary">${escapeScriptJson(jsonSummary)}</script>`,
    bodyContent: table + `<p>Top language${escapeHtml(top)}. Generated at ${escapeHtml(report.generatedAt)}.</p>` + faqHtml + internalLinks,
  });
}

function reportInsights(report) {
  const lines = Math.max(Number(report.total.lines) || 0, 1);
  const files = Math.max(Number(report.total.files) || 0, 1);
  const codeRatio = ((Number(report.total.code) || 0) / lines) * 100;
  const commentRatio = ((Number(report.total.comments) || 0) / lines) * 100;
  const codePerFile = (Number(report.total.code) || 0) / files;
  const scale = report.total.code >= 1_000_000 ? "very large" : report.total.code >= 100_000 ? "large" : report.total.code >= 10_000 ? "medium-sized" : "small";
  const concentration = report.topLanguage ? `${report.topLanguage.name} accounts for ${report.topLanguage.percent.toFixed(1)}% of counted code` : "No single top language was identified";
  return `<section><h2>Repository size insights</h2><p>This is a ${scale} codebase by counted code lines. Code represents ${codeRatio.toFixed(1)}% of all lines, comments represent ${commentRatio.toFixed(1)}%, and the repository averages ${formatNumber(Math.round(codePerFile))} code lines per file. ${escapeHtml(concentration)}.</p></section>`;
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

function htmlResponse(html, cacheControl) {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": cacheControl,
      ...securityHeaders(randomNonce()),
    },
  });
}

function withHtmlSecurity(response) {
  if (!response.headers.get("content-type")?.includes("text/html")) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders(randomNonce()))) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function randomNonce() {
  return crypto.randomUUID().replaceAll("-", "");
}

function securityHeaders(nonce = "") {
  const nonceSource = nonce ? ` 'nonce-${nonce}'` : "";
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "strict-transport-security": "max-age=63072000; includeSubDomains",
    "cross-origin-opener-policy": "same-origin",
    "content-security-policy": `default-src 'self'; script-src 'self' ${BOOT_SCRIPT_HASH}${nonceSource} https://cloud.umami.is https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.octocounts.com https://cloud.umami.is https://gateway.umami.is https://cloudflareinsights.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`,
  };
}
