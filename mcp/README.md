# OctoCounts MCP Server

Expose [OctoCounts](https://octocounts.com) SLOC reports to AI coding tools (Claude, Cursor, and any MCP client).

Tools:

- `analyze_repo`: count files, lines, code, comments, blanks, and languages for a public GitHub repo.
- `compare_repos`: compare two public GitHub repos or refs.

## Usage

Run via npx (no install needed):

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

Or from a local checkout:

```json
{
  "mcpServers": {
    "octocounts": {
      "command": "node",
      "args": ["/absolute/path/to/OctoCounts/mcp/src/index.js"],
      "env": {
        "OCTOCOUNTS_API_BASE": "https://api.octocounts.com"
      }
    }
  }
}
```

`OCTOCOUNTS_API_BASE` defaults to `https://api.octocounts.com`.

Local protocol smoke test:

```bash
node mcp/src/index.js
```

The server speaks MCP over stdio with `Content-Length` framed JSON-RPC messages.

## License

MIT
