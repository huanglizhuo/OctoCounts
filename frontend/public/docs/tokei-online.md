# tokei online: run tokei on GitHub repositories

Updated October 7, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

tokei is a fast, open-source line counter written in Rust — but it is a command-line tool you install on your own machine. OctoCounts runs tokei server-side on public GitHub repositories: paste a repository URL and get files, total lines, code lines, comments, and blanks per language, without installing anything. This page explains when an online tokei run makes sense and how it compares with the CLI.

## What is tokei?

tokei is an open-source source-line counter maintained at [github.com/XAMPPRocky/tokei](https://github.com/XAMPPRocky/tokei). It counts files, code lines, comment lines, and blank lines per programming language, and it is widely used because it is fast and recognizes hundreds of languages. It normally runs as a command-line tool on a checkout of code that already exists on your machine. OctoCounts uses tokei as its counting engine, so the numbers you get from the web app are tokei's numbers, produced by the same engine the CLI uses.

## How do I run tokei online without installing it?

Paste a public GitHub repository URL (for example `https://github.com/facebook/react`) into the [OctoCounts web app](https://octocounts.com/). OctoCounts downloads the repository's source archive — pinned to an exact commit SHA, so the count is reproducible — runs tokei on it, and returns the full breakdown: files, total lines, code, comments, blanks, and per-language totals. You can also point the analysis at a specific branch, tag, or commit. No account, token, or installation is required, and results are cached by commit, so re-viewing a report is instant. Try it with [facebook/react](https://octocounts.com/github/facebook/react) or [torvalds/linux](https://octocounts.com/github/torvalds/linux).

## Is OctoCounts really running tokei?

Yes. tokei is the counting engine, and every OctoCounts report states the exact tokei version that produced it, alongside the commit SHA it counted. The counting pipeline — archive download, default ignored directories, and how code, comment, and blank lines are classified per language — is documented on the [counting methodology page](https://octocounts.com/docs/methodology). That means an OctoCounts report and a local tokei run on the same commit at the same version produce matching numbers, which is what makes the online results citable in a pull request, README, or report.

## When should I use the tokei CLI instead?

Use the tokei CLI when your code is private or not hosted on GitHub: OctoCounts only analyzes **public GitHub repositories**, so private repositories, local-only projects, and other forges are CLI territory — clone or point tokei at the code on your machine. Use OctoCounts when the repository is public on GitHub and you want a shareable, commit-pinned report, a [README badge](https://octocounts.com/badges), or API access without setting up a toolchain.

| | tokei CLI | OctoCounts (tokei online) |
| --- | --- | --- |
| Installation | `cargo install tokei`, brew, or a release binary | None — paste a URL |
| Repository access | Any code on your machine, including private | Public GitHub repositories only |
| Commit pinning | Whatever checkout you run it on | Pinned to an exact commit SHA, cached by commit |
| Shareable report | Terminal output | Linkable page, PNG/JSON/text export |
| README badge | Build it yourself | [Live SLOC badges](https://octocounts.com/badges) |
| API | — | [Public report API](https://octocounts.com/docs/api) |

## Can I get tokei counts as a badge, API, or export?

Yes. From any OctoCounts report you can export plain text, JSON, or a shareable PNG card. [Live badges](https://octocounts.com/badges) put SLOC, code lines, files, comment share, or a single language's count into your README, refreshed from the cached report. The [report API](https://octocounts.com/docs/api) returns the same tokei-derived numbers as JSON for automation, and the [Chrome, Edge, and Firefox extension](https://octocounts.com/extension) shows a SLOC card right in the GitHub repository sidebar, next to the language bar.

## Related OctoCounts pages

- [OctoCounts home: count any public GitHub repository](https://octocounts.com/)
- [GitHub SLOC counter guide](https://octocounts.com/docs/github-sloc-counter)
- [How to count lines of code in a GitHub repository](https://octocounts.com/docs/count-lines-of-code-github)
- [OctoCounts vs cloc, scc, and tokei](https://octocounts.com/docs/octocounts-vs-cloc)
- [Counting methodology](https://octocounts.com/docs/methodology)
- [SLOC glossary](https://octocounts.com/docs/glossary)
- [GitHub SLOC badges for your README](https://octocounts.com/badges)
