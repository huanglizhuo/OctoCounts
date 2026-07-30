# OctoCounts — Code Growth & Extension Execution Plan

> Implementation handoff for GPT-5.6 Terra.
>
> This is the active, self-contained backlog and implementation handoff. It replaces the previous completed-task log because the workspace filesystem treats `task.md` and `TASK.md` as the same path.

## 1. Objective

Grow OctoCounts through two reinforcing loops:

1. **Extension loop:** install → first successful GitHub report → repeat repository visits → compare/share/rate.
2. **Data loop:** repository analysis → useful canonical data page → search/AI discovery → extension install or README badge → new referral traffic.

The implementation must improve activation, retention, reliability, and discoverability without weakening the current privacy promise or turning the extension into a second copy of the web app.

## 2. Mandatory Working Rules

- Read `PRODUCT.md`, `README.md`, this task file, `GROWTH.md`, and the project memory before implementation.
- Use codebase-memory-mcp graph tools first for code discovery: `search_graph`, `trace_path`, then `get_code_snippet`.
- Work in the numbered order unless a dependency explicitly permits safe parallel work.
- Make one focused commit per task or coherent subtask. Do not mix unrelated cleanup.
- Preserve all unrelated user changes in the worktree.
- Use additive database/schema changes. Do not destructively rewrite production data.
- Keep Chrome and Firefox builds passing; add Edge as an explicit build target rather than treating it as an alias silently.
- All new user-facing extension strings must be added to every existing locale or have an intentional English fallback verified in tests.
- All new indexable pages must have server-rendered/crawlable content, a single canonical URL, useful unique content, and internal links.
- Do not add new extension permissions unless the task explicitly requires one and the implementation documents the reason.
- After completing a task, update its status in this file from `pending` to `completed` and append verification evidence.

## 3. Existing Baseline — Do Not Reimplement

The following already exists and should be reused:

- Public GitHub repository analysis with commit-level caching.
- Chrome/Firefox MV3 extension with automatic GitHub sidebar card injection.
- Extension local cache, request deduplication, settings sync, fork skipping, placement, GitHub-language replacement, error persistence, TXT/JSON export, README badge copy, Compare link, Star prompt, and Chrome rating prompt.
- Permanent report URLs, server-injected report HTML, JSON-LD, citable answer blocks, dynamic OG images, sitemap, robots.txt, `llms.txt`, `llms-full.txt`, methodology/API/SLOC docs.
- `/stats`, `/recent`, `/popular`, `/hall-of-monoliths`, Badge Builder, `/compare`, `/diff`, PNG sharing, and web analytics events.
- GitHub Action, CLI, MCP server, popular-repository seed script, and launch kit.
- Privacy-preserving aggregate request `source` reporting. Do not replace it with user-level telemetry.

## 4. Explicit Non-Goals

These are stored in project memory and must not be implemented without explicit product-owner approval:

- Private repository support or GitHub OAuth/token handling.
- Heavy/user-level extension analytics, installation IDs, browsing history, repository-history telemetry, IP hashing, or user event streams.
- Large onboarding tours, modal walkthroughs, or multi-step tutorials.
- Default browser notifications or background alerts.
- Rebuilding all web-app functionality inside the extension.
- Restoring GitLab support.
- Unjustified permission expansion.

## 5. Priority and Impact Model

- **P0:** correctness, imminent Edge readiness, activation, or high-confidence retention/indexing work. Complete first.
- **P1:** high-impact product differentiation, reliability, and original-data acquisition surfaces.
- **P2:** compounding content/data surfaces with larger implementation scope.
- **P3:** valuable enhancements that should follow measured evidence from P0–P2.
- **Impact 5:** directly affects most users or creates a durable growth loop.
- **Impact 4:** affects a major funnel stage or protects product reputation.
- **Impact 3:** useful differentiator or conversion improvement with narrower reach.

## 6. Ranked Backlog

| Rank | ID | Priority | Impact | Effort | Task | Status |
|---:|---|:---:|:---:|:---:|---|---|
| 1 | T01 | P0 | 5 | S | Canonical, entity, repository URL, and version consistency | completed |
| 2 | T02 | P0 | 5 | S | Explicit Chrome/Edge/Firefox build targets and store routing | completed |
| 3 | T03 | P0 | 5 | M | Extension “since last visit” repository delta | pending |
| 4 | T04 | P0 | 4 | S | Contextual first-value activation flow | pending |
| 5 | T05 | P0 | 4 | S | IndexNow submission for new/updated canonical data pages | completed |
| 6 | T06 | P0 | 4 | M | Sitemap/indexability quality gate | pending |
| 7 | T07 | P1 | 5 | M | GitHub-native fork, branch, tag, and commit comparison actions | pending |
| 8 | T11 | P1 | 5 | M | GitHub DOM compatibility tests and resilient insertion fallback | pending |
| 9 | T12 | P1 | 5 | L | Release-to-release SLOC pages and automated release watcher | pending |
| 10 | T13 | P1 | 5 | L | Repository history snapshots, trends, and RSS | pending |
| 11 | T08 | P1 | 4 | S | Current-tab SLOC in the extension action badge | pending |
| 12 | T09 | P1 | 4 | M | Popup current-repository dashboard and card quick actions | pending |
| 13 | T10 | P1 | 4 | S | Value-signal-based Star/rating prompts | pending |
| 14 | T14 | P1 | 4 | M | Language data hubs and leaderboards | pending |
| 15 | T15 | P1 | 4 | M | Curated framework/tool comparison landing pages | completed |
| 16 | T16 | P2 | 4 | M | Localized SEO entry pages with stable locale URLs and hreflang | pending |
| 17 | T17 | P2 | 4 | S | Extension-specific Chrome/Edge/Firefox landing pages | pending |
| 18 | T18 | P2 | 3 | M | README badge adopter discovery and showcase | pending |
| 19 | T19 | P3 | 3 | L | Explicit analysis profiles and exclusions | pending |
| 20 | T20 | P3 | 3 | S | Deeper GitHub language filtering and code-search actions | pending |
| 21 | T21 | P0 | 4 | S | GEO P0 batch: compare/diff indexability, report FAQPage, crawler policy, entity signals | completed |
| 22 | T22 | P1 | 4 | S | ChatGPT AI Search sampling baseline and monthly monitoring | pending — blocked on browser bridge setup |
| 23 | T23 | P1 | 4 | M | Off-site evidence for answer-engine corroboration | pending |

