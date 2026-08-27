# OctoCounts API Docs

Maintained by [huanglizhuo](https://github.com/huanglizhuo)

> OctoCounts analyzes public GitHub repositories only. It does not request GitHub account access, does not support private repositories, and does not accept source-code uploads.

Canonical page: https://octocounts.com/docs/api

## Analyze a Repository

```
POST https://api.octocounts.com/api/analyze
Content-Type: application/json

{
  "repoUrl": "https://github.com/owner/repo",
  "refName": "main",
  "forceRefresh": false,
  "source": "api",
  "options": {
    "profile": "default",
    "ignoredDirs": [],
    "ignoredLanguages": [],
    "includeDocs": true,
    "includeTests": true,
    "includeGenerated": true
  }
}
```

`repoUrl` supports public `github.com` repositories. `refName` may be a branch, tag, or commit SHA. If omitted, OctoCounts uses the repository default branch. `source` is optional and may be `web`, `extension`, `github_action`, `cli`, `mcp`, `api`, `seed`, `github_trending`, or `unknown`; it is used only for aggregate source breakdowns.

## Job Status

```
GET https://api.octocounts.com/api/jobs/:jobId
```

Jobs return `queued`, `running`, `completed`, or `failed`. Completed jobs include `reportId`.

## Report

```
GET https://api.octocounts.com/api/reports/:reportId
```

Reports include repository metadata, pinned commit SHA, tokei version, analysis key, active analysis options, language rows, and totals for files, lines, code, comments, and blanks.

## Public Stats

```
GET https://api.octocounts.com/api/stats
```

Returns aggregate operational stats: total reports generated, unique public repositories analyzed, total lines counted, source breakdown, language totals, recent reports, and largest public repositories. This endpoint does not expose user-level analytics.

## SEO Data and OG Images

```
GET https://api.octocounts.com/api/seo/report?provider=github&owner=owner&repo=repo
GET https://api.octocounts.com/api/seo/recent
GET https://api.octocounts.com/api/seo/popular
GET https://api.octocounts.com/api/seo/monoliths
GET https://api.octocounts.com/api/seo/sitemap
GET https://api.octocounts.com/og/github/:owner/:repo
```

These endpoints power indexable report pages on `octocounts.com`. They return cached report metadata only; they do not start new analyses.

## Badges

```
GET https://api.octocounts.com/badge/:owner/:repo
GET https://api.octocounts.com/badge/:owner/:repo/branch/:branch
GET https://api.octocounts.com/badge/:owner/:repo/tag/:tag
GET https://api.octocounts.com/badge/:owner/:repo/commit/:sha
```

Badge query parameters:

- `type=code`, `lines`, `files`, `comments`, `languages`, `top-language`, or `ratio`
- `lang=Rust` for a single-language code-line badge

## Shareable Web URLs

```
https://octocounts.com/github/:owner/:repo
https://octocounts.com/github/:owner/:repo/tree/:ref
https://octocounts.com/github/:owner/:repo/commit/:sha
https://octocounts.com/compare?left=...&right=...&leftRef=...&rightRef=...
https://octocounts.com/diff?repo=...&base=...&head=...
```

## Methodology and AI Context

For citation details, cache keys, ignored folders, and counting limitations, see the [OctoCounts methodology](https://octocounts.com/docs/methodology). Agent-readable context is available at [/llms.txt](https://octocounts.com/llms.txt) and [/llms-full.txt](https://octocounts.com/llms-full.txt).

[Back to OctoCounts](https://octocounts.com/)
