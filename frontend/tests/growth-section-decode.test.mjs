import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// GrowthSection.tsx mounts the whole growth chunk (react-query, scene
// builder, player, exporters), which this repo's plain node --test harness
// cannot render — the suite tests such components through extracted pure
// modules, and none is factored out of this decode yet. So the regression is
// pinned structurally, the same way deployment.test.mjs pins nginx/Dockerfile
// behavior: on the exact decode expressions that shipped the bug, where a
// refresh failure with cached data used to replace the scene entirely.
const source = await readFile(new URL("../src/report/GrowthSection.tsx", import.meta.url), "utf8");

test("a failed history fetch only replaces the section when no scene can be built", () => {
  // The gating that shipped the bug read plain `historyQuery.isError ?` —
  // with stale data cached, that suppressed a playable scene. The error state
  // must require that the failure left nothing to render.
  assert.match(source, /historyQuery\.isError && !scene \? \(/);
  assert.doesNotMatch(source, /\) : historyQuery\.isError \? \(/);
});

test("a failed refresh with cached data keeps the scene and surfaces an inline notice", () => {
  // Same convention as the explore pages (ExploreDataError with stale data):
  // stale scene stays, styled notice + retry render above it.
  assert.ok(source.includes('import { ExploreDataError } from "../growth/ExploreLoading";'), "reuses the explore error component");
  assert.ok(
    source.includes("<ExploreDataError stale={!!historyQuery.data} onRetry={() => void historyQuery.refetch()} />"),
    "the scene branch renders the stale-data notice with a retry affordance",
  );
});
