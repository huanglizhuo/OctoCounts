const BASE = 'https://api.octocounts.com';
const FETCH_TIMEOUT_MS = 15000;

export async function fetchJson(url, init = {}, { signal = init.signal, deadline = Date.now() + 30_000 } = {}) {
  const isGet = !init.method || init.method === "GET";
  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new DOMException("OctoCounts request timed out", "TimeoutError");
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException("OctoCounts request timed out", "TimeoutError")), Math.min(FETCH_TIMEOUT_MS, deadline - Date.now()));
    let failure;
    try {
      return await readJsonResponse(await fetch(url, { ...init, signal: controller.signal }));
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
    signal?.throwIfAborted();
    const canRetry = failure.status !== undefined
      ? [429, 500, 502, 503, 504].includes(failure.status) && (isGet || failure.requestAccepted === false)
      : isGet && (failure instanceof TypeError || failure.name === "TimeoutError");
    const waitMs = failure.retryAfterMs ?? 500 * 2 ** attempt + Math.random() * 250;
    if (!canRetry || attempt >= 3 || !Number.isFinite(waitMs) || Date.now() + waitMs >= deadline) throw failure;
    await sleep(waitMs, signal);
  }
}

export async function readJsonResponse(response) {
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!response.ok || body === null) {
    const error = new Error(body?.message ?? `HTTP ${response.status}: ${response.statusText || "invalid JSON response"}`);
    error.status = response.status;
    error.code = body?.code;
    error.requestAccepted = body?.requestAccepted;
    error.retryAfterMs = retryAfterMs(response.headers.get("retry-after"));
    error.body = body;
    error.url = response.url;
    error.responseText = text.slice(0, 2048);
    if (error.retryAfterMs !== undefined) error.message += `; retry after ${Math.ceil(error.retryAfterMs / 1000)} seconds`;
    throw error;
  }
  return body;
}

export function retryAfterMs(value) {
  if (value === null) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function sleep(ms, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function analyze(owner, repo, ref, forceRefresh = false) {
  const headers = { 'Content-Type': 'application/json' };
  return fetchJson(`${BASE}/api/analyze`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      repoUrl: `https://github.com/${owner}/${repo}`,
      // Omitted when the page did not say which ref it is showing, which asks
      // the API for the repository's default branch. The alternative — sending
      // whatever the URL happened to contain — is what made every
      // `/tree/<ref>/<dir>` view fail with `ref_not_found`, on any branch name.
      refName: ref || undefined,
      forceRefresh,
      source: 'extension',
    }),
  });
}

export function pollJob(jobId) {
  return fetchJson(`${BASE}/api/jobs/${encodeURIComponent(jobId)}?wait=10`);
}

export function fetchReport(reportId) {
  return fetchJson(`${BASE}/api/reports/${encodeURIComponent(reportId)}`);
}

// Exchanges the authorization code chrome.identity.launchWebAuthFlow got
// from GitHub for an access token. Has to happen server-side (needs the
// extension OAuth App's client secret), so this is a plain JSON POST, not a
// redirect — see backend/src/oauth.rs::github_extension_token_exchange.
export function exchangeGithubCode(code, redirectUri) {
  return fetchJson(`${BASE}/api/auth/github/extension-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirectUri }),
  });
}

// Verifies `token` can read this repo's real star history and, the first
// time it succeeds for a given repo, kicks off a background backfill.
// Fire-and-forget from the caller's point of view — repeat calls for an
// already-backfilled repo are cheap no-ops server-side.
export function connectGithubToken(owner, repo, token) {
  return fetchJson(`${BASE}/api/auth/github/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'github', owner, repo, token }),
  });
}

export function fetchRepoHistory(owner, repo) {
  const params = new URLSearchParams({ provider: 'github', owner, repo });
  return fetchJson(`${BASE}/api/seo/repo-history?${params.toString()}`);
}
