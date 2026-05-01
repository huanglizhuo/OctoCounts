<p align="center">
  <img src="images/octo-count.png" alt="OctoCount logo" width="520">
</p>

# OctoCount

OctoCount is a fast, self-hosted source line counter for public GitHub repositories. Paste a GitHub repo URL, optionally choose a ref, and get a polished report with language totals for files, lines, code, comments, and blanks.

The app is built for developers who want quick SLOC visibility without cloning repositories locally.

## Features

- Public GitHub repository analysis by URL.
- Branch, tag, or commit ref support.
- GitHub archive download instead of `git clone`.
- Accurate language statistics through `tokei`.
- SQLite-backed job and report cache.
- Background analysis jobs with polling.
- Sortable, expandable report table.
- Copy report as text or JSON.
- Docker Compose setup for VPS deployment.

## Stack

- Backend: Rust, Axum, Tokio, Reqwest, SQLite via SQLx, Tokei for language statistics.
- Frontend: React, Vite, TypeScript, TanStack Query.

## Run Locally

For higher GitHub API limits, create a GitHub token and pass it as `GITHUB_TOKEN`.

### Docker Dev

Run both services in Docker with file watching:

```bash
cp .env.example .env
```

Edit `.env` and set `GITHUB_TOKEN` if you have one. Then start the dev stack:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Then open `http://127.0.0.1:5173`.

The dev stack runs:

- Backend API on `http://127.0.0.1:8080` with `cargo-watch`.
- Frontend on `http://127.0.0.1:5173` with Vite HMR.
- SQLite data in a Docker volume at `/data/sloc-dev.db`.
- Cargo and `node_modules` caches in Docker volumes.

### Host Dev

Run both services in one terminal:

```bash
GITHUB_TOKEN=github_pat_your_token_here ./run-local.sh
```

Then open `http://127.0.0.1:5173`.

You can also run without a token, but GitHub will rate-limit requests more quickly:

```bash
./run-local.sh
```

Or run them separately:

```bash
cd backend
cargo run
```

The API listens on `127.0.0.1:8080` by default and creates `sloc.db` automatically.

```bash
cd frontend
npm install
npm run dev
```

The frontend expects the API at `http://127.0.0.1:8080`. Override with `VITE_API_BASE`.

## GitHub Token

Create a fine-grained personal access token in GitHub:

1. Open GitHub `Settings` -> `Developer settings` -> `Personal access tokens`.
2. Choose `Fine-grained tokens`.
3. Generate a token with read-only public repository access or read-only metadata.
4. Copy the token and provide it as `GITHUB_TOKEN`.

Example:

```bash
export GITHUB_TOKEN=github_pat_your_token_here
./run-local.sh
```

## API

- `POST /api/analyze` with `{ "repoUrl": "https://github.com/owner/repo", "refName": "main" }`
- `GET /api/jobs/:jobId`
- `GET /api/reports/:reportId`

## VPS Notes

Set `GITHUB_TOKEN` to raise GitHub API limits, `DATABASE_URL` for the SQLite path, `BIND_ADDR` for the listen address, and `ANALYSIS_CONCURRENCY` for bounded analysis workers.

Docker Compose is included:

```bash
GITHUB_TOKEN=ghp_xxx docker compose up --build
```

This exposes the API on `:8080` and the web UI on `:5173`.
