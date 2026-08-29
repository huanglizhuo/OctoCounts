# How to Run & Deploy OctoCounts

## Local Development (Docker — recommended)

Docker Compose runs both services with watch mode and keeps build artifacts in volumes, so you're not reinstalling `node_modules` every time you breathe.

```bash
cp .env.example .env
```

Open `.env` and set `GITHUB_TOKEN`. It's optional, but without it GitHub will rate-limit you after about three requests and you'll spend the rest of the afternoon confused.

```bash
docker compose -f docker-compose.dev.yml up --build
```

Open `http://127.0.0.1:5173` and you're done.

What's running:

| Service | URL | Notes |
|---|---|---|
| Backend API | `http://127.0.0.1:8080` | Restarted by `cargo-watch` on changes |
| Frontend | `http://127.0.0.1:5173` | Vite HMR |
| Database | Docker volume | Postgres 17 — survives restarts |

To stop:

```bash
docker compose -f docker-compose.dev.yml down
```

---

## Local Development (Host-native)

If you'd rather not run Docker and enjoy living dangerously, start a local Postgres database first and set `DATABASE_URL` to it.

For separate terminals:

**Backend:**
```bash
cd backend
export DATABASE_URL=postgres://octocount:octocount@127.0.0.1:5432/octocounts
cargo run
# API listens on 127.0.0.1:8080 and creates Postgres tables automatically
```

With auto-restart on file changes:
```bash
cd backend
DATABASE_URL=postgres://octocount:octocount@127.0.0.1:5432/octocounts GITHUB_TOKEN=github_pat_your_token_here cargo watch -x run
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# Talks to 127.0.0.1:8080 by default. Override with VITE_API_BASE.
```

---

## GitHub Token

Without a token, GitHub's unauthenticated rate limit is 60 requests/hour per IP. That sounds fine until three people use the app at the same time.

Create a fine-grained personal access token:

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens**
2. Generate a token with **read-only public repository access** (or just read-only metadata)
3. Copy it

For host-native runs:
```bash
export GITHUB_TOKEN=github_pat_your_token_here
./run-local.sh
```

For Docker Compose, put it in `.env`:
```
GITHUB_TOKEN=github_pat_your_token_here
```

---

## Chrome Extension

The Chrome extension lives in `extension/`. Its production build creates an unpacked Manifest V3 extension in `extension/dist/chrome`.

Build it:

```bash
cd extension
npm install
npm run build:chrome
```

For local extension development with rebuilds on file changes:

```bash
cd extension
npm install
npm run dev
```

Load it in Chrome:

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select the repo's `extension/dist/chrome` folder
5. Open a GitHub repository page, for example `https://github.com/OWNER/REPO`

After changing extension code, rebuild or keep `npm run dev` running, then click **Reload** on the OctoCounts extension card in `chrome://extensions`. Refresh the GitHub tab after reloading the extension.

Notes:

- Chrome must load `extension/dist/chrome`, not the source `extension/` directory.
- The current extension build talks to `https://api.octocounts.com` from `extension/src/shared/api.js`, so it uses the deployed API by default.
- The Chrome manifest is copied from `extension/manifests/manifest.chrome.json` during the build.

### Extension release flow

GitHub Actions builds and packages both browser extensions from `.github/workflows/extension-release.yml`.

On pull requests that touch `extension/**`, and on pushes to `main`, the workflow runs:

```bash
cd extension
npm ci
npm run build
```

It uploads two separate Actions artifacts. The filenames include the extension version and the short commit hash:

| File | Contents | How users load it |
|---|---|---|
| `octocounts-chrome-v0.1.0-abc12345.zip` | `extension/dist/chrome` | Unzip, then Chrome → `chrome://extensions` → **Load unpacked** |
| `octocounts-firefox-v0.1.0-abc12345.zip` | `extension/dist/firefox` | Unzip, then Firefox → `about:debugging` → **This Firefox** → **Load Temporary Add-on** |

To publish a GitHub Release with both zip files attached, push a tag that starts with `extension-v`:

```bash
git tag extension-v0.1.0
git push origin extension-v0.1.0
```

The release workflow attaches both packages to the tag's GitHub Release. Chrome Web Store and Firefox Add-ons still require their own store submission/signing flows; the GitHub Release zips are for users who want to install or test directly from GitHub.

---

## Production Deployment

Production is **not** built on the server. CI builds the images and the private
infra repo deploys them.

**1. Images — built by CI, pushed to GHCR.**
`.github/workflows/build-images.yml` builds the backend and frontend on every push
to `main` and on `v*` tags, publishing:

| Image | Contents |
|---|---|
| `ghcr.io/huanglizhuo/octocounts-api` | backend (`backend/`) |
| `ghcr.io/huanglizhuo/octocounts-web` | frontend (`frontend/`) |

Cut a release by pushing a version tag (`git tag v0.4.0 && git push origin v0.4.0`),
which also tags the images `:v0.4.0` and `:latest`.

**2. Deploy — from the private `sloc-infra` repo.**
The running stack (Caddy + Cloudflare Tunnel + this API, and the librivox service)
lives in `huanglizhuo/sloc-infra`. It pulls the pinned GHCR images — no `docker build`
on the box. To ship a new version: push a tag here, then bump `OCTO_TAG` in
`sloc-infra/secrets/prod.env` and run `make deploy`. Roll back by setting the tag back.

