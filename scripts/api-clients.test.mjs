import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const clients = ["cli", "action", "mcp", "extension"];
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers });

for (const client of clients) {
  const path = client === "extension" ? "src/shared/api.js" : "src/api.js";
  const source = await readFile(new URL(`../${client}/${path}`, import.meta.url), "utf8");
  const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

  test(`${client}: Retry-After supports seconds and HTTP dates`, () => {
    assert.equal(api.retryAfterMs("2"), 2000);
    assert.equal(api.retryAfterMs("Thu, 01 Jan 1970 00:00:00 GMT"), 0);
    assert.equal(api.retryAfterMs("invalid"), undefined);
    assert.equal(api.retryAfterMs(null), undefined);
  });

  test(`${client}: GET retries transient errors but preserves final status and code`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return json({ code: "rate_limited", message: "busy" }, 429, { "retry-after": "0" }); });
    await assert.rejects(api.fetchJson("https://api.test/read"), (error) => error.status === 429 && error.code === "rate_limited" && error.retryAfterMs === 0);
    assert.equal(calls, 4);
  });

  test(`${client}: safe rejected POST retries; ambiguous POST never replays`, async (t) => {
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? json({ code: "rate_limited", requestAccepted: false }, 429, { "retry-after": "0" }) : json({ ok: true }));
    assert.deepEqual(await api.fetchJson("https://api.test/write", { method: "POST" }), { ok: true });
    assert.equal(calls, 2);
    for (const response of [() => json({ message: "busy" }, 503, { "retry-after": "0" }), () => { throw new TypeError("connection lost"); }]) {
      calls = 0;
      mock.mock.mockImplementation(async () => { calls++; return response(); });
      await assert.rejects(api.fetchJson("https://api.test/write", { method: "POST" }));
      assert.equal(calls, 1);
    }
  });

  test(`${client}: permanent errors and invalid success bodies fail without replay`, async (t) => {
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => { calls++; return json({ code: "not_found" }, 404); });
    await assert.rejects(api.fetchJson("https://api.test/read"), (error) => error.status === 404);
    assert.equal(calls, 1);
    mock.mock.mockImplementation(async () => { calls++; return new Response("<html>bad gateway</html>"); });
    await assert.rejects(api.fetchJson("https://api.test/read"), (error) => error.status === 200);
    assert.equal(calls, 2);
  });

  test(`${client}: caller can cancel Retry-After and deadline bounds waits`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return json({}, 503, { "retry-after": "60" }); });
    const controller = new AbortController();
    const result = api.fetchJson("https://api.test/read", {}, { signal: controller.signal, deadline: Date.now() + 120_000 });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(result, { name: "AbortError" });
    await assert.rejects(api.fetchJson("https://api.test/read", {}, { deadline: Date.now() + 20 }), (error) => error.status === 503);
    assert.equal(calls, 2);
  });

  if (client === "extension") continue;

  test(`${client}: jobs long-poll and preserve recovery information`, async (t) => {
    const urls = [];
    t.mock.method(globalThis, "fetch", async (url) => {
      urls.push(String(url));
      if (String(url).endsWith("/api/analyze")) return json({ kind: "job", jobId: "job/a" });
      return json({ code: "not_found", message: "lost job" }, 404);
    });
    await assert.rejects(api.analyzeAndWait("https://api.test", { repoUrl: "https://github.com/a/b" }), (error) => error.jobId === "job/a" && error.status === 404 && error.code === "not_found" && error.message.includes("resume with GET"));
    assert.equal(urls[1], "https://api.test/api/jobs/job%2Fa?wait=20");
    assert.equal(urls.length, 2);
  });

  test(`${client}: total deadline also cancels an in-flight job request`, async (t) => {
    t.mock.method(globalThis, "fetch", async (url, init) => {
      if (String(url).endsWith("/api/analyze")) return json({ kind: "job", jobId: "job-timeout" });
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    });
    await assert.rejects(api.analyzeAndWait("https://api.test", {}, { timeoutMs: 20 }), /job-timeout.*resume with GET/);
  });

  test(`${client}: fixed URLs use ID and SHA; opt-in preserves omitted defaults`, () => {
    const report = { id: "saved/a", repository: { owner: "o", name: "r" }, commitSha: "a".repeat(40), refName: "main", analysisOptions: { ignoredDirs: ["docs"] } };
    const url = new URL(api.reportUrl(report));
    assert.equal(url.pathname, `/github/o/r/commit/${report.commitSha}`);
    assert.equal(url.searchParams.get("reportId"), report.id);
    assert.deepEqual(JSON.parse(url.searchParams.get("analysis")), report.analysisOptions);
    assert.equal(api.repositoryOptions(false), undefined);
    assert.equal(api.repositoryOptions(true).includeGenerated, false);
    assert.throws(() => api.repositoryOptions("true"), /boolean/);
    assert.equal(api.policyCompatibility(report, report), "unknown");
    const policy = { version: "directories-v1", includeDocs: false, includeTests: false, includeGenerated: false, ignoredDirs: ["docs", "tests"], ignoredLanguages: ["JSON"], repositoryAttributes: { status: "off" } };
    const left = { countingPolicy: policy, tokeiVersion: "14" };
    const right = { ...left, countingPolicy: { ...policy, ignoredDirs: ["tests", "docs"], ignoredLanguages: ["json"] } };
    assert.equal(api.policyCompatibility(left, right), "same");
    assert.equal(api.policyCompatibility(left, { ...right, tokeiVersion: "15" }), "different");
  });
}
