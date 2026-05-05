const PREFIX = 'inflight::';

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
  return sessionGet(inflightKey(owner, repo, ref));
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
