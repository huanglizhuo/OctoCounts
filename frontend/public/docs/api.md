# OctoCounts API Docs

OctoCounts is a free API for counting source lines of code in public GitHub repositories. A client posts a repository URL and an optional branch, tag, or commit SHA to the analyze endpoint, polls the returned job, and fetches a report with files, total lines, code lines, comments, blanks, and per-language totals. No account or API token is required, and reports are cached by commit SHA, tokei version, and analysis options.

Updated October 25, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

> OctoCounts analyzes public GitHub repositories only. Analysis does not require GitHub account access, does not support private repositories, and does not accept source-code uploads.

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

`repoUrl` supports public `github.com` repositories. `refName` may be a branch, tag, or commit SHA. If omitted, OctoCounts uses the repository default branch. `source` is optional and may be `web`, `extension`, `github_action`, `cli`, `mcp`, `api`, `seed`, `github_trending`, `sloc_backfill`, or `unknown`; it is used only for aggregate source breakdowns.

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

## How should API and CI clients handle failures?

Use GET /api/jobs/:jobId?wait=20 to long-poll. The server caps wait at 25 seconds and responds on a status change; terminal jobs return immediately. Allow at least 30 seconds per request and a bounded total deadline. OctoCounts CLI, Action and MCP clients use a five-minute total deadline, including retries and polling.

Inspect both the HTTP status and JSON code. 429 and upstream 503 responses include Retry-After, in seconds or HTTP-date format. Read-only GET requests may retry 429, 500, 502, 503 and 504 with a bounded backoff; permanent 4xx errors should fail immediately. The bundled clients allow three retries. A POST may be retried only when the response explicitly contains requestAccepted: false. Never replay an analyze POST after an ambiguous network failure, or automatically replay a GitHub comment write.

Keep jobId after submission. If polling fails or times out, resume with GET /api/jobs/:jobId rather than submitting again; a completed job supplies reportId. A 404 means that saved record is unavailable. Default analyze limits are 5 requests/minute per IP with burst 10; forceRefresh has an additional 2/minute limit with burst 2. Limits are configurable and apply per backend instance, not globally across instances.


## How do I keep shared counts consistent?

Fixed report links add ?reportId=:reportId to a commit URL. GET /api/reports/:reportId and GET /api/reports/:reportId/badge.svg read that saved result; the badge also accepts type and lang. An iframe at /embed/github/:owner/:repo?reportId=:reportId reads the same result. Compare links use leftReportId and rightReportId; diff links use baseReportId and headReportId. Both include analysis options and resolved commit SHAs.

Saved IDs bind measured counts and counting policy. Storage is a cache with retention and size limits: a saved record can expire or be replaced, so fixed links are not a permanent archive. Missing fixed links, badges and embeds show unavailable instead of starting a new analysis. Save the JSON or exported text if long-term archival matters.

Live ref links, live badges and live embeds use the canonical public options: default profile, docs/tests/generated directory exclusions, empty custom ignores and repository declarations off. They follow the selected ref and may update at different times because of caching. Share uses fixed results by default; choose live mode explicitly. A comparison is marked unknown if either report lacks countingPolicy; matching options alone do not prove that an old report used the same rules.


## How do I opt into repository-declared filtering?

Set options.respectGitattributes to true and options.includeGenerated to false to exclude files declared linguist-generated in .gitattributes. Files declared linguist-vendored are excluded whenever this mode is enabled. IncludeGenerated: true keeps generated declarations; source-only still excludes them. Off is the default and keeps existing cache keys and counting behavior.

Specify all inclusion toggles when constructing options: omitting options entirely uses canonical exclusions; an explicitly empty options object retains the existing include-all toggle defaults. Git evaluates nested declarations, macros, quoted paths, unset and unspecified overrides. Only set or true activates exclusion. Directory exclusions run first and cannot be restored by declarations. This mode reads repository declarations only and does not implement the full GitHub Linguist classifier.

New reports include countingPolicy with effective rules and repositoryAttributes.status (off, not_found or applied), plus generatedFiles, vendoredFiles and excludedFiles. These are files removed by declaration filtering after extraction, not source-line totals; overlapping generated/vendored exclusions count once in excludedFiles. Old reports may omit countingPolicy and must be displayed as unknown. Filtering failures fail the analysis rather than silently using other rules.

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

Request `https://api.octocounts.com/badge/:owner/:repo` with optional `type` parameters (`code`, `lines`, `files`, `comments`, `languages`, `top-language`, or `ratio`) and optional branch, tag, or commit path segments. Wrap the badge URL in a Markdown image that links to the live OctoCounts report page.

### What shareable URLs does OctoCounts provide?

Every analyzed repository gets live web URLs such as `https://octocounts.com/github/:owner/:repo`, plus ref, compare, and diff URLs, so a report can be cited and shared without re-running the analysis.

[Back to OctoCounts](https://octocounts.com/)
