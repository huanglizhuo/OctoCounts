import { getSettings } from '../shared/settings.js';

const PREFIX = 'oc::';
// A single small object mapping cacheKey -> cachedAt, so periodic prune and
// count operations don't have to deserialize every cached report body.
const INDEX_KEY = 'oc::__index__';

export { getSettings };

async function readIndex() {
  const res = await chrome.storage.local.get(INDEX_KEY);
  return res[INDEX_KEY] || null;
}

async function writeIndex(index) {
  await chrome.storage.local.set({ [INDEX_KEY]: index });
}

// Rebuild the index from a full scan. Used once after upgrade (no index yet)
// or as recovery; the result is persisted so subsequent reads stay cheap.
async function rebuildIndex() {
  const all = await chrome.storage.local.get(null);
  const index = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(PREFIX) && k !== INDEX_KEY && v && typeof v.cachedAt === 'number') {
      index[k] = v.cachedAt;
    }
  }
  await writeIndex(index);
  return index;
}

async function getIndex() {
  return (await readIndex()) || (await rebuildIndex());
}

async function removeEntries(keys) {
  if (!keys.length) return;
  await chrome.storage.local.remove(keys);
  const index = await getIndex();
  let changed = false;
  for (const k of keys) {
    if (k in index) { delete index[k]; changed = true; }
  }
  if (changed) await writeIndex(index);
}

export async function getCached(owner, repo, ref = 'HEAD') {
  const key = cacheKey(owner, repo, ref);
  const result = await chrome.storage.local.get(key);
  const entry = result[key];
  if (!entry) return null;
  const { cacheTtlMs } = await getSettings();
  if (cacheTtlMs > 0 && Date.now() - entry.cachedAt > cacheTtlMs) {
    await removeEntries([key]);
    return null;
  }
  return entry;
}

export async function setCached(owner, repo, ref, report) {
  const key = cacheKey(owner, repo, ref);
  const cachedAt = Date.now();
  try {
    await chrome.storage.local.set({ [key]: { report, cachedAt } });
  } catch (e) {
    if (e.message?.includes('QUOTA_BYTES')) {
      await pruneOldest(0.2);
      await chrome.storage.local.set({ [key]: { report, cachedAt } });
    } else {
      throw e;
    }
  }
  const index = await getIndex();
  index[key] = cachedAt;
  await writeIndex(index);
}

function cacheKey(owner, repo, ref) {
  return `${PREFIX}${owner}/${repo}@${encodeURIComponent(ref || 'HEAD')}`;
}

export async function clearAll() {
  // Manual, rare action — do an exhaustive scan so nothing is orphaned even if
  // the index drifted, and drop the index alongside the entries.
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith(PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  return keys.filter(k => k !== INDEX_KEY).length;
}

export async function countEntries() {
  const index = await getIndex();
  return Object.keys(index).length;
}

export async function pruneExpired() {
  const { cacheTtlMs } = await getSettings();
  if (cacheTtlMs === 0) return;
  const index = await getIndex();
  const now = Date.now();
  const stale = Object.entries(index)
    .filter(([, cachedAt]) => now - cachedAt > cacheTtlMs)
    .map(([k]) => k);
  await removeEntries(stale);
}

async function pruneOldest(fraction) {
  const index = await getIndex();
  const entries = Object.entries(index).sort(([, a], [, b]) => a - b);
  const toRemove = entries.slice(0, Math.ceil(entries.length * fraction)).map(([k]) => k);
  await removeEntries(toRemove);
}
