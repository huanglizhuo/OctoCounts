# GEO / AI Search Analysis — octocounts.com

**Analysed:** 2026-08-04 · **Method:** live fetches as `GPTBot` + source inspection of `frontend/public/` and `frontend/functions/[[path]].js`

---

## 1. GEO Readiness Score: 65/100

| Criterion | Weight | Score | Note |
|---|---|---|---|
| Citability | 25% | 19 | Report pages are excellent; three list pages serve almost nothing |
| Structural readability | 20% | 16 | Tables, FAQ schema, clean hierarchy |
| Multi-modal | 15% | 9 | Images and OG cards, no video, no third-party visual footprint |
| Authority & brand signals | 20% | 8 | **Weakest.** No Wikipedia, Reddit, YouTube, or author credentials |
| Technical accessibility | 20% | 13 | Best-in-class robots/llms.txt, undercut by a broken sitemap |

The technical foundation here is well above average. The score is held down by two things: an infrastructure fault that hides the entire report corpus from crawlers, and a near-total absence of off-site brand presence.

---

## 2. Platform Breakdown

| Platform | Est. readiness | Reasoning |
|---|---|---|
| **Google AI Overviews** | Moderate | Report pages are SSR'd with `Dataset` + `FAQPage` schema and quotable stat blocks. Blocked mainly by discovery — see §7. |
| **ChatGPT** | Low–moderate | ChatGPT leans on Wikipedia (47.9%) and Reddit (11.3%). OctoCounts has neither. `GPTBot` is explicitly allowed including training use, which helps. |
| **Perplexity** | Low | Perplexity cites Reddit ~46.7% of the time. No Reddit footprint at all. |
| **Bing Copilot** | Moderate | IndexNow is already wired into the backend (`indexnow.rs`), which is the right lever. |

---

## 3. AI Crawler Access — Strong

`robots.txt` is deliberate and correct, including the newer `Content-Signal` directives:

| Crawler | Status |
|---|---|
| GPTBot | Allow (`search=yes,ai-input=yes,ai-train=yes`) |
| OAI-SearchBot, ChatGPT-User | Allow |
| ClaudeBot, anthropic-ai | Allow |
| PerplexityBot, Applebot | Allow |
| Google-Extended | Disallow (Gemini training only — does not affect Search) |
| CCBot | Disallow |

Global default is `search=yes,ai-input=yes,ai-train=no` with `Allow: /`. Nothing to change.

⚠️ The file's own comment warns that Cloudflare may prepend managed rules in production. Worth confirming in the dashboard that the managed robots.txt block is not overriding these allows.

---

## 4. llms.txt — Strong

Both `/llms.txt` (3,564 B) and `/llms-full.txt` (6,192 B) are live and well-formed. `/llms.txt` includes a "Short Answer" block, primary use cases, URL patterns, an API summary, and — unusually and correctly — an explicit **"Recommended Citation"** paragraph. This is close to the ideal implementation.

One gap: `Last-Updated: 2026-07-15` is now three weeks stale. Answer engines use it as a freshness signal.

---

## 5. Brand Mention Analysis — Weakest Area

Mentions correlate ~3x more strongly with AI citation than backlinks do. A search for the product surfaces only:

- octocounts.com (own site)
- github.com/huanglizhuo/OctoCounts (own repo)
- launches.uicomet.com (one directory listing)

| Platform | Presence |
|---|---|
| Wikipedia / Wikidata | None |
| Reddit | None found |
| YouTube | None found |
| LinkedIn | None found |

Meanwhile the "SLOC counter" query space is dominated by established tools — `scc`, `cloc`, `bytbox/sloc` — all with strong GitHub and community footprints. This is the single biggest lever on AI visibility and it is entirely off-site work.

---

## 6. Passage-Level Citability

Report pages are the strong asset. `/github/facebook/react` renders a 249-word `<noscript>` block whose opening ~45 words are a textbook self-contained citation:

> "As of 2026-08-03 (commit 3a717e42438a), facebook/react contains 469,945 total lines: 372,495 code, 59,881 comments, 37,569 blank, across 2,191 files in 11 languages (top: JavaScript 64.4%). Counted with tokei via OctoCounts."

Specific numbers, a date, a pinned commit, a named method, and self-attribution — everything an answer engine needs to quote and credit. Title and meta description carry the same figures.

Schema on that page: `Dataset`, `FAQPage`, `Question`/`Answer`, `SoftwareSourceCode`, `BreadcrumbList`, `DataDownload`, `Organization`, `ListItem`.

Minor tuning: 249 words sits above the 134–167 word band that correlates best with citation. The first paragraph already stands alone, so consider making the block's *first section* a clean ~150-word unit rather than trimming content.

---

## 7. 🔴 Critical: The Report Corpus Is Invisible to Crawlers

This is the highest-impact finding and it is an infrastructure fault, not a content one.

**The live sitemap contains 30 URLs and zero report pages.**

```
curl -s https://octocounts.com/sitemap.xml | grep -c "<loc>"   →  30
curl -s https://octocounts.com/sitemap.xml | grep -c "/github/" →  0
```

`sitemapResponse()` in `frontend/functions/[[path]].js:489` does fetch `/api/seo/sitemap` and concatenate the dynamic entries, so the code is right. The endpoint is not answering.

Probing the live API shows a consistent split:

