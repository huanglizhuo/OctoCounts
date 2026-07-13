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

test("Edge placeholder is explicit and disables rating until configured", async () => {
  const info = JSON.parse(await artifact("edge", "build-info.json"));
  if (!process.env.EDGE_STORE_URL || !process.env.EDGE_STORE_REVIEW_URL) {
    assert.equal(info.storeConfigured, false);
    assert.match(info.listingUrl, /PENDING_EDGE_LISTING/);
    assert.equal(info.ratingPromptEnabled, false);
  }
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

test("release packaging fails clearly while the Edge listing is pending", () => {
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
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Edge release packaging is blocked/);
  assert.match(result.stderr, /EDGE_STORE_URL and EDGE_STORE_REVIEW_URL/);
});
