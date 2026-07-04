<p align="center">
  <img src="images/favicon.png" alt="OctoCounts logo" width="64">
</p>

# OctoCounts – GitHub SLOC Counter

> GitHub shows language bars. OctoCounts shows the actual line counts.

[![Available in the Chrome Web Store](https://img.shields.io/chrome-web-store/v/gkgjpjdnaklagijmekoolhcpebmoldbj?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/octocounts-%E2%80%94-github-sloc/gkgjpjdnaklagijmekoolhcpebmoldbj)
[![Available in Firefox Add-ons](https://img.shields.io/amo/v/octocounts-github-sloc?label=Firefox%20Add-ons&logo=firefox&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/octocounts-github-sloc/)

[![OctoCounts](https://api.octocounts.com/badge/huanglizhuo/OctoCount)](https://octocounts.com/?q=https://github.com/huanglizhuo/OctoCount)

GitHub's sidebar shows language percentages, but misses actual file and line counts. OctoCounts adds this missing SLOC (Source Lines of Code) view to public repos without cloning.

Install the extension for instant stats directly on GitHub, or use the web app for public GitHub repositories. It downloads the repo archive, runs [tokei](https://github.com/XAMPPRocky/tokei), and caches the results—delivering a breakdown faster than `git clone`.

## Preview

<p align="center">
  <img src="images/preview.png" alt="OctoCounts extentionpreview">
</p>

## Why?

Sometimes you just want to know whether a repo is 2k lines, 200k lines, or a weekend-devouring monolith. GitHub already has the repo, the language stats, and the sidebar. OctoCounts fills in the missing numbers.

## What it does

- Adds a browser extension card to GitHub repo pages with files, total lines, code, comments, blanks, and language count
- Provides a web app where you can paste any public GitHub repo URL
- Resolves any branch, tag, or commit SHA — pins results to an exact commit so the cache is actually meaningful
- Downloads the GitHub archive tarball instead of cloning (much faster, no git history overhead)
- Counts files, lines, code, comments, and blanks per language via tokei
- Caches reports by `owner + repo + commit + tokei version` — repeat runs are instant
- Queues analysis jobs so concurrent requests don't bring the server to its knees
- Exports reports as plain text, JSON, or a shareable PNG card

## Stack

| Layer | Tech |
|---|---|
| Backend | Rust · Axum · Tokio · SQLx · Postgres · tokei |
| Frontend | React · TypeScript · Vite · TanStack Query |
| Infra | Docker Compose (dev + prod configs) |

## Badges

Drop a live SLOC badge into any README:

```markdown
<!-- Default branch — full SLOC summary -->
[![SLOC](https://api.octocounts.com/badge/:owner/:repo)](https://octocounts.com/?q=https://github.com/:owner/:repo)

<!-- Specific branch -->
[![SLOC](https://api.octocounts.com/badge/:owner/:repo/branch/:branch)](https://octocounts.com/?q=https://github.com/:owner/:repo)

<!-- Specific tag (immutable, cached forever) -->
[![SLOC](https://api.octocounts.com/badge/:owner/:repo/tag/:tag)](https://octocounts.com/?q=https://github.com/:owner/:repo)

<!-- Specific commit SHA (immutable, cached forever) -->
[![SLOC](https://api.octocounts.com/badge/:owner/:repo/commit/:sha)](https://octocounts.com/?q=https://github.com/:owner/:repo)
```

Add `?lang=<language>` to any of the above to get a per-language badge instead:

```markdown
<!-- Lines of code for a single language -->
[![Rust](https://api.octocounts.com/badge/:owner/:repo?lang=rust)](https://octocounts.com/?q=https://github.com/:owner/:repo)
[![Rust](https://api.octocounts.com/badge/:owner/:repo/branch/:branch?lang=rust)](https://octocounts.com/?q=https://github.com/:owner/:repo)
```

Language names are case-insensitive (`rust`, `Rust`, and `RUST` all work). If a language is not found in the report the badge shows `—`. While a fresh analysis is running the badge shows `···` — most badge CDNs will retry automatically.

| Cache behaviour | Header |
|---|---|
| Default branch / branch | `s-maxage=3600, stale-while-revalidate=86400` |
| Tag / commit | `max-age=31536000, immutable` |

## API

```
POST /api/analyze          { "repoUrl": "...", "refName": "main" }
GET  /api/jobs/:id
GET  /api/reports/:id

GET  /badge/:owner/:repo
GET  /badge/:owner/:repo/branch/:branch
GET  /badge/:owner/:repo/tag/:tag
GET  /badge/:owner/:repo/commit/:sha
```

All badge routes accept an optional `?lang=<language>` query parameter that switches the response from the full SLOC summary badge to a per-language shields.io-style badge.


## Running it

See **[how-to-run-and-deploy.md](how-to-run-and-deploy.md)** for local development setup, host-native instructions, GitHub token configuration, and production deployment.

## License

[MIT](LICENSE)
