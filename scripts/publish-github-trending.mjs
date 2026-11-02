#!/usr/bin/env node

import childProcess from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateTrendingSnapshot } from "../frontend/functions/trending-sloc.js";

export function publishTrending(cwd = process.cwd()) {
  const paths = ["frontend/public/github-trending.json", "data/github-trending-repos.txt"];
  const contents = paths.map((path) => readFileSync(join(cwd, path)));
  const candidate = validateTrendingSnapshot(JSON.parse(contents[0]));
  if (!candidate) throw new Error("Refusing to publish an invalid Trending snapshot");
  const git = (dir, ...args) => childProcess.execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  const scratch = mkdtempSync(join(tmpdir(), "octocounts-trending-publish-"));
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      git(cwd, "fetch", "origin", "main");
      const worktree = join(scratch, String(attempt));
      // Publish only the generated files on the latest remote commit; leave the source checkout alone.
      git(cwd, "worktree", "add", "--detach", worktree, "FETCH_HEAD");
      try {
        const current = validateTrendingSnapshot(JSON.parse(readFileSync(join(worktree, paths[0]), "utf8")));
        if (current && Date.parse(current.generatedAt) > Date.parse(candidate.generatedAt)) {
          console.log("Remote already has a newer Trending snapshot; keeping it.");
          return;
        }
        paths.forEach((path, index) => writeFileSync(join(worktree, path), contents[index]));
        git(worktree, "add", "--", ...paths);
        if (!git(worktree, "diff", "--cached", "--name-only").trim()) {
          console.log("Trending snapshot is unchanged.");
          return;
        }
        git(worktree, "commit", "-m", "chore: refresh GitHub Trending snapshot");
        try {
          git(worktree, "push", "origin", "HEAD:main");
          console.log("Published Trending snapshot.");
          return;
        } catch (error) {
          if (attempt === 3) throw error;
          console.warn(`Trending push failed; syncing with origin/main before attempt ${attempt + 1}.`);
        }
      } finally {
        git(cwd, "worktree", "remove", "--force", worktree);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) publishTrending();
