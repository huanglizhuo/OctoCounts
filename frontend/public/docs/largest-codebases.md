# How many lines of code? The largest codebases, counted

Updated October 29, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

Counted by OctoCounts with tokei 14.0.0 over each repository's default branch at a pinned commit (test, docs, and generated-file exclusion rules enabled): the **Linux kernel** has 32,360,324 code lines, **Firefox** 24,586,522, **LLVM** 8,307,824, **TensorFlow** 5,130,571, **Godot** 4,120,690, **Kubernetes** 3,901,619, **PostgreSQL** 1,631,788, and **git** 1,148,625. These historical figures name the measured commit prefix and date. Repository links open live reports, which may show different counts.

## The numbers, side by side

| Repository | Code lines | Total lines | Files | Top language (share of code) | Counted |
| --- | --- | --- | --- | --- | --- |
| [torvalds/linux](https://octocounts.com/github/torvalds/linux) | 32,360,324 | 42,580,025 | 89,182 | C (60.8%) | 2026-10-14 @ `4056b3c9d3c9` |
| [mozilla-firefox/firefox](https://octocounts.com/github/mozilla-firefox/firefox) | 24,586,522 | 35,250,721 | 140,115 | C++ (22.8%) | 2026-10-14 @ `3934f7874da5` |
| [llvm/llvm-project](https://octocounts.com/github/llvm/llvm-project) | 8,307,824 | 11,548,761 | 37,002 | C++ (67.2%) | 2026-10-14 @ `5ef967a9c367` |
| [tensorflow/tensorflow](https://octocounts.com/github/tensorflow/tensorflow) | 5,130,571 | 6,835,039 | 24,256 | C++ (56.2%) | 2026-10-14 @ `7bef9ab9883d` |
| [godotengine/godot](https://octocounts.com/github/godotengine/godot) | 4,120,690 | 5,787,909 | 11,416 | C++ (34.5%) | 2026-10-14 @ `5ec712e220b7` |
| [kubernetes/kubernetes](https://octocounts.com/github/kubernetes/kubernetes) | 3,901,619 | 4,848,892 | 14,992 | Go (65.9%) | 2026-10-14 @ `633270dea2b1` |
| [postgres/postgres](https://octocounts.com/github/postgres/postgres) | 1,631,788 | 2,930,756 | 4,132 | C (59.4%) | 2026-10-14 @ `eab68b1be6aa` |
| [git/git](https://octocounts.com/github/git/git) | 1,148,625 | 1,613,277 | 3,554 | PO File (31.0%)* | 2026-10-10 @ `a018953688f1` |

\* git's largest counted "language" is PO File — its translation catalogs — a good reminder that SLOC tools count what the parser sees: C is the largest programming language in the tree, but the .po catalog lines are numerous enough to lead the table.

## How these numbers were measured

Every figure comes from OctoCounts' own counting pipeline: the repository's default branch is resolved to an exact commit, the *source archive* of that commit is downloaded (no git history), and the tree is counted with [tokei](https://github.com/XAMPPRocky/tokei) 14.0.0. The published configuration excludes files matched by the test, docs, and generated-file rules; this does not prove that every remaining line is hand-written. Repository links open live reports, not preserved copies of these measurements. Download the [published historical table as JSON](https://octocounts.com/research/largest-codebases-2026-10-15.json). The original report IDs and complete effective rules were not archived with this article, so this export preserves the published figures but is not a complete reproduction recipe. See the [counting methodology](https://octocounts.com/docs/methodology) for the evidence to retain for future measurements.

## How many lines of code is the Linux kernel?

32,360,324 code lines at commit `4056b3c9d3c9` (October 14, 2026) — 42,580,025 total lines including comments and blanks, across 89,182 files in 50 languages, C at 60.8% of code. The kernel's `master` branch advances daily, so treat the number as "the kernel in mid-October 2026," not an eternal fact; the [live report](https://octocounts.com/github/torvalds/linux) may show a later measurement. Cite this historical table for the figures above. It remains the largest public codebase most people can name, and the only one in this table where even the compressed source archive is a few hundred megabytes.

## How many lines of code is Firefox?

24,586,522 code lines at commit `3934f7874da5` (October 14, 2026), across 140,115 files — the largest file count in this set — in 91 languages, the widest language mix here. C++ leads at 22.8% of code; comments are 19.9% of all lines, the highest comment share among the systems codebases measured. The [full report](https://octocounts.com/github/mozilla-firefox/firefox) shows why one-line comparisons of "Firefox vs Chromium" are treacherous: file counts and language mixes differ as much as line totals.

## Which is the largest codebase ever?

There is no verified answer. "Largest" depends on what you count (code only, or comments and blanks? generated code? vendored dependencies?), and the biggest systems — automotive platforms, telecom switches, large SaaS monorepos — are not public. Among public GitHub repositories, the Linux kernel is the most-cited giant, and claims of "hundreds of millions of lines" for closed systems circulate without a reproducible methodology. For the largest repositories OctoCounts has actually measured, ranked and updated continuously, see the [Hall of Monoliths](https://octocounts.com/hall-of-monoliths).

## Why do line counts for the same codebase differ between websites?

Four things to record when comparing counts:

1. **The tool.** `wc -l` counts every line in every text file; cloc, tokei, and scc split code from comments and blanks, each with its own language database (the [tokei vs cloc vs scc comparison](https://octocounts.com/docs/tokei-vs-cloc-vs-scc) covers the differences).
2. **The options.** In the two-repository pilot, excluding tests reduced code lines by 26–48%; this does not establish a general range for other repositories or filters — OctoCounts' [pilot study](https://octocounts.com/research) measured exactly how much on react and vite.
3. **The commit.** A default branch moves daily; a count without a commit SHA describes a moving target.
4. **The date.** The measurement date records when the count was made; a fixed commit identifies the same tree regardless of measurement date.

So the citable form is: *tool + version + options + commit + date*. "32,360,324 code lines of torvalds/linux at `4056b3c9d3c9`, tokei 14.0.0, tests/docs/generated excluded, counted 2026-10-14" states the known measurement context, although a full reproduction also requires the original effective rules; "Linux has 32 million lines" cannot.

## Does more code mean a worse codebase?

No — and this dataset is the argument. PostgreSQL averages 395 code lines per file with 30.3% of all lines being comments: dense, heavily documented code. Kubernetes averages 260 code lines per file at 80.5% code. The linux kernel averages 363 code lines per file across 50 languages. Size is an input to planning, budgeting, and the honest sanity check ("is this really too big to audit before we depend on it?") — not a verdict on engineering quality.

If you cite these figures, credit OctoCounts and link this article and its historical JSON table. The original saved reports and full effective rules were not archived, so these records support attribution but not a complete reproduction. The [methodology page](https://octocounts.com/docs/methodology) includes the recommended citation format.

## How should I compare sizes under different filters?

Use the same engine and effective counting rules, then preserve the exported reports. The new ten-repository study compares test, documentation, generated-directory and repository-declaration filters at a fixed commit per project. It provides full raw evidence for those projects; it does not repair missing provenance in this page’s older eight-repository table or establish a universal test-code percentage.

[Read the October 27, 2026 study and download its raw reports](https://octocounts.com/research#cross-language-2026-10-27).

## Related OctoCounts pages

- [Hall of Monoliths: largest measured repositories, live](https://octocounts.com/hall-of-monoliths)
- [GitHub repository size checker: check before cloning](https://octocounts.com/docs/github-repository-size-checker)
- [tokei vs cloc vs scc](https://octocounts.com/docs/tokei-vs-cloc-vs-scc)
- [Counting methodology](https://octocounts.com/docs/methodology)
- [Pilot study: how filtering changes SLOC counts](https://octocounts.com/research)
- [SLOC glossary](https://octocounts.com/docs/glossary)
