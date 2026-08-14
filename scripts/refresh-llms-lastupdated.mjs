#!/usr/bin/env node
// Refresh the `Last-Updated:` header in llms.txt / llms-full.txt so the
// freshness signal answer engines read never goes stale. Run by CI on every
// push to main that touches frontend content; exits 0 with no changes when
// the header already matches today.
import { readFile, writeFile } from "node:fs/promises";

const FILES = [
  new URL("../frontend/public/llms.txt", import.meta.url),
  new URL("../frontend/public/llms-full.txt", import.meta.url),
];
const today = new Date().toISOString().slice(0, 10);
let changed = 0;

for (const file of FILES) {
  const before = await readFile(file, "utf8");
  const after = before.replace(/^Last-Updated: .*$/m, `Last-Updated: ${today}`);
  if (after !== before) {
    await writeFile(file, after);
    changed += 1;
  }
}

console.log(`llms last-updated: ${changed ? `refreshed ${changed} file(s) to ${today}` : `already current (${today})`}`);
