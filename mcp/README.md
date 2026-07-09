# OctoCounts MCP Server

Expose OctoCounts reports to AI coding tools.

Tools:

- `analyze_repo`: count files, lines, code, comments, blanks, and languages for a public GitHub repo.
- `compare_repos`: compare two public GitHub repos or refs.

Claude/Cursor-style config:

```json
{
  "mcpServers": {
    "octocounts": {
      "command": "node",
      "args": ["/absolute/path/to/OctoCount/mcp/src/index.js"],
      "env": {
        "OCTOCOUNTS_API_BASE": "https://api.octocounts.com"
      }
    }
  }
}
```

Local protocol smoke test:

```bash
node mcp/src/index.js
```

The server speaks MCP over stdio with `Content-Length` framed JSON-RPC messages.
