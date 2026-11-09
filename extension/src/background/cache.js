import { getSettings } from '../shared/settings.js';

const PREFIX = 'oc::';
// A single small object mapping cacheKey -> cachedAt, so periodic prune and
// count operations don't have to deserialize every cached report body.
// Rebuild once for installs whose previous index omitted successful writes.
const INDEX_KEY = 'oc::__index_v2__';

export { getSettings };

const MAX_ENTRIES = 200;

// The service worker restarts often enough that this is a short-lived memo,
// not a permanent copy: chrome.storage.onChanged invalidates it the moment
// the options page or popup writes new settings.
let settingsCache = null;
let settingsPromise = null;

async function getSettingsCached() {
  if (settingsCache) return settingsCache;
  if (!settingsPromise) {
    settingsPromise = getSettings().then(settings => {
      settingsCache = settings;
      settingsPromise = null;
      return settings;
    }, err => {
      settingsPromise = null;
      throw err;
    });
  }
  return settingsPromise;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') settingsCache = null;
});

// All index mutations (set/prune/remove) go through this chain so two tabs
// finishing work at the same time cannot lose each other's entries with a
// read-modify-write race on the index.
let indexQueue = Promise.resolve();

function enqueueIndexWrite(fn) {
  const next = indexQueue.then(fn, fn);
  // Keep the chain alive even if a mutation fails; the error surfaces to the
  // caller of the enqueued operation, not to every later one.
  indexQueue = next.catch(() => {});
  return next;
}

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
  await chrome.storage.local.remove('oc::__index__');
  return index;
}

async function getIndex() {
  return (await readIndex()) || (await rebuildIndex());
}

async function removeEntries(keys) {
  if (!keys.length) return;
  await enqueueIndexWrite(async () => {
    await chrome.storage.local.remove(keys);
    const index = await getIndex();
    let changed = false;
    for (const k of keys) {
      if (k in index) { delete index[k]; changed = true; }
    }
    if (changed) await writeIndex(index);
  });
}

// Storage drift, direction (b): an index key whose body no longer exists.
// Ghost entries never expire on their own and overcount toward MAX_ENTRIES,
// evicting real bodies to make room for nothing. Mutates `index` in place;
// callers persist it via their own writeIndex.
async function dropGhostEntries(index) {
  const all = await chrome.storage.local.get(null);
  const ghosts = Object.keys(index).filter(k => !all[k]);
  for (const k of ghosts) delete index[k];
}

// LRU cap: keep at most MAX_ENTRIES, evicting the least-recently-cached first.
// Applies regardless of cacheTtlMs so "never expire" cannot grow unbounded.
async function enforceCap(index) {
  if (Object.keys(index).length <= MAX_ENTRIES) return writeIndex(index);
  // Over cap: drop ghost entries first so eviction slots are not wasted on
  // bodies that no longer exist, then evict the oldest real ones.
  await dropGhostEntries(index);
  const entries = Object.entries(index);
  if (entries.length <= MAX_ENTRIES) return writeIndex(index);
  const toRemove = entries
    .sort(([, a], [, b]) => a - b)
    .slice(0, entries.length - MAX_ENTRIES)
    .map(([k]) => k);
  await chrome.storage.local.remove(toRemove);
  for (const k of toRemove) delete index[k];
  await writeIndex(index);
}

export async function getCached(owner, repo, ref = 'HEAD') {
  const key = cacheKey(owner, repo, ref);
  const result = await chrome.storage.local.get(key);
  const entry = result[key];
  if (!entry) return null;
  const { cacheTtlMs } = await getSettingsCached();
  if (cacheTtlMs > 0 && Date.now() - entry.cachedAt > cacheTtlMs) {
    await removeEntries([key]);
    return null;
  }
  // Storage drift, direction (a): the body exists but the index lost the key.
  // Upsert it so the entry becomes visible and evictable (countEntries,
  // pruneExpired, enforceCap) instead of being served forever while living
  // outside all of them.
  await enqueueIndexWrite(async () => {
    const index = await getIndex();
    if (index[key] === entry.cachedAt) return;
    index[key] = entry.cachedAt;
    await writeIndex(index);
  });
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
  await enqueueIndexWrite(async () => {
    const index = await getIndex();
    index[key] = cachedAt;
    await enforceCap(index);
  });
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
  return keys.filter(k => k !== INDEX_KEY && k !== 'oc::__index__').length;
}

export async function countEntries() {
  const index = await getIndex();
  return Object.keys(index).length;
}

export async function pruneExpired() {
  const { cacheTtlMs } = await getSettingsCached();
  const index = await getIndex();
  if (cacheTtlMs > 0) {
    const now = Date.now();
    const stale = Object.entries(index)
      .filter(([, cachedAt]) => now - cachedAt > cacheTtlMs)
      .map(([k]) => k);
    await removeEntries(stale);
  }
  // Even with caching disabled (cacheTtlMs === 0) the LRU cap still applies.
  // This is also the periodic reconciliation pass: TTL expiry above only
  // removes entries the index knows are stale, so index keys whose bodies
  // disappeared (storage drift) are swept here — hourly, where a full scan is
  // acceptable. getCached heals the opposite direction on read.
  await enqueueIndexWrite(async () => {
    const current = await getIndex();
    await dropGhostEntries(current);
    await enforceCap(current);
  });
}

async function pruneOldest(fraction) {
  const index = await getIndex();
  const entries = Object.entries(index).sort(([, a], [, b]) => a - b);
  const toRemove = entries.slice(0, Math.ceil(entries.length * fraction)).map(([k]) => k);
  await removeEntries(toRemove);
}
