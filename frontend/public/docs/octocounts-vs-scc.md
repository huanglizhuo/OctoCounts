# OctoCounts vs scc

Updated November 5, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

[scc](https://github.com/boyter/scc) is a free, open-source command-line counter written in Go: point it at a directory on your machine and it reports files, lines, and comments per language, plus features OctoCounts does not provide — cyclomatic complexity estimates, COCOMO effort estimates, and duplicate-file filtering. [OctoCounts](https://octocounts.com/) is a web service for public GitHub repositories: paste a URL and it downloads the source archive, runs [tokei](https://github.com/XAMPPRocky/tokei), and returns a report pinned to an exact commit SHA with sharing, badges, and an API. The short version: scc for deep local analysis of code you already have; OctoCounts for a no-install, shareable count of a public GitHub repository.

These are different engines, not the same counter in two wrappers — OctoCounts runs tokei, not scc. Their totals can differ because the parsers and effective counting rules differ.

## Quick comparison

| | scc (CLI) | OctoCounts (web) |
|---|---|---|
| What it is | Command-line tool (Go), single binary | Web app + extensions + API, running tokei server-side |
| Install | Download a release binary or use a package manager | None — paste a URL |
| Input | Any directory on local disk | Public github.com repositories, any branch/tag/commit |
| Private code | Yes | No |
| Line counts | Files, code, comments, blanks per language | Files, code, comments, blanks per language (tokei) |
| Extra metrics | Cyclomatic complexity, COCOMO estimate, duplicate-file filtering | Language mix, comment share, [two-repo comparison](https://octocounts.com/compare), [branch diff](https://octocounts.com/diff) |
| Commit pinning | Whatever checkout you scan | Every report pinned to an exact commit SHA |
| Sharing | Terminal table; many output formats (CSV, JSON, HTML, SQL) | Stable report URL, PNG card, [README badges](https://octocounts.com/badges), [API](https://octocounts.com/docs/api) |

## Where scc wins

scc's pitch is more than raw counts. Its README describes it as a fast, accurate code counter with complexity calculations and COCOMO estimation, built as a dependency-free Go binary that runs on Windows, macOS, and Linux. Its documented capabilities include:

- **Cyclomatic complexity estimates** per language and file — a rough signal of branchy, hard-to-test code that pure line counts cannot express.
- **COCOMO estimates** — the classic Constructive Cost Model arithmetic applied to the count, producing an effort/schedule guess. Treat it as a conversation starter, not an estimate of what the code actually cost.
- **Duplicate-file filtering** — the --no-duplicates option excludes identical files from counts; this is not a general detector for repeated code blocks.
- **Output plumbing** — scc renders results in many formats (including CSV, JSON, HTML, and SQL), which makes it a good citizen in local scripts and reporting pipelines.

Like every CLI in this space, scc needs the code on disk first: use a checkout, an extracted source archive, or an existing source directory, then scan it. That is the right shape for private code, air-gapped machines, and any workflow where the analysis lives next to the code.

## Where OctoCounts wins

OctoCounts removes the setup and the clone. Paste a public GitHub repository URL — optionally with a branch, tag, or commit — and the analysis runs server-side: OctoCounts downloads that revision's compressed source archive (not the full git history), counts it with tokei, and caches the result.

- **Nothing to install,** and the repository never touches your disk.
- **Commit-pinned, reproducible reports:** each report names its commit SHA and tokei version, so the number can be re-derived and cited — useful in PRs, papers, and audits.
- **Sharing built in:** a stable URL, a PNG card, text/JSON export, and live [README badges](https://octocounts.com/badges); the [API](https://octocounts.com/docs/api), CLI, GitHub Action, and MCP server cover automation.
- **Comparisons:** put two repositories side by side at [/compare](https://octocounts.com/compare) or diff two refs at [/diff](https://octocounts.com/diff) — no local scripting required.
- **Limitation:** public GitHub repositories only. Private code and non-GitHub forges stay in CLI territory.

## Why the totals can differ

scc and OctoCounts can return different totals for the same repository; this page does not measure a typical difference. They are different programs with different language-detection heuristics: which extension maps to which language, how comments are recognized per syntax, how generated or minified files are treated, and which files are classified out entirely. Different commits and option sets can also change the result. Exact agreement is possible, but must be checked rather than assumed. The practical rule: compare a tool against itself over time, and when a number needs to be defended publicly, cite one tool's output with its engine, version, and revision — an OctoCounts report does this by carrying the commit SHA and tokei version on the page.

## Which one should I use?

| Scenario | Reach for |
|---|---|
| Quick public-repo count with nothing installed | OctoCounts |
| Shareable, commit-pinned citation for a PR or report | OctoCounts |
| README badge that tracks the cached report | OctoCounts [badges](https://octocounts.com/badges) |
| Side-by-side comparison of two public repos | OctoCounts [/compare](https://octocounts.com/compare) |
| Complexity or COCOMO estimates alongside counts | scc |
| Duplicate-file filtering | scc |
| CSV/JSON/SQL output piped into local reporting | scc |
| Private repositories or non-GitHub code | scc (or tokei, or cloc) |
| Air-gapped machine | scc |

**Bottom line:** the tools overlap only on "count lines in code." If the metric you want is complexity, duplication, or local pipeline output, scc has no web equivalent here. If the metric is a defensible line count for a public GitHub repository that you can link instead of paste, OctoCounts gets there with no install and no clone.

## Frequently Asked Questions

### What is the difference between OctoCounts and scc?

scc is a free, open-source command-line counter written in Go and distributed from [github.com/boyter/scc](https://github.com/boyter/scc). It counts files, lines, and comments per language and adds metrics OctoCounts does not produce: cyclomatic complexity estimates, COCOMO effort estimates, and duplicate-file filtering. OctoCounts is a web service for public GitHub repositories: paste a URL and it downloads the source archive, runs tokei, and returns a commit-pinned, shareable report with badges and an API. Neither tool requires an account.

### Why do scc and OctoCounts give different numbers for the same repository?

They run different counting engines with different language-detection and classification rules: scc identifies and counts files its own way, while OctoCounts runs tokei. Line counters disagree on edge cases — how a file extension maps to a language, which lines count as code versus comments, and which files count at all. Totals can also differ because they were taken at different commits or with different options. Compare a tool against itself across time; do not expect two engines to match to the line.

### Does scc have a web UI?

No. scc is distributed as a command-line binary from [github.com/boyter/scc](https://github.com/boyter/scc) and ships no hosted web service. For public GitHub repositories, OctoCounts fills the no-install niche: a URL in a browser produces the report, pinned to a commit SHA, with a shareable page, PNG card, text and JSON export, and README badges. For local or private code, scc and tokei both run from the terminal.

### Which is faster, scc or OctoCounts?

There is no published benchmark comparing the two, so this page makes no speed claim. What can be stated is mechanism: scc scans a directory already on your disk as a compiled Go binary, while OctoCounts downloads a repository's compressed source archive server-side instead of cloning the full git history, then runs tokei on it. Which path feels faster depends on your network, your machine, and whether a clone is needed at all.

### Can scc count a GitHub repository without cloning it?

Yes, if you download and extract a source archive instead of cloning. scc still needs the source files on local disk. OctoCounts is the option that skips that step for public GitHub repositories: it fetches the source archive server-side and publishes the counts, so nothing lands on your disk. For private or local code, run scc or tokei on a source directory you control.

## Related reading

- [OctoCounts vs tokei](https://octocounts.com/docs/octocounts-vs-tokei)
- [OctoCounts vs cloc, scc, and tokei](https://octocounts.com/docs/octocounts-vs-cloc)
- [Best SLOC counter tools compared](https://octocounts.com/docs/best-sloc-counter-tools)
- [GitHub repo size checker](https://octocounts.com/docs/github-repository-size-checker)
- [OctoCounts counting methodology](https://octocounts.com/docs/methodology)
- [Original research: how test, docs, and generated-file filtering changes SLOC counts](https://octocounts.com/research)
