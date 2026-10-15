# GitHub SLOC Counter Guide

Updated October 15, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

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

## What does an OctoCounts report show?

A worked example: the [live report for React](https://octocounts.com/github/react/react), counted October 15, 2026 at commit `99c106c43439` with the default public configuration (tests, docs, and generated files excluded), reads: **2,132 files, 460,757 total lines — 364,991 code, 59,409 comments, 36,357 blanks — across 11 languages, JavaScript leading at 63.5% of code**, with TypeScript, Rust, CSS, and the rest broken out per language in a table below the summary. Every report shows the same shape:

- **Summary card:** files, total lines, code, comments, blanks, and language count, with the commit SHA and tokei version it was counted at.
- **Per-language table:** files, total lines, code, comments, and blanks per language, sorted by code lines.
- **Reproducibility block:** the analysis options that produced the numbers, so a reader can rerun them (see [methodology](https://octocounts.com/docs/methodology)).
- **Exports and next steps:** text/JSON/PNG export, README [badges](https://octocounts.com/badges), per-repo compare and diff links.

## How the count is produced

1. The repository URL is validated and the requested branch, tag, or commit SHA is resolved to an exact commit.
2. The backend downloads the compressed source archive of that commit — not the git history.
3. The extracted tree is counted with tokei, skipping heavy dependency and build folders such as `node_modules`, `target`, `dist`, and `vendor` by default.
4. The report is cached by repository, commit SHA, tokei version, and analysis options — recounting the same commit returns the identical numbers.

The full pipeline, including how counting policy metadata and optional repository-declared filtering (`.gitattributes` linguist markers) work, is documented in the [counting methodology](https://octocounts.com/docs/methodology).

## How accurate is an OctoCounts count?

Exact for what it measures. A report is a precise count of the downloaded source archive under the stated options — same commit, same tokei version, same options on your machine returns the same numbers, because it is the same program reading the same bytes. What it is *not*: a measure of git history, generated artifacts excluded by the options, private code, or code quality. Two honest caveats when you quote counts: state the configuration (including or excluding tests alone can move a total by 20–50% — measured in the [filtering-effects pilot study](https://octocounts.com/research)), and name the commit, since a default branch moves daily. The [SLOC glossary](https://octocounts.com/docs/glossary) defines each reported category precisely.

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
- [Count lines of code without cloning](https://octocounts.com/docs/count-lines-without-cloning) — archive-based counting for when a full clone is overkill.
- [Can the GitHub API count lines of code?](https://octocounts.com/docs/github-api-count-lines) — what the API can't do, and the API routes that return real line counts.
- [GitHub repository size checker](https://octocounts.com/docs/github-repository-size-checker) — five ways to check how big a repository is before cloning, with real numbers.
- [How many lines of code? The largest codebases, counted](https://octocounts.com/docs/largest-codebases) — first-party counts for linux, Firefox, LLVM, and friends, pinned to commits.
- [Counting methodology](https://octocounts.com/docs/methodology) — the full counting pipeline, cache key, exclusions, and citation format.
- [tokei online](https://octocounts.com/docs/tokei-online) — run tokei on public GitHub repositories without installing it.
- [tokei vs cloc vs scc](https://octocounts.com/docs/tokei-vs-cloc-vs-scc) — the three popular open-source counters compared side by side.
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

## Comparing repositories, branches, or commits

Line counts answer "how big is this?" — comparisons answer "how big *relative to what?*". The [compare tool](https://octocounts.com/compare) puts two public repositories side by side with their language tables: a framework against its rival, a fork against upstream, or a dependency against its alternative. The [diff tool](https://octocounts.com/diff) tracks a single repository across refs or commits — how much a release grew, what a feature branch added. Both work from the same commit-pinned reports, so a comparison link shows the exact snapshots that were compared. There is also a curated hub of pre-built comparisons for popular pairs, from [React vs Vue](https://octocounts.com/compare/react-vs-vue) to [Rust vs Go](https://octocounts.com/compare/rust-vs-go).

## API

Programmatic users can start an analysis with `POST /api/analyze`, poll `GET /api/jobs/:jobId`, and fetch the result with `GET /api/reports/:reportId`. See the [OctoCounts API docs](https://octocounts.com/docs/api) for request bodies, report fields, and badge routes.

## Privacy and Scope

OctoCounts analyzes public repositories only. It does not request GitHub account access, does not support private repositories, and does not accept source-code uploads. Cached reports contain public repository statistics only.

More questions about counting, extensions, badges, and the API are answered in the [OctoCounts FAQ](https://octocounts.com/docs/faq).

## GitHub SLOC counter FAQ

### Is OctoCounts free?

Yes. The web app, report pages, badges, API, CLI, GitHub Action, and MCP server are free to use, with no account or sign-up. OctoCounts analyzes public github.com repositories only, does not request GitHub account access, and does not accept source-code uploads.

### Does OctoCounts clone the repository?

No. OctoCounts downloads the compressed source archive of the exact commit it resolves — not the full git history — which is why a first analysis usually finishes in seconds and a repeat analysis of the same commit is instant. The report records the commit SHA, the tokei version, and the analysis options it was counted with.

### Which repositories can OctoCounts count?

Any public github.com repository, at a branch, tag, or commit SHA you choose. Private repositories are not supported and source uploads are not accepted; for private code, run tokei or cloc locally in your checkout.

### How do I cite an OctoCounts count?

Cite tool, options, commit, and date, then link the report: for example, "torvalds/linux has 32,360,324 code lines (counted 2026-10-14 at commit `4056b3c9d3c9`, tests/docs/generated excluded, via OctoCounts/tokei): [octocounts.com/github/torvalds/linux](https://octocounts.com/github/torvalds/linux)". Every report page includes a copyable citation in exactly this shape, generated from the report's own metadata.

### What is the difference between code lines and total lines?

Total lines are code lines plus comment lines plus blank lines. "SLOC" usually means the code-line figure — executable or meaningful source lines after language parsing. OctoCounts reports all three categories side by side, per language and in the totals row, so any of the three definitions can be quoted from the same report.
