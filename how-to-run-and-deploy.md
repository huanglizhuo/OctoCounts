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
cd backend
export GITHUB_TOKEN=github_pat_your_token_here
DATABASE_URL=postgres://octocount:octocount@127.0.0.1:5432/octocounts cargo run
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

### GitHub login in the extension (Chrome Web Store)

The extension's optional "Connect GitHub" login uses a dedicated
extension-only GitHub OAuth App (client ID `Ov23liY7HsMdrzErq8Qv`, shipped in
`extension/src/shared/github-auth.js`). `chrome.identity.getRedirectURL()`
derives the OAuth redirect from the installed extension's ID, so the OAuth
App's **Authorization callback URL** must match the store build exactly:

```
https://gkgjpjdnaklagijmekoolhcpebmoldbj.chromiumapp.org/
```

`gkgjpjdnaklagijmekoolhcpebmoldbj` is the Chrome Web Store item ID. GitHub
OAuth Apps accept a single callback URL, so:

- Local unpacked builds get a different extension ID and cannot complete
  login while the callback points at the store ID. To test login locally,
  temporarily point the callback at the unpacked build's
  `chrome.identity.getRedirectURL()` value, then switch it back before release.
- The Edge Add-ons build has its own extension ID and therefore its own
  redirect URL, which cannot match the OAuth App's single callback URL. The
  login entry point is therefore compiled out of the edge and firefox builds
  (`isLoginSupported()` is false for non-chrome build targets, and their
  manifests omit the `identity` permission); only the Chrome Web Store build
  shows "Connect GitHub". To bring login to Edge, create a second OAuth App
  for the Edge item ID and switch `GITHUB_EXTENSION_OAUTH_CLIENT_ID` to a
  per-target value.

The backend never sees a redirect; it only exchanges the authorization code
server-side (`backend/src/oauth.rs`) using:

| Variable | Default | Notes |
|---|---|---|
| `GITHUB_EXTENSION_OAUTH_CLIENT_ID` | — | Must match the OAuth App above; unset disables the extension-token route |
| `GITHUB_EXTENSION_OAUTH_CLIENT_SECRET` | — | Secret of that OAuth App; keep server-side only |

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
The running stack (Caddy + Cloudflare Tunnel + this API, and other
services in the `sloc-infra` compose file) lives in `huanglizhuo/sloc-infra`.
It pulls the pinned GHCR images — no `docker build`
on the box. To ship a new version: push a tag here, then bump `OCTO_TAG` in
`sloc-infra/secrets/prod.env` and run `make deploy`. Roll back by setting the tag back.

> The old `docker compose up --build -d` flow (build-on-server) is superseded by the
> above. `docker-compose.dev.yml` remains for local development.

### Environment variables

| Variable | Default | Notes |
|---|---|---|
| `GITHUB_TOKEN` | — | Strongly recommended |
| `ANALYSIS_CONCURRENCY` | `2` | Max parallel analysis jobs |
| `DATABASE_URL` | required | Postgres connection string, for example `postgres://user:password@host:5432/octocounts` |
| `BIND_ADDR` | `127.0.0.1:8080` | Backend listen address; Docker Compose overrides this to `0.0.0.0:8080` |
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
| `GITHUB_EXTENSION_OAUTH_CLIENT_ID` | — | GitHub OAuth App client ID for the extension's "Connect GitHub" login (see [Chrome Extension](#chrome-extension)); unset disables the route |
| `GITHUB_EXTENSION_OAUTH_CLIENT_SECRET` | — | Secret for the same OAuth App; server-side only, never ship in the extension |

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

#### Resubmitting flagged URLs (Bing Webmaster Tools exports)

When Bing Webmaster Tools reports stale issues (duplicate meta descriptions,
duplicate titles) on URLs that are already fixed and deployed, resubmit them
so Bing recrawls and clears the flags:

```bash
INDEXNOW_KEY=<same key as Pages> node scripts/resubmit-urls-indexnow.mjs \
  ~/Downloads/octocounts.com_FailingUrls_9_12_2026.csv
```

The script reads any file containing octocounts.com URLs (quoted CSV columns
or bare one-per-line lists), deduplicates, batches, and POSTs them to
IndexNow using the same `{host, key, keyLocation, urlList}` payload the
backend submits. `INDEXNOW_HOST` / `INDEXNOW_ENDPOINT` override the defaults
(`octocounts.com` / `https://api.indexnow.org/indexnow`); `DRY_RUN=1` prints
batches without sending.

