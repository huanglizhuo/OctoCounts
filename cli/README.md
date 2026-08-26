# OctoCounts CLI

Count source lines of code (SLOC) for any public GitHub repository — no clone needed.
Powered by the [OctoCounts](https://octocounts.com) API (tokei under the hood).

## Usage

```bash
npx octocounts vitejs/vite
npx octocounts https://github.com/tokio-rs/axum --ref main
npx octocounts rust-lang/rust --json
```

Options:

- `--ref <ref>`: branch, tag, or commit SHA.
- `--json`: print the raw OctoCounts report JSON.
- `--api-base <url>`: use a local or alternate OctoCounts API.
- `--sample`: print a local sample report without network calls.

## Related

- [Web app](https://octocounts.com) — analyze any public repo and share a permanent report
- [Browser extension](https://octocounts.com) — SLOC directly inside GitHub's sidebar
- [README badges](https://octocounts.com#badges) — live SLOC badge for any repo
- [MCP server](https://www.npmjs.com/package/octocounts-mcp) — give AI assistants access to SLOC reports

## License

MIT
