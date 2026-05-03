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

## Production Deployment

The recommended free setup: **Oracle Cloud (backend) + Cloudflare Pages (frontend)**. Both are genuinely free, not "free until you forget to set a spending limit" free.

| Part | Service | Cost |
|---|---|---|
| Backend + DB | Oracle Cloud Always Free (ARM VM) | $0 forever |
| Frontend | Cloudflare Pages | $0 forever |
| Egress | Oracle Cloud includes 10TB/month | $0 for any sane traffic level |

---

### Backend — Oracle Cloud Always Free VM

Oracle's Always Free tier gives you up to 4 ARM (Ampere A1) OCPUs and 24GB RAM to split however you like. One instance with 1 OCPU and 6GB RAM is more than enough for OctoCounts. You also get 200GB of block storage total.

**One fair warning:** Oracle will reclaim ARM instances that sit idle (CPU, network, and memory all under 20%) for 7 consecutive days. A public-facing app with any traffic won't hit this. If you're running it as a private demo with zero visitors, schedule a cron job to ping it occasionally.

#### 1. Create the instance

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) — a credit card is required for identity verification, but you won't be charged for Always Free resources.
2. Go to **Compute → Instances → Create Instance**.
3. Under **Shape**, click **Change shape** → **Ampere** → select `VM.Standard.A1.Flex`.
4. Set **1 OCPU** and **6GB RAM** (or more if you want headroom).
5. Under **Image**, choose **Ubuntu 22.04**.
6. Under **Networking**, make sure **Assign a public IPv4 address** is checked.
7. Add your SSH public key.
8. Click **Create**. Note the public IP once it's running.

#### 2. Open ports in the firewall

Oracle's default security list blocks everything. Open ports 80 and 443 (or 8080 if you're skipping a reverse proxy):

1. Go to **Networking → Virtual Cloud Networks → your VCN → Security Lists**.
2. Add ingress rules for TCP port **80**, **443**, and **8080** from source `0.0.0.0/0`.

Also open them in the OS firewall on the instance itself:

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 8080 -j ACCEPT
sudo netfilter-persistent save
```

#### 3. Install Docker

```bash
ssh ubuntu@YOUR_INSTANCE_IP

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker run hello-world
```

#### 4. Deploy OctoCounts

```bash
git clone https://github.com/huanglizhuo/OctoCount.git
cd OctoCount

cp .env.example .env
# Edit .env and set GITHUB_TOKEN
nano .env

docker compose up --build -d
```

The backend API is now running on `http://YOUR_INSTANCE_IP:8080`.

#### 5. (Optional) Set up Caddy for HTTPS

If you have a domain pointed at the instance, Caddy handles TLS automatically:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

Edit `/etc/caddy/Caddyfile`:

```
api.yourdomain.com {
    reverse_proxy localhost:8080
}
```

```bash
sudo systemctl reload caddy
```

---

### Frontend — Cloudflare Pages

Cloudflare Pages builds and deploys the frontend on every push to your repo. Global CDN, custom domains, HTTPS — all free.

#### 1. Connect the repo

1. Go to [pages.cloudflare.com](https://pages.cloudflare.com) and log in (or create a free account).
2. Click **Create a project → Connect to Git**.
3. Authorize Cloudflare to access your GitHub account and select this repository.

#### 2. Configure the build

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `frontend` |

#### 3. Set the API environment variable

Under **Settings → Environment variables**, add:

| Variable | Value |
|---|---|
| `VITE_API_BASE` | `https://api.yourdomain.com` (or `http://YOUR_INSTANCE_IP:8080`) |

#### 4. Deploy

Click **Save and Deploy**. Cloudflare builds the frontend and hands you a `*.pages.dev` subdomain immediately. Point your own domain at it under **Custom domains** if you have one.

From this point on, every push to `main` triggers a new build and deploy automatically.

---

### Environment variables reference

| Variable | Default | Notes |
|---|---|---|
| `GITHUB_TOKEN` | — | Strongly recommended |
| `ANALYSIS_CONCURRENCY` | `2` | Max parallel analysis jobs |
| `DATABASE_URL` | `sqlite:///data/sloc.db` | SQLite path inside the container |
| `BIND_ADDR` | `0.0.0.0:8080` | Backend listen address |
