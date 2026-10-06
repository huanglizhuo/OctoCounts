# OctoCounts vs tokei

Updated October 7, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

tokei is a fast, open-source line counter written in Rust, distributed as a command-line tool from [github.com/XAMPPRocky/tokei](https://github.com/XAMPPRocky/tokei) — it counts files, code, comment, and blank lines per language on whatever checkout you point it at. [OctoCounts](https://octocounts.com/) is a web app that runs that same tokei engine server-side on public GitHub repositories: paste a URL, get a report pinned to an exact commit SHA. There is no official tokei web UI, so the choice is not two competing counters but two workflows: install the CLI when the code is on your machine, use the web app when the code is on GitHub and the result needs to be shared.

This is not a matchup of rival engines — OctoCounts runs tokei under the hood. The comparison below is about workflow: where the code lives, how the result is pinned, and what you can do with the numbers afterward.

## Quick comparison

| | tokei (CLI) | OctoCounts (web) |
|---|---|---|
| What it is | Command-line tool (Rust) | Web app + extensions + API, running tokei server-side |
| Install | `cargo install tokei`, brew, or a release binary | None — paste a URL |
| Input | Any directory on your machine | Public github.com repositories, any branch/tag/commit |
| Private code | Yes | No |
| Commit pinning | Whatever checkout you run it on | Every report pinned to an exact commit SHA |
| Output | Terminal table (text/JSON formats) | Linkable report page, PNG card, text/JSON export |
| Sharing | Copy-paste yourself | Stable URL, [README badges](https://octocounts.com/badges), [API](https://octocounts.com/docs/api) |
| Caching | None — each run recounts | Cached by commit + tokei version + options |

## The web side: what OctoCounts adds around tokei

OctoCounts takes a public GitHub repository URL, resolves the requested branch, tag, or commit, downloads that revision's compressed source archive (not the full git history), and runs tokei on it. The report you get back states the commit SHA and the exact tokei version used, breaks out files, total lines, code, comments, and blanks per language, and lives at a stable URL you can paste into a pull request, README, or issue.

- **No install and no clone:** the archive download happens server-side; your disk never touches the repository.
- **Commit-pinned citations:** a report URL names the revision it counted, so numbers stay verifiable after the repository moves on.
- **Reproducibility:** results are cached by repository, commit SHA, tokei version, and analysis options, so re-opening a report reproduces the same numbers.
- **Integrations:** browser extensions for Chrome, Edge, and Firefox show a SLOC card in the GitHub sidebar; a CLI, GitHub Action, and MCP server cover automated use.
- **Limitation:** public GitHub repositories only — no private repositories, no other forges, no source uploads.

## The CLI side: what tokei does on its own

[tokei](https://github.com/XAMPPRocky/tokei) is the counting engine itself. It is written in Rust, recognizes hundreds of languages, and reports files, code, comment, and blank lines grouped by language. Installed with `cargo install tokei`, a system package manager, or a prebuilt release binary, it runs against any directory — a git checkout, a tarball, a folder with no version control at all.

- **Private and local code:** the only path of the two for closed-source projects, local-only experiments, and non-GitHub forges.
- **Works offline:** once installed, counting needs no network at all.
- **Counts the working tree as it is:** uncommitted edits are counted immediately, with no commit required first.
- **Scriptable:** fits directly into shell pipelines and CI jobs on your own runners.
- **Trade-off:** you own the plumbing — getting from "terminal table" to a shared, dated, reproducible citation is manual work.

## Do the numbers match?

Yes, when the inputs match. OctoCounts runs tokei on the source archive of one exact commit; run the same tokei version over the same revision locally with the same options — ignored directories, whether docs, tests, or generated files are included — and the counts agree, because it is the same program doing the counting. The [counting methodology page](https://octocounts.com/docs/methodology) documents the pipeline and the default exclusions. This is also why an OctoCounts report can serve as a citation: it names the engine (tokei, with version), the revision (commit SHA), and the options, which is everything a skeptical reader needs to reproduce the number. Production currently runs tokei 14.0.0; every report shows the version that produced it.

## Which one should I use?

| Scenario | Reach for |
|---|---|
| Check a public repo's size from someone else's machine or a locked-down laptop | OctoCounts |
| Link a count in a PR or issue so others can verify it later | OctoCounts (commit-pinned URL) |
| Cite a codebase size in a paper or report with engine and version named | OctoCounts (report carries tokei version + SHA) |
| Live badge in a README that follows the cached report | OctoCounts [badges](https://octocounts.com/badges) |
| Count private or closed-source code | tokei CLI |
| Count a working tree mid-edit, before any commit exists | tokei CLI |
| Air-gapped or offline environment | tokei CLI |
| Step in a pipeline on your own CI runners | tokei CLI (or the OctoCounts [API](https://octocounts.com/docs/api)/[GitHub Action](https://octocounts.com/docs/faq) for public repos) |
| Code hosted outside github.com | tokei CLI |

**Bottom line:** the code's location decides. On GitHub and public → OctoCounts gives you the same tokei numbers with sharing, pinning, and badges for free; on your machine, private, or mid-edit → install the CLI. Using both is normal: many projects count locally with tokei during development and cite an OctoCounts report when the number needs to travel.

## Frequently Asked Questions

### Is there an official tokei web UI?

No. tokei is distributed as a command-line tool from [github.com/XAMPPRocky/tokei](https://github.com/XAMPPRocky/tokei), and its repository ships no official web service. OctoCounts is an independent web app that runs tokei as its server-side counting engine: paste a public GitHub repository URL and the web app downloads the source archive, runs tokei, and publishes the result as a shareable report. The CLI remains the tool of record for local code.

### Do OctoCounts and local tokei produce the same numbers?

Yes, when the input matches: OctoCounts runs tokei on the repository's source archive at one exact commit, so an OctoCounts report and a local tokei run on the same commit, at the same tokei version, with the same options (ignored directories, docs, tests, generated files) count the same lines. Every OctoCounts report states the tokei version and commit SHA it used, which is what makes the claim checkable rather than promotional.

### Which tokei version does OctoCounts run?

Production currently runs tokei 14.0.0, and every report displays the exact tokei version that produced its numbers next to the commit SHA. Because the version is pinned per report, an old report keeps describing the version that actually counted it, and a citation from OctoCounts names both the commit and the engine version without extra work.

### When is the tokei CLI the only option?

Four cases belong to the CLI: code that is private or not hosted on GitHub (OctoCounts analyzes public GitHub repositories only), machines without reliable network access, counting a working tree mid-edit before anything is committed, and scripted pipelines that must run on your own infrastructure. OctoCounts covers the public-GitHub, share-the-result side of that split.

### Does OctoCounts replace tokei?

No — it wraps tokei for one workflow. OctoCounts downloads a public GitHub repository's archive, runs tokei, and adds commit pinning, caching, shareable URLs, badges, JSON/text/PNG export, an API, and browser extensions. tokei itself is unchanged: install it with `cargo install tokei` or a package manager and count anything on your machine, private code included.

## Related reading

- [OctoCounts vs scc](https://octocounts.com/docs/octocounts-vs-scc)
- [OctoCounts vs cloc, scc, and tokei](https://octocounts.com/docs/octocounts-vs-cloc)
- [tokei online: run tokei on GitHub repositories](https://octocounts.com/docs/tokei-online)
- [GitHub repo size checker](https://octocounts.com/docs/github-repository-size-checker)
- [OctoCounts counting methodology](https://octocounts.com/docs/methodology)
- [Best SLOC counter tools compared](https://octocounts.com/docs/best-sloc-counter-tools)
