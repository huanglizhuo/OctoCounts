const API_BASE = "https://api.octocounts.com";
const BOOT_SCRIPT_HASH = "'sha256-WRZoCRpV9YaIG5sPOijC2jelInnwDvYw9BYBSfp3VQY='";
const STATIC_SITEMAP_ENTRIES = [
  { loc: "https://octocounts.com/" },
  { loc: "https://octocounts.com/stats" },
  { loc: "https://octocounts.com/recent" },
  { loc: "https://octocounts.com/popular" },
  { loc: "https://octocounts.com/trending" },
  { loc: "https://octocounts.com/hall-of-monoliths" },
  { loc: "https://octocounts.com/launch-kit.html" },
  { loc: "https://octocounts.com/docs/github-sloc-counter" },
  { loc: "https://octocounts.com/docs/api" },
  { loc: "https://octocounts.com/docs/methodology" },
  { loc: "https://octocounts.com/llms.txt" },
  { loc: "https://octocounts.com/llms-full.txt" },
  { loc: "https://octocounts.com/privacy" },
  { loc: "https://octocounts.com/contact" },
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
  return htmlResponse(injectReport(index, report, apiBase(context)), "public, s-maxage=300, stale-while-revalidate=3600");
}

async function listPageResponse(context, kind, url) {
  const index = await indexHtml(context);
  const page = url.searchParams.get("page") || "1";
  const response = await fetch(`${apiBase(context)}/api/seo/${kind}?page=${encodeURIComponent(page)}`, {
    headers: { accept: "application/json" },
  });
  const payload = response.ok ? await response.json() : { reports: [] };
  const pageMeta = listPageMeta(kind);
  const title = pageMeta.title;
  const description = pageMeta.description;
  const body = payload.reports
    .map(
      (report, index) =>
        `<li><span>${index + 1}.</span> <a href="${escapeAttr(report.publicPath)}">${escapeHtml(report.repoFullName)}</a> — ${escapeHtml(report.description)}</li>`
    )
    .join("");

  return htmlResponse(
    injectHeadAndNoscript(index, {
      title,
      description,
      canonical: pageMeta.canonical,
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
      noscript: `<section><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><ul>${body}</ul></section>`,
    }),
    "public, s-maxage=300, stale-while-revalidate=3600"
  );
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
      noscript: `<section><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p>Source: <a href="https://github.com/trending">GitHub Trending</a>. Snapshot updated <time datetime="${escapeAttr(snapshot.generatedAt)}">${escapeHtml(snapshot.date)}</time>.</p><ol>${body}</ol></section>`,
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
  const totals = stats?.totals
    ? `<ul>
      <li>${formatNumber(stats.totals.reportsGenerated)} reports generated</li>
      <li>${formatNumber(stats.totals.repositoriesAnalyzed)} public repositories analyzed</li>
      <li>${formatNumber(stats.totals.linesCounted)} total lines counted</li>
      <li>${formatNumber(stats.totals.languagesDetected)} languages detected</li>
    </ul>`
    : "<p>Stats are temporarily unavailable.</p>";

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
      noscript: `<section><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>${totals}</section>`,
    }),
    "public, s-maxage=300, stale-while-revalidate=3600"
  );
}

async function sitemapResponse(context) {
  const response = await fetch(`${apiBase(context)}/api/seo/sitemap`, {
    headers: { accept: "application/json" },
  });
  const dynamicEntries = response.ok ? await response.json() : [];
  const snapshot = await trendingSnapshot(context);
  const entries = STATIC_SITEMAP_ENTRIES.map((entry) => entry.loc.endsWith("/trending") ? { ...entry, lastmod: snapshot.date } : entry)
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

function injectReport(index, report, apiBaseUrl) {
  const top = report.topLanguage ? ` (${report.topLanguage.name} ${report.topLanguage.percent.toFixed(1)}%)` : "";
  const rows = report.languages
    .map(
      (language) => `<tr><td>${escapeHtml(language.name)}</td><td>${language.stats.files}</td><td>${language.stats.lines}</td><td>${language.stats.code}</td><td>${language.stats.comments}</td><td>${language.stats.blanks}</td></tr>`
    )
    .join("");
  const faq = reportFaq(report);
  const faqHtml = `<section><h2>Report FAQ</h2>${faq
    .map((item) => `<h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p>`)
    .join("")}</section>`;
  const internalLinks = `<nav aria-label="Related OctoCounts pages"><ul>
    <li><a href="/recent">Recently analyzed repositories</a></li>
    <li><a href="/popular">Popular SLOC reports</a></li>
    <li><a href="/trending">Trending GitHub repositories</a></li>
    <li><a href="/hall-of-monoliths">Hall of Monoliths</a></li>
    <li><a href="/docs/github-sloc-counter">GitHub SLOC counter guide</a></li>
    <li><a href="/docs/methodology">Counting methodology</a></li>
    <li><a href="/docs/api">OctoCounts API docs</a></li>
  </ul></nav>`;
  const table = `<section><h1>${escapeHtml(report.repoFullName)} SLOC report</h1><p>${escapeHtml(report.citation)}</p>${reportInsights(report)}<table><thead><tr><th>Language</th><th>Files</th><th>Lines</th><th>Code</th><th>Comments</th><th>Blanks</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  const jsonSummary = reportSummaryJson(report);
  return injectHeadAndNoscript(index, {
    title: report.title,
    description: report.description,
    canonical: report.canonicalUrl,
    robots: "index,follow,max-image-preview:large,max-snippet:-1",
    ogImage: `${apiBaseUrl}/og/${encodeURIComponent(report.provider)}/${encodeURIComponent(report.owner)}/${encodeURIComponent(report.repo)}`,
    jsonLd: reportJsonLd(report),
    extraHead: `<script type="application/json" id="octocounts-report-summary">${escapeScriptJson(jsonSummary)}</script>`,
    noscript: table + `<p>Top language${escapeHtml(top)}. Generated at ${escapeHtml(report.generatedAt)}.</p>` + faqHtml + internalLinks,
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
    noscript: `<section><h1>${escapeHtml(fullName)} SLOC report</h1><p>No cached report exists yet. Open this page with JavaScript enabled to run an analysis.</p></section>`,
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
  html = html.replace('<div id="root"></div>', `<div id="root"></div><noscript>${meta.noscript}</noscript>`);
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
