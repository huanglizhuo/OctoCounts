# tokei vs cloc vs scc: which line counter?

Updated October 25, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

[tokei](https://github.com/XAMPPRocky/tokei), [cloc](https://github.com/AlDanial/cloc), and [scc](https://github.com/boyter/scc) are three open-source line counters, and all three split a local source tree into code, comment, and blank lines. The differences: **tokei** (Rust) is built for fast counting with compact output; **cloc** (Perl) has a long history and a diff mode; **scc** (Go) adds cyclomatic complexity estimates, COCOMO effort projections, and license detection on top of the counts.

## What is the difference between tokei, cloc, and scc?

| | tokei | cloc | scc |
| --- | --- | --- | --- |
| **Written in** | Rust | Perl | Go |
| **Counts** | code, comments, blanks per language | code, comments, blanks per language | code, comments, blanks per language |
| **Extras** | compact terminal output, JSON via serde, configuration file | broad language coverage, `--diff` between two trees, many export formats (CSV, JSON, markdown, …) | cyclomatic complexity, COCOMO effort/cost estimates, license detection, byte estimates |
| **Speed profile** | fast on large trees (Rust) | measure on your tree (Perl) | fast on large trees (Go) |
| **Typical install** | `cargo install tokei`, brew, package managers | cpan/brew/apt packaging of the Perl script | `go install`, brew, release binaries |
| **Private repos** | Yes (local checkout) | Yes (local checkout) | Yes (local checkout) |
| **Shareable web reports** | No | No | No |

All three run on Linux, macOS, and Windows, and all three read a local checkout — none of them talks to a hosted repository by URL.

## tokei

[tokei](https://github.com/XAMPPRocky/tokei) is the counter to reach for when the job is "count this tree, fast, without ceremony." Output is a compact per-language table; `--output json` emits machine-readable totals via serde, and a `tokei.toml` can carry a shared configuration. It supports 200+ languages and is the engine OctoCounts runs server-side — the [OctoCounts vs tokei page](https://octocounts.com/docs/octocounts-vs-tokei) covers the split of labor between the CLI and the web service.

## cloc

[cloc](https://github.com/AlDanial/cloc) has been counting trees since the mid-2000s and supports many languages — the usual pick when a tree contains less common languages. Its signature extra is `cloc --diff`, which counts what changed between two directories, archives, or git revisions — useful for release reports. Measure execution time on your own source tree with pinned tool versions if speed matters.

## scc

[scc](https://github.com/boyter/scc) counts like the other two but reports more: per-file cyclomatic complexity, COCOMO effort and cost projections, license detection, and byte estimates, across a wide range of output formats. If your report needs "how big *and* how tangled," scc produces both in one pass. The extras come with a caveat: complexity figures are estimates and measure something different from code-line totals; compare line counts separately under matching rules — the [OctoCounts vs scc page](https://octocounts.com/docs/octocounts-vs-scc) has details.

## Which is faster: tokei, cloc, or scc?

This page does not publish a controlled speed benchmark. If execution time matters, measure each tool on the same checkout, with pinned versions, equivalent exclusions, the same machine, and a stated cache state; keep the commands and results with your comparison. (For reference points measured over a network, OctoCounts' [pilot study](https://octocounts.com/research) published per-request timings of archive-based tokei analysis on react and vite.)

## Do tokei, cloc, and scc give the same numbers?

Not necessarily. Tools use different language definitions, comment parsing, and exclusion defaults, so totals can differ on the same checkout. No universal percentage difference follows from those implementation differences. For a verifiable citation, record the tool and version, exact source tree and commit, effective counting rules, and measurement date. Complexity estimates are separate metrics from line counts.

## Can I run tokei without installing it?

Yes — [OctoCounts](https://octocounts.com/) runs tokei server-side on public GitHub repositories: paste a URL and get counts reproducible with the same source tree, tokei version, and effective filtering rules, pinned to an exact commit, with shareable report pages, README badges, and a JSON API. For private repositories, install the CLI; the [tokei online guide](https://octocounts.com/docs/tokei-online) explains when each route fits.

## Which line counter should you use?

| Scenario | Pick |
| --- | --- |
| Fast, clean counting of a local checkout or CI step | tokei |
| Rare languages, or diffing two trees with `--diff` | cloc |
| Counts plus complexity, COCOMO, or license detection | scc |
| Public GitHub repo, no install, shareable commit-pinned report | [OctoCounts](https://octocounts.com/) (runs tokei server-side) |
| Private or sensitive code | tokei, cloc, or scc locally |

**Bottom line:** for local counting the three tools overlap far more than they differ — pick by extras (scc), language coverage and diffing (cloc), or Rust speed and clean output (tokei). When the tree is a public GitHub repository and the goal is a number you can share and cite, running tokei online through [OctoCounts](https://octocounts.com/) skips the install and pins the result to a commit.

## Related OctoCounts pages

- [OctoCounts vs cloc, scc, and tokei](https://octocounts.com/docs/octocounts-vs-cloc)
- [OctoCounts vs tokei](https://octocounts.com/docs/octocounts-vs-tokei)
- [OctoCounts vs scc](https://octocounts.com/docs/octocounts-vs-scc)
- [tokei online: run tokei without installing](https://octocounts.com/docs/tokei-online)
- [Best SLOC counter tools compared](https://octocounts.com/docs/best-sloc-counter-tools)