---

## T01 — Canonical, Entity, Repository URL, and Version Consistency

**Priority:** P0
**Impact:** 5/5
**Effort:** Small
**Status:** completed

### Why

Production currently mixes the renamed GitHub repository `huanglizhuo/OctoCounts` with the old `huanglizhuo/OctoCount`. Static documentation URLs also redirect from `.html` to extensionless URLs while canonical tags and sitemap entries still point to `.html`. The home-page software schema contains a stale extension version.

These inconsistencies fragment SEO signals, confuse AI/entity extraction, and cause extension support/Star links to depend on GitHub’s old-repository redirect behavior.

### Implementation

1. Replace old repository URLs with `https://github.com/huanglizhuo/OctoCounts` in user-facing source, examples, schema, docs, badge samples, extension footer, Star prompt, CLI/Action/MCP links, and initial sample report.
2. Select extensionless documentation URLs as canonical because production currently redirects `.html` to extensionless paths:
   - `/docs/github-sloc-counter`
   - `/docs/methodology`
   - `/docs/api`
3. Update canonical, OG URL, JSON-LD `mainEntityOfPage`, sitemap entries, internal links, `llms.txt`, `llms-full.txt`, and generated sitemap route constants to use the same extensionless URLs.
4. Keep 308 redirects from legacy `.html` URLs.
5. Remove hard-coded `softwareVersion` drift:
   - Prefer build-time injection from `extension/package.json` or a root product-version source.
   - Add a build/test assertion that page schema version matches the packaged Chrome extension version.
6. Update `GROWTH.md` status summary so already deployed SEO/GEO/analytics/Action/CLI/MCP work is not shown as pending.

### Likely Files

- `frontend/index.html`
- `frontend/functions/[[path]].js`
- `frontend/src/constants.ts`
- `frontend/src/main.tsx`
- `frontend/src/initialReport.json`
- `frontend/public/sitemap.xml`
- `frontend/public/llms.txt`
- `frontend/public/llms-full.txt`
- `frontend/public/docs/*.html`
- `frontend/public/privacy.html`
- `frontend/public/contact.html`
- `frontend/public/launch-kit.html`
- `extension/src/content/panel.js`
- `extension/src/popup/index.html`
- `README.md`, `GROWTH.md`

### Acceptance Criteria

- Repository-wide search finds no user-facing `huanglizhuo/OctoCount` URL that is not intentionally documented as a legacy redirect.
- Every canonical URL returns 200 directly and self-canonicals to itself.
- Legacy `.html` URLs return 308 to the canonical extensionless URL.
- Sitemap, canonical, OG URL, JSON-LD, and internal links agree.
- Homepage schema version matches `extension/package.json` after a production build.
- Frontend and extension builds pass.

### Verification

```bash
rg 'huanglizhuo/OctoCount([^s]|$)' .
curl -I https://octocounts.com/docs/methodology
curl -I https://octocounts.com/docs/methodology.html
curl -s https://octocounts.com/docs/methodology | rg 'canonical|og:url'
```

### Verification Evidence — 2026-07-13

- `cd frontend && npm run test:seo`: passed 7/7, including Cloudflare and Nginx legacy redirects, direct canonical routes, canonical/OG/JSON-LD agreement, static/dynamic sitemap agreement, production-image version-source availability, and built schema version `0.4.1` matching `extension/package.json`.
- `cd frontend && npx playwright test`: passed 8/8 desktop/mobile browser QA tests.
- `cd backend && cargo fmt --check && cargo test`: passed; 31/31 backend tests.
- `cd action && npm run sample` and `cd cli && npm run sample:json`: passed with `huanglizhuo/OctoCounts` report identities and URLs.
- Repository/source and generated-artifact searches find no old `OctoCount` identity outside this task's intentional legacy description/assertion.
- Docker-equivalent isolated-context verification passed: a clean temporary `/app` received only the Dockerfile's frontend COPY inputs, adjacent `/extension/package.json`, a fresh `npm ci`, and `npm run build`; generated schema contained `"softwareVersion": "0.4.1"`. The focused test also locks Compose/CI/Dockerfile context wiring.

---

## T02 — Explicit Chrome/Edge/Firefox Build Targets and Store Routing

**Priority:** P0
**Impact:** 5/5
**Effort:** Small
**Status:** completed

### Why

Edge Add-ons is in review, but the extension build currently distinguishes only Firefox from “Chrome”. Store and review URLs are hard-coded, so an Edge user may be sent to the Chrome listing/review page.

### Implementation

1. Introduce an explicit build target: `chrome`, `edge`, or `firefox`.
2. Generate separate output directories:
   - `dist/chrome`
   - `dist/edge`
   - `dist/firefox`
3. Create a shared runtime build-info module containing:
   - browser/store identifier
   - install/listing URL
   - review URL
   - store display name
   - version
4. Replace `isFirefoxBuild()` and Chrome-specific constants with target-aware helpers.
5. Ensure Edge uses the final Microsoft Edge Add-ons URLs once approved. Until then, support an environment/build-time placeholder that fails the Edge release build clearly rather than silently falling back to Chrome.
6. Add `npm` scripts for all targets and a `build:all` command.
7. Update release packaging to emit clearly named archives with version and target.
8. Add tests or build assertions that no Edge artifact contains a Chrome review URL and no Firefox artifact renders a Chromium rating prompt.