Two extra modes (see `docs/seo-index-runbook.md`):

```bash
# Verify the key file the Pages function serves matches the key (SG-08 check)
INDEXNOW_KEY=<key> node scripts/resubmit-urls-indexnow.mjs --verify-key

# Push the core pages (static + compare sitemap children) after a deploy
INDEXNOW_KEY=<key> node scripts/resubmit-urls-indexnow.mjs --core
```

### Cloudflare edge cache and Web Analytics

Applied and checked in the Cloudflare dashboard on 2026-09-27. These settings
live outside this repository; a code deployment does not recreate them.

In the `octocounts.com` zone, keep Cache Rules in this order:

1. `octocounts-public-pages-respect-origin`
   (rule ID `b36d1aef197a4c52aea66e41994ae031`).
2. The existing public SEO pages and read-only API cache rule.
3. The existing retrieval-time AI crawler bypass rule for `/github/`,
   `/compare/`, and `/docs/`. Keep it after the public rules so it can serve
   Markdown for the configured crawler User-Agents.

The first rule uses this exact expression:

```text
http.host eq "octocounts.com" and (http.request.uri.path in {"/" "/compare" "/diff" "/badges" "/extension" "/trending.xml"} or starts_with(http.request.uri.path, "/compare/"))
```

Settings: **Eligible for cache**; Edge TTL = **Use cache-control header if
present, bypass cache if not**; Browser TTL = **Respect origin TTL**. Keep
the default cache key, including the query string. Do not override origin
TTL or add status-code TTL overrides that could cache `private`/`no-store`
responses. The rule is restricted to the frontend host, not the API host.

At verification, these HTML pages sent `s-maxage=300,
stale-while-revalidate=600`: five minutes fresh, with another ten-minute
stale window while revalidating. `/trending.xml` sent `s-maxage=3600,
stale-while-revalidate=86400`. Follow the actual response headers when
changing application policy; do not assume all routes have the same TTL.
For immediate deployment visibility, purge only affected URLs using
**Caching → Configuration → Custom Purge → URL**.

Verification: repeat ordinary GETs to `/`, `/compare`, `/diff`, `/badges`,
`/extension`, `/trending.xml`, and `/compare/react-vs-vue`. All seven showed
`HIT` in the SIN sample after propagation; `Age: 0` immediately after filling
the cache is valid. Existing `/stats` and `/github/facebook/react` also hit.
These samples do not establish global performance or background revalidation
behavior across TTL expiry.

```sh
rtk proxy curl -sS -D - -o /dev/null https://octocounts.com/
rtk proxy curl -sS -D - -o /dev/null 'https://octocounts.com/extension?format=md'
rtk proxy curl -sS -D - -o /dev/null -A 'PerplexityBot/1.0' https://octocounts.com/compare/react-vs-vue
```

Check that normal pages remain HTML, explicit `?format=md` responses are
Markdown under a separate URL key, and the crawler request above remains
Markdown with `private, no-store` and a bypassed/DYNAMIC cache status. A
UA-only `no-store` response prevents insertion into shared cache but cannot
bypass an already-cached HTML response by itself; preserve the crawler rule.

**Web Analytics:** retain the Pages-managed site `octocounts.pages.dev +1`,
which includes `octocounts.com`. Its beacon token is
`71af94b0ca2c4711a817b0cb99d9eb5b`. The separate `octocounts.com` Web Analytics
site has RUM set to **Disable**; its historical record was not deleted.
Both integrations had been enabled, and browser DOM inspection showed two
scripts with different tokens. A single script in curl HTML was insufficient
to detect the duplication. After disabling domain auto-injection and purging
only the homepage URL, browser checks of `/` and `/compare` showed just the
Pages beacon. Analytics report aggregation was not revalidated in that check.

Rollback: disable only `octocounts-public-pages-respect-origin`, leaving the
existing cache and crawler rules intact. To restore the previous duplicate
analytics configuration, set the separate domain site's RUM back to Enable
and Update; do not delete the Pages-managed site. Security settings were not
changed by this work.

### Putting it behind a reverse proxy

For a public domain, put Caddy or Nginx in front:

- Route `/api/*` → `api:8080`
- Route everything else → `web:80`

Or expose them under separate subdomains — whatever your ops setup prefers. OctoCounts doesn't care.

In production today the frontend is hosted on Cloudflare Pages and the API is
reached through a Cloudflare Tunnel back to the VPS backend (see the private
`sloc-infra` repo), so this section only applies to self-hosted single-machine
`docker compose` deployments.
