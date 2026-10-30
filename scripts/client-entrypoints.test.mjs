import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import { handleRequest } from "../mcp/src/core.js";

test("MCP initialize negotiates the protocol version the spec way", async () => {
  const negotiated = async (protocolVersion) =>
    (await handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion } })).result.protocolVersion;
  assert.equal(await negotiated("2025-03-26"), "2025-03-26", "a supported version is echoed");
  assert.equal(await negotiated("2024-11-05"), "2024-11-05");
  assert.equal(await negotiated("2099-01-01"), "2025-06-18", "anything else gets the newest supported version");
  assert.equal(await negotiated(undefined), "2025-06-18");
});

test("MCP stdio accepts ping and cancellation while an analysis is pending", async (t) => {
  let pollStarted;
  const started = new Promise((resolve) => { pollStarted = resolve; });
  const server = createServer((request, response) => {
    if (request.url === "/api/analyze") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ kind: "job", jobId: "cancel-job" })); }
    else if (request.url.startsWith("/api/jobs/")) pollStarted();
    else { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const child = spawn(process.execPath, [new URL("../mcp/src/index.js", import.meta.url).pathname], { env: { ...process.env, OCTOCOUNTS_API_BASE: `http://127.0.0.1:${server.address().port}` }, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { child.kill(); server.closeAllConnections(); server.close(); });
  const messages = [];
  let buffer = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) { const end = buffer.indexOf("\n"); messages.push(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1); }
  });
  const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "analyze_repo", arguments: { repo_url: "example/repo" } } });
  await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error("analysis did not begin")), 3000).unref())]);
  send({ jsonrpc: "2.0", id: 2, method: "ping" });
  send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } });
  child.stdin.write("{malformed}\n");
  const deadline = Date.now() + 3000;
  while (messages.length < 3 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(messages.find((message) => message.id === 2).result, {});
  const cancelled = messages.find((message) => message.id === 1);
  assert.equal(cancelled.error.data.jobId, "cancel-job");
  assert.match(cancelled.error.message, /cancelled.*resume with GET/);
  assert.equal(messages.find((message) => message.id === null).error.code, -32700);
});

// Run the actual card request functions with deterministic worker responses;
// DOM rendering is covered by the extension's fixture suite.
async function cardRequests(sendMessage) {
  const source = await readFile(new URL("../extension/src/content/card.js", import.meta.url), "utf8");
  const start = source.indexOf("function stopPolling() {");
  const end = source.indexOf("\n}", source.indexOf("async function startAnalysis(", start)) + 2;
  const timers = new Map();
  let nextTimer = 0;
  const context = vm.createContext({
    chrome: { runtime: { sendMessage } }, Date, encodeURIComponent,
    t: (key) => key,
    setTimeout: (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(`let _pollOperation = 0, _pollTimer = null, _deadlineTimer = null, _pollStart = null; const POLL_TIMEOUT_MS = 300000; ${source.slice(start, end)}`, context);
  return { start: context.startAnalysis, stop: context.stopPolling, timers };
}

test("extension does not resubmit an ambiguous POST or failed job read", async () => {
  const calls = [];
  const errors = [];
  const card = await cardRequests(async (message) => { calls.push(message); return { error: { code: "unknown" } }; });
  await card.start({ owner: "example", repo: "repo", onError: (error) => errors.push(error) });
  assert.equal(calls.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(card.timers.size, 0);

  const polling = await cardRequests(async (message) => { calls.push(message); return message.type === "ANALYZE" ? { type: "JOB", jobId: "recover-me" } : { error: { code: "not_found" } }; });
  await polling.start({ owner: "example", repo: "repo", onError: (error) => errors.push(error) });
  const poll = [...polling.timers.values()].find((timer) => timer.ms < 300000);
  await poll.callback();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].type, "POLL");
  assert.match(errors[1].detail, /recover-me.*GET \/api\/jobs/);
});

test("extension's total deadline suppresses a late worker response", async () => {
  let finish;
  const errors = [];
  let completed = false;
  const card = await cardRequests(() => new Promise((resolve) => { finish = resolve; }));
  const request = card.start({ owner: "example", repo: "repo", onError: (error) => errors.push(error), onCompleted: () => { completed = true; } });
  [...card.timers.values()].find((timer) => timer.ms === 300000).callback();
  finish({ type: "CACHED", report: {} });
  await request;
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "timeout");
  assert.equal(completed, false);
});
