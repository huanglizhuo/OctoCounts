# GitHub SLOC Counter Guide

Updated August 15, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

> OctoCounts is a free source lines of code counter for public repositories. It works from a URL, does not clone git history, and reports files, total lines, code, comments, blanks, and language totals.

Canonical page: https://octocounts.com/docs/github-sloc-counter

## What OctoCounts Is Best For

- Quickly estimate the size of an unfamiliar open source repository.
- Compare a dependency, fork, alternative project, branch, tag, or commit.
- Add a live SLOC badge to a README.
- Export language counts as text, JSON, or a social share image.
- Use an API for public repository size checks in internal tools or CI dashboards.

## Supported Repository Hosts

| Host | Support | Entry point |
| --- | --- | --- |
| GitHub public repositories | Web app, API, report pages, badges, Chrome extension, Edge extension, Firefox extension | `https://github.com/owner/repo` |
| Private repositories | Not supported | Run `tokei` locally instead |

## How the Count Works

1. OctoCounts validates the public repository URL and resolves the requested branch, tag, or commit SHA.
2. The backend downloads a source archive for that exact ref instead of cloning full git history.
3. The extracted source tree is counted with [tokei](https://github.com/XAMPPRocky/tokei).
4. Generated and heavy dependency folders such as `.git`, `node_modules`, `target`, `dist`, and `vendor` are ignored by default.
5. The report is cached by repository, commit SHA, tokei version, and analysis options.

For the full counting policy, cache key, exclusions, limitations, and citation format, see the [OctoCounts methodology](https://octocounts.com/docs/methodology). Agent-readable context is also available in [/llms.txt](https://octocounts.com/llms.txt) and [/llms-full.txt](https://octocounts.com/llms-full.txt).

## Metrics Explained

| Metric | Meaning |
| --- | --- |
| Files | Source files detected by language rules. |
| Total lines | Code lines + comment lines + blank lines. |
| Code lines | Executable or meaningful source lines after language parsing. |
| Comments | Line and block comments recognized by the language parser. |
| Blanks | Whitespace-only lines. |
| Languages | Detected programming languages and file types, sorted by code lines. |

## Examples

```
https://octocounts.com/?q=https://github.com/huanglizhuo/OctoCounts
https://octocounts.com/github/huanglizhuo/OctoCounts
https://octocounts.com/github/huanglizhuo/OctoCounts/tree/main
https://octocounts.com/compare?left=https://github.com/huanglizhuo/OctoCounts&right=https://github.com/tokio-rs/axum
https://octocounts.com/diff?repo=https://github.com/huanglizhuo/OctoCounts&base=main&head=22c3647
```

## Badges

Use live badges to show repository size in a README:

```
[![OctoCounts](https://api.octocounts.com/badge/huanglizhuo/OctoCounts)](https://octocounts.com/github/huanglizhuo/OctoCounts)
[![Code lines](https://api.octocounts.com/badge/huanglizhuo/OctoCounts?type=code)](https://octocounts.com/github/huanglizhuo/OctoCounts)
[![Rust lines](https://api.octocounts.com/badge/huanglizhuo/OctoCounts?lang=Rust)](https://octocounts.com/github/huanglizhuo/OctoCounts)
```

## API

Programmatic users can start an analysis with `POST /api/analyze`, poll `GET /api/jobs/:jobId`, and fetch the result with `GET /api/reports/:reportId`. See the [OctoCounts API docs](https://octocounts.com/docs/api) for request bodies, report fields, and badge routes.

## Privacy and Scope

OctoCounts analyzes public repositories only. It does not request GitHub account access, does not support private repositories, and does not accept source-code uploads. Cached reports contain public repository statistics only.

## Frequently Asked Questions

### What does OctoCounts count?

OctoCounts counts files, total lines, code lines, comment lines, blank lines, and per-language totals for public GitHub repositories.

### Do I need to clone the repository?

No. OctoCounts downloads the source archive for a branch, tag, or commit SHA, runs tokei on the extracted files, and caches the result by commit and analysis options.

### Does OctoCounts support private repositories?

No. OctoCounts analyzes public repositories only and does not accept source-code uploads or request account access.