> The old `docker compose up --build -d` flow (build-on-server) is superseded by the
> above. `docker-compose.dev.yml` remains for local development.

### Environment variables

| Variable | Default | Notes |
|---|---|---|
| `GITHUB_TOKEN` | — | Strongly recommended |
| `ANALYSIS_CONCURRENCY` | `2` | Max parallel analysis jobs |
| `DATABASE_URL` | required | Postgres connection string, for example a Neon pooled URL |
| `BIND_ADDR` | `0.0.0.0:8080` | Backend listen address |
| `CLEANUP_INTERVAL_SECONDS` | `3600` | Storage cleanup cadence |
| `JOB_RETENTION_COMPLETED_DAYS` | `1` | Retain completed/failed jobs this many days |
| `JOB_RETENTION_STALE_HOURS` | `6` | Retain stale queued/running jobs this many hours |
| `REPORT_MIN_RETENTION_DAYS` | `30` | Never evict reports younger than this |
| `REPORT_MAX_ROWS` | `20000` | LRU-style report cap |
| `REPORT_CLEANUP_BATCH_SIZE` | `1000` | Max report rows deleted per cleanup batch |
| `INDEXNOW_ENABLED` | `true` | Submit new/updated canonical report URLs to IndexNow (no-op unless `INDEXNOW_KEY` is set) |
| `INDEXNOW_KEY` | — | Required when enabled; must match the Pages-side `INDEXNOW_KEY` |
| `INDEXNOW_HOST` | `octocounts.com` | Host that submitted URLs and the key file belong to |
| `INDEXNOW_KEY_LOCATION` | `https://<INDEXNOW_HOST>/<INDEXNOW_KEY>.txt` | Public URL of the key file |
| `INDEXNOW_BATCH_SIZE` | `100` | Max URLs per IndexNow request |
| `INDEXNOW_MAX_RETRIES` | `3` | Retries per batch after the first attempt (exponential backoff) |
| `INDEXNOW_TIMEOUT_SECONDS` | `10` | Per-request HTTP timeout |
| `INDEXNOW_DRY_RUN` | `false` | Log batches without sending HTTP requests (testing) |
| `INDEXNOW_ENDPOINT` | `https://api.indexnow.org/indexnow` | Submission endpoint; override to point at a mock server |

### IndexNow submission

When `INDEXNOW_ENABLED=true`, the backend submits the canonical URL of a report
page to IndexNow whenever a report is newly created or materially updated
(cache hits never trigger submissions). Submissions are batched, deduplicated,
and retried with backoff; failures are only logged and never affect analysis
or report persistence.

Deployment requirement: IndexNow verifies ownership by fetching the key file at
`https://<INDEXNOW_HOST>/<INDEXNOW_KEY>.txt`. The backend does **not** serve
this file — it is served by a Cloudflare Pages function on `octocounts.com`
that reads the Pages environment variable `INDEXNOW_KEY`. You must therefore
set the **same** `INDEXNOW_KEY` in two places:

1. Cloudflare Pages project env var `INDEXNOW_KEY` (serves the key file), and
2. the backend environment (`INDEXNOW_ENABLED=true` + `INDEXNOW_KEY`).

The key must be a hex/alphanumeric token (8–128 characters) of your choosing.
Set `INDEXNOW_DRY_RUN=true` first if you want to verify wiring in the logs
before real submissions go out.

### Cloudflare edge cache rule for `/` and `/compare/*`

The Pages Function already sends `Cache-Control: public, s-maxage=3600,
stale-while-revalidate=86400` for the homepage and every `/compare/*` page —
identical to what `/github/*` report pages send. Report pages hit Cloudflare's
edge cache (`cf-cache-status: HIT`); the homepage and compare pages currently
don't (`cf-cache-status: DYNAMIC` on every request), because Cloudflare does
not cache HTML by origin `Cache-Control` alone — it needs a **Cache Rule**
that explicitly makes HTML documents on those paths eligible, matching
whatever rule already covers `/github/*`. This is dashboard/API configuration
outside this repo (no Terraform/wrangler cache-rule config exists here), so it
can't be fixed by a code change — apply it by hand:

1. Cloudflare dashboard → the `octocounts.com` zone → **Rules → Cache Rules**.
2. Open the existing rule that covers `/github/*` (or find it under **Caching
   → Configuration** if it's a Cache Level: Cache Everything Page Rule
   instead) and note its exact match/eligibility settings.
3. Add `/` (exact) and `/compare/*` to that rule's URL match, or duplicate it
   with those paths — "Eligible for cache" + "Respect origin TTL" so it keeps
   honoring the `s-maxage=3600` the Function already sends.
4. Verify with `curl -sI https://octocounts.com/ | grep -i cf-cache-status`
   and the same for a `/compare/*` URL — expect `HIT` on the second request
   within an hour, matching `/github/*` today.

To stop:
```bash
docker compose down
```

### Putting it behind a reverse proxy

For a public domain, put Caddy or Nginx in front:

- Route `/api/*` → `api:8080`
- Route everything else → `web:80`

Or expose them under separate subdomains — whatever your ops setup prefers. OctoCounts doesn't care.
