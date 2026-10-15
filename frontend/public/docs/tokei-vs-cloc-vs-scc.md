# tokei vs cloc vs scc: which line counter?

Updated October 15, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

[tokei](https://github.com/XAMPPRocky/tokei), [cloc](https://github.com/AlDanial/cloc), and [scc](https://github.com/boyter/scc) are the three most popular open-source line counters, and all three split a local source tree into code, comment, and blank lines. The differences: **tokei** (Rust) is built for fast counting with compact output; **cloc** (Perl) is the oldest and has the widest language database plus a diff mode; **scc** (Go) adds cyclical complexity estimates, COCOMO effort projections, and license detection on top of the counts.

## What is the difference between tokei, cloc, and scc?

| | tokei | cloc | scc |
| --- | --- | --- | --- |
| **Written in** | Rust | Perl | Go |
| **Counts** | code, comments, blanks per language | code, comments, blanks per language | code, comments, blanks per language |
| **Extras** | compact terminal output, JSON via serde, configuration file | widest language coverage, `--diff` between two trees, many export formats (CSV, JSON, markdown, …) | cyclical complexity, COCOMO effort/cost estimates, license detection, byte estimates |
| **Speed profile** | fast on large trees (Rust) | slowest of the three on very large trees (Perl), fine on typical repos | fast on large trees (Go) |
| **Typical install** | `cargo install tokei`, brew, package managers | cpan/brew/apt packaging of the Perl script | `go install`, brew, release binaries |
| **Private repos** | Yes (local checkout) | Yes (local checkout) | Yes (local checkout) |
| **Shareable web reports** | No | No | No |

All three run on Linux, macOS, and Windows, and all three read a local checkout — none of them talks to a hosted repository by URL.

## tokei

[tokei](https://github.com/XAMPPRocky/tokei) is the counter to reach for when the job is "count this tree, fast, without ceremony." Output is a compact per-language table; `--output json` emits machine-readable totals via serde, and a `tokei.toml` can carry a shared configuration. It supports 200+ languages and is the engine OctoCounts runs server-side — the [OctoCounts vs tokei page](https://octocounts.com/docs/octocounts-vs-tokei) covers the split of labor between the CLI and the web service.

## cloc

[cloc](https://github.com/AlDanial/cloc) has been counting trees since the mid-2000s and carries the widest language database of the three — the usual pick when a tree contains less common languages. Its signature extra is `cloc --diff`, which counts what changed between two directories, archives, or git revisions — useful for release reports. Trade-off: being Perl, it is the slowest of the three on very large trees, though fine on typical repositories.

## scc

[scc](https://github.com/boyter/scc) counts like the other two but reports more: per-file cyclical complexity, COCOMO effort and cost projections, license detection, and byte estimates, across a wide range of output formats. If your report needs "how big *and* how tangled," scc produces both in one pass. The extras come with a caveat: complexity-based figures are estimates by construction and won't match tokei/cloc line totals used as a baseline — the [OctoCounts vs scc page](https://octocounts.com/docs/octocounts-vs-scc) has details.

## Which is faster: tokei, cloc, or scc?

On very large trees, the Rust and Go implementations are dramatically faster than Perl-based cloc — that much is consistent with each project's own published claims. Between tokei and scc, the gap is usually small and flips with the file mix and hardware. Absolute numbers vary too much to crown one winner here: if the difference matters for your CI budget, run two of them on the same checkout and keep the faster. (For reference points measured over a network, OctoCounts' [pilot study](https://octocounts.com/research) published per-request timings of archive-based tokei analysis on react and vite.)

## Do tokei, cloc, and scc give the same numbers?

Rarely, exactly. Each tool ships its own language database, its own comment-syntax rules, and its own defaults for skipping directories, so totals can differ by a few percent on the same checkout. That is normal and is exactly why a citation should name the tool and version: "32,360,324 code lines by tokei at commit `4056b3c9d3c9`" is reproducible; a bare "32 million" is not. The [SLOC glossary](https://octocounts.com/docs/glossary) defines the categories the three tools share.

## Can I run tokei without installing it?

Yes — [OctoCounts](https://octocounts.com/) runs tokei server-side on public GitHub repositories: paste a URL and get the same counts the CLI would produce, pinned to an exact commit, with shareable report pages, README badges, and a JSON API. For private repositories, install the CLI; the [tokei online guide](https://octocounts.com/docs/tokei-online) explains when each route fits.

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
