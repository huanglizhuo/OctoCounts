# OctoCounts Methodology

Updated August 15, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

> OctoCounts counts public GitHub repository source trees at a pinned ref. It does not clone full git history, does not request account access, and does not analyze private repositories.

Canonical page: https://octocounts.com/docs/methodology

## What is SLOC?

SLOC, or source lines of code, is a measure of software size counted as the number of lines in a project's source files. A SLOC count normally separates three kinds of line: **code** lines carrying executable statements or declarations, **comment** lines carrying documentation, and **blank** lines. "Lines of code" without qualification usually means the code figure alone, while "total lines" means all three added together. Because the ratio between them varies widely by language and project, a SLOC report is only comparable when the counting rules are stated. OctoCounts reports all three figures separately for every language, counted with [tokei](https://github.com/XAMPPRocky/tokei) at a pinned commit, so any two reports can be compared directly.

## Counting Pipeline

1. **Validate:** OctoCounts accepts public `github.com` repository URLs only.
2. **Resolve:** The requested branch, tag, or commit SHA is resolved to a pinned commit SHA.
3. **Download:** The backend downloads the GitHub source archive for that exact ref.
4. **Extract:** The archive is unpacked into a temporary workspace.
5. **Count:** [tokei](https://github.com/XAMPPRocky/tokei) detects languages and counts files, total lines, code lines, comments, and blank lines.
6. **Cache:** The report is stored by repository, commit SHA, tokei version, and analysis options.

OctoCounts currently runs [tokei](https://github.com/XAMPPRocky/tokei) 14.0.0 (pinned in the backend's `Cargo.lock`, checked 2026-08-29). Because the cache key includes the tokei version, any report generated after an upgrade is recounted rather than reused, so counts never silently mix results from two tokei versions.

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

## Recommended Citation

```
As of {date} (commit {sha}), {owner}/{repo} contains {total_lines} total lines: {code_lines} code, {comment_lines} comments, {blank_lines} blank, across {file_count} files in {language_count} languages. Counted with tokei via OctoCounts.
```

Every cached report page includes its own generated citation text. Prefer citing the canonical report URL, for example `https://octocounts.com/github/torvalds/linux`.

## Frequently Asked Questions

### How does OctoCounts count source lines of code?

OctoCounts resolves a public GitHub ref to a commit SHA, downloads the source archive, extracts it, runs tokei, and caches the resulting language statistics by repository, commit, tokei version, and analysis options.

### Why does OctoCounts use archive downloads instead of git clone?

Archive downloads fetch the source tree for one ref without transferring full git history. This is faster for quick repository inspection and keeps reports pinned to a reproducible commit.

### Are OctoCounts reports exact?

OctoCounts reports are exact for the downloaded source archive and selected analysis options. They are not a measure of git history, generated artifacts excluded by settings, private code, or files unavailable in the public archive.
