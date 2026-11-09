import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

// Same transpile-to-node_modules-cache pattern as github-status.test.mjs.
// api.ts imports ./i18n (the full i18next runtime) and reads
// import.meta.env.VITE_API_BASE at module scope, neither of which exists in
// plain Node — the compiled copy gets the i18n import pointed at a
// deterministic stub (t() returns key + options) and the env read replaced
// with `undefined` so the default API base applies. analyzeAndWait itself is
// then driven end to end through a stubbed global fetch: no network, no
// React, real promise/timer semantics.
const cacheDir = new URL("../node_modules/.cache/octocounts-tests/", import.meta.url);
const compiled = await transform(await readFile(new URL("../src/api.ts", import.meta.url), "utf8"), { loader: "ts", format: "esm", target: "es2020" });
await mkdir(cacheDir, { recursive: true });
await writeFile(new URL("i18n-stub.mjs", cacheDir), `export default {
  language: "en",
  t(key, options) {
    if (!options) return key;
    const vars = Object.entries(options).map(([name, value]) => name + "=" + value).join(",");
    return key + "(" + vars + ")";
  },
};
`);
await writeFile(
  new URL("api.mjs", cacheDir),
  compiled.code.replace('from "./i18n"', 'from "./i18n-stub.mjs"').replace("import.meta.env.VITE_API_BASE", "undefined"),
);
const { analyzeAndWait } = await import(new URL("api.mjs", cacheDir).href);

const jsonResponse = (body) => ({ ok: true, status: 200, statusText: "OK", json: async () => body, headers: { get: () => null } });

// Installs a fetch stub that answers from `route(url)`, counts /api/jobs
// polls, and restores the real fetch afterwards.
async function withFetch(route, fn) {
  const original = globalThis.fetch;
  let jobPolls = 0;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes("/api/jobs/")) jobPolls += 1;
    return jsonResponse(route(path));
  };
  try {
    return { result: await fn(), jobPolls };
  } finally {
    globalThis.fetch = original;
  }
}

const REPORT = { id: "r1", repository: { owner: "o", name: "r" }, refName: "main", commitSha: "abc", total: { lines: 1 }, languages: [] };
const acceptedJob = () => ({ kind: "job", jobId: "job-1", status: "queued" });

test("a completed job without reportId fails immediately instead of polling to the deadline", async () => {
  const { jobPolls } = await withFetch(
    (path) => (path.includes("/api/analyze") ? acceptedJob() : path.includes("/api/jobs/") ? { id: "job-1", status: "completed" } : assert.fail(`unexpected fetch ${path}`)),
    () => assert.rejects(analyzeAndWait({ repoUrl: "https://github.com/o/r", refName: "" }), (error) => {
      // The message names the decode failure and (via the shared wrapper) the
      // job id — not a misleading "taking too long" after 300s of polling.
      assert.match(error.message, /compare\.missingReport\(status=completed\)/);
      assert.match(error.message, /error\.resumeJob\(jobId=job-1\)/);
      return true;
    }),
  );
  assert.equal(jobPolls, 1, "the terminal-but-reportless job must not be re-polled");
});

test("an unexpected job status fails immediately with the status value", async () => {
  const { jobPolls } = await withFetch(
    (path) => (path.includes("/api/analyze") ? acceptedJob() : path.includes("/api/jobs/") ? { id: "job-1", status: "cancelled" } : assert.fail(`unexpected fetch ${path}`)),
    () => assert.rejects(analyzeAndWait({ repoUrl: "https://github.com/o/r", refName: "" }), (error) => {
      assert.match(error.message, /compare\.unexpectedJobStatus\(status=cancelled\)/);
      assert.match(error.message, /error\.resumeJob\(jobId=job-1\)/);
      return true;
    }),
  );
  assert.equal(jobPolls, 1, "an unknown status must not be treated as queued/running");
});

test("queued and running keep polling and a completed job with reportId resolves", async () => {
  const statuses = [["queued"], ["running"], ["completed"]];
  const { result, jobPolls } = await withFetch(
    (path) => {
      if (path.includes("/api/analyze")) return acceptedJob();
      if (path.includes("/api/jobs/")) {
        const [status] = statuses.shift();
        return status === "completed" ? { id: "job-1", status, reportId: "r1" } : { id: "job-1", status };
      }
      if (path.includes("/api/reports/r1")) return REPORT;
      assert.fail(`unexpected fetch ${path}`);
    },
    () => analyzeAndWait({ repoUrl: "https://github.com/o/r", refName: "" }),
  );
  assert.equal(result.id, "r1");
  assert.equal(jobPolls, 3, "queued and running each get one poll before the completed one");
});
