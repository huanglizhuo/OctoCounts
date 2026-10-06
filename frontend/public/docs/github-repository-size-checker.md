# GitHub repo size checker: check before cloning

Updated October 7, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

There are five practical ways to check how big a GitHub repository is before you clone it: GitHub's REST API `size` field (a one-line `curl`, no clone), a shallow clone (`git clone --depth 1`), GitHub's git-sizer tool on a full clone, a local line counter such as [tokei](https://github.com/XAMPPRocky/tokei) or [cloc](https://github.com/AlDanial/cloc) on a checkout, and a no-clone SLOC report from [OctoCounts](https://octocounts.com/). They answer different questions — bytes of history, snapshot download cost, or lines of source code — so this page shows when each one is the right check, with real numbers for torvalds/linux, mozilla-firefox/firefox, and kubernetes/kubernetes.

Every number on this page was checked on October 7, 2026. SLOC figures come from OctoCounts reports that name their exact commit SHA and tokei version; byte figures come from GitHub's REST API `size` field, which GitHub documents as calculated hourly.

## Why check a repository's size before cloning?

Cloning is the most expensive first step in working with an unfamiliar repository, and its cost scales with things you cannot see from the repository page. Four costs are worth predicting:

- **Disk space.** A full clone writes both the working tree and a `.git` directory holding every version of every file in the project's history. Old, active projects can accumulate gigabytes of history that remain on disk even after you delete your local branches.
- **Download time.** Clone transfer is proportional to the packed history plus the checkout. On a metered or slow connection, discovering that a repository is gigabytes only after the clone stalls is the exact situation a size check prevents.
- **CI minutes.** Pipelines that clone from scratch on every run pay the same cost repeatedly. Knowing whether a repository is tens of megabytes or several gigabytes decides between a full clone, a shallow clone, or a cached archive download.
- **Day-to-day git speed.** Large histories make `git status`, `git log`, and garbage collection slower over time. Size is a long-term tax, not just a one-time download.

## Method 1: the GitHub REST API size field (no clone)

GitHub's REST API documents a `size` field on the repository endpoint (`GET /repos/{owner}/{repo}`) as the size of the repository in kilobytes, calculated hourly. One `curl` returns it with no authentication for public repositories:

```
curl -s https://api.github.com/repos/torvalds/linux | grep '"size"'
  # "size": 6401075  (about 6.1 GB, checked 2026-10-07)
```

This is the cheapest byte-level check and the only one that works before anything touches your disk. Its limits are worth knowing: the figure covers the repository as GitHub stores it (history plus checkout, in packed form), it is refreshed hourly rather than live, and it tells you nothing about what the bytes are — a repository can be large because of binaries and media, or because of twenty years of history, and the number cannot distinguish them.

## Method 2: a shallow clone (`git clone --depth 1`)

`git clone --depth 1` is git's documented way to fetch only the most recent commit of a branch instead of the full history. On old, active repositories this usually cuts the transfer by a large factor while still giving you a complete, buildable working tree of the latest commit. Measure what arrived with `git count-objects -vH`, which reports the local object store size:

```
git clone --depth 1 https://github.com/kubernetes/kubernetes
git -C kubernetes count-objects -vH   # size-pack: how much history you actually got
```

A shallow clone answers a slightly different question than the API: it measures the current snapshot's transfer cost on your connection, not the repository's total stored size. Two caveats follow from the mechanism. First, history-based tools do not work on a shallow copy — [git-sizer](https://github.com/github/git-sizer), for instance, needs a complete clone. Second, a shallow clone still writes the full checkout to disk, so it does not help when the working tree itself is what will not fit.

## Method 3: git-sizer on a full clone

[git-sizer](https://github.com/github/git-sizer) is GitHub's open-source tool (written in Go) that computes a set of size metrics over a repository's complete history — counts of commits, trees, and blobs, the largest blobs, and similar structural measures — and flags the values that tend to cause problems for git hosting and tooling. It is the right check when your question is not "how big is this?" but "will this repository misbehave?": contributor-side slowness, push failures, or hosting limits. Its trade-off is the loop you were trying to avoid: git-sizer analyzes a local clone, so you need the full history on disk before it can tell you whether you should have cloned it.

## Method 4: count lines on a checkout you already have

If a checkout already exists locally, a line counter turns it into source-level numbers. [tokei](https://github.com/XAMPPRocky/tokei) (Rust) counts files, code, comments, and blanks per language; [cloc](https://github.com/AlDanial/cloc) (Perl) is the long-established alternative with very broad language support; [scc](https://github.com/boyter/scc) (Go) adds complexity estimates. These tools answer "how much source is in this snapshot?", never "how many bytes will the clone take?" — and they need the code on disk first, which puts them after the clone rather than before it.

## Method 5: a no-clone SLOC report from OctoCounts

[OctoCounts](https://octocounts.com/) is the check designed to run before any clone: paste a public GitHub repository URL and it downloads the repository's compressed source archive for the requested branch, tag, or commit — not the full git history — runs [tokei](https://github.com/XAMPPRocky/tokei) on it, and returns a cached, shareable report with files, total lines, code, comments, blanks, and per-language totals, pinned to an exact commit SHA. Each report also carries its tokei version, so the numbers are reproducible and citable. For the scale question ("is this codebase a hundred thousand lines or thirty million?") it is the only method here that needs nothing on your disk; for the byte question it says nothing, which is why the two kinds of check complement each other. Try it on [torvalds/linux](https://octocounts.com/github/torvalds/linux) or [mozilla-firefox/firefox](https://octocounts.com/github/mozilla-firefox/firefox).

## SLOC size versus disk size: different questions

The most common confusion when checking repository size is treating bytes and lines as the same measurement. They diverge in both directions:

| | Repository size (bytes) | SLOC (lines) |
|---|---|---|
| Measures | Compressed history + checkout, all file types | Text lines in one snapshot's source files |
| Driven by | History length, binaries, media, fixtures | Source files in the checked-out commit |
| Answers | "What will this cost to clone and keep?" | "How much code is in this codebase?" |
| Checked with | API size field, git-sizer, count-objects | tokei, cloc, scc, OctoCounts |

Concrete divergence: a repository with 40 MB of design assets and 5,000 lines of code is byte-large and line-small; a compiler codebase can hold tens of millions of lines of highly compressible text while its stored size stays modest relative to, say, a media-heavy repository of the same byte count. Neither number implies the other, and "big" means different things for cloning (bytes) and for evaluating a codebase's scale (lines).

## Real numbers: three large repositories

Both kinds of measurement, side by side. Byte figures are GitHub's REST API `size` field (checked October 7, 2026); line figures are OctoCounts reports, each pinned to its commit.

| Repository | API size (2026-10-07) | Files | Code lines | Top language |
|---|---|---|---|---|
| [torvalds/linux](https://octocounts.com/github/torvalds/linux) | 6,401,075 KB (≈6.1 GB) | 89,158 | 32,353,830 | C (60.8%) |
| [mozilla-firefox/firefox](https://octocounts.com/github/mozilla-firefox/firefox) | not checked | 139,651 | 24,523,020 | C++ |
| [kubernetes/kubernetes](https://github.com/kubernetes/kubernetes) | 1,529,410 KB (≈1.5 GB) | — | — | Go |

The linux line counts come from the cached OctoCounts report at commit `67f0943b394d` (counted October 5, 2026 with tokei 14.0.0): 42,571,003 total lines, of which 32,353,830 are code, 4,868,080 comments, and 5,349,093 blanks, across 50 languages. The firefox figures come from its [OctoCounts report](https://octocounts.com/github/mozilla-firefox/firefox) of the same date (139,651 files, 24,523,020 code lines, top language C++). Where a cell is marked "—" the figure was not measured for this page; the point of the table is that the two columns are independent measurements, not two views of one number.

## Which check should I use?

| Scenario | Best check |
|---|---|
| Quick byte-size check, nothing installed, nothing on disk | GitHub REST API `size` field |
| How much source code does it have, before cloning anything | [OctoCounts](https://octocounts.com/) no-clone SLOC report |
| Build the code today without downloading history | `git clone --depth 1` |
| Will this repository stress git tooling or hosting limits | [git-sizer](https://github.com/github/git-sizer) on a full clone |
| Count lines in a checkout already on your machine | [tokei](https://github.com/XAMPPRocky/tokei), [cloc](https://github.com/AlDanial/cloc), or [scc](https://github.com/boyter/scc) |
| Shareable, citable source-size numbers for a report or PR | [OctoCounts](https://octocounts.com/) (commit-pinned URL, [badges](https://octocounts.com/badges), [API](https://octocounts.com/docs/api)) |

**Bottom line:** decide what "size" you mean before checking. Bytes before cloning come from the API's `size` field or a shallow clone; lines of code before cloning come from an OctoCounts report; structural git-health warnings come from git-sizer after a full clone. The torvalds/linux pair above — about 6.1 GB of repository versus 32,353,830 code lines in one snapshot — is the clearest reminder that the answers are different numbers about different things.

## Frequently Asked Questions

### How can I check a GitHub repository's size before cloning?

The fastest no-clone check is GitHub's REST API: `GET /repos/{owner}/{repo}` returns a `size` field in kilobytes, which GitHub documents as calculated hourly. For example, on October 7, 2026 the linux repository reported a size of 6,401,075 KB (about 6.1 GB) and kubernetes/kubernetes reported 1,529,410 KB (about 1.5 GB). For the amount of source code rather than bytes on disk, OctoCounts produces a commit-pinned SLOC report from just the repository URL — no clone at all.

### Does GitHub show a repository's size on the website?

No. A GitHub repository page shows the language bar and file listing but not a total size figure. The documented way to get one without cloning is the REST API's `size` field on the repository endpoint, which reports kilobytes of the repository as stored by GitHub, refreshed hourly. GitHub's own git-sizer tool goes further and reports detailed size metrics, but it needs a complete local clone to analyze.

### What is the difference between repository size and lines of code?

Repository size measures bytes: every version of every file in the git history, including binaries, media, and compressed packfiles. Lines of code measures the text volume of one snapshot: source lines, comment lines, and blank lines per language. A repository can be large in bytes because of history or assets while having modest source lines, or have millions of code lines stored compactly as text. As a concrete pair of numbers: torvalds/linux reports about 6.1 GB via the API size field and 32,353,830 code lines at commit 67f0943b394d via an OctoCounts report.

### Does a shallow clone download the whole history?

No. `git clone --depth 1` fetches only the most recent commit of the branch, not the full history, which is the documented behavior of the `--depth` option. That usually cuts the download substantially on old, active repositories, but you still receive the full working tree of that commit, and some git operations such as fetching further history or running history-aware tools work differently on a shallow copy. git-sizer and any history-based size analysis require the full clone.

### How big is the Linux kernel repository?

On October 7, 2026, the GitHub REST API reported torvalds/linux with a size field of 6,401,075 KB, about 6.1 GB. OctoCounts' cached report for the same repository, counted at commit `67f0943b394d` on October 5, 2026 with tokei 14.0.0, shows 89,158 files, 42,571,003 total lines, and 32,353,830 code lines across 50 languages, with C the top language at 60.8% of code. The two numbers answer different questions: bytes of history versus lines in one snapshot.

## Related OctoCounts pages

- [GitHub SLOC counter guide](https://octocounts.com/docs/github-sloc-counter)
- [How to count lines of code in a GitHub repository](https://octocounts.com/docs/count-lines-of-code-github)
- [tokei online: run tokei on GitHub repositories](https://octocounts.com/docs/tokei-online)
- [OctoCounts vs tokei](https://octocounts.com/docs/octocounts-vs-tokei)
- [OctoCounts vs scc](https://octocounts.com/docs/octocounts-vs-scc)
- [Counting methodology](https://octocounts.com/docs/methodology)
- [SLOC glossary](https://octocounts.com/docs/glossary)
