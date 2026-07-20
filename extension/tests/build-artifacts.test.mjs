import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", ROOT), "utf8"));

const expected = {
  chrome: {
    store: "chrome",
    storeName: "Chrome Web Store",
    storeOrigin: "https://chromewebstore.google.com/",
  },
  edge: {
    store: "edge",
    storeName: "Microsoft Edge Add-ons",
    storeOrigin: "https://microsoftedge.microsoft.com/",
  },
  firefox: {
    store: "firefox",
    storeName: "Firefox Add-ons",
    storeOrigin: "https://addons.mozilla.org/",
  },
};

async function artifact(target, file) {
  return readFile(new URL(`dist/${target}/${file}`, ROOT), "utf8");
}

test("each browser artifact exposes target-specific build information", async () => {
  for (const [target, targetExpected] of Object.entries(expected)) {
    const info = JSON.parse(await artifact(target, "build-info.json"));
    assert.equal(info.target, target);
    assert.equal(info.store, targetExpected.store);
    assert.equal(info.storeName, targetExpected.storeName);
    assert.equal(info.version, pkg.version);
    assert.ok(info.listingUrl.startsWith(targetExpected.storeOrigin));
    assert.ok(info.reviewUrl.startsWith(targetExpected.storeOrigin));
  }
});

test("built manifests keep the source permission set and packaged version", async () => {
  const permissionBaseline = JSON.parse(await readFile(new URL("manifests/manifest.chrome.json", ROOT), "utf8"));
  for (const target of Object.keys(expected)) {
    const sourceName = target === "firefox" ? "firefox" : target;
    const source = JSON.parse(await readFile(new URL(`manifests/manifest.${sourceName}.json`, ROOT), "utf8"));
    const manifest = JSON.parse(await artifact(target, "manifest.json"));
    assert.equal(manifest.version, pkg.version);
    assert.deepEqual(manifest.permissions, source.permissions);
    assert.deepEqual(manifest.host_permissions, source.host_permissions);
    assert.deepEqual(manifest.permissions, permissionBaseline.permissions);
    assert.deepEqual(manifest.host_permissions, permissionBaseline.host_permissions);
  }
});

test("artifacts never contain another browser store URL", async () => {
  const chrome = await artifact("chrome", "content.js");
  const edge = await artifact("edge", "content.js");
  const firefox = await artifact("firefox", "content.js");

  assert.doesNotMatch(chrome, /microsoftedge\.microsoft\.com|addons\.mozilla\.org/);
  assert.doesNotMatch(edge, /chromewebstore\.google\.com|addons\.mozilla\.org/);
  assert.doesNotMatch(firefox, /chromewebstore\.google\.com|microsoftedge\.microsoft\.com/);
});

test("completed cards expose explicit controls without nesting them in a button role", async () => {
  const card = await readFile(new URL("src/content/card.js", ROOT), "utf8");
  const zh = JSON.parse(await readFile(new URL("src/locales/zh.json", ROOT), "utf8"));
  const ja = JSON.parse(await readFile(new URL("src/locales/ja.json", ROOT), "utf8"));

  assert.match(card, /class="oc-icon-btn oc-open-panel-btn"/);
  assert.match(card, /cardHost\.setAttribute\('role', 'region'\)/);
  assert.doesNotMatch(card, /cardHost\.setAttribute\('role', 'button'\)/);
  assert.doesNotMatch(card, /cardHost\.addEventListener\('keydown'/);
  assert.equal(zh.popup.privateNotice, "私有或内部仓库：OctoCounts 仅支持公开仓库。");
  assert.equal(ja.popup.privateNotice, "非公開または内部リポジトリ：OctoCounts は公開リポジトリのみ対応しています。");
});

test("error cards clear stale completed-card interaction and link their details", async () => {
  const card = await readFile(new URL("src/content/card.js", ROOT), "utf8");

  assert.match(card, /cardHost\.setAttribute\('data-state', 'error'\)/);
  assert.match(card, /cardHost\.removeEventListener\('click', cardHost\._ocListener\)/);
  assert.match(card, /cardHost\._ocListener = null/);
  assert.match(card, /aria-controls="oc-error-detail"/);
  assert.match(card, /id="oc-error-detail"/);
});

test("Edge build uses the released listing and enables its rating prompt", async () => {
  const info = JSON.parse(await artifact("edge", "build-info.json"));
  assert.equal(info.storeConfigured, true);
  assert.equal(info.listingUrl, "https://microsoftedge.microsoft.com/addons/detail/octocounts-%E2%80%93-github-sloc-/ehifednhpbpekkadndaipnngopbhpoim");
  assert.equal(info.ratingPromptEnabled, true);
});

test("configured Edge rating prompt names and links to Microsoft Edge Add-ons", async () => {
  const env = {
    ...process.env,
    EDGE_STORE_URL: "https://microsoftedge.microsoft.com/addons/detail/octocounts/example",
    EDGE_STORE_REVIEW_URL: "https://microsoftedge.microsoft.com/addons/detail/octocounts/example",
  };
  const result = spawnSync("npm", ["run", "build:edge"], {
    cwd: new URL(".", ROOT),
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const info = JSON.parse(await artifact("edge", "build-info.json"));
  const content = await artifact("edge", "content.js");
  assert.equal(info.ratingPromptEnabled, true);
  assert.equal(info.storeName, "Microsoft Edge Add-ons");
  assert.match(content, /Microsoft Edge Add-ons/);
  assert.doesNotMatch(content, /rate OctoCounts on Chrome|valora OctoCounts en Chrome|notez OctoCounts sur Chrome|Chrome 商店评分|Chrome で評価/);
});

test("release packaging succeeds with the default Edge listing", () => {
  const env = { ...process.env };
  delete env.EDGE_STORE_URL;
  delete env.EDGE_STORE_REVIEW_URL;
  const build = spawnSync("npm", ["run", "build:edge"], {
    cwd: new URL(".", ROOT),
    env,
    encoding: "utf8",
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const result = spawnSync(process.execPath, ["scripts/package-artifacts.mjs", "--release", "--dry-run"], {
    cwd: new URL(".", ROOT),
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
