# OctoCounts API Docs

OctoCounts is a free API for counting source lines of code in public GitHub repositories. A client posts a repository URL and an optional branch, tag, or commit SHA to the analyze endpoint, polls the returned job, and fetches a report with files, total lines, code lines, comments, blanks, and per-language totals. No account or API token is required, and reports are cached by commit SHA, tokei version, and analysis options.

Updated September 16, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

> OctoCounts analyzes public GitHub repositories only. It does not request GitHub account access, does not support private repositories, and does not accept source-code uploads.

Canonical page: https://octocounts.com/docs/api

## How do I analyze a public GitHub repository?

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

## How do I check the status of an analysis job?

```
GET https://api.octocounts.com/api/jobs/:jobId
```

Jobs return `queued`, `running`, `completed`, or `failed`. Completed jobs include `reportId`.

## What does an OctoCounts report contain?

```
GET https://api.octocounts.com/api/reports/:reportId
```

Reports include repository metadata, pinned commit SHA, tokei version, analysis key, active analysis options, language rows, and totals for files, lines, code, comments, and blanks.

## What public stats are available?

```
GET https://api.octocounts.com/api/stats
```

Returns aggregate operational stats: total reports generated, unique public repositories analyzed, total lines counted, source breakdown, language totals, recent reports, and largest public repositories. This endpoint does not expose user-level analytics.

## Which endpoints power indexable pages and OG images?

```
GET https://api.octocounts.com/api/seo/report?provider=github&owner=owner&repo=repo
GET https://api.octocounts.com/api/seo/recent
GET https://api.octocounts.com/api/seo/popular
GET https://api.octocounts.com/api/seo/monoliths
GET https://api.octocounts.com/api/seo/sitemap
GET https://api.octocounts.com/og/github/:owner/:repo
```

These endpoints power indexable report pages on `octocounts.com`. They return cached report metadata only; they do not start new analyses.

## How do I generate a SLOC badge for a repository?

```
GET https://api.octocounts.com/badge/:owner/:repo
GET https://api.octocounts.com/badge/:owner/:repo/branch/:branch
GET https://api.octocounts.com/badge/:owner/:repo/tag/:tag
GET https://api.octocounts.com/badge/:owner/:repo/commit/:sha
```

Badge query parameters:

- `type=code`, `lines`, `files`, `comments`, `languages`, `top-language`, or `ratio`
- `lang=Rust` for a single-language code-line badge

## What shareable web URLs does OctoCounts provide?

```
https://octocounts.com/github/:owner/:repo
https://octocounts.com/github/:owner/:repo/tree/:ref
https://octocounts.com/github/:owner/:repo/commit/:sha
https://octocounts.com/compare?left=...&right=...&leftRef=...&rightRef=...
https://octocounts.com/diff?repo=...&base=...&head=...
```

## Where are the methodology and AI-readable context documented?

For citation details, cache keys, ignored folders, and counting limitations, see the [OctoCounts methodology](https://octocounts.com/docs/methodology). Agent-readable context is available at [/llms.txt](https://octocounts.com/llms.txt) and [/llms-full.txt](https://octocounts.com/llms-full.txt).

## Frequently Asked Questions

### Do I need an API key or account to use the OctoCounts API?

No. The OctoCounts API requires no GitHub account access, no API token, and no sign-up. It analyzes public github.com repositories only, does not support private repositories, and does not accept source-code uploads.

### How do I analyze a public GitHub repository?

POST `https://api.octocounts.com/api/analyze` with a JSON body containing `repoUrl` and optionally `refName`, `forceRefresh`, `source`, and analysis options. `refName` may be a branch, tag, or commit SHA; if omitted, OctoCounts uses the repository default branch.

### How do I check the status of an analysis job?

Poll `GET https://api.octocounts.com/api/jobs/:jobId`. Jobs return `queued`, `running`, `completed`, or `failed`, and completed jobs include a `reportId` that you pass to the report endpoint.

### What does an OctoCounts report contain?

`GET https://api.octocounts.com/api/reports/:reportId` returns repository metadata, the pinned commit SHA, the tokei version used, the analysis key, the active analysis options, per-language rows, and totals for files, lines, code, comments, and blanks.

### How do I add a SLOC badge to my README?

Request `https://api.octocounts.com/badge/:owner/:repo` with optional `type` parameters (`code`, `lines`, `files`, `comments`, `languages`, `top-language`, or `ratio`) and optional branch, tag, or commit path segments. Wrap the badge URL in a Markdown image that links to the permanent OctoCounts report page.

### What shareable URLs does OctoCounts provide?

Every analyzed repository gets permanent web URLs such as `https://octocounts.com/github/:owner/:repo`, plus ref, compare, and diff URLs, so a report can be cited and shared without re-running the analysis.

[Back to OctoCounts](https://octocounts.com/)