### Likely Files

- `extension/vite.config.js`
- `extension/package.json`
- `extension/scripts/release.js`
- `extension/manifests/manifest.chrome.json`
- optional new `extension/manifests/manifest.edge.json`
- `extension/src/shared/buildInfo.js`
- `extension/src/content/panel.js`
- `extension/src/popup/index.js`

### Acceptance Criteria

- `npm run build:all` produces three valid artifacts.
- Each artifact reports the correct version and store URLs.
- Chrome, Edge, and Firefox do not show rating prompts for another store.
- No additional runtime permission is introduced.

### Verification Evidence — 2026-07-13

- `cd extension && npm test`: passed 5/5 after independently building `dist/chrome`, `dist/edge`, and `dist/firefox`.
- Artifact assertions verified target/store identity, version `0.4.1`, target-specific listing/review origins, identical permission/host-permission baselines, and absence of cross-store URLs.
- `cd extension && npm run package:artifacts`: emitted `octocounts-{chrome,edge,firefox}-v0.4.1-274d1153.zip` from three independent build directories.
- Pending Edge builds use an explicit Microsoft Edge Add-ons placeholder, set `storeConfigured: false`, and disable the rating prompt. The release-packaging test confirms a clear failure requiring `EDGE_STORE_URL` and `EDGE_STORE_REVIEW_URL`.
- `.github/workflows/extension-release.yml` parsed successfully and packages the independent target directories; tag packaging invokes the Edge configuration guard.
- `git diff --check`: passed.

---

## T03 — Extension “Since Last Visit” Repository Delta

**Priority:** P0
**Impact:** 5/5
**Effort:** Medium
**Status:** pending

### Why

The current extension delivers excellent first-use value but offers nearly the same result on repeat visits. A local “since last visit” delta turns a one-shot counter into a retention feature without accounts, tracking, or a new permission.

### Data Model

Store a bounded local snapshot after a successful user-visible render:

```js
lastSeen::<owner>/<repo> = {
  commitSha,
  refName,
  seenAt,
  total: { files, lines, code, comments, blanks },
  languages: [{ name, files, lines, code, comments, blanks }]
}
```

### Implementation

1. Add a small snapshot module separate from API response cache.
2. Compare the latest completed report with the prior snapshot for the same repository/ref.
3. Present only meaningful changes:
   - code line delta
   - file delta
   - changed/new/removed language count
   - time since prior observation
4. Add a compact card/panel message such as `+1,842 code lines since your last visit`.
5. Provide `View full diff` linking to the existing web `/diff` route with base previous SHA and head current SHA.
6. Do not overwrite the previous snapshot before calculating/rendering the delta.
7. Update the snapshot after the result has been shown successfully.
8. Bound storage by LRU count and age; integrate pruning with existing extension cache maintenance without conflating cache TTL with last-seen history.
9. Do not transmit last-seen history to the backend.

### Edge Cases

- First visit: no delta UI.
- Same SHA: optionally show `No code change since last visit`, but keep visually quiet.
- Different ref: do not compare unless both snapshots represent the same ref or the UI labels the comparison explicitly.
- Force refresh with unchanged SHA: do not create a false visit delta.
- Missing old language data: degrade to total-only delta.

### Likely Files

- new `extension/src/background/history.js` or `extension/src/shared/history.js`
- `extension/src/background/index.js`
- `extension/src/content/card.js`
- `extension/src/content/panel.js`
- `extension/src/styles/card.css`
- `extension/src/styles/panel.css`
- `extension/src/locales/*.json`

### Acceptance Criteria

- Two reports for the same repo/ref with different SHAs show an accurate signed delta.
- First visits and same-SHA visits do not show misleading changes.
- History remains local, bounded, and clearable.
- Existing API cache behavior is unchanged.
- Unit tests cover additions, removals, new languages, removed languages, same SHA, and ref mismatch.
- Chrome/Edge/Firefox builds pass.

---

## T04 — Contextual First-Value Activation Flow

**Priority:** P0
**Impact:** 4/5
**Effort:** Small
**Status:** pending

### Why

The current welcome banner is visible only if the user opens the popup. The extension’s real activation moment occurs on the first public GitHub repository where a report succeeds.

### Implementation

1. Define activation as:
   - first successful report rendered, then
   - user opens the detailed panel or uses a report action.
2. After the first successful card render, show one dismissible contextual hint attached to the card:
   - no modal
   - no page-blocking overlay
   - one sentence and one action
3. Suggested copy: `OctoCounts is ready — click for language details →`.
4. Persist `firstValueHintDismissed` or activation completion in `chrome.storage.local`.
5. In the popup welcome state on non-repository pages, add a `Try on microsoft/vscode` sample button that opens a public repository.
6. The hint must disappear permanently after panel open, explicit dismissal, or first report action.
7. Do not combine the first-value hint with Star/rating prompts.

### Likely Files

- `extension/src/content/card.js`
- `extension/src/content/panel.js`
- `extension/src/popup/index.html`
- `extension/src/popup/index.js`
- `extension/src/styles/card.css`
- `extension/src/locales/*.json`

### Acceptance Criteria

- A new profile can install the extension and reach a real report without opening settings.
- The hint appears once, never blocks GitHub controls, and is keyboard accessible.
- Returning users never see the onboarding hint again.
- No additional permission or analytics identifier is added.

---

## T05 — IndexNow Submission for New/Updated Canonical Data Pages

**Priority:** P0
**Impact:** 4/5
**Effort:** Small
**Status:** completed

### Why

