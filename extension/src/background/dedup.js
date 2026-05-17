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

export async function getInflight(owner, repo, ref = 'HEAD') {
  const entry = await sessionGet(inflightKey(owner, repo, ref));
  if (!entry) return null;
  if (Date.now() - entry.startedAt > INFLIGHT_TTL_MS) {
    await clearInflight(owner, repo, ref);
    return null;
  }
  return entry;
}

export async function setInflight(owner, repo, ref = 'HEAD', jobId) {
  await sessionSet(inflightKey(owner, repo, ref), { jobId, startedAt: Date.now() });
}

export async function clearInflight(owner, repo, ref = 'HEAD') {
  await sessionRemove(inflightKey(owner, repo, ref));
}

function inflightKey(owner, repo, ref) {
  return `${PREFIX}${owner}/${repo}@${encodeURIComponent(ref || 'HEAD')}`;
}
