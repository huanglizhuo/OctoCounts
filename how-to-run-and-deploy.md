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
| Database | Docker volume | `sloc-dev.db` — survives restarts |

To stop:

```bash
docker compose -f docker-compose.dev.yml down
```

---

## Local Development (Host-native)

If you'd rather not run Docker and enjoy living dangerously:

```bash
GITHUB_TOKEN=github_pat_your_token_here ./run-local.sh
```

Or without a token (rate-limiting incoming):

```bash
./run-local.sh
```

For separate terminals:

**Backend:**
```bash
cd backend
cargo run
# API listens on 127.0.0.1:8080, creates sloc.db automatically
```

With auto-restart on file changes:
```bash
cd backend
GITHUB_TOKEN=github_pat_your_token_here cargo watch -x run
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

It uploads a single Actions artifact named `octocounts-browser-extensions` containing:

| File | Contents | How users load it |
|---|---|---|
| `octocounts-chrome.zip` | `extension/dist/chrome` | Unzip, then Chrome → `chrome://extensions` → **Load unpacked** |
| `octocounts-firefox.zip` | `extension/dist/firefox` | Unzip, then Firefox → `about:debugging` → **This Firefox** → **Load Temporary Add-on** |

To publish a GitHub Release with both zip files attached, push a tag that starts with `extension-v`:

```bash
git tag extension-v0.1.0
git push origin extension-v0.1.0
```

The release workflow attaches both packages to the tag's GitHub Release. Chrome Web Store and Firefox Add-ons still require their own store submission/signing flows; the GitHub Release zips are for users who want to install or test directly from GitHub.

---

## Production Deployment

Tested on a plain VPS. No Kubernetes required, no Helm charts, no regrets.

```bash
cp .env.example .env
# Edit .env — at minimum set GITHUB_TOKEN
docker compose up --build -d
```

Services expose:

| Service | Address |
|---|---|
| API | `http://SERVER_IP:8080` |
| Frontend | `http://SERVER_IP:5173` |

### Environment variables

| Variable | Default | Notes |
|---|---|---|
| `GITHUB_TOKEN` | — | Strongly recommended |
| `ANALYSIS_CONCURRENCY` | `2` | Max parallel analysis jobs |
| `DATABASE_URL` | `sqlite:///data/sloc.db` | SQLite path inside the container |
| `BIND_ADDR` | `0.0.0.0:8080` | Backend listen address |

To stop:
```bash
docker compose down
```

### Putting it behind a reverse proxy

For a public domain, put Caddy or Nginx in front:

- Route `/api/*` → `api:8080`
- Route everything else → `web:80`

Or expose them under separate subdomains — whatever your ops setup prefers. OctoCounts doesn't care.
