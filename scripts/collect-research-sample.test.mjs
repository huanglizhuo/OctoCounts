import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { collectRun, CONFIGS } from "./collect-research-sample.mjs";

test("research preserves raw evidence and rejects identity or policy drift", async () => {
  const originalFetch = globalThis.fetch;
  const sha = "a".repeat(40);
  const entry = CONFIGS[1];
  const report = {
    id: "saved-report", repository: { owner: "octo", name: "demo" }, commitSha: sha,
    generatedAt: "2026-10-27T00:00:00Z", tokeiVersion: "14.0.0",
    analysisOptions: entry.options,
    countingPolicy: { ...entry.options, version: "v1", repositoryAttributes: { status: "disabled" } },
    total: { files: 10, lines: 15, code: 10, comments: 3, blanks: 2 },
  };
  let returned = report, calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    assert.equal(JSON.parse(init.body).refName, sha);
    return Response.json({ kind: "cached", report: returned });
  };
  try {
    const ok = await collectRun("octo/demo", entry, sha, "collector-hash");
    assert.equal(ok.outcome, "ok");
    assert.deepEqual(ok.report, report);
    assert.equal(ok.collectorSha256, "collector-hash");
    returned = { ...report, commitSha: "b".repeat(40) };
    const wrong = await collectRun("octo/demo", entry, sha, "collector-hash");
    assert.equal(wrong.outcome, "failed");
    assert.match(wrong.error, /changed the measured commit/);
    assert.equal(wrong.report.commitSha, returned.commitSha);
    returned = { ...report, countingPolicy: { ...report.countingPolicy, includeTests: true } };
    assert.equal((await collectRun("octo/demo", entry, sha, "collector-hash")).outcome, "failed");
    const before = calls;
    assert.equal((await collectRun("octo/demo", entry, undefined, "collector-hash")).outcome, "failed");
    assert.equal(calls, before, "no unpinned variant is submitted after a failed baseline");
  } finally { globalThis.fetch = originalFetch; }
});

test("published study preserves pinned evidence and matching HTML/Markdown counts", async () => {
  const root = new URL("../frontend/public/", import.meta.url);
  const raw = await readFile(new URL("research/filtering-effects-2026-10-27.jsonl", root), "utf8");
  const archive = JSON.parse(await readFile(new URL("research/filtering-effects-2026-10-27-source.json", root), "utf8"));
  const html = await readFile(new URL("research.html", root), "utf8");
  const md = await readFile(new URL("research.md", root), "utf8");
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  assert.equal(hash(raw), archive.datasetSha256);
  for (const file of Object.values(archive.files)) assert.equal(hash(file.content), file.sha256);
  const rows = raw.trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 50);
  const repos = [...new Set(rows.map((row) => row.repository))];
  assert.equal(repos.length, 10);
  for (const repo of repos) {
    const group = rows.filter((row) => row.repository === repo);
    assert.deepEqual(group.map((row) => row.config), ["default", "exclude-tests", "exclude-docs", "exclude-generated", "repository-declarations"]);
    assert.equal(new Set(group.map((row) => row.commitSha)).size, 1);
    const cells = [repo + " @ " + group[0].commitSha.slice(0, 12)];
    for (const [i, row] of group.entries()) {
      assert.equal(row.outcome, "ok");
      assert.match(row.commitSha, /^[a-f0-9]{40}$/);
      assert.equal(row.report.commitSha, row.commitSha);
      assert.equal(row.collectorSha256, archive.files["scripts/collect-research-sample.mjs"].sha256);
      assert.equal(row.tokeiVersion, "tokei-14.0.0");
      assert.deepEqual(row.totals, row.report.total);
      assert.equal(row.report.countingPolicy.version, row.options.respectGitattributes ? "attributes-v1" : "directories-v1");
      assert.ok(row.report.id && Number.isFinite(Date.parse(row.report.generatedAt)));
      for (const key of ["includeDocs", "includeTests", "includeGenerated"]) assert.equal(row.report.countingPolicy[key], row.options[key]);
      assert.equal(row.report.analysisOptions.respectGitattributes ?? false, row.options.respectGitattributes);
      const code = row.totals.code.toLocaleString("en-US");
      const delta = group[0].totals.code - row.totals.code;
      cells.push(i ? `${code} (${delta ? "−" : ""}${(100 * delta / group[0].totals.code).toFixed(1)}%)` : code);
    }
    assert.ok(md.includes(`| ${cells.join(" | ")} |`), repo);
    assert.ok(html.includes(`<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`), repo);
  }
  assert.ok(html.includes(archive.datasetSha256) && md.includes(archive.datasetSha256));
});
