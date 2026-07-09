# OctoCounts Growth Implementation Task Log

## Context

OctoCounts is a GitHub SLOC tool with:

- Web app: https://octocounts.com/
- Chrome/Firefox browser extension that injects SLOC stats into GitHub repo pages.
- Backend using Rust/Axum/SQLx/Postgres/tokei.
- Frontend using React/TypeScript/Vite/TanStack Query.
- Extension using MV3 native JavaScript.

Product purpose:

- GitHub shows language percentages but does not show actual file and line counts.
- OctoCounts fills that gap without cloning by downloading public GitHub archives, running tokei, caching by commit, and showing files/lines/code/comments/blanks per language.
- Users can export reports as text/JSON/PNG and generate README badges.

Important user-provided correction:

- The Chrome extension already has about 6,800 weekly users.
- Growth work should treat this as an existing-traction product, not a cold start.
- Edge Add-ons submission is already in review, so Edge listing work is excluded from this task list.

Existing repo notes:

- `GROWTH.md` already records a broad roadmap.
- Existing implemented assets include SEO pages, sitemap, `robots.txt`, `llms.txt`, recent/popular pages, OG/report routes, badge builder, compare/diff, PNG export, and plugin star nudge.
- The current task should focus only on work that can be implemented in this codebase now.

## Current Priority Order

1. Existing-user conversion:
   - Add Chrome Web Store rating prompt in extension.
   - Ensure prompt is respectful, one-time, and only after repeated successful value.
   - Improve analytics events for web funnel.

2. GitHub propagation:
   - Make badge links default to permanent report pages.
   - Add stronger report completion CTAs.
   - Add extension-side copy README badge action.

3. Search/content growth:
   - Add repo seed script for popular repositories.
   - Improve list/report pages and citable content where needed.
   - Add comparison/SEO docs if they fit cleanly.

4. Developer distribution:
   - GitHub Action MVP.
   - `npx` CLI.
   - MCP server.

## Execution Rules

- Work through tasks in priority order.
- Update this file after each completed task.
- Prefer codebase-memory-mcp graph tools for code discovery.
- Use `apply_patch` for manual edits.
- Do not revert unrelated user changes.
- Run relevant builds/checks after each area and full checks at the end when feasible.

## Task List

### T1. Extension rating prompt

Status: completed

Goal:

- Convert a fraction of 6,800 weekly Chrome users into Chrome Web Store ratings/reviews.

Behavior:

- Trigger after repeated successful repo SLOC renders.
- Should not show on first use.
- Should be dismissible.
- Should persist dismissal in `chrome.storage.local`.
- Should not replace the GitHub star prompt; it can appear after or alongside current one-time nudges without stacking multiple prompts in the same panel.
- Chrome-specific store link should open in a new tab.

Likely files:

- `extension/src/content/card.js`
- `extension/src/content/panel.js`
- `extension/src/styles/panel.css`
- `extension/src/locales/en.json`
- `extension/src/locales/zh.json`
- Other locale files if required by existing i18n pattern.

Acceptance:

- Prompt appears only after the configured success count.
- Closing or clicking permanently suppresses it.
- Build succeeds for Chrome and Firefox.
- Firefox build does not break even if prompt points to Chrome only or is guarded.

### T2. Web analytics event normalization

Status: completed

Goal:

- Make the web funnel measurable for growth decisions.

Events to verify/add:

- `analyze_submitted`
- `analyze_completed`
- `badge_markdown_copied`
- `png_exported`
- `extension_store_click`
- `report_url_copied`
- `share_clicked` if share actions exist.

Likely files:

- `frontend/src/analytics.ts`
- `frontend/src/main.tsx`
- `frontend/src/BrowserExtensionSection.tsx`
- `frontend/src/useAnalysisRunner.ts`

Acceptance:

- Events are emitted through existing Umami/Plausible helper.
- Event names are consistent and documented in code where helpful.
- Frontend build succeeds.

### T3. Badge links default to permanent report pages

Status: completed

Goal:

- Turn README badges into long-term SEO/report-page referral loops.

Behavior:

- Badge markdown should link to `/github/:owner/:repo` when possible instead of `/?q=...`.
- Branch/tag/commit badge links should link to matching permanent report path if available.
- Fallback remains valid for arbitrary input.

Likely files:

- `frontend/src/main.tsx`
- `frontend/src/reportUtils.ts` if helper belongs there.
- `README.md` examples.

Acceptance:

- Badge builder copied markdown points to permanent report URL.
- README examples use report URLs.
- Existing badge image URLs are unchanged.

### T4. Stronger report completion CTAs

Status: completed

Goal:

- After a successful analysis, make the next action a propagation action.

Behavior:

- Prioritize actions such as:
  - Add/copy README badge.
  - Copy report URL.
  - Export/share PNG.
  - Install extension.
- Keep visual style aligned with terminal-native product voice.

Likely files:

- `frontend/src/main.tsx`
- `frontend/src/styles.css`
- `frontend/src/locales/en.json`
- `frontend/src/locales/zh.json`

Acceptance:

