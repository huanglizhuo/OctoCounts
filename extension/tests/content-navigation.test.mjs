import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { build } from 'vite';

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
      input: new URL('../src/content/index.js', import.meta.url).pathname,
      output: { format: 'iife' },
    },
  },
});
const source = output.find(item => item.type === 'chunk').code;
const fixture = await readFile(new URL('./fixtures/github-sidebar-css-module.html', import.meta.url), 'utf8');
const report = {
  total: { code: 42, files: 1, lines: 50, comments: 8, blanks: 0 },
  languages: [{ name: 'JavaScript', stats: { code: 42, files: 1, lines: 50, comments: 8, blanks: 0 } }],
};

async function harness(settings = {}) {
  const { document, MutationObserver, Event } = parseHTML(fixture);
  const location = new URL('https://github.com/octo/demo');
  const window = { location, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  window.self = window.top = window;
  const requests = [];
  const timers = new Map();
  let clock = 0;
  let nextTimer = 0;
  const chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage(message) {
        if (message.type === 'GET_SETTINGS') return Promise.resolve({ showStarHistory: false, ...settings });
        return new Promise(resolve => requests.push({ ...message, resolve }));
      },
    },
    storage: {
      onChanged: { addListener() {} },
      local: { async get() { return {}; }, async set() {}, async remove() {} },
    },
  };
  runInNewContext(source, {
    document, window, location, MutationObserver, chrome, URL, console,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, at: clock + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  async function tick(ms = 500) {
    await setImmediate();
    const end = clock + ms;
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      clock = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
      await setImmediate();
    }
    clock = end;
  }
  await tick();
  return {
    document, location, requests, tick,
    card: () => document.querySelector('[data-octocount-card]'),
    turbo: () => document.dispatchEvent(new Event('turbo:render')),
    replaceBody() { document.body.replaceWith(parseHTML(fixture).document.body); },
  };
}

test('continues observing sidebar changes after Turbo replaces the body', async () => {
  const h = await harness();
  h.replaceBody();
  h.turbo();
  await h.tick();
  assert.ok(h.card());
  h.card().remove();
  await h.tick();
  assert.ok(h.card(), 'a React sidebar update in the new body must remount the card');
  h.requests.at(-1).resolve({ type: 'CACHED', report });
  await h.tick();
  assert.equal(h.card().getAttribute('data-state'), 'completed');
});

test('replaces a restored loading card whose analysis belongs to an old mount', async () => {
  const h = await harness();
  const stale = h.card();
  stale.remove();
  await h.tick();
  const current = h.card();
  assert.notEqual(current, stale);
  current.replaceWith(stale);
  h.turbo();
  await h.tick();
  h.requests.at(-1).resolve({ type: 'CACHED', report });
  await h.tick();
  assert.equal(h.card().getAttribute('data-state'), 'completed', 'restored skeleton must have a live analysis');
});

test('replaces cloned card markup without a shadow root', async () => {
  const h = await harness();
  h.card().replaceWith(h.card().cloneNode(true));
  h.turbo();
  await h.tick();
  h.requests.at(-1).resolve({ type: 'CACHED', report });
  await h.tick();
  assert.equal(h.card().getAttribute('data-state'), 'completed');
  assert.ok(h.card().shadowRoot);
});

test('leaving and returning to a repo ignores the old response and finishes polling', async () => {
  const h = await harness();
  const oldRequest = h.requests[0];
  h.location.pathname = '/octo/demo/issues';
  h.turbo();
  await h.tick();
  assert.equal(h.card(), null);
  h.location.pathname = '/octo/demo';
  h.turbo();
  await h.tick();
  const current = h.card();
  oldRequest.resolve({ type: 'CACHED', report });
  await h.tick();
  assert.ok(current.shadowRoot.querySelector('.oc-status'));
  h.requests.at(-1).resolve({ type: 'JOB', jobId: 'new-job' });
  await h.tick(1500);
  assert.equal(h.requests.at(-1).type, 'POLL');
  assert.equal(h.requests.at(-1).jobId, 'new-job');
  h.requests.at(-1).resolve({ type: 'COMPLETED', report });
  await h.tick();
  assert.equal(h.card(), current);
  assert.equal(current.getAttribute('data-state'), 'completed');
  assert.equal(h.document.querySelectorAll('[data-octocount-card]').length, 1);
  h.turbo();
  await h.tick();
  assert.equal(h.requests.length, 3, 'a healthy card must not restart analysis');
});

test('silent mode waits for success before mounting', async () => {
  const h = await harness({ silentUntilSuccess: true });
  assert.equal(h.card(), null);
  h.turbo();
  await h.tick();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve({ type: 'CACHED', report });
  await h.tick();
  assert.equal(h.card().getAttribute('data-state'), 'completed');
});
