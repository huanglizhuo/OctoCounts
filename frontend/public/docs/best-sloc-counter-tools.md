# Best Tools to Count Lines of Code (SLOC) in 2026

Updated October 25, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

OctoCounts is a free SLOC counter for public GitHub repositories and one of six tools compared on this page. It counts files, total lines, code lines, comments, and blanks per language with tokei, run on a downloaded source archive instead of a git clone, and returns a shareable, commit-pinned report. The other tools — tokei, cloc, scc, sloccount, and GitHub's language bar — each measure size differently and suit different workflows.

Six tools compared for counting source lines of code — OctoCounts, tokei, cloc, scc, sloccount, and GitHub's built-in language bar — with what each measures, who it's best for, and where it falls short. None of these tools measure code quality; they measure size.

## Comparison at a glance

| Tool | Type | Written in | Best for | Price |
| --- | --- | --- | --- | --- |
| OctoCounts | Web app + browser extension | Rust / TypeScript | Public GitHub repos, no install, shareable reports | Free |
| [tokei](https://github.com/XAMPPRocky/tokei) | CLI | Rust | Fast local/private counts, CI pipelines | Free, open source |
| [cloc](https://github.com/AlDanial/cloc) | CLI | Perl | Language coverage for legacy/unusual codebases, legacy/unusual codebases | Free, open source |
| [scc](https://github.com/boyter/scc) | CLI | Go | Fast counts plus complexity estimates in one pass | Free, open source |
| [sloccount](https://www.dwheeler.com/sloccount/) | CLI | Perl / C | COCOMO cost estimates on older Unix-style codebases | Free, open source (unmaintained) |
| GitHub language bar | Built into GitHub | — | A quick, no-setup glance at language mix by bytes | Free (built in) |

### OctoCounts

**Best for:** public GitHub repos, zero install, shareable reports

OctoCounts is a free web app and browser extension that counts files, total lines, code lines, comments, and blanks for any public GitHub repository. It downloads the repository's source archive for a pinned commit instead of cloning full git history, runs tokei under the hood, and returns a shareable report URL — no local installation, no account, and no cloning required. It also ships a README badge, a GitHub Action, a CLI, and an MCP server for AI coding assistants.

- **Pros:** No install for the web app, shareable/cacheable report URLs, README badges, commit-pinned reproducible results
- **Cons:** Public repositories only, depends on network access to analyze, not a replacement for a local CLI in CI that needs private-repo access

### tokei

**Best for:** fast local or private counts, CI pipelines

tokei is an open-source, Rust-based command-line counter with parallel file processing and support for many languages. It's the counting engine OctoCounts itself uses. Run it directly against any local checkout, public or private, with no network dependency.

- **Pros:** Very fast, works on private repos, no network required, widely used as a library inside other tools
- **Cons:** Requires installing a Rust binary or crate, no built-in report sharing or hosting, results aren't reproducible across machines without pinning the tokei version

tokei has no official web interface. OctoCounts runs tokei online, free, at commit-pinned URLs — see the [tokei online guide](https://octocounts.com/docs/tokei-online) if you want tokei's numbers for a public GitHub repository without installing anything.

### cloc

**Best for:** the language and file-format coverage

cloc has been counting lines of code since 2006 and supports many languages and legacy file formats. Check its published language list against your files; speed and parser coverage depend on the tool version and source tree, so this page does not rank the tools by either measure.

- **Pros:** Broad language support, two decades of edge-case fixes, well documented and widely trusted
- **Cons:** Performance depends on the repository and tool version, requires a Perl runtime, no hosted/shareable report format

### scc

**Best for:** fast counts plus rough complexity estimates

scc (Sloc, Cloc and Code) is a Go-based counter that additionally estimates cyclomatic complexity and a COCOMO-style cost/effort figure per language. If a single command needs to produce both a line count and a rough complexity signal, scc covers both in one pass.

- **Pros:** Fast, adds complexity and cost estimates tokei and cloc don't, single static binary, easy to install
- **Cons:** Smaller community than cloc, complexity/cost estimates are rough heuristics, not precise measurements

### sloccount

**Best for:** COCOMO-style cost estimates on older Unix-style codebases

sloccount is one of the original SLOC counters, dating to the early 2000s, known for its built-in COCOMO development-cost estimates. It's effectively unmaintained today, has weaker support for modern languages and tooling than tokei, cloc, or scc, and is included here mainly because it still surfaces in searches for SLOC history and legacy build pipelines.

- **Pros:** Built-in COCOMO cost estimate, long history, well known in the SLOC-metrics literature
- **Cons:** Unmaintained, weak modern-language support, harder to install on current systems than any other tool here

### GitHub's language bar

**Best for:** a quick, no-setup glance at language mix

Every GitHub repository page shows a colored bar breaking down the codebase by language — but that breakdown is a percentage of bytes classified by GitHub's Linguist, not a line count, and it excludes files Linguist marks as vendored, generated, or documentation. It's a built-in overview of what languages a repo uses, but it can't answer "how many lines" or "how much is comments versus code." See the full [GitHub language bar alternative](https://octocounts.com/docs/github-language-bar-alternative) comparison.

- **Pros:** Zero setup, already on every repo page, instant
- **Cons:** Bytes not lines, no code/comment/blank breakdown, excludes vendored and generated files from its own classification, which can hide as much as it shows

## What is the best free tool to count lines of code?

It depends on where the code lives and what you need. For a check of source line counts in a public GitHub repository without installing anything, use OctoCounts; GitHub's language bar shows byte-based language mix instead. For local or private codebases, tokei, scc, and cloc offer command-line workflows. Check each tool's current language list for unusual or legacy languages. There is no single best tool for every case; the right choice depends on whether the repository is public or private, whether you want a CLI or a web report, and how many languages you need recognized.

## What is the difference between tokei, cloc, and scc?

All three are command-line tools that count files, code lines, comment lines, and blank lines per language. tokei and scc are written in compiled languages (Rust and Go); cloc is written in Perl. cloc has a long track record and a diff mode, while tokei and scc offer their own parsers and output formats. Check the language lists for the exact versions you plan to use.

## Can I count lines of code without cloning a GitHub repository?

Yes. OctoCounts downloads a repository's source archive for a specific commit instead of performing a full git clone, so it transfers only the current source tree and requires no local installation. GitHub's language bar also requires no cloning, though it only reports byte-based percentages rather than line counts. Local tools such as tokei, cloc, and scc require either cloning the repository or already having a local copy to scan.

## Is SLOC count a good measure of code quality?

No. Every tool in this comparison measures size, not quality, complexity, or maintainability. A larger SLOC count can mean more features, more generated or vendored code, more verbose language idioms, or simply more tests. Use SLOC counts to gauge the scale of a codebase, not to judge whether it is well written. See the [counting methodology](https://octocounts.com/docs/methodology) for how OctoCounts specifically defines code, comment, and blank lines.

## Related OctoCounts pages

- [OctoCounts home: count any public GitHub repository](https://octocounts.com/)
- [tokei vs cloc vs scc (tool-to-tool)](https://octocounts.com/docs/tokei-vs-cloc-vs-scc)
- [OctoCounts vs cloc, scc, and tokei (head-to-head)](https://octocounts.com/docs/octocounts-vs-cloc)
- [OctoCounts vs tokei (head-to-head)](https://octocounts.com/docs/octocounts-vs-tokei)
- [OctoCounts vs scc (head-to-head)](https://octocounts.com/docs/octocounts-vs-scc)
- [GitHub repo size checker: check before cloning](https://octocounts.com/docs/github-repository-size-checker)
- [GitHub language bar alternative](https://octocounts.com/docs/github-language-bar-alternative)
- [Counting methodology](https://octocounts.com/docs/methodology)
- [Frequently asked questions](https://octocounts.com/docs/faq)
- [GitHub SLOC badges for your README](https://octocounts.com/badges)
