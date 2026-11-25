const PREFIX = 'inflight::';
const INFLIGHT_TTL_MS = 10 * 60 * 1000; // 2× card polling timeout (5 min)

async function sessionGet(key) {
  try {
    const result = await chrome.storage.session.get(key);
    return result[key] || null;
  } catch (_) {
    return null;
  }
}

async function sessionSet(key, value) {
  try {
    await chrome.storage.session.set({ [key]: value });
  } catch (_) {}
}

async function sessionRemove(key) {
  try {
    await chrome.storage.session.remove(key);
  } catch (_) {}
}

// Serialize session read/modify/write so a late poll cannot retire a newer job.
let writes = Promise.resolve();
function serialize(operation) {
  const result = writes.then(operation);
  writes = result.catch(() => {});
  return result;
}

export function getInflight(owner, repo, ref = 'HEAD') {
  const key = inflightKey(owner, repo, ref);
  return serialize(async () => {
    const entry = await sessionGet(key);
    if (!entry || Date.now() - entry.startedAt <= INFLIGHT_TTL_MS) return entry;
    await sessionRemove(key);
    return null;
  });
}

export function setInflight(owner, repo, ref = 'HEAD', jobId) {
  return serialize(() => sessionSet(inflightKey(owner, repo, ref), { jobId, startedAt: Date.now() }));
}

export function clearInflight(owner, repo, ref, expectedJobId) {
  const key = inflightKey(owner, repo, ref);
  return serialize(async () => {
    if (expectedJobId !== undefined && (await sessionGet(key))?.jobId !== expectedJobId) return false;
    await sessionRemove(key);
    return true;
  });
}

function inflightKey(owner, repo, ref) {
  return `${PREFIX}${owner}/${repo}@${encodeURIComponent(ref || 'HEAD')}`;
}
