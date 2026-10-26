# Count lines of code without cloning the repository

Updated October 27, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

You can count a GitHub repository's lines of code without cloning it: paste the URL into the [OctoCounts web app](https://octocounts.com/) and it downloads the source archive of the requested ref — not the git history — counts it with tokei, and returns files, total lines, code lines, comments, blanks, and per-language totals. Duration depends on repository size, upstream access, queueing, and deployment limits. The [browser extension](https://octocounts.com/extension), report pages, `.md` twins, [badges](https://octocounts.com/badges), and [API](https://octocounts.com/docs/api) all answer from the same archive-based pipeline, so no step ever requires a local clone.

## Why avoid cloning just to count lines?

A full clone includes repository history as well as the current source tree. A source archive contains one revision without that history, which is enough for a line count. Transfer size and duration depend on the repository and network; shallow or partial clones can also reduce transfers. With OctoCounts, archive download and counting happen on the server.

## How do I count lines without cloning?

1. Open the [OctoCounts web app](https://octocounts.com/) and paste the repository URL — for example `https://github.com/react/react`.
2. Optionally pick a branch, tag, or commit SHA. The analysis pins to the exact commit it resolves.
3. OctoCounts downloads the source archive for that ref, runs tokei, and shows files, total lines, code, comments, blanks, and per-language rows.
4. Share the report URL, export text/JSON/PNG, or add a [live badge](https://octocounts.com/badges) to your README.

If you keep reading code on github.com, the [OctoCounts extension](https://octocounts.com/extension) skips even the paste: it adds a SLOC card to the repository sidebar on every public repo page you visit.

## Do git partial clones make no-clone counting unnecessary?

They narrow the gap without closing it. `git clone --depth 1` truncates history but still fetches every file of the latest commit, and `--filter=blob:none` defers file contents until checkout — at which point running `wc`, cloc, or tokei fetches the whole tree anyway. A shallow partial clone of a monorepo can still be hundreds of megabytes on your disk. There are also read-only tricks that avoid git entirely — the [GitHub API page](https://octocounts.com/docs/github-api-count-lines) explains why the API route still cannot give you lines — server-side archive counting is one way to avoid moving the source tree onto your machine.

## Do the numbers match a count on a local clone?

Matching counts require the same actual source tree, tokei version, and effective counting rules, including extraction exclusions and repository attributes. A local checkout at the same commit may differ from an archive: export-ignore can omit paths and export-subst can change file contents. Record the full commit SHA, engine version, options, effective policy, and measurement date; retain the exported JSON and a saved-report link while available. Older reports may lack a complete policy. The filtering pilot measures option effects, not local-versus-server parity. See [Git archive attribute semantics](https://git-scm.com/docs/git-archive).

## What is the fastest way to count lines without cloning?

For a one-off, open `https://octocounts.com/github/:owner/:repo` directly — a warm report can reuse cached counts because results are cached by repository, commit SHA, tokei version, and analysis options. For automation, the [API's](https://octocounts.com/docs/api) `GET /api/reports/:reportId` returns full JSON and the badge endpoints return a ready-made SVG. For scale: in OctoCounts' [2026 pilot](https://octocounts.com/research), archive-based analysis of the react and vite repositories completed in 1.2–1.9 seconds of observed wall time per request; cache and queue state were not controlled.

## When do you still need a clone?

Private repositories — OctoCounts analyzes public github.com repositories only and does not accept uploads — and any analysis that needs local tooling beyond line counts. In those cases clone (shallow if you like) and run [tokei](https://github.com/XAMPPRocky/tokei) or [cloc](https://github.com/AlDanial/cloc) in the checkout; the [full counting guide](https://octocounts.com/docs/count-lines-of-code-github) covers the clone-based commands too.

## How can I verify a count without keeping a clone?

Export the report JSON and retain its full commit SHA, tokei version, generatedAt, selected options and effective countingPolicy. The ten-repository study archives complete reports rather than relying on a live cache. It measures filtering effects on GitHub source archives; it does not establish parity with a local checkout, and request wall time is not a cold-download benchmark.

[Read the October 27, 2026 study and download its raw reports](https://octocounts.com/research#cross-language-2026-10-27).

## Related OctoCounts pages

- [How to count lines of code in a GitHub repository (all four methods)](https://octocounts.com/docs/count-lines-of-code-github)
- [Can the GitHub API count lines of code?](https://octocounts.com/docs/github-api-count-lines)
- [GitHub repository size checker: check before cloning](https://octocounts.com/docs/github-repository-size-checker)
- [Counting methodology](https://octocounts.com/docs/methodology)
- [Pilot study: filtering effects on SLOC counts](https://octocounts.com/research)
