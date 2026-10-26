# How Filtering Changes SLOC Counts: 10-Repository Study

Article updated October 27, 2026. The new ten-repository study and the unchanged September pilot are separate datasets.

## Cross-language study — October 27, 2026

In this non-random sample of 10 public repositories, excluding test directories reduced code-line counts by 0.0% to 84.3% at a fixed commit per repository. These are filter effects, not estimates of each project’s total test code. All 50 runs used tokei-14.0.0; complete reports and effective rules are archived below.

### Sample and method

Ten repositories were selected before collection to cover seven ecosystems and two broad project types: JavaScript/TypeScript (Express, Vite), Python (Flask, Requests), Rust (fd, ripgrep), Go (Gin), Java (jsoup), C++ (nlohmann/json), and Swift (Alamofire). This is a convenience sample of libraries, frameworks and developer tools, not a random or size-stratified survey.

Collected on October 27, 2026 in Asia/Singapore (UTC timestamps are retained in the data). For each repository, the first run resolved the default branch; the other four runs used that exact 40-character SHA. The experimental “default” baseline explicitly enables docs, tests and generated files, disables repository declarations, uses the default profile and supplies no custom ignores. This is not a statement about website defaults: built-in dependency/build exclusions and tokei traversal rules still apply.

The first three variants independently disable tests, docs or generated directories. Directory matching is case-sensitive. Test-directory rules match test, tests, __tests__ and fixtures; they do not remove every file named *_test.go. Docs rules match docs, doc and documentation; generated-directory rules match generated, gen and .generated. The fifth variant additionally enables respectGitattributes with generated files excluded. Compare the declaration-enabled result with exclude-generated to isolate the effect of repository declarations, not with the all-included baseline.

Requests ran sequentially with at least 13 seconds between analyses and no force-refresh. Cache hits were allowed. collectedAt is the collection timestamp; report.generatedAt is the counting timestamp. Wall time includes API/queue/polling behavior and is not a controlled performance benchmark. This completed dataset has 50 successful runs and zero failed rows; the collector records failures instead of dropping them.

### Code-line results

Parentheses show reduction from the experimental baseline; every row uses one fixed commit. Full SHAs are in the raw data.

| Repository / commit | Baseline code | Exclude tests | Exclude docs | Exclude generated | + Declarations |
| --- | ---: | ---: | ---: | ---: | ---: |
| expressjs/express @ 1c6f1b0fe400 | 16,632 | 2,619 (−84.3%) | 16,632 (0.0%) | 16,632 (0.0%) | 16,632 (0.0%) |
| vitejs/vite @ e954a9cda0b5 | 115,672 | 83,338 (−28.0%) | 114,182 (−1.3%) | 115,672 (0.0%) | 115,672 (0.0%) |
| pallets/flask @ d086db856be1 | 25,621 | 19,686 (−23.2%) | 16,101 (−37.2%) | 25,621 (0.0%) | 25,621 (0.0%) |
| psf/requests @ 611c6162cbc4 | 12,012 | 7,795 (−35.1%) | 9,505 (−20.9%) | 12,012 (0.0%) | 12,012 (0.0%) |
| sharkdp/fd @ c44735ec0f13 | 7,991 | 4,577 (−42.7%) | 7,793 (−2.5%) | 7,991 (0.0%) | 7,793 (−2.5%) |
| BurntSushi/ripgrep @ 6892bc2b7efe | 42,949 | 38,194 (−11.1%) | 42,543 (−0.9%) | 42,949 (0.0%) | 42,949 (0.0%) |
| gin-gonic/gin @ 0f09c3a9b462 | 18,311 | 18,311 (0.0%) | 18,311 (0.0%) | 18,311 (0.0%) | 18,311 (0.0%) |
| jhy/jsoup @ 0c508f17a52d | 49,802 | 20,894 (−58.0%) | 49,802 (0.0%) | 49,802 (0.0%) | 49,802 (0.0%) |
| nlohmann/json @ 81d66291c556 | 184,337 | 93,032 (−49.5%) | 171,079 (−7.2%) | 184,337 (0.0%) | 145,483 (−21.1%) |
| Alamofire/Alamofire @ bda9ed57d729 | 324,285 | 324,285 (0.0%) | 27,204 (−91.6%) | 324,285 (0.0%) | 324,285 (0.0%) |

### Repository-declaration evidence

| Repository | Declaration status | Excluded files | Vendored flags | Generated flags |
| --- | --- | ---: | ---: | ---: |
| expressjs/express | not_found | 0 | 0 | 0 |
| vitejs/vite | applied | 0 | 0 | 0 |
| pallets/flask | not_found | 0 | 0 | 0 |
| psf/requests | not_found | 0 | 0 | 0 |
| sharkdp/fd | applied | 6 | 6 | 0 |
| BurntSushi/ripgrep | not_found | 0 | 0 | 0 |
| gin-gonic/gin | not_found | 0 | 0 | 0 |
| jhy/jsoup | applied | 0 | 0 | 0 |
| nlohmann/json | applied | 4 | 0 | 4 |
| Alamofire/Alamofire | not_found | 0 | 0 | 0 |

Vendored/generated flags may overlap; excluded files count each removed file once. The raw policy records preserve the exact status and rules.

### Scope and limitations

A zero delta means the selected rules removed no counted code lines; it does not prove absence of tests, documentation or generated code. Declaration exclusion counts above describe extracted files, including files tokei may not count. Archive contents can differ from a checkout because of export-ignore/export-subst. Results describe these commits and tokei version, not future branch tips, code quality, performance, or GitHub Linguist byte percentages. The September pilot remains separate and was not overwritten.

