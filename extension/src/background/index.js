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

      let job;
      try {
        job = await pollJob(jobId);
      } catch (err) {
        if (err.status === 404) {
          await clearInflight(owner, repo, ref);
          return handleMessage({ type: 'ANALYZE', owner, repo, ref, forceRefresh: false });
        }
        throw err;
      }

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
  if (apiError?.code && apiError?.message) {
    return {
      code: apiError.code,
      status: err.status,
      detail: apiError.detail || apiError.details || err.responseText || '',
    };
  }

  if (err.status === 429) return { code: 'rate_limited', status: err.status, detail: err.responseText || '' };
  if (err.status === 403) return { code: 'forbidden', status: err.status, detail: err.responseText || '' };
  if (err.status === 413) return { code: 'too_large', status: err.status, detail: err.responseText || '' };
  if (err.status === 404) return { code: 'not_found', status: err.status, detail: err.responseText || '' };
  if (err.status === 401) return { code: 'auth_error', status: err.status, detail: err.responseText || '' };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { code: 'offline' };
  return {
    code: 'unknown',
    status: err.status,
    detail: err.responseText || '',
  };
}
