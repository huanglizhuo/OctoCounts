const BASE = 'https://api.octocounts.com';

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
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
      refName: ref,
      forceRefresh,
    }),
  });
}

export function pollJob(jobId) {
  return fetchJson(`${BASE}/api/jobs/${jobId}`);
}

export function fetchReport(reportId) {
  return fetchJson(`${BASE}/api/reports/${reportId}`);
}