OctoCounts creates and updates canonical report pages continuously. Search engines should learn about high-quality report, release-diff, trend, language, and comparison pages without waiting for a full sitemap recrawl.

### Implementation

1. Add configuration for `INDEXNOW_KEY`, host, key-location URL, enable flag, batch size, and retry limits.
2. Serve the IndexNow key file at the documented public location.
3. Create an asynchronous URL submission service with:
   - deduplication
   - batching
   - bounded retries with backoff
   - timeout
   - failure logging without failing report creation
4. Trigger only after a canonical/indexable URL is newly created or materially updated.
5. Submit canonical URLs only; never submit query-parameter variants or noindex pages.
6. Support a dry-run/test mode and mock HTTP endpoint.
7. Do not send every cache hit.

### Likely Files

- `backend/src/config.rs`
- `backend/src/store.rs`
- `backend/src/seo.rs`
- new `backend/src/indexnow.rs`
- `backend/src/main.rs`
- deployment env examples/config

### Acceptance Criteria

- A newly indexable report queues exactly one canonical URL submission.
- Cache hits do not trigger submissions.
- Network failure does not fail analysis or report persistence.
- Tests verify batching, deduplication, URL filtering, and retry behavior.

### Verification Evidence — 2026-07-30

- `cd backend && cargo fmt --check && cargo test`: 43 passed / 0 failed, including 11 new IndexNow tests (batch size trigger and flush-interval trigger, same-window dedup, URL filtering for query/fragment/wrong-host/http/root, retry on 5xx/429 with backoff, no retry on 4xx, dry-run zero requests, payload host/key/keyLocation/urlList correctness, disabled-without-key behavior).
- Trigger point: `coordinator.rs` `complete_job` after `store.save_report()` succeeds — reached only on new/materially-updated reports; cache hits return earlier and never enqueue.
- New module `backend/src/indexnow.rs` (config, fire-and-forget service, batch worker, bounded retry); env config in `backend/src/config.rs`; `seo.rs::public_path` reused for canonical URLs.
- Env documented in `.env.example`, `docker-compose.yml` (9 `INDEXNOW_*` pass-throughs), and `how-to-run-and-deploy.md` (new "IndexNow submission" section).
- Key file served by the Cloudflare Pages function at `https://octocounts.com/<INDEXNOW_KEY>.txt` from the Pages `INDEXNOW_KEY` env (see T21), not by the backend; both sides must share the same key.
- Deviation recorded: `INDEXNOW_KEY_LOCATION` default derives from `INDEXNOW_HOST` instead of a hard-coded host; identical under the default host.

---

## T06 — Sitemap/Indexability Quality Gate

**Priority:** P0
**Impact:** 4/5
**Effort:** Medium
**Status:** pending

### Why

Not every analyzed repository deserves immediate inclusion in the sitemap. Low-information or disposable repositories can dilute crawl attention. Reports should remain shareable while indexation focuses on useful, original pages.

### Implementation

1. Add an explainable indexability decision, not a black-box score.
2. Candidate signals:
   - curated seed status
   - successful complete report
   - non-empty description
   - non-archived status
   - fork status
   - stars/watchers threshold bands
   - report access count
   - repeated independent analysis
   - minimum meaningful source-file/code count
3. Fetch/cache only required public GitHub metadata; avoid increasing analysis latency by placing enrichment off the critical path where possible.
4. Store indexability state and reason codes so behavior is auditable.
5. Include only indexable reports in sitemap/list-data intended for search.
6. Serve low-score report pages normally but add `noindex,follow` and exclude them from sitemap.
7. Curated popular seed repositories always qualify after a valid report.
8. Add a re-evaluation job so a previously low-score page can become indexable after gaining access/popularity.
9. Do not use stars as the only criterion.

### Likely Files

- `backend/src/store.rs`
- `backend/src/github.rs`
- `backend/src/models.rs`
- `backend/src/seo.rs`
- `frontend/functions/[[path]].js`
- `scripts/seed-popular-repos.mjs`

### Acceptance Criteria

- Sitemap contains only reports that pass the documented rule.
- Low-score pages remain functional, canonical, and `noindex,follow`.
- The indexability reason is testable and visible in internal logs/admin output.
- Existing popular/recent/stats pages remain functional.

---

## T07 — GitHub-Native Fork, Branch, Tag, and Commit Comparison Actions

**Priority:** P1
**Impact:** 5/5
**Effort:** Medium
**Status:** pending

### Why

Showing SLOC is useful; explaining how the current GitHub context differs is differentiating. Reuse the existing web `/compare` and `/diff` capabilities rather than rebuilding the complete comparison UI in the extension.

### Implementation Order

1. Non-default branch → `Compare with default branch`.
2. Fork → `Compare with upstream`.
3. Tag → `Compare with previous release` when a prior tag can be resolved reliably.
4. Commit → `Compare with parent` when a parent SHA is available.

### Implementation

1. Extend page-context parsing to return context type, current ref, default branch, upstream repository, prior tag, and parent SHA when available.
2. Prefer data already embedded in GitHub’s rendered page; use GitHub public API only when required and cache metadata.
3. Add one context-aware action in the detailed panel; do not crowd the base card.
4. Build the existing canonical `/compare` or `/diff` URL with both sides prefilled.
5. Label exactly what will be compared.
6. If context is ambiguous, omit the action rather than guessing.

### Likely Files

- `extension/src/content/detect.js`
- `extension/src/content/panel.js`
- `extension/src/content/card.js`
- `extension/src/shared/api.js`
- `extension/src/locales/*.json`

### Acceptance Criteria

- Default-branch repo pages do not show a redundant branch comparison.
- Fork pages correctly target upstream.
- Refs containing `/` are encoded correctly.
- Generated URLs load valid prefilled web comparisons.
- No private-repo data or credentials are requested.

