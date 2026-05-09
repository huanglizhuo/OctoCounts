<p align="center">
  <img src="images/favicon.png" alt="OctoCounts logo" width="128">
</p>

# OctoCounts – the SLOC panel GitHub forgot

> GitHub shows language bars. OctoCounts shows the actual line counts.

[![Available in the Chrome Web Store](https://img.shields.io/chrome-web-store/v/gkgjpjdnaklagijmekoolhcpebmoldbj?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/octocounts-%E2%80%94-github-sloc/gkgjpjdnaklagijmekoolhcpebmoldbj)

GitHub's sidebar tells you a repo is 62% TypeScript and 18% Rust, but it does not show files, code lines, comments, or blanks. OctoCounts adds that missing SLOC view to public GitHub repositories without cloning anything to your laptop.

Install the Chrome extension to see SLOC directly in GitHub's repo sidebar, or use the web app to paste any public repo URL and get a full report. OctoCounts downloads the archive, runs [tokei](https://github.com/XAMPPRocky/tokei), caches the result by commit SHA, and hands you a sortable breakdown before `git clone` would finish warming up.

## Preview

<p align="center">
  <img src="images/preview.png" alt="OctoCounts extentionpreview">
</p>

## Why?

Sometimes you just want to know whether a repo is 2k lines, 200k lines, or a weekend-devouring monolith. GitHub already has the repo, the language stats, and the sidebar. OctoCounts fills in the missing numbers.

## What it does

- Adds a Chrome extension card to GitHub repo pages with files, total lines, code, comments, blanks, and language count
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

## API

Three endpoints, that's it:

```
POST /api/analyze    { "repoUrl": "...", "refName": "main" }
GET  /api/jobs/:id
GET  /api/reports/:id
```

## Running it

See **[how-to-run-and-deploy.md](how-to-run-and-deploy.md)** for local development setup, host-native instructions, GitHub token configuration, and production deployment.

## License

MIT
