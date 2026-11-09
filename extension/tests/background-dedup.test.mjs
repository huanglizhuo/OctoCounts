import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'vite';

// background/index.js imports github-auth.js, whose module scope reads
// __OCTO_BUILD_TARGET__, so the service worker is exercised as a built bundle
// in a fresh context — same approach as content-navigation.test.mjs.
const { output } = await build({
  configFile: false,
  logLevel: 'silent',
  define: {
    __OCTO_BUILD_TARGET__: '"chrome"',
    __OCTO_STORE_NAME__: '"Chrome"',
    __OCTO_REVIEW_URL__: '""',
    __OCTO_EXTENSION_VERSION__: '"test"',
    __OCTO_RATING_PROMPT_ENABLED__: 'false',
  },
  build: {
    write: false,
    minify: false,
    rollupOptions: {
      input: new URL('../src/background/index.js', import.meta.url).pathname,
      output: { format: 'iife' },
    },
  },
});
const source = output.find(item => item.type === 'chunk').code;

function storageArea(initial = {}) {
  const store = structuredClone(initial);
  return {
    store,
    async get(key) {
      if (key == null) return structuredClone(store);
      const keys = Array.isArray(key) ? key : [key];
      const out = {};
      for (const k of keys) if (k in store) out[k] = structuredClone(store[k]);
      return out;
    },
    async set(values) { Object.assign(store, structuredClone(values)); },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
    },
  };
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    url: 'https://api.octocounts.com/api/analyze',
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  };
}

async function harness() {
  const local = storageArea();
  const sync = storageArea();
  const session = storageArea();
  const listeners = [];
  const analyzeCalls = [];
  const analyzeGates = [];
  const chrome = {
    alarms: { create() {}, onAlarm: { addListener() {} } },
    runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } },
    storage: { onChanged: { addListener() {} }, local, sync, session },
  };
  runInNewContext(source, {
    chrome,
    fetch: async (url, init) => {
      analyzeCalls.push({ url, body: JSON.parse(init.body) });
      await new Promise(resolve => { analyzeGates.push(resolve); });
      return jsonResponse({ kind: 'job', jobId: `job-${analyzeCalls.length}` });
    },
    setTimeout, clearTimeout, AbortController, DOMException, console,
  });
  return {
    analyzeCalls,
    inflight: (owner, repo, ref = 'HEAD') =>
      session.store[`inflight::${owner}/${repo}@${encodeURIComponent(ref || 'HEAD')}`] ?? null,
    releaseAnalyze: () => analyzeGates.shift()(),
    send(message) {
      return new Promise(resolve => {
        for (const listener of listeners) listener(message, {}, resolve);
      });
    },
    async settle() { for (let i = 0; i < 5; i++) await setImmediate(); },
  };
}

test('forceRefresh clears the stale in-flight entry before the new job is set', async () => {
  const h = await harness();

  const first = h.send({ type: 'ANALYZE', owner: 'octo', repo: 'demo', ref: 'main' });
  await h.settle();
  h.releaseAnalyze();
  assert.equal((await first).type, 'JOB');
  assert.equal((await first).jobId, 'job-1');
  assert.equal(h.inflight('octo', 'demo', 'main').jobId, 'job-1');

  // Non-forced analyses still dedup onto the in-flight job without a request.
  const second = h.send({ type: 'ANALYZE', owner: 'octo', repo: 'demo', ref: 'main' });
  assert.equal((await second).jobId, 'job-1');
  assert.equal(h.analyzeCalls.length, 1);

  // While the forced analysis is still in flight, the stale entry must already
  // be gone — otherwise a concurrent analysis resolves to the orphaned job id.
  const forced = h.send({ type: 'ANALYZE', owner: 'octo', repo: 'demo', ref: 'main', forceRefresh: true });
  await h.settle();
  assert.equal(h.analyzeCalls.length, 2);
  assert.equal(h.analyzeCalls[1].body.forceRefresh, true);
  assert.equal(h.inflight('octo', 'demo', 'main'), null,
    'the superseded entry must be cleared while the forced analysis is in flight');

  h.releaseAnalyze();
  assert.equal((await forced).jobId, 'job-2');
  assert.equal(h.inflight('octo', 'demo', 'main').jobId, 'job-2');
});
