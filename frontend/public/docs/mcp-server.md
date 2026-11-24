# OctoCounts MCP server: line counts for AI coding assistants

Updated November 24, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

The OctoCounts MCP server gives an AI coding assistant two tools, `analyze_repo` and `compare_repos`, for counting the source lines of code of public GitHub repositories. The assistant calls a tool with a repository URL; the server asks the OctoCounts API, waits for the analysis, and returns the totals with the counting rules that produced them. It runs over stdio through `npx octocounts-mcp`, needs no account or token, and never clones the repository to your machine.

Canonical page: https://octocounts.com/docs/mcp-server

## How do I add the OctoCounts MCP server to a client?

Register the server in the MCP client configuration of Claude, Cursor, or any other MCP client:

```json
{
  "mcpServers": {
    "octocounts": {
      "command": "npx",
      "args": ["-y", "octocounts-mcp"]
    }
  }
}
```

To run it from a local checkout of the OctoCounts repository instead of the npm package, point `command` at `node` and `args` at `mcp/src/index.js` in that checkout, and set `OCTOCOUNTS_API_BASE` if the API does not live at its default address.

## Tools

| Tool | Required arguments | Optional arguments | Returns |
| --- | --- | --- | --- |
| `analyze_repo` | `repo_url` (GitHub URL or `owner/repo`) | `ref` (branch, tag, or commit SHA), `respect_gitattributes` | Files, total lines, code lines, comments, blanks, and languages for the repository. |
| `compare_repos` | `left_repo_url`, `right_repo_url` | `left_ref`, `right_ref`, `respect_gitattributes` | A side-by-side comparison of two public GitHub repositories or refs. |

## What the tools return

Both tools accept the optional boolean `respect_gitattributes`, which is off by default. Turning it on excludes repository-declared generated and vendored files under the canonical profile; `compare_repos` applies the same setting to both sides. Results carry the effective counting policy, or unknown for reports stored before options were recorded. Report links pin the saved result ID and the commit SHA.

`compare_repos` output includes `counting_policy_compatibility`: `same`, `different`, or `unknown`. It also explains that deltas are net size changes between two counted trees, not the lines Git reports as added or deleted.

## How the server handles failures and cancellation

Analysis requests use bounded safe retries, long-polling, and a five-minute total deadline. Errors keep the job ID and a recovery URL, so an analysis that finished after the client stopped waiting can still be collected. A stdio client may send `notifications/cancelled` with the original request ID; an HTTP request cancels its wait when the client disconnects. Cancellation stops the client's wait only: a job the backend already accepted can still finish and be recovered. Saved records can expire from the cache.

## Scope and protocol

The server analyzes public GitHub repositories only. Private repositories and source uploads are not supported, and no GitHub login is exchanged. It speaks MCP over stdio with newline-delimited JSON-RPC messages, one JSON object per line. `OCTOCOUNTS_API_BASE` overrides the API base and defaults to `https://api.octocounts.com`. The server is published on npm as `octocounts-mcp`. What the API stores is described in the [privacy policy](https://octocounts.com/privacy).

## MCP server FAQ

### Which AI tools can use the OctoCounts MCP server?

Any client that supports the Model Context Protocol over stdio, including Claude and Cursor. The server is registered like any other local MCP server, with npx as the command and octocounts-mcp as the package.

### Is the OctoCounts MCP server free?

Yes. It calls the public OctoCounts API, which counts public GitHub repositories without an account or token. The API rate-limits how many analyses one IP address may start per minute; see the API docs.

### Can the MCP server count a private repository?

No. OctoCounts analyzes public GitHub repositories only and does not accept source uploads. For private code, run tokei locally on the checkout instead.

### What is the difference between analyze_repo and compare_repos?

analyze_repo returns the line counts of one repository or ref. compare_repos analyzes two repositories or refs and returns both results side by side with their counting-policy compatibility, so the assistant can state whether the two counts are comparable.

### Does the MCP server copy repository code to my machine?

No. The server sends the repository URL to the OctoCounts API, which downloads the source archive for the requested commit and counts it with tokei. Only the resulting numbers travel back to the client.

## Related OctoCounts pages

- [OctoCounts CLI: count SLOC from a terminal](https://octocounts.com/docs/cli)
- [GitHub Action: SLOC diff on pull requests](https://octocounts.com/docs/github-action)
- [OctoCounts API docs](https://octocounts.com/docs/api)
- [OctoCounts Methodology](https://octocounts.com/docs/methodology)
- [All OctoCounts guides](https://octocounts.com/docs)