import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publishTrending } from "./publish-github-trending.mjs";

const exec = childProcess.execFileSync;
const snapshotPath = "frontend/public/github-trending.json";
const repoPath = "data/github-trending-repos.txt";
const git = (dir, ...args) => exec("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

function writeSnapshot(dir, date) {
  const snapshot = { source: "https://github.com/trending", date, generatedAt: `${date}T00:00:00Z`, repositories: [] };
  writeFileSync(join(dir, snapshotPath), JSON.stringify(snapshot));
  writeFileSync(join(dir, repoPath), `# ${date}\n`);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "trending-publish-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, "remote.git");
  const source = join(root, "source");
  const competitor = join(root, "competitor");
  git(root, "init", "--bare", "--initial-branch=main", remote);
  mkdirSync(join(source, "frontend/public"), { recursive: true });
  mkdirSync(join(source, "data"));
  git(source, "init", "--initial-branch=main");
  git(source, "config", "user.name", "Test");
  git(source, "config", "user.email", "test@example.com");
  writeSnapshot(source, "2026-11-01");
  git(source, "add", ".");
  git(source, "commit", "-m", "Initial snapshot");
  git(source, "remote", "add", "origin", remote);
  git(source, "push", "origin", "main");
  git(root, "clone", remote, competitor);
  git(competitor, "config", "user.name", "Other");
  git(competitor, "config", "user.email", "other@example.com");
  writeSnapshot(source, "2026-11-02");
  return { root, remote, source, competitor };
}

test("publishing retries a racing push and preserves remote commits and local changes", (t) => {
  const { remote, source, competitor } = fixture(t);
  writeFileSync(join(source, "notes.txt"), "local work");
  git(source, "add", "notes.txt");
  const before = git(source, "status", "--porcelain");
  writeFileSync(join(competitor, "release.txt"), "upstream change");
  git(competitor, "add", ".");
  git(competitor, "commit", "-m", "Unrelated release");
  git(competitor, "push", "origin", "main");
  let pushes = 0;
  t.mock.method(childProcess, "execFileSync", (command, args, options) => {
    if (args[2] === "push" && ++pushes === 1) {
      writeFileSync(join(competitor, "race.txt"), "racing change");
      git(competitor, "add", ".");
      git(competitor, "commit", "-m", "Racing commit");
      git(competitor, "push", "origin", "main");
    }
    return exec(command, args, options);
  });
  publishTrending(source);
  assert.equal(pushes, 2);
  assert.equal(git(remote, "show", "main:release.txt"), "upstream change");
  assert.equal(git(remote, "show", "main:race.txt"), "racing change");
  assert.equal(git(remote, "show", `main:${snapshotPath}`), readFileSync(join(source, snapshotPath), "utf8"));
  assert.equal(git(remote, "show", `main:${repoPath}`), "# 2026-11-02\n");
  assert.equal(git(source, "status", "--porcelain"), before);
  assert.equal(git(source, "worktree", "list", "--porcelain").match(/^worktree /gm).length, 1);
  assert.equal(git(remote, "diff-tree", "--no-commit-id", "--name-only", "-r", "main").trim(), `${repoPath}\n${snapshotPath}`);
});

test("a newer snapshot arriving during a retry wins as a complete file pair", (t) => {
  const { remote, source, competitor } = fixture(t);
  let pushes = 0;
  t.mock.method(childProcess, "execFileSync", (command, args, options) => {
    if (args[2] === "push" && ++pushes === 1) {
      writeSnapshot(competitor, "2026-11-03");
      git(competitor, "add", ".");
      git(competitor, "commit", "-m", "Newer snapshot");
      git(competitor, "push", "origin", "main");
    }
    return exec(command, args, options);
  });
  publishTrending(source);
  assert.equal(pushes, 1);
  assert.equal(JSON.parse(git(remote, "show", `main:${snapshotPath}`)).date, "2026-11-03");
  assert.equal(git(remote, "show", `main:${repoPath}`), "# 2026-11-03\n");
});

test("unchanged snapshots create no commit, and repeated push failures are bounded", (t) => {
  const { remote, source } = fixture(t);
  writeSnapshot(source, "2026-11-01");
  const before = git(remote, "rev-parse", "main");
  publishTrending(source);
  assert.equal(git(remote, "rev-parse", "main"), before);
  writeSnapshot(source, "2026-11-02");
  let pushes = 0;
  t.mock.method(childProcess, "execFileSync", (command, args, options) => {
    if (args[2] === "push") { pushes++; throw new Error("Push rejected"); }
    return exec(command, args, options);
  });
  assert.throws(() => publishTrending(source), /Push rejected/);
  assert.equal(pushes, 3);
  assert.equal(git(remote, "rev-parse", "main"), before);
  assert.equal(git(source, "worktree", "list", "--porcelain").match(/^worktree /gm).length, 1);
});