---

## T08 — Current-Tab SLOC in the Extension Action Badge

**Priority:** P1
**Impact:** 4/5
**Effort:** Small
**Status:** pending

### Implementation

1. After successful analysis, send the total code/line count and tab context to the background worker.
2. Set a compact action badge per tab: `984`, `12k`, `1.2m`.
3. Set a stable accessible badge color consistent with the product theme.
4. Clear badge text when leaving a supported public repository.
5. Show a short `!` only for actionable failures, then clear it; do not make error badges persistent.
6. Avoid stale results across GitHub SPA navigation and tab reuse.

### Likely Files

- `extension/src/content/card.js`
- `extension/src/content/index.js`
- `extension/src/background/index.js`
- shared formatting helper

### Acceptance Criteria

- The badge reflects the current tab only.
- SPA navigation updates or clears it correctly.
- Unsupported/private pages show no LOC badge.
- No new permission is required.

---

## T09 — Popup Repository Dashboard and Card Quick Actions

**Priority:** P1
**Impact:** 4/5
**Effort:** Medium
**Status:** pending

### Why

The popup is currently settings-led. On a repository page, users are more likely to want current status and actions than cache configuration.

### Implementation

1. Add a top current-repository summary:
   - owner/repository
   - code/total lines
   - ref and short SHA
   - cached/fresh state
   - last-seen delta when available
2. Primary actions:
   - Open details
   - Compare
   - Copy report URL
   - Copy README badge
3. Move settings into a visually secondary/collapsible region without hiding error recovery.
4. Add a compact `···` action menu to the injected card with:
   - Copy report URL
   - Copy README badge
   - Open full report
   - Disable for this repository
5. Do not add a permanent row of buttons to the base card.
6. Reuse existing URL/badge helpers to prevent drift.

### Acceptance Criteria

- Current repository data appears without a redundant API analysis.
- Quick actions work for branch/tag/commit refs.
- Popup remains useful on non-repository and error pages.
- Keyboard and screen-reader operation works.

---

## T10 — Value-Signal-Based Star/Rating Prompts

**Priority:** P1
**Impact:** 4/5
**Effort:** Small
**Status:** pending

### Why

The current prompts are based mainly on successful render counts. Automatic renders do not necessarily indicate satisfaction. Prompting after meaningful voluntary actions should improve review quality and reduce annoyance.

### Implementation

1. Keep existing one-time dismissal/click persistence.
2. Record local-only positive-value flags/counts:
   - panel opened repeatedly
   - badge copied
   - report URL copied
   - TXT/JSON exported
   - Compare/Diff opened
3. Trigger Star/rating only when minimum success count **and** at least one positive-value signal are present.
4. Suppress rating prompts when:
   - a recent analysis error exists
   - the current analysis was slow/failed/retried excessively
   - onboarding hint is active
   - another growth prompt is visible
5. Use target-specific store URLs from T02.
6. Do not add telemetry; all prompt eligibility remains local.

### Acceptance Criteria

- Passive automatic renders alone never produce a rating prompt.
- Positive voluntary actions make an eligible prompt possible.
- Each prompt remains one-time and dismissible.
- Firefox and Edge never receive the Chrome review URL.

---

## T11 — GitHub DOM Compatibility Tests and Resilient Insertion Fallback

**Priority:** P1
**Impact:** 5/5
**Effort:** Medium
**Status:** pending

### Why

The extension depends on GitHub DOM structures such as `.BorderGrid`. A GitHub markup change can break the core experience for every user and generate store removals/negative reviews.

### Implementation

1. Add deterministic DOM fixtures for:
   - standard public repository
   - fork
   - branch/tree
   - tag
   - commit
   - private repository
   - non-repository GitHub page
2. Test repository detection, ref parsing, card insertion, re-insertion after mutation, SPA navigation cleanup, and fallback placement.
3. Add a second insertion strategy when the primary language/sidebar container is unavailable.
4. Make insertion selectors centralized and named, not scattered literals.
5. Add a scheduled smoke workflow using Playwright against one or more real public GitHub repositories. It should detect markup breakage without mutating GitHub.
6. Add diagnostic logging behind an explicit local debug flag.
7. Optional remote configuration may disable a broken placement strategy, but it must:
   - contain no user identity
   - be cached
   - fail open to a safe local default
   - never become a remote-code mechanism

### Acceptance Criteria

- Fixture tests cover all listed page types.
- A missing primary selector uses the fallback or fails visibly/diagnosably.
- SPA route changes do not duplicate cards or leak observers/listeners.
- Scheduled smoke test produces an actionable failure message.

---

## T12 — Release-to-Release SLOC Pages and Automated Release Watcher

**Priority:** P1
**Impact:** 5/5
**Effort:** Large
**Status:** pending

### Why

Release changes create recurring, timely, original data. They are more shareable and citable than a one-time repository total and reuse the existing immutable ref analysis.

### Implementation

1. Add a curated repository watch list, initially reusing high-interest seed repositories.
2. Poll GitHub Releases/tags on a scheduled workflow with ETag/rate-limit handling.
3. For each newly observed release:
   - identify previous comparable release
   - analyze both immutable refs
   - store or derive totals and per-language delta
   - generate a permanent canonical page
4. Canonical route recommendation:
   - `/github/:owner/:repo/releases/:from...:to`
5. Server-render:
   - direct summary answer
   - totals table
   - per-language changes
   - methodology/ref/SHA/date
   - links to both underlying reports
6. Generate release-specific dynamic OG imagery.
7. Add pages to sitemap only when both analyses are complete and the repository passes the indexability gate.
8. Submit new canonical pages through IndexNow.
9. Do not auto-publish arbitrary release prose; use deterministic data summaries.

### Acceptance Criteria