| Endpoint | Status |
|---|---|
| `/healthz` | 200 |
| `/api/seo/report?...` | 200 |
| `/badge/:owner/:repo` | 200 |
| `/api/seo/sitemap` | **404** |
| `/api/seo/popular` | **404** |
| `/api/seo/monoliths` | **404** |
| `/api/stats` | **404** |
| `/api/seo/recent` | **404** externally, yet works from the Pages Function |

The 404s carry `content-length: 0` and no body, which is axum's unmatched-route response rather than a Cloudflare block page — so they originate at the application, not the edge.

**Consequence for crawler-visible content**, measured on the same cache generation (`age≈53s`, all `HIT`):

| Page | Words visible to GPTBot | State |
|---|---|---|
| `/recent` | 448 | ✅ renders report list |
| `/trending` | 417 | ✅ (reads a static JSON snapshot, no API) |
| `/hall-of-monoliths` | 28 | ❌ title + description only |
| `/stats` | 22 | ❌ "Stats are temporarily unavailable" |
| `/popular` | 15 | ❌ empty |

`/recent` and `/popular` go through the *same* code branch (`[[path]].js:60`), so the difference comes from the API response, not the renderer.

All five of these pages are in the sitemap and marked `index,follow`. Three of them currently offer an answer engine nothing to cite.

**This is not a version-staleness issue** — `seo/report`, `seo/recent`, `seo/popular` and `seo/sitemap` were all added in the same commit (`0e00cad`, 2026-07-04), so a stale build would fail all of them uniformly. The local `sloc-api-1` container is a stale leftover (image built 2026-06-12, predating those routes) and is not what serves `api.octocounts.com`. Root cause needs checking at whatever currently terminates that hostname.

---

## 8. Top 5 Highest-Impact Changes

1. **Fix the list/sitemap endpoints on the deployed origin.** Everything else in this report is secondary. It restores three indexed pages from ~20 words to real content and, more importantly, admits the entire report corpus into the sitemap.
2. **Then deploy the `perf/backend-optimizations` branch.** It raises the sitemap cap from an effective 500 to 45,000 (`d54ba59`) — the cap was a silent `clamp(0, 500)` that meant even a working endpoint published ~1% of available URLs. It also cuts the sitemap query from 70 ms to 8 ms, which is what makes serving the full list affordable.
3. **Build a Reddit and YouTube footprint.** Perplexity cites Reddit ~46.7% of the time; YouTube mentions carry the strongest single correlation (~0.737) with AI citation. A short demo video and genuine participation in r/programming / r/github threads about counting lines of code would move this more than any on-page change.
4. **Add author/maintainer credentials.** `Person` schema with `sameAs` links to GitHub and LinkedIn, plus a visible byline on the docs and methodology pages. Authority signals are currently near zero.
5. **Refresh `llms.txt`'s `Last-Updated`** and wire it into the release process so it never goes stale again.

---

## 9. Schema Recommendations

Report pages are already well covered. Gaps:

- **`Person`** for the maintainer, with `sameAs` → GitHub, LinkedIn. Nothing currently establishes a human author.
- **`SoftwareApplication`** on the homepage (currently `Organization` + `SoftwareSourceCode`). AI assistants answering "what tool counts lines of code in a GitHub repo" match on `SoftwareApplication` with `applicationCategory` and `offers` (free).
- **`HowTo`** on `/docs/github-sloc-counter` — "how do I count lines of code in a GitHub repo" is a procedural query and `HowTo` is the matching type.
- **`dateModified`** on report-page `Dataset` nodes. `generatedAt` exists in the copy; exposing it as schema makes freshness machine-readable.

---

## 10. Content Reformatting Suggestions

- **`/stats`**: give the SSR path a fallback that renders whatever it *can* rather than "Stats are temporarily unavailable" — an indexed page should never be able to reach a state where it offers nothing. Note also that the `/api/stats` totals are currently inflated (a fan-out bug fixed on the perf branch in `88a11e9`); the page has been contradicting itself, showing a report count roughly 30x larger than the source breakdown immediately below it.
- **`/hall-of-monoliths` and `/popular`**: same fallback problem. At minimum render a static explanatory paragraph plus links to `/recent`, so the page is never empty.
- **`/docs/methodology`**: prime candidate for a 134–167 word "What is SLOC and how is it counted?" definition block near the top. Definition patterns ("X is…", "X refers to…") are disproportionately cited.
- **Comparison pages** (`/compare/react-vs-vue`): already server-rendered and inherently citable. Expanding this set targets "X vs Y lines of code" queries where no incumbent tool competes — the clearest content opportunity on the site.

---

## What Is Already Right

Worth stating plainly, because it is unusual: explicit AI-crawler allowlisting with `Content-Signal`, both `llms.txt` and `llms-full.txt` including a recommended-citation block, server-side rendering for every key route, eight schema types on report pages, dynamically rendered 1200×630 OG cards, and IndexNow submission wired into the backend. The on-page GEO work is largely done. The gap is delivery (§7) and off-site presence (§5).

Sources: [octocounts.com](https://octocounts.com/) · [huanglizhuo/OctoCounts](https://github.com/huanglizhuo/OctoCounts) · [launches.uicomet.com](https://launches.uicomet.com/products/octocounts-sloc-panel-github-forget--H6I_)
