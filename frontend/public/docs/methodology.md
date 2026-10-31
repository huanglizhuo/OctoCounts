# OctoCounts Methodology

Updated October 27, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

OctoCounts is a free SLOC counter for public GitHub repositories that counts source lines of code with [tokei](https://github.com/XAMPPRocky/tokei), an open-source line counter written in Rust. For every analysis it resolves the requested branch, tag, or commit SHA to an exact commit, downloads the source archive for that ref instead of cloning git history, and caches the report by repository, commit SHA, tokei version, and analysis options.

> OctoCounts counts public GitHub repository source trees at a pinned ref. It does not clone full git history, does not require account access for analysis, and does not analyze private repositories.

Canonical page: https://octocounts.com/docs/methodology

## What is SLOC?

SLOC, or source lines of code, is a measure of software size counted as the number of lines in a project's source files. A SLOC count normally separates three kinds of line: **code** lines carrying executable statements or declarations, **comment** lines carrying documentation, and **blank** lines. "Lines of code" without qualification usually means the code figure alone, while "total lines" means all three added together. Because the ratio between them varies widely by language and project, a SLOC report is only comparable when the counting rules are stated. OctoCounts reports all three figures separately for every language, counted with [tokei](https://github.com/XAMPPRocky/tokei) at a pinned commit, so reports with matching effective rules can be compared.

## Counting Pipeline

1. **Validate:** OctoCounts accepts public `github.com` repository URLs only.
2. **Resolve:** The requested branch, tag, or commit SHA is resolved to a pinned commit SHA.
3. **Download:** The backend downloads the GitHub source archive for that exact ref.
4. **Extract:** The archive is unpacked into a temporary workspace.
5. **Count:** [tokei](https://github.com/XAMPPRocky/tokei) detects languages and counts files, total lines, code lines, comments, and blank lines.
6. **Cache:** The report is stored by repository, commit SHA, tokei version, and analysis options.

OctoCounts currently runs [tokei](https://github.com/XAMPPRocky/tokei) 15.0.0 (pinned in the backend's `Cargo.lock`, upgraded from 14.0.0 on 2026-10-30). Because the cache key includes the tokei version, any report generated after an upgrade is recounted rather than reused, so counts never silently mix results from two tokei versions. tokei 15 recognizes C3, Djot, Godot text scene (`.tscn`) and `.blade` files, which 14.0.0 skipped; each report keeps the version that counted it.

## Cache Key

Reports are cached by repository provider, owner, repository name, commit SHA, tokei version, and active analysis options. Repeated requests for the same commit and options return the cached report instead of downloading and counting again.

## Default Exclusions

OctoCounts skips heavy dependency and build folders by default so counts represent the source tree rather than installed dependencies or generated output.

```
.cache
.git
.next
build
dist
node_modules
target
vendor
```

## Counting policy and comparable results

Code lines measure source size under the stated rules, not quality, productivity, effort or executable statements. Total lines are code + comments + blanks. The report's countingPolicy records the effective inclusion toggles, exact directory exclusions, ignored languages and declaration mode. Old reports without this metadata show unknown.

Directory exclusions match exact, case-sensitive path components, not globs. Tokei also applies its own language detection, hidden-file and ignore-file traversal defaults. Source-only forces docs, tests and generated directory exclusions. Compare and diff check policy version, tokei version and effective rules; the same declaration mode still applies each repository's own declarations.

Diff reports a net size change between two counted trees (head minus base). It is not Git's added/deleted line count. Percentage change uses the base count; a zero base and positive head is shown as New.


## Repository declarations in .gitattributes

Repository-declared filtering is optional and off by default. Enable respectGitattributes to apply linguist-generated and linguist-vendored. Generated declarations are excluded unless includeGenerated is true; source-only always excludes them. Vendored declarations are excluded whenever the mode is on.

Git check-attr supplies nested precedence, macros, quoted paths and unset/unspecified overrides. Only attributes set or assigned true activate exclusion. Hard directory exclusions run before declarations and cannot be overridden. Server/user Git configuration and attributes are isolated. This feature does not run GitHub Linguist's heuristics or change tokei's language classifier.

Reports distinguish declarations off, enabled with no declarations found in the extracted tree, and applied. Removal counts describe extracted files, not necessarily files tokei would count as source. Filtering has a 30-second deadline and an 8 MiB cumulative declaration limit; invalid Git declarations or filtering errors fail the analysis explicitly.


## Fixed and live sharing

Fixed sharing uses the saved report ID, commit SHA and options. The report, badge and iframe read the same saved count. Comparison URLs pin both saved results. Engine or policy differences are shown before interpreting a comparison; reports with unknown rules cannot be marked compatible.

Saved reports remain subject to cache cleanup and replacement. Missing fixed reports show unavailable and are never silently re-counted. Export the report JSON or text for durable retention. Live mode follows the chosen ref using canonical public options and can change as the ref moves; cache refreshes across surfaces are independent.

## Metrics

| Metric | Definition |
| --- | --- |
| Files | Files detected by tokei as source or supported text formats. |
| Total lines | Code lines + comment lines + blank lines. |
| Code lines | Language-parser-recognized source code lines. |
| Comments | Line and block comments recognized by language rules. |
| Blanks | Whitespace-only lines. |
| Languages | Detected programming languages and file types, sorted by code lines. |

## Limitations

- OctoCounts analyzes public GitHub repositories only.
- Counts reflect the source archive at one commit, not the full repository history.
- Generated files, dependency folders, docs, tests, and ignored languages may be included or excluded depending on analysis options.
- Language classification follows tokei's rules and supported file types.
- GitHub repositories that are empty, private, unavailable, or too large may fail analysis.

For measured examples of how these analysis options change reported counts across real repositories, see the [pilot study on how test, docs, and generated-file filtering changes SLOC counts](https://octocounts.com/research).

## Recommended Citation

```
As of {date} (commit {sha}), {owner}/{repo} contains {total_lines} total lines: {code_lines} code, {comment_lines} comments, {blank_lines} blank, across {file_count} files in {language_count} languages. Counted with tokei via OctoCounts.
```

Every cached report page includes its own generated citation text. For stable counts, prefer the saved report link with reportId and keep an exported copy. Canonical repository URLs follow cached public reports, for example `https://octocounts.com/github/torvalds/linux`.

## How to cite and preserve a measured count

Keep the full 40-character commit SHA, report ID, generatedAt, tokeiVersion, analysisOptions and countingPolicy with the exported report JSON. State code lines separately from total lines. A saved-report URL is useful while the cache retains it; an archived JSON file preserves evidence after eviction. The new ten-repository filtering study publishes these fields for every run, including the repository-declaration mode. Its historical counts must not be presented as current default-branch totals.

[Read the October 27, 2026 study and download its raw reports](https://octocounts.com/research#cross-language-2026-10-27).

## Frequently Asked Questions

### How does OctoCounts count source lines of code?

OctoCounts resolves a public GitHub ref to a commit SHA, downloads the source archive, extracts it, runs tokei, and caches the resulting language statistics by repository, commit, tokei version, and analysis options.

### Why does OctoCounts use archive downloads instead of git clone?

Archive downloads fetch the source tree for one ref without transferring full git history, which keeps the transfer limited to the current source tree and keeps reports pinned to a reproducible commit.

### Are OctoCounts reports exact?

OctoCounts reports are exact for the downloaded source archive and selected analysis options. They are not a measure of git history, generated artifacts excluded by settings, private code, or files unavailable in the public archive.

## Other languages

[简体中文](https://octocounts.com/zh/docs/methodology)