- A new release creates at most one comparison page.
- Reruns are idempotent.
- Pre-release/draft release behavior is explicitly configured.
- Ref/SHA identity is reproducible.
- Pages remain valid if GitHub later changes the default branch.

---

## T13 — Repository History Snapshots, Trends, and RSS

**Priority:** P1
**Impact:** 5/5
**Effort:** Large
**Status:** pending

### Why

Historical trends create return usage and a unique original dataset. They should build on release tracking, not snapshot every GitHub repository indiscriminately.

### Implementation

1. Start with curated/watchlisted repositories only.
2. Store compact immutable snapshot summaries keyed by repository/ref/SHA/date; avoid duplicating full report bodies unnecessarily.
3. Add a repository trends route:
   - `/github/:owner/:repo/trends`
4. Show:
   - code/total line history
   - files
   - language mix changes
   - comment ratio
   - release annotations
5. Render a crawlable textual summary/table in addition to charts.
6. Add RSS/Atom feed per tracked repository for new release/change entries.
7. Link trends from report pages and extension `since last visit` full-diff actions where appropriate.
8. Enforce retention/downsampling policy so storage does not grow without bound.

### Acceptance Criteria

- Snapshot ingestion is idempotent by SHA and analysis profile.
- Charts and tables show the same numbers.
- RSS validates and contains canonical links.
- No background tracking is enabled for arbitrary repositories by default.

---

## T14 — Language Data Hubs and Leaderboards

**Priority:** P1
**Impact:** 4/5
**Effort:** Medium
**Status:** pending

### Initial Routes

- `/languages/rust`
- `/languages/python`
- `/languages/typescript`
- `/languages/javascript`
- `/languages/go`

### Implementation

1. Derive language aggregates from indexable, quality-gated reports only.
2. Each hub should include original useful data:
   - largest repositories by code lines in that language
   - repository count and total measured code
   - median/percentile repository size where statistically valid
   - language share and comment ratio
   - methodology and sample timestamp
3. Prevent one giant monorepo from making all aggregate copy meaningless; display sample size and use robust statistics.
4. Server-render unique titles, descriptions, answer blocks, tables, canonical, JSON-LD Dataset/CollectionPage, and internal links.
5. Add pagination only when enough qualified data exists; do not create empty thin pages.
6. Add language hubs to sitemap and IndexNow when materially updated.

### Acceptance Criteria

- No language page is published below a documented minimum sample size.
- Values are derived from canonical reports and reproducible queries.
- Pages link to underlying evidence reports.
- Mobile tables and charts remain usable.

---

## T15 — Curated Framework/Tool Comparison Landing Pages

**Priority:** P1
**Impact:** 4/5
**Effort:** Medium
**Status:** completed

### Why

Existing `/compare` query pages are interactive but not a curated indexable content set. A limited set of high-intent comparisons can produce useful, citable pages without generating combinatorial thin content.

### Implementation

1. Add a checked-in curated comparison registry, initially 10–20 pairs, for example React/Vue, Vite/Webpack, npm/pnpm, Fastify/Express.
2. Generate stable routes such as `/compare/react-vs-vue`.
3. Store exact repository identities and default/selected refs in the registry.
4. Server-render:
   - balanced direct summary
   - totals comparison
   - language overlap/differences
   - methodology/ref/SHA/date
   - links to both reports and interactive Compare UI
5. Avoid subjective “better” claims based on SLOC.
6. Rebuild/update only after source reports materially change.
7. Do not create arbitrary pair permutations.

### Acceptance Criteria

- Only registry-approved comparisons are indexable.
- Each page has current, reproducible source reports.
- Copy clearly states that code size is not code quality.
- Pages validate on mobile and expose useful non-JS HTML.

### Verification Evidence — 2026-07-30

- Registry `frontend/functions/compare-registry.js`: 16 pairs (react-vs-vue, angular-vs-react, svelte-vs-react, nextjs-vs-react-router, vite-vs-webpack, fastify-vs-express, nestjs-vs-express, deno-vs-node, pnpm-vs-yarn, tensorflow-vs-pytorch, electron-vs-tauri, react-native-vs-flutter, rust-vs-go, mongodb-vs-postgres, grafana-vs-kibana, terraform-vs-ansible). Both sides of every pair are in `data/popular-repos.txt` and returned HTTP 200 from the live `api/seo/report` endpoint; candidates failing that check (bootstrap, django, valkey, nuxt, npm/cli) were dropped.
- `/compare/:slug` server-renders in `frontend/functions/[[path].js`: neutral direct summary with an explicit "code size is not code quality" disclaimer, totals comparison table, language overlap/difference section, methodology/ref/SHA/date, links to both reports and the prefilled interactive `/compare?left=...&right=...` page, Dataset + BreadcrumbList JSON-LD consistent with page facts, `noindex` fallback when either report is missing.
- Bare `/compare` noscript lists all curated comparisons; generated and static sitemaps both include all 16 `/compare/<slug>` entries; `llms.txt`/`llms-full.txt` document the corpus.
- `frontend/src/main.tsx`: `/compare/*` routes to `ComparePage` and prefills from the SSR-injected `#octocounts-compare-prefill` JSON, so client hydration keeps the SSR head intact.
- `cd frontend && npm run test:seo`: 30/30 passed (5 new tests). `npx playwright test`: 9/9 passed.

---

## T16 — Localized SEO Entry Pages with Stable Locale URLs and Hreflang

**Priority:** P2
**Impact:** 4/5
**Effort:** Medium
**Status:** pending

### Initial Scope

Start with English, Simplified Chinese, and Japanese entry content, not all report pages:

- `/en/github-sloc-counter`
- `/zh/github-sloc-counter`
- `/ja/github-sloc-counter`
- matching extension landing pages from T17

### Implementation

