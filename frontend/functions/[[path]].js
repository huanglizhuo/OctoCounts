const API_BASE = "https://api.octocounts.com";
const STATIC_SITEMAP_ENTRIES = [
  { loc: "https://octocounts.com/", lastmod: "2026-07-04", priority: "1.0" },
  { loc: "https://octocounts.com/docs/github-sloc-counter.html", lastmod: "2026-07-04", priority: "0.8" },
  { loc: "https://octocounts.com/docs/api.html", lastmod: "2026-07-04", priority: "0.7" },
  { loc: "https://octocounts.com/llms.txt", lastmod: "2026-07-04", priority: "0.6" },
  { loc: "https://octocounts.com/privacy", lastmod: "2026-07-04", priority: "0.3" },
  { loc: "https://octocounts.com/contact", lastmod: "2026-07-04", priority: "0.3" },
];

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (url.pathname === "/sitemap.xml") {
    return sitemapResponse(context);
  }

  if (parts[0] === "github" && parts.length >= 3) {
    const route = parseGitHubRoute(parts);
    return reportResponse(context, route);
  }

  if (parts[0] === "gitlab" && parts.length >= 3) {
    const route = parseGitLabRoute(parts);
    if (route) return reportResponse(context, route);
  }

  if (url.pathname === "/recent" || url.pathname === "/popular") {
    return listPageResponse(context, url.pathname.slice(1), url);
  }

  return context.env.ASSETS.fetch(context.request);
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

function parseGitLabRoute(parts) {
  const rest = parts.slice(1);
  const markerIndex = rest.findIndex((part, index) => index >= 2 && (part === "tree" || part === "commit"));
  const repoParts = markerIndex === -1 ? rest : rest.slice(0, markerIndex);
  if (repoParts.length < 2) return null;
  return {
    provider: "gitlab",
    owner: repoParts.slice(0, -1).join("/"),
    repo: repoParts[repoParts.length - 1],
    refName: markerIndex === -1 ? "" : rest.slice(markerIndex + 1).join("/"),
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
  return htmlResponse(injectReport(index, report), "public, s-maxage=300, stale-while-revalidate=3600");
}

async function listPageResponse(context, kind, url) {
  const index = await indexHtml(context);
  const page = url.searchParams.get("page") || "1";
  const response = await fetch(`${apiBase(context)}/api/seo/${kind}?page=${encodeURIComponent(page)}`, {
    headers: { accept: "application/json" },
  });
  const payload = response.ok ? await response.json() : { reports: [] };
  const title = kind === "recent" ? "Recently analyzed repositories | OctoCounts" : "Popular SLOC reports | OctoCounts";
  const description =
    kind === "recent"
      ? "Recently analyzed public GitHub and GitLab repositories with source line count reports."
      : "Popular OctoCounts source line count reports for public GitHub and GitLab repositories.";
  const body = payload.reports
    .map((report) => `<li><a href="${escapeAttr(report.publicPath)}">${escapeHtml(report.repoFullName)}</a> — ${escapeHtml(report.description)}</li>`)
    .join("");

  return htmlResponse(
    injectHeadAndNoscript(index, {
      title,
      description,
      canonical: `https://octocounts.com/${kind}`,
      robots: "index,follow,max-image-preview:large,max-snippet:-1",
      ogImage: "https://octocounts.com/og-image.jpg",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: title,
        description,
        url: `https://octocounts.com/${kind}`,
      },
      noscript: `<section><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><ul>${body}</ul></section>`,
    }),
    "public, s-maxage=300, stale-while-revalidate=3600"
  );
}

async function sitemapResponse(context) {
  const response = await fetch(`${apiBase(context)}/api/seo/sitemap`, {
    headers: { accept: "application/json" },
  });
  const dynamicEntries = response.ok ? await response.json() : [];
  const entries = [
    ...STATIC_SITEMAP_ENTRIES,
    ...dynamicEntries.map((entry) => ({ loc: entry.loc, lastmod: entry.lastmod, priority: "0.6" })),
  ];
  const urls = entries
    .map(
      (entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${escapeXml(entry.lastmod)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${entry.priority}</priority>
  </url>`
    )
    .join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

async function indexHtml(context) {
  const url = new URL(context.request.url);
  url.pathname = "/index.html";
  url.search = "";
  const response = await context.env.ASSETS.fetch(new Request(url.toString(), context.request));
  return response.text();
}

function apiBase(context) {
  return context.env.SEO_API_BASE || API_BASE;
}

function injectReport(index, report) {
  const top = report.topLanguage ? ` (${report.topLanguage.name} ${report.topLanguage.percent.toFixed(1)}%)` : "";
  const rows = report.languages
    .map(
      (language) => `<tr><td>${escapeHtml(language.name)}</td><td>${language.stats.files}</td><td>${language.stats.lines}</td><td>${language.stats.code}</td><td>${language.stats.comments}</td><td>${language.stats.blanks}</td></tr>`
    )
    .join("");
  const table = `<section><h1>${escapeHtml(report.repoFullName)} SLOC report</h1><p>${escapeHtml(report.citation)}</p><table><thead><tr><th>Language</th><th>Files</th><th>Lines</th><th>Code</th><th>Comments</th><th>Blanks</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  return injectHeadAndNoscript(index, {
    title: report.title,
    description: report.description,
    canonical: report.canonicalUrl,
    robots: "index,follow,max-image-preview:large,max-snippet:-1",
    ogImage: `${API_BASE}/og/${report.provider}/${report.owner}/${report.repo}`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: `${report.repoFullName} source line count`,
      description: report.description,
      url: report.canonicalUrl,
      dateModified: report.generatedAt,
      measurementTechnique: "tokei via OctoCounts",
      variableMeasured: ["files", "lines", "code", "comments", "blanks", "languages"],
    },
    noscript: table + `<p>Top language${escapeHtml(top)}. Generated at ${escapeHtml(report.generatedAt)}.</p>`,
  });
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
  let html = index;
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

function htmlResponse(html, cacheControl) {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": cacheControl,
    },
  });
}
