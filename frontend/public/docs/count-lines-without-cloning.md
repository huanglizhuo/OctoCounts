# Count lines of code without cloning the repository

Updated October 15, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

You can count a GitHub repository's lines of code without cloning it: paste the URL into the [OctoCounts web app](https://octocounts.com/) and it downloads the source archive of the requested ref — not the git history — counts it with tokei, and returns files, total lines, code lines, comments, blanks, and per-language totals in seconds. The [browser extension](https://octocounts.com/extension), report pages, `.md` twins, [badges](https://octocounts.com/badges), and [API](https://octocounts.com/docs/api) all answer from the same archive-based pipeline, so no step ever requires a local clone.

## Why avoid cloning just to count lines?

A git clone downloads the full history: every revision of every file that ever existed on the default branch. The linux repository's git history is measured in gigabytes, while a single snapshot of its source tree is a few hundred megabytes compressed — and that snapshot is all a line counter reads. Counting lines of code needs files, not history, so for size checks the clone is nearly all waste: minutes of transfer and gigabytes of disk for one number. The [repository size checker guide](https://octocounts.com/docs/github-repository-size-checker) covers how to estimate that size *before* deciding to clone.

## How do I count lines without cloning?

1. Open the [OctoCounts web app](https://octocounts.com/) and paste the repository URL — for example `https://github.com/facebook/react`.
2. Optionally pick a branch, tag, or commit SHA. The analysis pins to the exact commit it resolves.
3. OctoCounts downloads the source archive for that ref, runs tokei, and shows files, total lines, code, comments, blanks, and per-language rows.
4. Share the report URL, export text/JSON/PNG, or add a [live badge](https://octocounts.com/badges) to your README.

If you keep reading code on github.com, the [OctoCounts extension](https://octocounts.com/extension) skips even the paste: it adds a SLOC card to the repository sidebar on every public repo page you visit.

## Do git partial clones make no-clone counting unnecessary?

They narrow the gap without closing it. `git clone --depth 1` truncates history but still fetches every file of the latest commit, and `--filter=blob:none` defers file contents until checkout — at which point running `wc`, cloc, or tokei fetches the whole tree anyway. A shallow partial clone of a monorepo can still be hundreds of megabytes on your disk. There are also read-only tricks that avoid git entirely — the [GitHub API page](https://octocounts.com/docs/github-api-count-lines) explains why the API route still cannot give you lines — which leaves archive-based counting as the only route that never moves the repository onto your machine.

## Do the numbers match a count on a local clone?

Yes, when the inputs match. OctoCounts counts the source archive of one exact commit with tokei; check out the same commit locally and run the same tokei version with the same options, and the counts agree — it is the same program reading the same bytes. Every report records its commit SHA, tokei version, and analysis options so the claim is checkable; the [counting methodology](https://octocounts.com/docs/methodology) documents the pipeline and the [filtering-effects pilot study](https://octocounts.com/research) publishes the raw measurements (collected with tokei 12.1 on 2026-09-08; production now runs tokei 14.0.0).

## What is the fastest way to count lines without cloning?

For a one-off, open `https://octocounts.com/github/:owner/:repo` directly — a warm report renders instantly because results are cached by repository, commit SHA, tokei version, and analysis options. For automation, the [API's](https://octocounts.com/docs/api) `GET /api/reports/:reportId` returns full JSON and the badge endpoints return a ready-made SVG. For scale: in OctoCounts' [2026 pilot](https://octocounts.com/research), archive-based analysis of the react and vite repositories completed in 1.2–1.9 seconds per request, end to end, on a cold queue.

## When do you still need a clone?

Private repositories — OctoCounts analyzes public github.com repositories only and does not accept uploads — and any analysis that needs local tooling beyond line counts. In those cases clone (shallow if you like) and run [tokei](https://github.com/XAMPPRocky/tokei) or [cloc](https://github.com/AlDanial/cloc) in the checkout; the [full counting guide](https://octocounts.com/docs/count-lines-of-code-github) covers the clone-based commands too.

## Related OctoCounts pages

- [How to count lines of code in a GitHub repository (all four methods)](https://octocounts.com/docs/count-lines-of-code-github)
- [Can the GitHub API count lines of code?](https://octocounts.com/docs/github-api-count-lines)
- [GitHub repository size checker: check before cloning](https://octocounts.com/docs/github-repository-size-checker)
- [Counting methodology](https://octocounts.com/docs/methodology)
- [Pilot study: filtering effects on SLOC counts](https://octocounts.com/research)