### Download and cite

Each JSONL row includes the full API report, report ID, full commit SHA, selected options, effective countingPolicy, repository-attribute status/removal counts, engine version, generatedAt, collectedAt, outcome, wall time and the collector source SHA-256. Retain this versioned file when citing the results; live saved reports can expire.

[Download all 50 raw reports (JSONL)](https://octocounts.com/research/filtering-effects-2026-10-27.jsonl) · [Archived collector and shared CLI client](https://octocounts.com/research/filtering-effects-2026-10-27-source.json) (source hashes included).

Dataset SHA-256: `03dc0f9f6a0896bad5cb2bb25edd0ffcd7f067ce777b7fe2847d06488339ba34`

Cite: OctoCounts, “How Filtering Changes SLOC Counts: 10-Repository Study”, October 27, 2026, tokei-14.0.0. Include the repository, full commit SHA and named configuration; link to this section and the versioned dataset.

## Historical two-repository pilot — September 8, 2026

_Original OctoCounts research. All pilot measurements were collected by OctoCounts on 2026-09-08 from public GitHub repositories with the tokei-12.1 engine. If you cite these numbers, please credit OctoCounts and link to [octocounts.com/research](https://octocounts.com/research)._

## Research question

For the same repository at the same commit, how much do OctoCounts' analysis options — excluding tests, docs, or generated files — change the reported line counts, and what does that imply for comparing reports?

The question matters because SLOC comparisons are only valid when both sides were counted under the same configuration. New reports record known effective counting rules; older reports may lack that metadata. This pilot records its selected options but predates the current effective-policy record, which limits exact reproduction.

## Method

The pilot sampled two public GitHub repositories already present in the OctoCounts corpus — [react/react](https://octocounts.com/github/react/react) (counted under its former `facebook/react` path; the repository has since moved organizations) and [vitejs/vite](https://octocounts.com/github/vitejs/vite) — and counted each one under four configurations: the site default (docs, tests, and generated files all included), `exclude-tests`, `exclude-docs`, and `exclude-generated`. That is 2 repositories × 4 configurations = 8 counted runs, all recorded on 2026-09-08.

Two design choices make the deltas pure configuration effects rather than drift:

- **Commit pinning.** The default configuration ran first and recorded the resolved commit SHA; every other configuration pinned `refName` to that exact SHA. All four runs per repository therefore count identical source material — react at `9b7a0d4029ee`, Vite at `e6f6b3e31192`.
- **Bounded execution.** Requests ran sequentially (concurrency 1) with no force-refresh and at most one retry per request — none was needed. Every run recorded the repository, commit, configuration, wall time, and returned totals; failures would have been recorded, never dropped.

## Key findings

| Code lines | default | exclude-tests | exclude-docs | exclude-generated |
| --- | ---: | ---: | ---: | ---: |
| react/react @ `9b7a0d4029ee` | 696,459 | 364,248 (−47.7%) | 696,459 (0) | 696,459 (0) |
| vitejs/vite @ `e6f6b3e31192` | 112,297 | 82,439 (−26.6%) | 110,808 (−1.3%) | 112,297 (0) |

1. **Test exclusion is the dominant filter in both samples.** It removes 26–48% of code lines. Any SLOC comparison that mixes test-inclusive and test-exclusive counts is not a valid comparison.
2. **Docs exclusion barely moved** — 0 for react and −1.3% for Vite. The filter's path and extension rules matched almost nothing in these two trees. A zero delta is information about rule coverage, not proof that these repositories lack documentation.
3. **Generated-file exclusion matched nothing** in either sample — the same caveat applies: this measures which trees the rules match, not ground truth about generated code.

The instrument itself worked: commit pinning, per-run timing, and totals were all recorded, with the tokei-12.1 engine on every run, wall time of 1,254–1,842 ms per request (≈13 s total), and zero failures or retries across the 8 requests.

## Limitations

- The sample is not random and n=2: these are two JavaScript/TypeScript tooling repositories. No claim about open source in general is possible from it.
- Filtering is heuristic (path/extension based). "Generated" and "docs" classification cannot be perfect, and the measured deltas are bounded by that heuristic rather than ground truth.
- A single engine version (tokei-12.1) and a single collection date (2026-09-08): the results describe these repositories at these commits. OctoCounts' production engine has since been upgraded to [tokei](https://github.com/XAMPPRocky/tokei) 14.0.0 (see the [counting methodology](https://octocounts.com/docs/methodology)); the pilot was not rerun, so these figures describe tokei-12.1 only.

## Pilot follow-up

The October 27 study above expands the sample to ten repositories and archives complete current-engine reports. It is a separate measurement set; these historical pilot rows remain unchanged.

## Data

The complete pilot dataset is published as newline-delimited JSON, one recorded run per row (8 rows): [pilot-samples.jsonl](https://octocounts.com/research/pilot-samples.jsonl). Each row carries the repository, configuration options, pinned commit SHA, collection timestamp, outcome, wall time, engine version (`tokei-12.1`), and full totals (files, lines, code, comments, blanks). This is original data collected by OctoCounts; if you use it, please cite OctoCounts as the source and link to [octocounts.com/research](https://octocounts.com/research).

## Related reading

- [OctoCounts counting methodology](https://octocounts.com/docs/methodology)
- [react/react SLOC report](https://octocounts.com/github/react/react) and [vitejs/vite SLOC report](https://octocounts.com/github/vitejs/vite)
- [Compare two repositories side by side](https://octocounts.com/compare)
- [OctoCounts public growth stats](https://octocounts.com/stats)
