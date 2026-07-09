# OctoCounts CLI

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
