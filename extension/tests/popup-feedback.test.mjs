import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
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
    rollupOptions: { input: new URL('../src/popup/index.js', import.meta.url).pathname, output: { format: 'iife' } },
  },
});
const html = await readFile(new URL('../src/popup/index.html', import.meta.url), 'utf8');

test('popup reports failed login and clear-cache replies and lets the user retry', async () => {
  const { document } = parseHTML(html);
  for (const select of document.querySelectorAll('select')) {
    Object.defineProperty(select, 'value', { writable: true, value: '' });
  }
  let fail = true;
  let account = {};
  const chrome = {
    storage: {
      local: { get: async () => account },
      sync: { get: async () => ({}), set: async () => {} },
    },
    runtime: {
      getURL: p => p,
      async sendMessage({ type }) {
        if (type === 'COUNT_CACHE') return { count: 3 };
        if (fail) return { error: { code: 'unknown' } };
        if (type === 'GITHUB_LOGIN') { account = { githubLogin: 'octo', githubToken: 'fixture' }; return { login: 'octo' }; }
        return { cleared: 3 };
      },
    },
    tabs: { query: async () => [] },
    identity: { launchWebAuthFlow() {} },
  };
  runInNewContext(output.find(item => item.type === 'chunk').code, {
    document, chrome, console, setTimeout: () => 1, clearTimeout() {},
  });
  await setImmediate();
  const el = id => document.getElementById(id);
  for (const attempt of ['failure', 'success']) {
    fail = attempt === 'failure';
    el('githubLoginBtn').click();
    el('clearCache').click();
    await setImmediate();
    assert.match(el('githubAccountStatus').textContent, fail ? /login failed/i : /octo/);
    assert.equal(el('clearCacheStatus').className, 'cache-status cache-status--' + (fail ? 'err' : 'ok'));
    assert.match(el('clearCacheStatus').textContent, fail ? /fail/i : /3/);
    assert.equal(el('clearCache').disabled, false);
  }
});
