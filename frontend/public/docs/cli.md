# OctoCounts CLI: count lines of code from a terminal

Updated November 24, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

`npx octocounts` counts the source lines of code of a public GitHub repository from a terminal. It sends the repository to the OctoCounts API, waits for the analysis, and prints files, total lines, code lines, comment lines and blank lines per language, or the whole report as JSON with `--json`. Nothing needs installing beyond Node.js, the repository is never cloned, and a repository that was already counted returns its cached report.

Canonical page: https://octocounts.com/docs/cli

## How do I count a repository's lines of code from the command line?

Pass a public GitHub repository as `owner/repo` or as its full URL:

```bash
npx octocounts vitejs/vite
npx octocounts https://github.com/tokio-rs/axum --ref main
npx octocounts rust-lang/rust --json
```

`--ref` selects a branch, tag, or commit SHA. Without it OctoCounts counts the repository's default branch. The CLI needs Node.js and npm: `npx` downloads the `octocounts` package from npm the first time it runs.

## Options

| Option | Purpose |
| --- | --- |
| `--ref <ref>` | Count a specific branch, tag, or commit SHA. |
| `--json` | Print the raw OctoCounts report JSON instead of the table. |
| `--api-base <url>` | Use a local or alternate OctoCounts API. |
| `--respect-gitattributes` | Apply the repository's declared generated and vendored exclusions. Off by default. |
| `--sample` | Print a local sample report without any network calls. |
| `--help` | Show the usage text. |

## What the CLI counts

The CLI counts under the same default scope as every OctoCounts surface: documentation, test and generated directories are excluded, and dependency and build folders are always skipped. The output includes the effective counting policy, or `unknown` for reports stored before options were recorded. With `--respect-gitattributes`, OctoCounts also excludes files the repository marks as generated or vendored in `.gitattributes`; the flag is off by default and keeps existing cache keys. The full rules are on the [methodology page](https://octocounts.com/docs/methodology).

Report links pin the saved result ID and the commit. A saved result is a cache entry: it can expire or be replaced, so export the JSON when a count needs to be kept.

## How the CLI handles failures

Requests allow three safe transient retries and a five-minute total deadline. An analyze request is retried only when the server explicitly rejected it before submission, so the same repository is never analyzed twice by accident. If a job times out, the error keeps its job ID and a recovery URL. The public API limits how many analyses one IP address may start; the limits are listed in the [API docs](https://octocounts.com/docs/api).

## CLI, web app, API, Action, or MCP server?

- Use the **CLI** when a script, terminal, or CI job needs a line count on standard output.
- Use the [web app](https://octocounts.com/) for shareable reports, README badges, and side-by-side comparisons.
- Use the [API](https://octocounts.com/docs/api) when you are writing your own client.
- Use the [GitHub Action](https://octocounts.com/docs/github-action) to comment a pull request's line-count change.
- Use the [MCP server](https://octocounts.com/docs/mcp-server) when an AI coding assistant should look a count up itself.

## CLI FAQ

### Is the OctoCounts CLI free?

Yes. Counting public GitHub repositories is free and needs no account or API token. The public API rate-limits how many analyses one IP address may start per minute; see the API docs.

### Does the CLI clone the repository?

No. The CLI sends the repository URL to the OctoCounts API, which downloads the source archive for the requested commit and counts it with tokei. No Git history is transferred to your machine and no source code is written to disk.

### Can the CLI count a private repository?

No. OctoCounts analyzes public GitHub repositories only and does not accept source uploads. For private code, install tokei or cloc and run it on your checkout; the OctoCounts vs cloc guide shows the matching commands.

### How do I get JSON from the OctoCounts CLI?

Add --json. The CLI then prints the raw OctoCounts report JSON, which includes the per-language rows, the totals, the commit SHA, the tokei version, and the analysis options and counting policy that produced the numbers.

### Can I try the CLI without a network connection?

Yes. npx octocounts --sample prints a bundled sample report without calling the API. Every other command needs network access to the OctoCounts API.

## Related OctoCounts pages

- [OctoCounts API docs](https://octocounts.com/docs/api)
- [GitHub Action: SLOC diff on pull requests](https://octocounts.com/docs/github-action)
- [MCP server for AI coding assistants](https://octocounts.com/docs/mcp-server)
- [OctoCounts Methodology](https://octocounts.com/docs/methodology)
- [OctoCounts vs cloc: command mapping](https://octocounts.com/docs/octocounts-vs-cloc)
- [All OctoCounts guides](https://octocounts.com/docs)