# OctoCounts guides: counting lines of code in GitHub repositories

Updated October 29, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

OctoCounts is a free SLOC counter for public GitHub repositories. These guides explain how to count lines of code in a GitHub repository with or without cloning it, how tokei, cloc, scc, and GitHub's language bar differ, how OctoCounts counts and how to cite its numbers, and how to use its API, README badges, and browser extension.

Canonical page: https://octocounts.com/docs

## Count lines of code

- [How to count lines of code in a GitHub repository](https://octocounts.com/docs/count-lines-of-code-github): four methods, from a no-install web counter to git, cloc, and tokei commands.
- [Count lines of code without cloning the repository](https://octocounts.com/docs/count-lines-without-cloning): archive-based counting in the browser, the sidebar extension, and badges.
- [Can the GitHub API count lines of code?](https://octocounts.com/docs/github-api-count-lines): what the languages endpoint returns (bytes, not lines) and which routes return lines.
- [GitHub repo size checker](https://octocounts.com/docs/github-repository-size-checker): check a repository's size before cloning it or depending on it.
- [tokei online](https://octocounts.com/docs/tokei-online): run tokei on any public GitHub repository without installing it.
- [GitHub SLOC counter guide](https://octocounts.com/docs/github-sloc-counter): reading OctoCounts reports, badges, exports, and comparisons.

## SLOC tools compared

- [Best tools to count lines of code (SLOC)](https://octocounts.com/docs/best-sloc-counter-tools): OctoCounts, tokei, cloc, scc, sloccount, and GitHub's language bar side by side.
- [tokei vs cloc vs scc](https://octocounts.com/docs/tokei-vs-cloc-vs-scc): why three open-source counters report different totals.
- [OctoCounts vs cloc, scc, and tokei](https://octocounts.com/docs/octocounts-vs-cloc): which tool fits local analysis, CI, browser workflows, and sharing.
- [OctoCounts vs tokei](https://octocounts.com/docs/octocounts-vs-tokei): the same tokei engine, run server-side on public repositories and pinned to commits.
- [OctoCounts vs scc](https://octocounts.com/docs/octocounts-vs-scc): local counting with complexity estimates versus no-install public reports.
- [GitHub language bar alternative](https://octocounts.com/docs/github-language-bar-alternative): why GitHub's bar shows byte percentages instead of line counts.

## Data and research

- [How many lines of code? The largest codebases, counted](https://octocounts.com/docs/largest-codebases): Linux, Firefox, LLVM, and more, pinned to commits.
- [How filtering changes SLOC counts](https://octocounts.com/research): a fixed-commit study of what excluding tests, docs, and generated files does to totals.
- [OctoCounts public growth stats](https://octocounts.com/stats): aggregate report, repository, and language totals.

## Reference

- [Methodology](https://octocounts.com/docs/methodology): archive download, commit pinning, tokei, exclusions, cache keys, and how to cite a count.
- [SLOC glossary](https://octocounts.com/docs/glossary): code lines, comment lines, blank lines, physical and logical SLOC.
- [FAQ](https://octocounts.com/docs/faq): privacy, private repositories, badges, limits, and how OctoCounts compares to local tools.
- [API docs](https://octocounts.com/docs/api): analyze public repositories and fetch cached reports, badges, compare, and diff URLs.

## 简体中文

- [GitHub 代码行数统计：OctoCounts SLOC 使用指南](https://octocounts.com/zh/docs/github-sloc-counter)
- [OctoCounts 代码行数统计方法与规则](https://octocounts.com/zh/docs/methodology)
