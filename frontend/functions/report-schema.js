// Shared by the edge response and the hydrated report; use only displayed report facts.
export function reportJsonLd(report) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Dataset",
        "@id": `${report.canonicalUrl}#dataset`,
        name: `${report.repoFullName} source line count`,
        description: report.description,
        url: report.canonicalUrl,
        dateModified: typeof report.generatedAt === "string" ? report.generatedAt.replace(/(\.\d{3})\d+/, "$1") : report.generatedAt,
        ...(report.analysisKey ? { identifier: report.analysisKey } : {}),
        measurementTechnique: "tokei via OctoCounts",
        variableMeasured: ["files", "lines", "code", "comments", "blanks"].map((name) => ({
          "@type": "PropertyValue", name, value: report.total[name],
        })).concat({ "@type": "PropertyValue", name: "languages", value: report.languages.length }),
        creator: {
          "@type": "Organization",
          "@id": "https://octocounts.com/#organization",
          name: "OctoCounts",
          url: "https://octocounts.com/",
        },
        isBasedOn: { "@id": `${report.canonicalUrl}#source` },
        distribution: {
          "@type": "DataDownload",
          encodingFormat: "application/json",
          contentUrl: report.reportId
            ? `https://api.octocounts.com/api/reports/${encodeURIComponent(report.reportId)}`
            : `https://api.octocounts.com/api/seo/report?${new URLSearchParams({ provider: report.provider, owner: report.owner, repo: report.repo, ...(report.refName ? { refName: report.refName } : {}) })}`,
        },
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": `${report.canonicalUrl}#source`,
        name: report.repoFullName,
        codeRepository: report.htmlUrl,
        url: report.commitSha ? `${report.htmlUrl}/tree/${encodeURIComponent(report.commitSha)}` : report.htmlUrl,
        programmingLanguage: report.languages.map((language) => language.name),
        version: report.commitSha,
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
