# GitHub Language Bar Alternative: Real Line Counts

OctoCounts is a free alternative to GitHub's language bar. It shows actual files, total lines, code lines, comments, and blanks per language for any public repository, instead of a single byte-based percentage bar.

## What does GitHub's language bar actually measure?

GitHub's language bar shows the percentage of a repository's bytes attributed to each detected language, not lines of code, not files, and not a code/comment/blank breakdown. A repository that is 80% JavaScript by bytes could still have more actual lines of Python if the Python files are terser or more heavily commented. The bar also excludes files GitHub's Linguist classifies as vendored, generated, or documentation, which can shift the percentages away from what a contributor would experience reading the codebase.

## How is OctoCounts different from the GitHub language bar?

OctoCounts reports files, total lines, code lines, comment lines, and blank lines per language, pinned to a specific commit, instead of a single byte-based percentage bar. It downloads the repository's source archive, runs [tokei](https://github.com/XAMPPRocky/tokei), and returns numbers you can sort, export, badge, or cite, rather than a fixed-width colored bar with no underlying counts.

| | GitHub language bar | OctoCounts |
| --- | --- | --- |
| What it measures | Percentage of bytes per language | Files, total lines, code, comments, blanks per language |
| Commit pinning | Reflects the default branch tip only | Pinned to a specific branch, tag, or commit SHA |
| Exportable | No | Plain text, JSON, or a shareable PNG card |
| Badge for a README | Not available | [Live SLOC badges](https://octocounts.com/badges) |
| Where it appears | Repository page sidebar only | GitHub sidebar (via extension) and a standalone web report |

## Why doesn't GitHub just show line counts instead of the language bar?

GitHub has not added a line-count view to the repository sidebar. The language bar is a lightweight summary computed from the same Linguist byte-classification data GitHub already uses for syntax highlighting, which is cheaper to compute than an actual line-by-line count across every file. OctoCounts fills that gap as a browser extension and web app rather than a GitHub feature.

## Can I see line counts directly on GitHub's repository page?

Install the OctoCounts browser extension for [Chrome](https://chromewebstore.google.com/detail/octocounts-%E2%80%94-github-sloc/gkgjpjdnaklagijmekoolhcpebmoldbj), [Edge](https://microsoftedge.microsoft.com/addons/detail/octocounts-%E2%80%93-github-sloc-/ehifednhpbpekkadndaipnngopbhpoim), or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/octocounts-github-sloc) to add a SLOC card directly to GitHub's repository sidebar, next to where the language bar already appears. No account or configuration is required. You can also paste any public repository URL into the [OctoCounts web app](https://octocounts.com/) for the same breakdown without installing anything.

## Related OctoCounts pages

- [OctoCounts home: count any public GitHub repository](https://octocounts.com/)
- [GitHub SLOC counter guide](https://octocounts.com/docs/github-sloc-counter)
- [Counting methodology](https://octocounts.com/docs/methodology)
- [Frequently asked questions](https://octocounts.com/docs/faq)
- [OctoCounts vs cloc, scc, and tokei](https://octocounts.com/docs/octocounts-vs-cloc)
- [Best SLOC counter tools compared](https://octocounts.com/docs/best-sloc-counter-tools)
- [GitHub SLOC badges for your README](https://octocounts.com/badges)
