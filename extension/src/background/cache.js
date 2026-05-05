const PREFIX = 'oc::';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export async function getSettings() {
  const result = await chrome.storage.sync.get({
    apiEndpoint: 'https://api.octocounts.com',
    autoAnalyze: true,
    skipForks:   true,
    cardPlacement: 'top',
    ignoreList:  '',
    cacheTtlMs:  DEFAULT_TTL_MS,
  });
  return result;
}

export async function getCached(owner, repo, ref = 'HEAD') {
  const key = cacheKey(owner, repo, ref);
  const result = await chrome.storage.local.get(key);
  const entry = result[key];
  if (!entry) return null;
  const { cacheTtlMs } = await getSettings();
  if (cacheTtlMs > 0 && Date.now() - entry.cachedAt > cacheTtlMs) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return entry;
}

export async function setCached(owner, repo, ref, report) {
  const key = cacheKey(owner, repo, ref);
  try {
    await chrome.storage.local.set({ [key]: { report, cachedAt: Date.now() } });
  } catch (e) {
    if (e.message?.includes('QUOTA_BYTES')) {
      await pruneOldest(0.2);
      await chrome.storage.local.set({ [key]: { report, cachedAt: Date.now() } });
    }
  }
}

function cacheKey(owner, repo, ref) {
  return `${PREFIX}${owner}/${repo}@${encodeURIComponent(ref || 'HEAD')}`;
}

export async function clearAll() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith(PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  return keys.length;
}

export async function countEntries() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter(k => k.startsWith(PREFIX)).length;
}

export async function pruneExpired() {
  const { cacheTtlMs } = await getSettings();
  if (cacheTtlMs === 0) return;
  const all = await chrome.storage.local.get(null);
  const stale = Object.entries(all)
    .filter(([k, v]) => k.startsWith(PREFIX) && Date.now() - v.cachedAt > cacheTtlMs)
    .map(([k]) => k);
  if (stale.length) await chrome.storage.local.remove(stale);
}

async function pruneOldest(fraction) {
  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all)
    .filter(([k]) => k.startsWith(PREFIX))
    .sort(([, a], [, b]) => a.cachedAt - b.cachedAt);
  const toRemove = entries.slice(0, Math.ceil(entries.length * fraction)).map(([k]) => k);
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
}
