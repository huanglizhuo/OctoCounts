# OctoCounts SEO / GEO Measurement (SG-10)

- Updated: 2026-10-27. ChatGPT UTM fallback and attribution basis added.
- Created: 2026-09-08 (batch A kickoff of the SEO/GEO plan's SG-10 (history: docs/seo-geo-history.md)).
- Status: event dictionary and export templates are authoritative for the
  current code; dashboards and baselines must be filled from real exports.
- Principle: clicks are not installs, citations without clicks never appear in
  referrer data, and ordinary google.com traffic is not AI Overview traffic.

## 1. Event dictionary (as implemented in frontend/src/analytics.ts)

| Event | Trigger | Properties | Dedup / notes | Cannot imply |
|---|---|---|---|---|
| `ai_visit` | Landing visit with a known AI referrer, or exact `utm_source=chatgpt.com` when no known AI referrer exists. Known AI answer hosts: `chatgpt.com`, `chat.openai.com`, `perplexity.ai`, `pplx.ai`, `gemini.google.com`, `copilot.microsoft.com`, `claude.ai`, `kimi.com` | `source` (chatgpt/perplexity/gemini/copilot/claude/kimi), `path`, `attribution` (referrer/utm) | Once per source per session (a JSON source set in `sessionStorage` `octocounts.ai_visit`); storage-blocked browsers deduplicate within one page only | Total AI citations (unclicked citations are invisible); AI traffic without a recognized referrer or campaign tag |
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

The app and static HTML articles share `frontend/public/analytics-runtime.js`.
Events wait in memory until the configured SDK loads; AI visit markers are
stored only after an SDK accepts the call. Each provider receives an event at
most once. SDK acceptance does not prove network delivery or backend ingestion.
A blocked SDK or leaving the page before it loads can still lose an event.
The source set migrates legacy single-source session markers. No recognized referrer or campaign tag means unknown; provider documentation such as platform.openai.com is not
classified as ChatGPT. Analytics are optional and never gate page interaction.
`frontend/tests/analytics.test.mjs` covers delayed SDKs, duplicate sources,
legacy markers, blocked storage, rejected SDK calls, and false-positive hosts.

Landed for /extension (SG-03): the page is live and its store links fire
`extension_store_click` with `placement: "extension_page"`
(`frontend/src/pages/marketing.tsx` via `StoreLink`), extending the existing
event rather than renaming it.

## 2. Source classification

- **AI visit**: `ai_visit` event above. Absence of the event is absence of an
  identifiable AI referrer/campaign tag, not absence of AI traffic.
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
  Edge Add-ons is also collected from its public page's structured metadata
  (`parseEdgeHtml`); its version remains unknown when absent from that page.
  Store metrics define their own "user" — label the metric definition in every
  report. Store totals cannot identify individual search/AI-attributed installs.

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
| Extension users by store | latest snapshot | `data/extension-metrics.jsonl` | track-extension-metrics | Chrome, Firefox, Edge; Edge version may be unknown |

## 6. Weekly review rules

- Compare equal-length before/after windows on the same page group; annotate
  releases (from git log), project news, and seasonality before attributing.
- Never present a store click as an install; never present an AI citation
  count as visits.
- Record each check's date, data source, and missing items in this file's
  baseline table; do not overwrite prior baselines.


## 7. Release checks and performance baseline

`frontend-checks.yml` runs the existing SEO, CSP, product-fact and unit checks
plus the browser QA suite on pull requests. `npm run test:budget` reads the
production Vite manifest and totals gzip bytes of each route's static dependency
closure, including the shared analytics runtime. Home hydration includes the
extension promo chunk; Chinese home includes its locale. Reports include their
lazy report sections, while rasterizers and encoders stay deferred. Budgets are
165/180 KiB JS for English/Chinese home, 200 KiB for reports, 175 KiB for tools,
and 18 KiB CSS. The October 25 local build started around 142 KiB JS and 15 KiB
CSS for English home; these are transfer measurements, not LCP/INP/CLS scores.
Use production CrUX/RUM and a dated mobile Lighthouse run before attributing
ranking or conversion changes to performance. No private search/analytics
exports have been added by this code change; unknown baseline cells remain
unknown rather than invented zeros.

## 8. ChatGPT attribution and citation baseline (2026-10-27)

Known AI referrers take precedence over UTM tags. Otherwise only the exact
`utm_source=chatgpt.com` value selects ChatGPT. UTM is user-editable attribution,
not proof of a citation or crawler identity. The existing per-source session
marker is shared by both paths. A visit keeps its initial landing path and
attribution basis even if the analytics SDK loads later. Canonical URLs remain
free of campaign parameters. Umami may also record campaigns independently.

The fixed bilingual prompt set and recording template are in
[chatgpt-geo-baseline.csv](chatgpt-geo-baseline.csv). Blank result fields mean
not measured. Run each prompt in a fresh chat with search enabled and record
model, locale, date, answer evidence, mention, linked citation, URL and whether
the answer preserves commit/date/counting-policy limitations. Repeat under the
same conditions; report the denominator and distinguish mentions from citations.
Do not fill these fields from curl or a generic web-search API. GSC/Bing/Umami
private exports remain required for their respective metrics.
