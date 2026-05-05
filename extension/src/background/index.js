import { analyze, pollJob, fetchReport } from '../shared/api.js';
import { getCached, setCached, clearAll, countEntries, pruneExpired, getSettings } from './cache.js';
import { getInflight, setInflight, clearInflight } from './dedup.js';

chrome.alarms.create('prune-cache', { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'prune-cache') pruneExpired();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch(err => sendResponse({ error: classifyError(err) }));
  return true;
});

async function handleMessage(msg) {
  const settings = await getSettings();

  switch (msg.type) {
    case 'ANALYZE': {
      const { owner, repo, ref, forceRefresh = false } = msg;

      if (!forceRefresh) {
        const cached = await getCached(owner, repo, ref);
        if (cached) return { type: 'CACHED', report: cached.report, cachedAt: cached.cachedAt };

        const inflight = await getInflight(owner, repo, ref);
        if (inflight) return { type: 'JOB', jobId: inflight.jobId };
      }

      const result = await analyze(owner, repo, ref, forceRefresh);

      if (result.kind === 'cached') {
        await setCached(owner, repo, ref, result.report);
        return { type: 'CACHED', report: result.report, cachedAt: Date.now() };
      }

      await setInflight(owner, repo, ref, result.jobId);
      return { type: 'JOB', jobId: result.jobId };
    }

    case 'POLL': {
      const { jobId, owner, repo, ref } = msg;
      const job = await pollJob(jobId);

      if (job.status === 'completed' && job.reportId) {
        const report = await fetchReport(job.reportId);
        await setCached(owner, repo, ref, report);
        await clearInflight(owner, repo, ref);
        return { type: 'COMPLETED', report };
      }

      if (job.status === 'failed') {
        await clearInflight(owner, repo, ref);
        return { type: 'FAILED', error: job.error };
      }

      return { type: 'PENDING', status: job.status };
    }

    case 'GET_SETTINGS':
      return settings;

    case 'CLEAR_CACHE': {
      const count = await clearAll();
      return { cleared: count };
    }

    case 'COUNT_CACHE':
      return { count: await countEntries() };

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}

function classifyError(err) {
  const apiError = err.body && typeof err.body === 'object' ? err.body : null;
  if (apiError?.code && apiError?.message) return { code: apiError.code, message: apiError.message };

  if (err.status === 429 || err.status === 403) return { code: 'rate_limited', message: 'GitHub API rate limit reached. Try again later.' };
  if (err.status === 413) return { code: 'too_large',   message: 'Repository exceeds the 2 GB archive size limit' };
  if (err.status === 404) return { code: 'not_found',   message: 'Repository not found or is empty' };
  if (err.status === 401) return { code: 'auth_error',  message: 'OctoCounts API authorization failed' };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { code: 'offline', message: 'No network connection' };
  return { code: 'unknown', message: err.message || 'Analysis failed' };
}
