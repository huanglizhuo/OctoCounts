# OctoCounts SEO / GEO Measurement (SG-10)

- Created: 2026-09-08 (batch A kickoff of SEO-GEO-optimize-plan.md SG-10).
- Status: event dictionary and export templates are authoritative for the
  current code; dashboards and baselines must be filled from real exports.
- Principle: clicks are not installs, citations without clicks never appear in
  referrer data, and ordinary google.com traffic is not AI Overview traffic.

## 1. Event dictionary (as implemented in frontend/src/analytics.ts)

| Event | Trigger | Properties | Dedup / notes | Cannot imply |
|---|---|---|---|---|
| `ai_visit` | Landing visit whose `document.referrer` host matches a known AI answer host (`chatgpt.com`, `openai.com`, `perplexity.ai`, `pplx.ai`, `gemini.google.com`, `copilot.microsoft.com`, `claude.ai`, `kimi.com`) | `source` (chatgpt/perplexity/gemini/copilot/claude/kimi), `path` | Once per source per session (`sessionStorage` `octocounts.ai_visit`); storage-blocked browsers skip the event rather than spam it | Total AI citations (unclicked citations are invisible); AI traffic without referrer | 
| `analyze_submitted` | User submits an analysis | `provider`, plus runner context | Per submission | That an analysis succeeded |
| `analyze_completed` | An analysis returns a report | `provider`, cached flag optional | Per completion | That every visit analyzed something |
| `extension_store_click` | Click on any store install link | `store` (chrome/edge/firefox), `placement` (`hero`, `topbar`, `extension_section`, `extension_page`, …) | Per click, no dedup by design | That the user installed or kept the extension |
| `report_url_copied` / `share_clicked` | Copy/share actions on reports | share type / target | Per action | Reach of the shared link |
| `report_citation_copied` | Copy-citation button on report pages (SG-04) | `provider` | Per click | That the citation was pasted or read anywhere |
| `report_text_copied` / `report_json_copied` | Copy text / JSON export on report pages | `provider` | Per successful copy | Downstream usage |
| `compare_run` | User clicks Run on the compare / diff page | `mode` (repos/diff), `provider` / `leftProvider` + `rightProvider` | Per click | That the comparison succeeded or was shared |
| `recent_chip_clicked` | Click a recent-analysis chip on the home page | `provider` | Per click | — |
| `sample_chip_clicked` | Click a sample repository chip on the home page | `sample`, `provider` | Per click | — |
| `similar_repo_clicked` | Click a similar-repository card on report pages | `provider`, `placement` (`report_similar`), `target` (`owner/repo`) | Per click | — |
| `png_exported`, `gif_exported`, `badge_markdown_copied`, `embed_snippet_copied` | Export/copy actions | context of the builder | Per action | Downstream usage |

Known limitations to verify before relying on early-fire events (SG-10 step 5):
the analytics script is deferred, so an event fired before the script loads may
be dropped; confirm with a browser test before adding a queue.

Landed for /extension (SG-03): the page is live and its store links fire
`extension_store_click` with `placement: "extension_page"`
(`frontend/src/pages/marketing.tsx` via `StoreLink`), extending the existing
event rather than renaming it.

## 2. Source classification

- **AI visit**: `ai_visit` event above. Absence of the event is absence of an
  identifiable AI referrer, not absence of AI traffic.
- **Search**: referrer from a search engine results page (google.com, bing.com,
  …) — classify in the analytics backend, never from `google.com` alone as AI.
- **Known source parameter**: tagged URLs kept out of canonical (analytics
  fields only).
- **Direct / unknown**: everything else.

## 3. Data sources and export templates

No Search Console / Bing / analytics-backend access was available when this
document was created (2026-09-08). Until access is granted, record exports in
the templates below and mark unavailable cells as *unknown*, never as zero.

- **Google Search Console** — per 28 days: page, queries, impressions, clicks,
  CTR, position. Filter groups: `/compare/*`, `/github/*`, `/docs/*`, `/`,
  `/extension`.
- **Bing Webmaster Tools** — same fields plus *AI Performance* (citations,
  AI-expanded queries; fields as the account exposes them).
- **Web analytics (umami; plausible loader also wired)** — visits by page and
  referrer class, `ai_visit`/`extension_store_click`/`analyze_completed` counts
  by `source`/`placement`/`store`.
- **Extension store aggregates** — already collected by
  `scripts/track-extension-metrics.mjs` (Chrome Web Store + AMO via shields,
  appended to `data/extension-metrics.jsonl`, scheduled by
  `.github/workflows/track-extension-metrics.yml`): users, ratings, versions.
  Store metrics define their own "user" — label the metric definition in every
  report; Edge Add-ons is not covered by that script today (record as gap).

## 4. Funnels

1. Landing (by source class) → `analyze_completed` (same session) →
   `extension_store_click` (same session).
2. Landing on `/extension` → `extension_store_click`.
3. Installs/active users: store aggregates only, reported beside — never
   joined to — the click funnel. No per-user cross-site attribution is claimed.

## 5. Baseline record (fill before each release batch)

| Item | Window | Value | Source | Notes/gaps |
|---|---|---|---|---|
| Search impressions/clicks by page group | last 28 d | *unknown* | GSC | no access yet |
| Bing AI citations | last 28 d | *unknown* | Bing WT AI Performance | no access yet |
| AI visits by source | last 28 d | *unknown* | umami export | no access yet |
| `extension_store_click` by placement | last 28 d | *unknown* | umami export | no access yet |
| Extension users by store | latest snapshot | `data/extension-metrics.jsonl` | track-extension-metrics | Edge missing |

## 6. Weekly review rules

- Compare equal-length before/after windows on the same page group; annotate
  releases (from git log), project news, and seasonality before attributing.
- Never present a store click as an install; never present an AI citation
  count as visits.
- Record each check's date, data source, and missing items in this file's
  baseline table; do not overwrite prior baselines.