1. Use stable locale-prefixed URLs with fully localized visible content, titles, descriptions, FAQ, schema text, and CTAs.
2. Add reciprocal `hreflang` links including self and `x-default`.
3. Self-canonical each locale page; never canonical Chinese/Japanese pages to English.
4. Add locale alternates to sitemap consistently.
5. Keep the client-side language preference for the app, but do not use it as the SEO localization mechanism.
6. Translate search intent and terminology naturally; do not ship raw literal translations.
7. Do not multiply all programmatic report pages into every locale during this task.

### Acceptance Criteria

- Every locale URL returns 200 with the correct `<html lang>` and server-rendered language.
- Canonical and hreflang clusters are reciprocal and valid.
- Locale pages contain genuinely translated main content.

---

## T17 — Extension-Specific Chrome/Edge/Firefox Landing Pages

**Priority:** P2
**Impact:** 4/5
**Effort:** Small
**Status:** pending

### Implementation

1. Create distinct useful pages, not doorway-page copies:
   - `/github-sloc-chrome-extension`
   - `/github-sloc-edge-extension`
   - `/github-sloc-firefox-extension`
2. Include browser-specific installation CTA, screenshots, actual permissions, privacy explanation, supported GitHub contexts, troubleshooting, version, and store reviews link.
3. Use browser-specific store URLs from the same source used by T02.
4. Add WebApplication/SoftwareApplication schema only where accurate.
5. Server-render and internally link from homepage/docs/report CTAs.
6. Edge page may exist before approval but must clearly say `Under review` and must not expose a dead install CTA; switch through configuration after approval.

### Acceptance Criteria

- Each page materially differs by browser support/install/troubleshooting information.
- Store links never cross browsers.
- Version and permissions are generated from build sources rather than manually duplicated.

---

## T18 — README Badge Adopter Discovery and Showcase

**Priority:** P2
**Impact:** 3/5
**Effort:** Medium
**Status:** pending

### Implementation

1. Build a scheduled script that searches public GitHub code for `api.octocounts.com/badge` using an approved authenticated GitHub API workflow token.
2. Store only public repository identity and discovered badge URL; no user profiling.
3. Verify the badge still exists in the default-branch README before publishing.
4. Add a `/showcase` page with repository links, visible badge, and report link.
5. Respect GitHub API limits and remove stale adopters.
6. Do not automatically open PRs, issues, or contact repository owners.
7. Track aggregate adopter count for social proof when the count is meaningful.

### Acceptance Criteria

- Discovery is idempotent and rate-limit aware.
- Showcase contains only verified public badge adopters.
- Stale entries are removed after repeated failed verification.
- No external repository is modified.

---

## T19 — Explicit Analysis Profiles and Exclusions

**Priority:** P3
**Impact:** 3/5
**Effort:** Large
**Status:** pending

### Scope

Provide a small set of reproducible profiles rather than an unrestricted ignore-pattern editor:

- `full_repository`
- `source_only`
- `exclude_tests_and_docs`

### Implementation

1. Specify exact exclusions and semantics for each profile.
2. Add profile to analyze request, cache key, report model, canonical/report display, badge/report citations, Action/CLI/MCP inputs, and methodology.
3. Keep current behavior as the default profile for backward compatibility.
4. Ensure two profiles for the same SHA do not collide in cache/storage.
5. Expose profile selection in the web app and extension settings/panel only after backend support is complete.
6. Clearly label every number with its profile.

### Acceptance Criteria

- Same SHA/profile is reproducible and cacheable.
- Different profiles cannot share a report ID/cache record accidentally.
- Existing callers without a profile continue to work.
- Documentation lists exact exclusions and limitations.

---

## T20 — Deeper GitHub Language Filtering and Code-Search Actions

**Priority:** P3
**Impact:** 3/5
**Effort:** Small
**Status:** pending

### Implementation

1. Preserve the current language-row click behavior.
2. Add an explicit secondary action for supported languages:
   - open GitHub code search scoped to the repository/language
3. Do not rely on undocumented modifier-key behavior alone; provide accessible labels/menu actions.
4. Preserve selected sort/filter state within the detailed panel while it remains open.
5. Correctly encode repository names and GitHub search qualifiers.

### Acceptance Criteria

- Language filter and code-search URLs work for representative languages.
- Keyboard users can invoke every action.
- Unsupported/ambiguous languages omit the code-search action rather than generating broken queries.

---

## T21 — GEO P0 Batch: Compare/Diff Indexability, Report FAQPage, Crawler Policy, Entity Signals

**Priority:** P0
**Impact:** 4/5
**Effort:** Small
**Status:** completed

### Why

A 2026-07 GEO audit (yao-geo-skills page-audit/panorama-audit methodology, ChatGPT focus) found: `/compare` and `/diff` returned HTTP 404 in production (Pages function fell through to static assets), report pages lacked the FAQPage JSON-LD that `llms-full.txt` advertises, `robots.txt` contradicted itself (`Content-Signal: ai-train=no` vs `GPTBot: Allow`), the homepage raw HTML had no crawlable internal links, static sitemap entries had no `lastmod`, and the IndexNow key file (T05) had no serving route.

### Implemented

