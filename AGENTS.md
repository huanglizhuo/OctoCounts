# OctoCounts agent instructions

## Code discovery: use codebase-memory MCP first

This repository is indexed by `codebase-memory-mcp`. For symbols, implementations,
callers, dependencies, architecture, and impact analysis, use the graph before
filesystem search. Do not start with repository-wide `rg`, `grep`, `find`, globbing,
or reading whole source files to discover code.

### Project configuration

- MCP server: `codebase-memory-mcp`.
- Graph project: **`OctoCounts`** (case-sensitive; pass `project: "OctoCounts"`).
- Local checkout: `/Users/lizhuo/owork/sloc`.
- Index mode: `full`, including frontend, backend, extension, scripts, and docs
  that the indexer supports; existing `.gitignore` exclusions remain effective.
- Local MCP executable: `/Users/bytedance/.local/bin/codebase-memory-mcp`.
- The host already registers this server in `~/.codex/config.toml`; do not add a
  duplicate server or overwrite unrelated host configuration.
- The index is local to this host. Another host/checkout must register the MCP
  server and index its own absolute repository path before using these examples.

### Session startup and freshness

1. At session start or after compaction, call `list_projects`, then
   `index_status({"project":"OctoCounts"})`. Verify the returned root matches
   the active checkout; do not use an index of another worktree by accident.
2. Use Verify (Tier 2) by default. For a quick positive lookup, Scout is allowed
   with provisional conclusions; for an exhaustive bounded audit, use Auditor.
3. If the project is missing, initialize it with:

   ```json
   {"repo_path":"/absolute/path/to/OctoCounts","name":"OctoCounts","mode":"full"}
   ```

   Pass this object to `index_repository`. Use the actual checkout path.
4. Before relying on a result, check file freshness with `check_index_coverage`.
   The host's `auto_watch` was **false** when configured on 2026-09-08. Do not
   assume background refresh is active, or enable global watching for unrelated
   repositories merely to work here. When relevant source has changed, refresh
   this repository with `index_repository` before subsequent graph analysis.
   Batch refreshes after coherent edits, not after every keystroke.
5. If watching is enabled later, allow normal background refresh; reindex only
   when missing/stale or an immediate refresh is needed. Query current status;
   do not treat historical node counts or generation timestamps as freshness.

### Query workflow

1. **Discover:** `search_graph` with `name_pattern`, `query`, and a bounded
   `file_pattern` or `label` where useful.
2. **Trace:** `trace_path` with the exact qualified name returned by discovery.
   Use `inbound` for callers, `outbound` for callees, or `both` when both matter.
3. **Read:** `get_code_snippet` for the discovered qualified symbol. Do not guess
   qualified names or infer implementation details from symbol names alone.
4. **Validate coverage:** call `check_index_coverage` once with all files cited
   or changed for the current question. Include bounded `scopes` for negative or
   exhaustive claims. Inspect its generation and freshness metadata.
5. **Broader questions:** use `get_architecture` for orientation; inspect the
   schema before complex `query_graph` queries. Use `detect_changes` with its
   documented committed-diff semantics; it is not evidence that uncommitted
   changes have been indexed.

Paginate `search_graph` while `has_more` is true when completeness is needed.
For `trace_path`, follow `next` as `cursor` with the same arguments when
`truncated` is true. Narrow large queries before paging. Degree counts are not
caller counts; obtain callers from `trace_path`.

Examples (tool argument objects, not shell commands):

```text
search_graph({"project":"OctoCounts","name_pattern":"^useAnalysisRunner$","label":"Function","limit":10})
search_graph({"project":"OctoCounts","name_pattern":"^runAnalysis$","label":"Function","limit":10})
search_graph({"project":"OctoCounts","name_pattern":"^analyze_reports$","label":"Method","limit":10})
```

After rediscovering the current qualified name:

```text
trace_path({"project":"OctoCounts","function_name":"OctoCounts.frontend.src.useAnalysisRunner.runAnalysis","direction":"both","depth":1,"limit":50})
get_code_snippet({"project":"OctoCounts","qualified_name":"OctoCounts.frontend.src.useAnalysisRunner.runAnalysis"})
check_index_coverage({"project":"OctoCounts","paths":["frontend/src/useAnalysisRunner.ts","frontend/src/main.tsx","frontend/src/api.ts"]})
```

### Focused source fallback, not a full-repository search

Graph coverage is best-effort. A clean result means no recorded gap, not proven
completeness. Missing search results do not prove a symbol or behavior is absent.

- For `partial`, `skipped`, `excluded`, stale, pending, or unknown coverage, read
  the reported file/ranges and search only the relevant bounded scope as needed.
- Literal strings, CSS declarations, translated copy, configuration values,
  Markdown, and other non-structural text may require `search_code` or a targeted
  `rg`; the graph does not replace exact text inspection for these questions.
- Full indexing on 2026-09-08 reported partial parsing in `frontend/index.html`
  (line 257), `frontend/nginx.conf` (lines 1–68), and
  `frontend/public/docs/faq.html` (line 279). These are historical hints: obtain
  current ranges from `check_index_coverage`, then inspect them directly.
- Build output, dependencies, screenshots, and binary media are intentionally
  excluded. Do not remove ignore rules just to make coverage appear complete.
- If MCP is unavailable, report the limitation and try the same graph tools via
  the installed CLI before falling back to bounded source discovery. Never claim
  a successful graph query when the transport or index failed.

### MCP connection recovery

The installed CLI exposes the same graph tools and can be used if this task's
MCP transport is closed. These local commands were verified during setup:

```sh
rtk proxy /Users/bytedance/.local/bin/codebase-memory-mcp cli --json index_status --project OctoCounts
rtk proxy /Users/bytedance/.local/bin/codebase-memory-mcp cli --json search_graph --project OctoCounts --name-pattern '^useAnalysisRunner$' --label Function --limit 10
rtk proxy /Users/bytedance/.local/bin/codebase-memory-mcp cli --json index_repository --repo-path /Users/bytedance/traeProjects/OctoCounts --name OctoCounts --mode full
```

A new/reconnected MCP session can call the server directly. If startup reports
`pre-coordination or unverified CBM generation`, inspect the worker log and
active daemon first. Do not delete databases, remove held locks, bypass daemon
coordination, or kill all CBM clients as a routine recovery step. Shared daemon
maintenance can interrupt other tasks; prefer the working CLI or an orderly
reconnect. Preserve the existing iOS/Android project indexes.

### Subagents

Before delegating code exploration, the parent must query the graph and coverage.
Pass the project/root, evidence tier, generation/freshness, bounded scope, exact
symbols and paths, relevant call relationships, query pagination state, coverage
gaps, completed source fallback, and unresolved questions. Do not assume children
inherit MCP access. A child without MCP must use supplied evidence and focused
source reads, and disclose that limitation.

## Workspace changes and shell commands

- Preserve existing user and other-agent changes; do not revert unrelated work.
- Prefix shell commands with `rtk`; use `rtk proxy` for tools without a filter.
- Keep generated index databases and local diagnostic logs outside tracked
  product source. No graph artifact needs to be committed for this local setup.
