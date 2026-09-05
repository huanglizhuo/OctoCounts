const BASE = 'https://api.octocounts.com';
const FETCH_TIMEOUT_MS = 15000;

// AbortSignal.timeout() is available in all supported browsers (Chrome 103+,
// Firefox 100+), but fall back to a manual controller if it ever is not.
function timeoutSignal(ms) {
  if (typeof AbortSignal?.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('signal timed out', 'TimeoutError')), ms);
  return controller.signal;
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: timeoutSignal(FETCH_TIMEOUT_MS) });
  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch (_) {}
  }

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.url = url;
    err.body = body;
    err.responseText = text;
    throw err;
  }

  return body ?? {};
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
  return fetchJson(`${BASE}/api/jobs/${jobId}`);
}

export function fetchReport(reportId) {
  return fetchJson(`${BASE}/api/reports/${reportId}`);
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
