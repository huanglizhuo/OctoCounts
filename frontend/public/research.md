# How Filtering Changes SLOC Counts: OctoCounts Pilot Study

_Original OctoCounts research. All measurements were collected by OctoCounts on 2026-09-08 from public GitHub repositories with the tokei-12.1 engine. If you cite these numbers, please credit OctoCounts and link to [octocounts.com/research](https://octocounts.com/research)._

## Research question

For the same repository at the same commit, how much do OctoCounts' analysis options — excluding tests, docs, or generated files — change the reported line counts, and what does that imply for comparing reports?

The question matters because SLOC comparisons are only valid when both sides were counted under the same configuration. OctoCounts reports always state their configuration, but until this study we had no measured estimate of how large the effect actually is.

## Method

The pilot sampled two public GitHub repositories already present in the OctoCounts corpus — [facebook/react](https://octocounts.com/github/facebook/react) and [vitejs/vite](https://octocounts.com/github/vitejs/vite) — and counted each one under four configurations: the site default (docs, tests, and generated files all included), `exclude-tests`, `exclude-docs`, and `exclude-generated`. That is 2 repositories × 4 configurations = 8 counted runs, all recorded on 2026-09-08.

Two design choices make the deltas pure configuration effects rather than drift:

- **Commit pinning.** The default configuration ran first and recorded the resolved commit SHA; every other configuration pinned `refName` to that exact SHA. All four runs per repository therefore count identical source material — react at `9b7a0d4029ee`, Vite at `e6f6b3e31192`.
- **Bounded execution.** Requests ran sequentially (concurrency 1) with no force-refresh and at most one retry per request — none was needed. Every run recorded the repository, commit, configuration, wall time, and returned totals; failures would have been recorded, never dropped.

## Key findings

| Code lines | default | exclude-tests | exclude-docs | exclude-generated |
| --- | ---: | ---: | ---: | ---: |
| facebook/react @ `9b7a0d4029ee` | 696,459 | 364,248 (−47.7%) | 696,459 (0) | 696,459 (0) |
| vitejs/vite @ `e6f6b3e31192` | 112,297 | 82,439 (−26.6%) | 110,808 (−1.3%) | 112,297 (0) |

1. **Test exclusion is the dominant filter in both samples.** It removes 26–48% of code lines. Any SLOC comparison that mixes test-inclusive and test-exclusive counts is not a valid comparison.
2. **Docs exclusion barely moved** — 0 for react and −1.3% for Vite. The filter's path and extension rules matched almost nothing in these two trees. A zero delta is information about rule coverage, not proof that these repositories lack documentation.
3. **Generated-file exclusion matched nothing** in either sample — the same caveat applies: this measures which trees the rules match, not ground truth about generated code.

The instrument itself worked: commit pinning, per-run timing, and totals were all recorded, with the tokei-12.1 engine on every run, wall time of 1,254–1,842 ms per request (≈13 s total), and zero failures or retries across the 8 requests.

## Limitations

- The sample is not random and n=2: these are two JavaScript/TypeScript tooling repositories. No claim about open source in general is possible from it.
- Filtering is heuristic (path/extension based). "Generated" and "docs" classification cannot be perfect, and the measured deltas are bounded by that heuristic rather than ground truth.
- A single engine version (tokei-12.1) and a single collection date (2026-09-08): the results describe these repositories at these commits.

## Next steps

The measured cost clears the gate for a full study: 10–20 repositories × 4 configurations (≈80 requests) would take roughly 3–4 minutes of sequential requests at the pilot's per-request cost. The full study should sample across languages and project types (not only JavaScript/TypeScript tooling) and report per-rule match rates, not only deltas. When it ships, this page will be updated and versioned data files will appear under `/research/`.

## Data

The complete pilot dataset is published as newline-delimited JSON, one recorded run per row (8 rows): [pilot-samples.jsonl](https://octocounts.com/research/pilot-samples.jsonl). Each row carries the repository, configuration options, pinned commit SHA, collection timestamp, outcome, wall time, engine version (`tokei-12.1`), and full totals (files, lines, code, comments, blanks). This is original data collected by OctoCounts; if you use it, please cite OctoCounts as the source and link to [octocounts.com/research](https://octocounts.com/research).

## Related reading

- [OctoCounts counting methodology](https://octocounts.com/docs/methodology)
- [facebook/react SLOC report](https://octocounts.com/github/facebook/react) and [vitejs/vite SLOC report](https://octocounts.com/github/vitejs/vite)
- [Compare two repositories side by side](https://octocounts.com/compare)
- [OctoCounts public growth stats](https://octocounts.com/stats)
