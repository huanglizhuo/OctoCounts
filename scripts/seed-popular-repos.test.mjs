import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

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
