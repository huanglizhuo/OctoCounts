# Pilot report: filtering-effects study (SG-06)

- Collected: 2026-09-08, by `scripts/collect-research-sample.mjs` (sequential,
  no force-refresh, one retry per request — none needed).
- Samples: `pilot-samples.jsonl` (8 rows, 0 failures). Raw rows are the
  authority; this report only summarizes them.
- Reproduce: `node scripts/collect-research-sample.mjs --repos facebook/react,vitejs/vite --out /tmp/pilot.jsonl`

## Measured cost (the full-study gate)

| Metric | Value |
|---|---|
| Requests | 8 (2 repositories × 4 configurations) |
| Wall time per request | 1,254–1,842 ms (total ≈ 13 s) |
| Failures / retries | 0 / 0 |
| Engine | tokei-12.1 on every run |

Projected full study (20 repositories × 4 configurations = 80 requests):
roughly 3–4 minutes of sequential requests. Cost is dominated by repositories
larger than these two; the sequential runner keeps peak load at one analysis
at a time.

## Study design (from the original plan, merged 2026-09-19)

- Question: for the same repository at the same commit, how much do
  OctoCounts' analysis options — excluding tests, docs, or generated files —
  change the reported line counts, and what does that imply for comparing
  reports? Pilot approved by the site owner on 2026-09-08 (2 repositories
  only; the full 10–20 repository run still needs a second approval).
- Method: run `default` first and record the commit SHA; pin every variant
  (`exclude-tests` / `exclude-docs` / `exclude-generated`) to that exact SHA
  so all runs count identical source material. Record repository, commit,
  configuration, cached-vs-job, wall time, and totals; failures are recorded,
  never dropped. Sequential (concurrency 1), no force-refresh, one retry.
- Sample criteria: public repositories already in the seeded/popular corpus,
  medium-sized (10^4–10^6 lines). Pilot: facebook/react, vitejs/vite.

## Pilot observations (n=2 — NOT generalizable)

Each repository's four runs count the identical commit (facebook/react
`9b7a0d4029ee`, vitejs/vite `e6f6b3e31192`), so the deltas below are pure
configuration effects.

| Code lines | default | exclude-tests | exclude-docs | exclude-generated |
|---|---:|---:|---:|---:|
| facebook/react | 696,459 | 364,248 (**−47.7%**) | 696,459 (0) | 696,459 (0) |
| vitejs/vite | 112,297 | 82,439 (**−26.6%**) | 110,808 (−1.3%) | 112,297 (0) |

1. **Test exclusion is the dominant filter in both samples** — it removes
   26–48% of code lines. Any SLOC comparison that mixes test-inclusive and
   test-exclusive counts is not a valid comparison.
2. **Docs exclusion barely moved** (0 and −1.3%): the filter's path/extension
   rules matched almost nothing in these two trees. A zero delta is
   information about rule coverage, NOT proof that these repositories lack
   documentation.
3. **Generated-file exclusion matched nothing** in either sample — same
   caveat about rule coverage versus ground truth.

## What the pilot says about study design

- The instrument works: commit pinning, per-run timing, and totals all
  recorded; nothing was dropped.
- The interesting question is now clearly *how much of a repository's SLOC is
  tests* across ecosystems, and *which trees the docs/generated rules
  actually match*. The full study should sample across languages and project
  types (not only JavaScript/TypeScript tooling) and report per-rule match
  rates, not only deltas.
- Limitations that must appear in any published article: non-random sample,
  heuristic classification (deltas bounded by rule coverage, not ground
  truth), single engine version and date.

## Recommendation

Proceed to the full 10–20 repository run at the measured cost (~80 requests,
single concurrency, minutes of wall time), sampling across ecosystems. Data
files per version (`frontend/public/research/…`) and the article page are part
of the full-study task, not of this pilot.