- Successful report view exposes clear propagation CTAs.
- Mobile and desktop layout remain stable.
- Frontend build succeeds.

### T5. Extension-side copy README badge action

Status: completed

Goal:

- Let GitHub users copy a README badge directly from the injected stats panel.

Behavior:

- In detailed panel or card after successful render, provide copy badge markdown for current repo/ref where possible.
- Track or otherwise label the copied action if extension analytics is not added.
- Keep browser-store privacy risk low; no extension analytics unless intentionally added later.

Likely files:

- `extension/src/content/panel.js`
- `extension/src/content/card.js`
- `extension/src/styles/panel.css`
- `extension/src/locales/*.json`

Acceptance:

- Copy button copies valid markdown.
- Markdown image URL points to API badge.
- Markdown link points to permanent report page.
- Extension build succeeds.

### T6. Popular repo seed script

Status: completed

Goal:

- Generate indexed report inventory for common high-intent searches.

Behavior:

- Add a script that reads a curated list of GitHub repos and calls the public/local analyze API.
- Poll jobs until complete or failed.
- Rate-limit requests.
- Support dry-run and API base options.

Likely files:

- `scripts/seed-popular-repos.mjs` or similar.
- `data/popular-repos.txt` or similar.
- README/docs note if useful.

Acceptance:

- Script can run against local or production API.
- Dry run prints planned repos without network calls.
- Failures are summarized.

### T7. GitHub Action MVP

Status: completed

Goal:

- Create a distributable channel where PRs show OctoCounts SLOC diff comments.

Scope:

- May be a new `action/` package in this repo.
- Analyze base/head refs through existing API.
- Generate markdown comment body.
- Include hidden marker for upsert behavior.

Acceptance:

- Action files exist with clear README usage.
- Local unit-level command or dry-run can generate a comment body.

### T8. CLI MVP

Status: completed

Goal:

- Add npm-discoverable `npx octocounts owner/repo` style interface.

Scope:

- May be a new `cli/` package.
- Uses existing API.
- Outputs terminal table and report URL.

Acceptance:

- CLI can be run locally.
- JSON mode exists.

### T9. MCP server MVP

Status: completed

Goal:

- Make OctoCounts usable from AI coding tools.

Scope:

- May be a new `mcp/` package.
- Tools: `analyze_repo`, `compare_repos`.
- Uses existing public API.

Acceptance:

- MCP server can run locally over stdio.
- README gives Claude/Cursor-style config example.

## Progress Log

- 2026-07-09: Completed T9. Added `mcp/` package with no-dependency stdio MCP server exposing `analyze_repo` and `compare_repos`, README configuration example, and Content-Length framed JSON-RPC handling. Verified `initialize` and `tools/list` responses via a local framed-message smoke test, plus `node -c` syntax checks for new Node scripts.
- 2026-07-09: Completed T8. Added `cli/` npm-style package with `octocounts` bin, no-dependency Node CLI, `--ref`, `--json`, `--api-base`, and `--sample` support. Verified with `node cli/src/index.js --sample` and `node cli/src/index.js --sample --json`.
- 2026-07-09: Completed T7. Added `action/` GitHub Action MVP with `action.yml`, README, no-dependency Node 20 implementation, OctoCounts API polling, PR comment upsert via hidden marker, and local `--sample-comment` output. Verified with `node action/src/index.js --sample-comment`.
- 2026-07-09: Completed T6. Added `data/popular-repos.txt` with 50 curated repos and `scripts/seed-popular-repos.mjs` with dry-run, API base, file, limit, concurrency, delay, polling, and force-refresh options. Verified with `node scripts/seed-popular-repos.mjs --dry-run --limit 5`.
- 2026-07-09: Completed T5. Added a GitHub-only `Copy badge` action to the extension detail panel. It copies API badge markdown linked to the permanent OctoCounts report page, updates the panel `open` link to the same permanent URL, adds locale strings, and `npm run build` passes in `extension/`.
- 2026-07-09: Completed T4. Added a report completion CTA strip with README badge copy, report URL copy, PNG card export, and Chrome install actions. Added responsive CSS, i18n strings, and tracking for badge/report/store actions. `npm run build` passes in `frontend/`.
- 2026-07-09: Completed T3. Frontend badge embed/builder already linked to permanent report URLs. Updated README badge examples so badge clicks return to `/github/:owner/:repo`, `/tree/:ref`, or `/commit/:sha` report pages instead of query-parameter URLs.
- 2026-07-09: Completed T2. Added `AnalyticsEvents`, normalized key web events, added `report_url_copied` via a report footer URL copy button, added `share_clicked` for compare/diff URL copies, standardized extension store click placements, and `npm run build` passes in `frontend/`.
- 2026-07-09: Completed T1. Added a Chrome-only Web Store rating prompt after repeated successful extension use. It reuses the existing success counter, avoids stacking with the GitHub star prompt, persists dismissal/clicks, adds locale strings, and `npm run build` passes in `extension/` for Chrome and Firefox.
- 2026-07-09: Created this task log from the current conversation and agreed priority order.
