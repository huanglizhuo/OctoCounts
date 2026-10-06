# GitHub SLOC Counter Guide

Updated October 7, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

OctoCounts is a free SLOC counter for public GitHub repositories. Paste a repository URL, optionally pick a branch, tag, or commit SHA, and OctoCounts downloads the source archive, counts every file with [tokei](https://github.com/XAMPPRocky/tokei), and returns files, total lines, code lines, comments, blanks, and per-language totals. Reports are cached by commit SHA and can be exported as plain text, JSON, or a PNG card, or added to a README as a live badge.

> OctoCounts is a free source lines of code counter for public repositories. It works from a URL, does not clone git history, and reports files, total lines, code, comments, blanks, and language totals.

Canonical page: https://octocounts.com/docs/github-sloc-counter

## What OctoCounts Is Best For

- Quickly estimate the size of an unfamiliar open source repository.
- Compare a dependency, fork, alternative project, branch, tag, or commit.
- Add a live SLOC badge to a README.
- Export language counts as text, JSON, or a social share image.
- Use an API for public repository size checks in internal tools or CI dashboards.

OctoCounts is one option among several. For head-to-head trade-offs see [OctoCounts vs cloc, scc, and tokei](https://octocounts.com/docs/octocounts-vs-cloc); for a wider field including sloccount and GitHub's language bar, see the [best SLOC counter tools](https://octocounts.com/docs/best-sloc-counter-tools) comparison.

## Supported Repository Hosts

| Host | Support | Entry point |
| --- | --- | --- |
| GitHub public repositories | Web app, API, report pages, badges, Chrome extension, Edge extension, Firefox extension | `https://github.com/owner/repo` |
| Private repositories | Not supported | Run `tokei` locally instead |

## tokei online, without installing anything

tokei itself has no official web interface — it is a command-line tool. OctoCounts runs tokei online, free, at commit-pinned URLs: paste a public GitHub repository URL and get the same counts the CLI would produce, pinned to an exact commit. The [tokei online guide](https://octocounts.com/docs/tokei-online) explains when an online run beats the CLI and how the two compare.

## OctoCounts Docs Guides

Every guide in this section, with what each covers:

- [How to count lines of code in a GitHub repository](https://octocounts.com/docs/count-lines-of-code-github) — four practical methods (web counter, browser extension, git commands, API) with exact commands and trade-offs.
- [GitHub repository size checker](https://octocounts.com/docs/github-repository-size-checker) — five ways to check how big a repository is before cloning, with real numbers.
- [Counting methodology](https://octocounts.com/docs/methodology) — the full counting pipeline, cache key, exclusions, and citation format.
- [tokei online](https://octocounts.com/docs/tokei-online) — run tokei on public GitHub repositories without installing it.
- [OctoCounts vs cloc, scc, and tokei](https://octocounts.com/docs/octocounts-vs-cloc) — head-to-head trade-offs against the local counting tools.
- [OctoCounts vs tokei](https://octocounts.com/docs/octocounts-vs-tokei) — web reports vs the local CLI, same counting engine.
- [OctoCounts vs scc](https://octocounts.com/docs/octocounts-vs-scc) — local complexity and COCOMO estimates vs shareable web reports.
- [Best SLOC counter tools compared](https://octocounts.com/docs/best-sloc-counter-tools) — six tools including sloccount and GitHub's built-in language bar.
- [GitHub language bar alternative](https://octocounts.com/docs/github-language-bar-alternative) — why GitHub's byte-based language bar is not a line count.
- [SLOC glossary](https://octocounts.com/docs/glossary) — precise definitions of code lines, comments, blanks, and related terms.
- [OctoCounts API docs](https://octocounts.com/docs/api) — analyze endpoints, report fields, and badge routes.
- [OctoCounts FAQ](https://octocounts.com/docs/faq) — answers about counting, extensions, badges, and the API.

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

The [badges page](https://octocounts.com/badges) documents every badge type and query parameter.

## API

Programmatic users can start an analysis with `POST /api/analyze`, poll `GET /api/jobs/:jobId`, and fetch the result with `GET /api/reports/:reportId`. See the [OctoCounts API docs](https://octocounts.com/docs/api) for request bodies, report fields, and badge routes.

## Privacy and Scope

OctoCounts analyzes public repositories only. It does not request GitHub account access, does not support private repositories, and does not accept source-code uploads. Cached reports contain public repository statistics only.

More questions about counting, extensions, badges, and the API are answered in the [OctoCounts FAQ](https://octocounts.com/docs/faq).
