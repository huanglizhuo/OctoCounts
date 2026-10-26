import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../public/analytics-runtime.js", import.meta.url), "utf8");

function analytics({ saved, blockedStorage = false } = {}) {
  const scripts = [];
  const storage = new Map(saved ? [["octocounts.ai_visit", saved]] : []);
  const window = { location: { pathname: "/docs/methodology", search: "" } };
  const document = {
    referrer: "https://chatgpt.com/",
    querySelector: (selector) => scripts.find((script) => selector.includes("data-domain") ? script.dataset.domain : script.dataset.websiteId),
    createElement: () => ({ dataset: {}, addEventListener(name, callback) { this[name] = callback; } }),
    head: { appendChild: (script) => scripts.push(script) },
  };
  const sessionStorage = {
    getItem(key) { if (blockedStorage) throw new Error("blocked"); return storage.get(key) ?? null; },
    setItem(key, value) { if (blockedStorage) throw new Error("blocked"); storage.set(key, value); },
  };
  const runtime = vm.runInNewContext(`${source.replaceAll("export function", "function")}\n({ initAnalytics, trackEvent, trackAiVisitIfReferred, aiReferrerSource })`, { window, document, sessionStorage, URL, URLSearchParams });
  return { ...runtime, window, document, storage, scripts };
}

test("AI landings wait for the SDK and retain their original landing path", () => {
  const app = analytics();
  app.initAnalytics();
  app.trackAiVisitIfReferred();
  app.trackAiVisitIfReferred();
  assert.equal(app.storage.size, 0, "do not persist a visit before SDK acceptance");
  const events = [];
  app.window.umami = { track: (...event) => events.push(event) };
  app.window.location.pathname = "/";
  app.scripts[0].load();
  app.trackAiVisitIfReferred();
  assert.equal(events.length, 1);
  assert.equal(events[0][0], "ai_visit");
  assert.equal(events[0][1].path, "/docs/methodology");
  assert.deepEqual(JSON.parse(app.storage.get("octocounts.ai_visit")), ["chatgpt"]);
});

test("ChatGPT campaign fallback tracks once and keeps the attribution basis", () => {
  const app = analytics();
  app.document.referrer = "";
  app.window.location.search = "?utm_source=chatgpt.com";
  app.initAnalytics();
  app.trackAiVisitIfReferred();
  const events = [];
  app.window.umami = { track: (...event) => events.push(event) };
  app.scripts[0].load();
  app.document.referrer = "https://chatgpt.com/";
  app.trackAiVisitIfReferred();
  assert.equal(events.length, 1);
  assert.equal(events[0][1].source, "chatgpt");
  assert.equal(events[0][1].attribution, "utm");
  assert.deepEqual(JSON.parse(app.storage.get("octocounts.ai_visit")), ["chatgpt"]);

  const conflict = analytics();
  conflict.document.referrer = "https://perplexity.ai/";
  conflict.window.location.search = "?utm_source=chatgpt.com";
  conflict.window.umami = { track: (_name, props) => {
    assert.equal(props.source, "perplexity");
    assert.equal(props.attribution, "referrer");
  } };
  conflict.trackAiVisitIfReferred();
  for (const tag of ["chatgpt.com.evil.test", "evilchatgpt.com", "https://chatgpt.com", "openai.com", ""]) {
    const unknown = analytics();
    unknown.document.referrer = "";
    unknown.window.location.search = `?utm_source=${encodeURIComponent(tag)}`;
    unknown.window.umami = { track: () => assert.fail(`unexpected attribution: ${tag}`) };
    unknown.trackAiVisitIfReferred();
  }
});

test("deduplication remembers all sources, including across page loads", () => {
  const app = analytics({ saved: '["chatgpt"]' });
  const events = [];
  app.window.umami = { track: (...event) => events.push(event) };
  for (const host of ["chatgpt.com", "perplexity.ai", "chatgpt.com", "perplexity.ai"]) {
    app.document.referrer = `https://${host}/`;
    app.trackAiVisitIfReferred();
  }
  assert.equal(events.length, 1);
  assert.equal(events[0][1].source, "perplexity");
  assert.deepEqual(JSON.parse(app.storage.get("octocounts.ai_visit")), ["chatgpt", "perplexity"]);
  const legacy = analytics({ saved: "chatgpt" });
  legacy.window.umami = { track: () => assert.fail("legacy session must stay deduplicated") };
  legacy.trackAiVisitIfReferred();
});

test("referrer matching excludes provider documentation and spoofed hostnames", () => {
  const { aiReferrerSource } = analytics();
  for (const url of ["https://openai.com/", "https://platform.openai.com/docs/", "https://chatgpt.com.evil.test/", "https://evilchatgpt.com/", "invalid", undefined]) {
    assert.equal(aiReferrerSource(url), undefined, url);
  }
  assert.equal(aiReferrerSource("https://chat.openai.com/"), "chatgpt");
  assert.equal(aiReferrerSource("https://chatgpt.com/"), "chatgpt");
  assert.equal(aiReferrerSource("https://claude.ai/"), "claude");
});

test("storage blocking and SDK exceptions cannot break page interactions", () => {
  const app = analytics({ blockedStorage: true });
  app.window.umami = { track: () => { throw new Error("not ready"); } };
  assert.doesNotThrow(() => app.trackAiVisitIfReferred());
  const events = [];
  app.window.umami.track = (...event) => events.push(event);
  app.initAnalytics();
  app.trackAiVisitIfReferred();
  assert.equal(events.length, 1);
});

test("each configured provider flushes once when it becomes ready", () => {
  const app = analytics();
  app.initAnalytics({ domain: "octocounts.com" });
  app.initAnalytics({ domain: "octocounts.com" });
  assert.equal(app.scripts.length, 2);
  app.trackEvent("extension_store_click", { store: "chrome" });
  const umami = [], plausible = [];
  app.window.umami = { track: (...event) => umami.push(event) };
  app.scripts[0].load();
  app.window.plausible = (...event) => plausible.push(event);
  app.scripts[1].load();
  app.initAnalytics({ domain: "octocounts.com" });
  assert.equal(umami.length, 1);
  assert.equal(plausible.length, 1);
  assert.equal(plausible[0][1].props.store, "chrome");
});

test("static articles use the same analytics property as the application", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const id = html.match(/data-website-id="([^"]+)"/)[1];
  const app = analytics();
  app.initAnalytics();
  assert.equal(app.scripts[0].dataset.websiteId, id);
});
