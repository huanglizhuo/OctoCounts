import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const script = new URL("./seed-popular-repos.mjs", import.meta.url);
function plan(...args) {
  return execFileSync(process.execPath, [script.pathname, "--dry-run", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .trim().split("\n").filter((line) => /^[\w.-]+\/[\w.-]+(?:\s|$)/.test(line));
}

test("rotating batches cover the whole inventory including appended compare repositories", () => {
  const inventory = plan();
  const size = 50;
  const count = Math.ceil(inventory.length / size);
  const batches = Array.from({ length: count }, (_, batch) => plan("--limit", String(size), "--batch", String(batch)));
  assert.deepEqual(batches.flat(), inventory);
  assert.deepEqual(plan("--limit", String(size), "--batch", String(count)), batches[0]);
  assert.ok(batches.every((batch) => batch.length > 0 && batch.length <= size));
});

test("invalid batch and limit values cannot silently change the scheduled scope", () => {
  for (const args of [["--batch", "-1"], ["--batch", "1.5"], ["--limit", "0"], ["--limit", "wrong"], ["--batch"], ["--limit"]]) {
    assert.throws(() => plan(...args));
  }
});

// The scheduled runs failed for weeks by retrying 429s after 1s/2s/4s while the
// API's bucket only refills every few seconds; Retry-After is the real answer.
test("a rate-limited analyze waits for Retry-After instead of failing", async () => {
  let posts = 0;
  const server = createServer((request, response) => {
    request.resume().on("end", () => {
      posts += 1;
      if (posts === 1) {
        response.writeHead(429, { "content-type": "application/json", "retry-after": "2" });
        response.end(JSON.stringify({ code: "rate_limited", message: "too many requests; please retry later" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ kind: "cached", report: { id: "r1", repository: { owner: "octo", name: "demo" } } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const dir = await mkdtemp(join(tmpdir(), "seed-test-"));
    const file = join(dir, "repos.txt");
    await writeFile(file, "octo/demo\n");
    const started = Date.now();
    await promisify(execFile)(process.execPath, [
      script.pathname, "--api-base", `http://127.0.0.1:${server.address().port}`, "--file", file, "--limit", "1",
    ]);
    assert.equal(posts, 2);
    assert.ok(Date.now() - started >= 2_000, "the retry must honor Retry-After, not the 1s backoff");
  } finally {
    server.close();
  }
});
