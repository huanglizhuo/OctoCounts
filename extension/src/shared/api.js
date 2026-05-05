const BASE = 'https://api.octocounts.com';

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    try { err.body = await res.json(); } catch (_) {}
    throw err;
  }
  return res.json();
}

export function analyze(owner, repo, ref, token, forceRefresh = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
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

export function pollJob(jobId, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetchJson(`${BASE}/api/jobs/${jobId}`, { headers });
}

export function fetchReport(reportId, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetchJson(`${BASE}/api/reports/${reportId}`, { headers });
}
