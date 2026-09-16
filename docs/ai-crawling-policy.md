# OctoCounts crawler & AI-access policy (SG-08)

- Created: 2026-09-08. Verified against provider documentation listed below on
  the same date; re-verify before changing any rule.
- This document describes repository configuration. Production behavior also
  depends on the Cloudflare zone in front of octocounts.com (WAF, cache rules,
  managed robots transforms) — see §5.

## 1. Crawler matrix

| Crawler (UA token) | Operator | Purpose per provider docs | robots.txt rule | What we actually serve |
|---|---|---|---|---|
| Googlebot, Bingbot, and other search engine crawlers | Search engines | Search indexing | `User-agent: *` Allow | HTML only. Deliberately NOT markdown: serving search crawlers different content than users would be cloaking. |
| OAI-SearchBot | OpenAI | Search/indexing for ChatGPT search results | Allow | Markdown twin (retrieval bot) or HTML |
| ChatGPT-User | OpenAI | Fetches pages a user asks ChatGPT about | Allow | Markdown twin or HTML |
| GPTBot | OpenAI | **Training** corpus crawl | Allow (`ai-train=yes` signal) | HTML. Training permission is a separate decision from search visibility — governed by this row, not by OAI-SearchBot's. |
| PerplexityBot / Perplexity-User | Perplexity | Search indexing / user-initiated fetch | Allow | Markdown twin or HTML |
| ClaudeBot / Claude-User | Anthropic | Indexing / user-initiated fetch | Allow | Markdown twin or HTML |
| Google-Extended | Google | Gemini grounding & training (does not control Google Search indexing) | Allow | HTML |
| CCBot | Common Crawl | Open corpus building (training pipelines downstream) | Allow | HTML |
| Bytespider | ByteDance | Training corpus crawl (TikTok/Douyin AI) | Allow | HTML |
| Applebot | Apple | Apple Intelligence / Siri grounding | Allow | Markdown twin or HTML |

Key distinction this matrix exists to keep straight (SG-08 finding): **GPTBot
is a training crawler. Allowing or blocking it does not change ChatGPT's
ability to see or cite OctoCounts in search — that is OAI-SearchBot and
ChatGPT-User.** The earlier robots.txt comment conflated the two.

## 2. Format negotiation

- Canonical format is standard HTML; the complete answer on every report,
  comparison, docs, stats, and trending page is readable without JavaScript
  (server-rendered bodies), so HTML alone is sufficient for any client.
- Explicit markdown twins exist for every SSR page: append `.md` or add
  `?format=md`. These are cacheable, distinct URLs.
- For retrieval-time AI crawlers only, the edge function ALSO serves the
  markdown twin on the HTML URL when the user agent matches
  `AI_RETRIEVAL_BOT_UA` in `frontend/functions/[[path]].js`. Those responses
  are `private, no-store` + `Vary: User-Agent`, so the variant can never
  enter the shared zone cache (the zone cache keys on URL alone).
- Rollback: set `AI_MARKDOWN_UA=0` in the Cloudflare Pages environment to
  disable the UA-derived switch while keeping explicit `.md` URLs. Suggested
  rollout: verify in a Pages preview deployment first, then production.
- Accept-header negotiation is intentionally NOT implemented; adding it later
  requires defining its cache key and Vary first.

## 3. What we do not claim

- A simulated UA request here proves what our function returns, not that a
  real provider crawler was allowed through the CDN/WAF (see §5).
- llms.txt/llms-full.txt are courtesy summaries, not prerequisites for being
  cited; robots.txt/llms "Last-Updated" dates reflect real content changes
  (see `frontend/content/content-manifest.json`).

## 4. Format equivalence (tested)

`frontend/tests/seo.test.mjs` asserts the HTML body, the client view model,
and the markdown twin of report and comparison pages carry identical repo
names, numbers, dates, commits, and FAQ answers, and that interleaved
requests never leak markdown into the HTML cache entry (`private, no-store` +
`Vary: User-Agent`).

## 5. Production verification still required (cannot be done from the repo)

- [ ] From a clean connection (no cookies), fetch `https://octocounts.com/`
      with each crawler UA above and confirm the zone does not answer 403, a
      challenge page, or a cached wrong-format variant.
- [ ] Cross-check at least one provider's crawl logs or debug endpoint
      (e.g. Bing URL Inspection, OpenAI's docs on verifying OAI-SearchBot
      IPs) to confirm real crawler reachability.
- [ ] Inspect the Cloudflare zone cache rules to confirm the documented
      URL-only cache key assumption still holds before changing format logic.

References (checked 2026-09-08): OpenAI crawler documentation
(openai.com/bots: GPTBot training-only, OAI-SearchBot search,
ChatGPT-User user-initiated), Google "AI features and your website",
Cloudflare cache-key documentation.
