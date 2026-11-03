import assert from 'node:assert/strict';
import test from 'node:test';

let moduleId = 0;
globalThis.chrome = undefined;
async function cacheHarness(t, initial = {}, ttl = 0) {
  const storage = structuredClone(initial);
  t.mock.property(globalThis, 'chrome', { storage: {
    onChanged: { addListener() {} },
    sync: {
      async get() { return { cacheTtlMs: ttl, skipForksMigratedToDefaultOff: true }; },
    },
    local: {
      async get(key) { return structuredClone(key == null ? storage : { [key]: storage[key] }); },
      async set(values) { Object.assign(storage, structuredClone(values)); },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
      },
    },
  } });
  const cache = await import(`../src/background/cache.js?test=${++moduleId}`);
  return { cache, storage };
}

test('cache persists every index entry and evicts the oldest above 200 reports', async (t) => {
  const { cache, storage } = await cacheHarness(t);
  let now = 1000;
  t.mock.method(Date, 'now', () => now++);
  for (let i = 0; i < 205; i++) await cache.setCached('octo', `repo-${i}`, 'main', { id: i });
  assert.equal(await cache.countEntries(), 200);
  assert.equal(Object.keys(storage).filter(key => key.includes('@')).length, 200);
  assert.equal(await cache.getCached('octo', 'repo-0', 'main'), null);
  assert.equal((await cache.getCached('octo', 'repo-204', 'main')).report.id, 204);
});

test('concurrent cache writes survive, and refreshing a report updates its expiry', async (t) => {
  const { cache } = await cacheHarness(t, {}, 1000);
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  await Promise.all(Array.from({ length: 10 }, (_, i) => cache.setCached('octo', `repo-${i}`, 'main', { id: i })));
  assert.equal(await cache.countEntries(), 10);
  now = 1900;
  await cache.setCached('octo', 'repo-0', 'main', { id: 'refreshed' });
  now = 2100;
  await cache.pruneExpired();
  assert.equal(await cache.countEntries(), 1);
  assert.equal((await cache.getCached('octo', 'repo-0', 'main')).report.id, 'refreshed');
});

test('upgrade rebuilds the incomplete old index and restores the capacity limit', async (t) => {
  const initial = { 'oc::__index__': { 'oc::octo/repo-0@main': 1 } };
  for (let i = 0; i < 205; i++) initial[`oc::octo/repo-${i}@main`] = { report: { id: i }, cachedAt: i + 1 };
  const { cache, storage } = await cacheHarness(t, initial);
  await cache.pruneExpired();
  assert.equal(await cache.countEntries(), 200);
  assert.equal(storage['oc::__index__'], undefined);
  assert.equal(await cache.getCached('octo', 'repo-0', 'main'), null);
  assert.equal(await cache.clearAll(), 200);
  assert.equal(await cache.countEntries(), 0);
});