1. `/compare` and `/diff` return 200 SSR shells with unique title/description/canonical/OG, `index,follow` robots, and noscript content (`comparePageResponse` in `frontend/functions/[[path].js`); client hydration no longer flips robots to `noindex` (`frontend/src/main.tsx`).
2. `reportJsonLd` @graph includes a `FAQPage` node built from the existing `reportFaq(report)` Q&As already present in page noscript.
3. `robots.txt`: GPTBot group carries an explicit `Content-Signal: search=yes,ai-input=yes,ai-train=yes` with a corrected comment; owner decision: keep GPTBot allowed for ChatGPT visibility. Google-Extended and CCBot remain disallowed.
4. Homepage noscript: "Explore OctoCounts" internal-link block (recent/popular/trending/hall-of-monoliths/docs + 3 sample reports) and an "OctoCounts vs local tokei/cloc" comparison table.
5. Homepage gains an `Organization` JSON-LD block (`@id: https://octocounts.com/#organization`, sameAs GitHub + three extension stores).
6. All static sitemap entries carry `lastmod` (`STATIC_SITEMAP_LASTMOD`) in both the generated and static `sitemap.xml` copies; static copy adds the missing `/llms-full.txt` entry.
7. Pages function serves the IndexNow key file at `/<INDEXNOW_KEY>.txt` from the `INDEXNOW_KEY` env (deploy companion to T05).

### Verification Evidence — 2026-07-30

- `cd frontend && npm run test:seo`: 25/25 passed before T15 (30/30 after), including new tests for compare/diff SSR shells, FAQPage presence on report pages, GPTBot content signal, sitemap lastmod in both copies, Organization schema, and the IndexNow key route (env set and unset).
- Production spot-check before the fix: `curl https://octocounts.com/compare` returned HTTP 404 with the 404.html body.

---

## T22 — ChatGPT AI Search Sampling Baseline and Monthly Monitoring

**Priority:** P1
**Impact:** 4/5
**Effort:** Small (recurring)
**Status:** pending — blocked on local OpenCLI Browser Bridge setup

### Why

GEO changes need a measurement loop. The `yao-chatgpt-crawler` skill (installed at `~/.agents/skills/`) repeatedly samples ChatGPT web AI search for a fixed question set and reports mention rate, Top 1/3/5 probability, citation source structure, and competitor comparison.

### Implementation

1. Prerequisite (manual): local OpenCLI Browser Bridge with a logged-in ChatGPT web profile; then `node scripts/preflight.mjs --profile <profile>` from the skill directory.
2. Fixed question set (~25 questions): repo line-count lookups ("how many lines of code does facebook/react have"), tool discovery ("best SLOC counter", "github line count tool"), and comparisons ("react vs vue codebase size").
3. Run 5–10 repeats per question monthly; store JSON/HTML reports under a dated directory; track OctoCounts mention/citation trend and which sources ChatGPT cites.
4. Fallback if no browser bridge: manual monthly run of the same question set in ChatGPT with results logged to a spreadsheet.

### Acceptance Criteria

- First baseline report exists and lists per-question mention status and cited sources.
- Month-over-month runs are comparable (same question set, same repeat count).

---

## T23 — Off-Site Evidence for Answer-Engine Corroboration

**Priority:** P1
**Impact:** 4/5
**Effort:** Medium (non-code, recurring)
**Status:** pending

### Why

For recommendation-type questions ("best SLOC counter", "github line count tool"), ChatGPT answers lean on third-party pages rather than the product site itself. OctoCounts currently has little third-party corroboration.

### Implementation

1. Submit listings: AlternativeTo, SaaSHub, StackShare (and similar tool directories).
2. Pitch inclusion in 2–3 "best GitHub tools / developer productivity tools" listicles.
3. Execute the GROWTH.md P1-8 launch plan (Show HN, Product Hunt, Chinese communities, Reddit) — launch threads are themselves frequently cited sources.
4. Track new referring domains alongside the T22 sampling results.

### Acceptance Criteria

- Listings live on at least 3 tool directories.
- At least one independent third-party article/thread mentioning OctoCounts is indexed.

---

## 7. Cross-Cutting Test Matrix

Every affected task must run the relevant subset; release candidates run all applicable checks.

### Backend

```bash
cd backend
cargo fmt --check
cargo test
```

Add focused tests for:

- schema/data migration safety
- indexability decisions
- IndexNow dedupe/batching/failure isolation
- release comparison idempotency
- history snapshot uniqueness
- language aggregate correctness

### Frontend

```bash
cd frontend
npm run build
npx playwright test
```

Verify desktop and 390px mobile layouts for every new public page. Check canonical, robots, hreflang, JSON-LD, OG, and crawlable HTML with direct HTTP requests.

### Extension

```bash
cd extension
npm run build:all
```

Test at minimum:

- Chrome, Edge, Firefox artifact contents
- standard repo, fork, branch, tag, commit, private repo, non-repo page
- first run and returning run
- same-SHA and changed-SHA last-seen delta
- SPA navigation and tab switching
- cache/error/offline fallback
- keyboard navigation and reduced motion
- store/review URLs per target

### Privacy and Permissions

For every extension change:

- compare generated manifests before/after
- document every new outbound request
- verify no install ID/user ID/history telemetry was added
- update privacy text only when actual collection behavior changes

## 8. Suggested Delivery Batches

### Batch A — Correctness and Edge readiness

- T01
- T02

Release immediately after verification because these fix current inconsistencies and prepare the Edge review outcome.

### Batch B — Activation and retention

- T03
- T04
- T08
- T10

Measure with existing aggregate request-source data and store metrics; do not add user-level analytics.

### Batch C — Extension differentiation and resilience

- T07
- T09
- T11

### Batch D — Search discovery quality

- T05
- T06
- T14
- T15
- T17

### Batch E — Recurring original data

- T12
- T13

### Batch F — Expansion after evidence

- T16
- T18
- T19
- T20

## 9. Completion Definition

This plan is complete when:

- all P0 and P1 tasks are implemented or explicitly rejected with recorded reasoning;
- Chrome, Edge, and Firefox artifacts are independently correct;
- repeat GitHub visits expose meaningful local change information;
- GitHub context offers reliable comparison actions;
- DOM compatibility has automated protection;
- new report discovery is submitted quickly but sitemap inclusion is quality-gated;
- release/history/language/comparison pages provide original, reproducible, crawlable data;
- privacy and non-goal boundaries remain intact.
