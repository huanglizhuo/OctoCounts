<p align="center">
  <img src="images/octo-count.png" alt="OctoCounts logo" width="520">
</p>

# OctoCounts

OctoCounts is a fast, self-hosted source line counter for public GitHub repositories. Paste a GitHub repo URL, optionally choose a ref, and get a polished report with language totals for files, lines, code, comments, and blanks.

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

## Local Development

Docker Compose is the recommended local workflow because it runs both services with watch mode and keeps build/dependency artifacts in Docker volumes.

```bash
cp .env.example .env
```

Edit `.env` and set `GITHUB_TOKEN` if you have one. The token is optional, but strongly recommended because unauthenticated GitHub API requests are rate-limited quickly.

```bash
docker compose -f docker-compose.dev.yml up --build
```

Then open `http://127.0.0.1:5173`.

The dev stack provides:

- Backend API on `http://127.0.0.1:8080`, restarted by `cargo-watch`.
- Frontend on `http://127.0.0.1:5173`, updated by Vite HMR.
- SQLite data in a Docker volume at `/data/sloc-dev.db`.
- Cargo and `node_modules` caches in Docker volumes.

Stop the dev stack:

```bash
docker compose -f docker-compose.dev.yml down
```

### Host Development

You can also run both services directly on the host:

```bash
GITHUB_TOKEN=github_pat_your_token_here ./run-local.sh
```

Then open `http://127.0.0.1:5173`.

You can also run without a token, but GitHub will rate-limit requests more quickly:

```bash
./run-local.sh
```

For separate terminals:

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

For backend auto-restart outside Docker, install `cargo-watch` and run:

```bash
cd backend
GITHUB_TOKEN=github_pat_your_token_here cargo watch -x run
```

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

For Docker Compose, put the token in `.env`:

```bash
GITHUB_TOKEN=github_pat_your_token_here
```

## API

- `POST /api/analyze` with `{ "repoUrl": "https://github.com/owner/repo", "refName": "main" }`
- `GET /api/jobs/:jobId`
- `GET /api/reports/:reportId`

## Deployment

Use the production Docker Compose file for a VPS or server:

```bash
cp .env.example .env
```

Edit `.env` for production. At minimum set `GITHUB_TOKEN`; optionally tune `ANALYSIS_CONCURRENCY`.

Start the production stack:

```bash
docker compose up --build -d
```

Production compose exposes:

- API: `http://SERVER_IP:8080`
- Web UI: `http://SERVER_IP:5173`

Common production environment variables:

- `GITHUB_TOKEN`: raises GitHub API limits.
- `ANALYSIS_CONCURRENCY`: number of bounded analysis jobs, default `2`.
- `DATABASE_URL`: SQLite path, default `sqlite:///data/sloc.db`.
- `BIND_ADDR`: backend listen address, default `0.0.0.0:8080`.

Stop production:

```bash
docker compose down
```

For a public domain, put Caddy or Nginx in front of the services. Route frontend traffic to `web:80` and API traffic to `api:8080`, or expose them under separate hostnames.
