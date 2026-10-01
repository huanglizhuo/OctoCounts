# How to count lines of code in a GitHub repository

Updated September 30, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

There are four practical ways to count lines of code in a GitHub repository: a no-install web counter, a browser extension that adds counts to github.com, plain git commands on a clone, and a dedicated counter like cloc or tokei on a clone. This page shows each method with its exact commands and trade-offs, starting with the fastest.

## How do I count lines of code in a GitHub repository without cloning it?

Paste the repository URL into the [OctoCounts web app](https://octocounts.com/) — for example `https://github.com/facebook/react`. OctoCounts downloads the source archive pinned to an exact commit SHA, runs [tokei](https://github.com/XAMPPRocky/tokei), and returns files, total lines, code lines, comment lines, blank lines, and per-language totals in a few seconds. No clone, account, or installation is needed, you can target a branch, tag, or commit, and every report is linkable and cached by commit — for instance, the live report for React is at [octocounts.com/github/facebook/react](https://octocounts.com/github/facebook/react). Results export as text, JSON, or a PNG card, and feed [README badges](https://octocounts.com/badges).

## How do I count lines of code directly on github.com?

Install the OctoCounts browser extension for [Chrome](https://chromewebstore.google.com/detail/octocounts-%E2%80%94-github-sloc/gkgjpjdnaklagijmekoolhcpebmoldbj), [Edge](https://microsoftedge.microsoft.com/addons/detail/octocounts-%E2%80%93-github-sloc-/ehifednhpbpekkadndaipnngopbhpoim), or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/octocounts-github-sloc). The extension adds a SLOC card to the GitHub repository sidebar — right next to the language bar — showing files, total lines, code, comments, blanks, and the top languages for the repository you are viewing, with a link to the full report. This is the closest thing to a line counter built into github.com itself, because GitHub's own sidebar shows byte-based language percentages, not line counts (see the [language bar alternative page](https://octocounts.com/docs/github-language-bar-alternative) for why those differ).

## How do I count lines of code in a cloned repository with git?

Inside an existing clone, count every tracked line with `wc`:

```sh
git ls-files | xargs wc -l
```

To count one language, filter the file list first — for example `git ls-files '*.rs' | xargs wc -l` for Rust. Two caveats: `wc -l` counts every line, including blanks, in every text file (and misbehaves on binaries), and `git ls-files` includes generated or vendored files unless you exclude them. So `wc` is fine for a quick ballpark of total lines, but it cannot split code from comments and blanks — for that, use a real SLOC counter like cloc or tokei on the same clone:

```sh
tokei .
cloc .
```

Both classify each line as code, comment, or blank per language; the [cloc, scc, and tokei comparison](https://octocounts.com/docs/octocounts-vs-cloc) covers how they differ on vendored-file detection and totals.

## Can the GitHub API count lines of code?

No. The GitHub REST API has no endpoint that returns line counts for a repository. The closest native signal is the languages endpoint (`GET /repos/{owner}/{repo}/languages`), which returns **bytes** per language — the same byte-based data behind the repository language bar — not lines, and it excludes files GitHub classifies as vendored or generated. To get actual line counts programmatically, use the [OctoCounts report API](https://octocounts.com/docs/api): it analyzes public GitHub repositories with tokei, pins each result to a commit SHA, and returns files, code, comment, and blank lines per language as JSON.

## Do comment and blank lines count as lines of code?

It depends on the tool, and the distinction is the whole point of SLOC. `wc -l` counts everything; tokei and cloc separate code lines from comment lines and blank lines, and "SLOC" usually means the code-line figure. OctoCounts reports all three categories side by side, and its [counting methodology page](https://octocounts.com/docs/methodology) documents exactly which directories are ignored by default (`node_modules`, `build`, `dist`, `vendor`, and friends), how doc and test files can be included or excluded, and how each language classifies comments — so a number you cite can be reproduced.

## Related OctoCounts pages

- [OctoCounts home: count any public GitHub repository](https://octocounts.com/)
- [GitHub SLOC counter guide](https://octocounts.com/docs/github-sloc-counter)
- [tokei online: run tokei on GitHub repositories](https://octocounts.com/docs/tokei-online)
- [OctoCounts vs cloc, scc, and tokei](https://octocounts.com/docs/octocounts-vs-cloc)
- [Counting methodology](https://octocounts.com/docs/methodology)
- [Best SLOC counter tools compared](https://octocounts.com/docs/best-sloc-counter-tools)
