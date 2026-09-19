# OctoCounts FAQ

Updated September 19, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

OctoCounts is a free source lines of code (SLOC) counter for public GitHub repositories. It shows files, total lines, code lines, comments, blanks, and per-language totals without cloning: the requested branch, tag, or commit SHA is resolved to an exact commit and counted with tokei, an open-source Rust line counter. No account is required, private repositories are not supported, and results can be exported as plain text, JSON, or a PNG card.

Frequently asked questions about OctoCounts, source lines of code counting, GitHub support, browser extensions, badges, and the API.

## Getting started

### What is OctoCounts?

OctoCounts is a free, open-source source lines of code (SLOC) counter for public GitHub repositories. It shows file counts, total lines, code lines, comment lines, blank lines, and per-language totals without cloning: counts are pinned to an exact commit and computed with tokei, an open-source Rust line counter. It runs in the browser with no account, ships Chrome, Edge, and Firefox extensions, and exports results as plain text, JSON, or a shareable PNG card.

### What is SLOC?

SLOC stands for Source Lines of Code. It is a software metric used to measure the size of a program by counting the lines in its source code. Unlike raw line count, SLOC distinguishes between code lines (actual instructions the compiler or interpreter processes), comment lines (documentation and explanations), and blank lines (whitespace). This breakdown matters because a 10,000-line file that is 40% comments tells a different story than one that is 95% code.

Developers use SLOC to estimate project complexity, compare codebases when evaluating dependencies, scope billing and audit work, and communicate repository size to stakeholders who may not read code. OctoCounts reports SLOC at two levels: per programming language and as aggregate totals across the entire repository. The underlying counter is tokei, an open-source line counter written in Rust that processes files in parallel.

### How do I count lines of code in a GitHub repository?

Open octocounts.com, paste a public GitHub repository URL (for example `github.com/torvalds/linux`), optionally pick a branch, tag, or commit SHA, and click Analyze. OctoCounts resolves the ref to one pinned commit, downloads the source archive, runs tokei, and returns a sortable per-language breakdown with aggregate totals, usually within seconds and without a git clone. Every analysis gets a permanent report URL that can be shared, cited, or revisited later.

### Is OctoCounts free?

Yes. OctoCounts is completely free to use for public GitHub repositories. There is no account required, no API key, no sign-up, and no rate limit that is publicly documented. Both the web app and the browser extensions are free with no premium tier. The backend is open source, written in Rust using the Axum framework, and the frontend is written in React with TypeScript. If you prefer, you can self-host the entire stack; the source code is available on GitHub at github.com/huanglizhuo/OctoCounts.

OctoCounts intentionally analyzes public repositories only and has no advertising and collects no personal data.

## Features and integrations

### Does OctoCounts have a browser extension?

Yes. OctoCounts has browser extensions for Chrome, Edge, and Firefox, all named OctoCounts – GitHub SLOC & Code Statistics. They add a compact SLOC card directly to GitHub repository sidebars, appearing automatically on any public repository page and showing the total line count and analysis status. Clicking the card opens the full panel with files, total lines, code lines, comment lines, and blank lines per language — the same breakdown as the web app.

A local cache makes repeat visits to the same repository and ref instant, the auto-analyze setting controls whether counts fetch on page load or on demand, and a placement setting controls where the card appears in the sidebar. No GitHub account or API token is required, and the extension source code is publicly available on GitHub.

### What programming languages does OctoCounts support?

OctoCounts uses tokei for language detection, which supports over 200 programming languages and file types, including Rust, Python, JavaScript, TypeScript, Go, Java, C, C++, C#, Ruby, Swift, Kotlin, PHP, Scala, Haskell, Elixir, Erlang, Clojure, F#, Lua, R, Julia, Dart, Perl, Shell, Bash, PowerShell, HTML, CSS, SCSS, SQL, GraphQL, Dockerfile, YAML, JSON, TOML, XML, Markdown, and many more.

Language detection is extension-based, with fallback to shebang lines and content-based detection for ambiguous files. OctoCounts automatically skips heavy generated folders before passing the archive to tokei, so the SLOC count reflects actual human-written source code rather than auto-generated files that would inflate the numbers.

### Can I export the results?

Yes. OctoCounts supports three export formats, available from the action buttons below the analysis results. Plain text copies a formatted table to your clipboard, showing language name, file count, total lines, code lines, comment lines, and blank lines in a column-aligned layout suitable for pasting into README files, GitHub issues, or documentation. JSON downloads the full structured report, including per-language stats and aggregate totals, formatted for scripts, CI pipelines, or other tools that consume JSON.

PNG downloads a 1200x630 image card showing the language breakdown, suitable for sharing on social media, GitHub READMEs, or portfolio pages. All three formats are generated client-side from the analysis data already loaded in your browser, so no additional server request is needed.

### How do I add a SLOC badge to my README?

Use the badge builder on /badges to pick a badge type, copy the generated Markdown snippet, and paste it into your README.md. Badges are available for total SLOC, code lines, file count, comment lines, language count, top language, code share, and single-language counts. Each badge renders from the latest cached report for that repository and links back to the permanent OctoCounts report page, so readers can click through and verify the underlying numbers themselves.

### Can I compare two repositories?

Yes. The /compare page compares any two public GitHub repositories, branches, tags, or commits side by side, showing files, total lines, code lines, comments, blanks, and per-language totals for both sides. The /diff page compares two refs of the same repository, which is useful for seeing how a refactor or dependency bump changed code size. OctoCounts also publishes curated comparison pages such as React vs Vue and Rust vs Go with editorial context.

## Methodology and accuracy

### How does OctoCounts count lines of code?

OctoCounts resolves the requested branch, tag, or commit SHA to one pinned commit, downloads that exact ref's GitHub source archive (a compressed tarball, not a full git clone), extracts it, and counts every source file with tokei. Heavy dependency folders such as `.git`, `node_modules`, `target`, `dist`, and `vendor` are ignored by default so vendored code does not inflate the count. The full counting rules are documented in the [methodology](https://octocounts.com/docs/methodology).

### How is OctoCounts different from GitHub's language bar?

OctoCounts differs from GitHub's language bar by reporting absolute counts instead of percentages. GitHub's language bar is a relative estimate: it infers each language's share from file counts and byte sizes, so a few large generated or vendored files can dominate it, and it never shows absolute line counts. OctoCounts reports actual numbers — files, total lines, code lines, comments, blanks, and per-language totals — pinned to a specific commit, with dependency folders like `node_modules` and `vendor` excluded by default. The result is a count a reviewer can reproduce: same commit, same exclusions, same totals. OctoCounts also gives every analysis a permanent URL with a citation block, while GitHub's bar has no permalink. See the full [GitHub language bar alternative](https://octocounts.com/docs/github-language-bar-alternative) comparison for a worked example (statements verified 2026).

### How is OctoCounts different from running tokei or cloc locally?

OctoCounts downloads a compressed archive instead of doing a full git clone, requires no local installation, caches reports by commit SHA, and provides shareable report URLs, README badges, an API, a CLI, and a GitHub Action.

### What is a cached report?

A cached report is a stored SLOC result keyed by repository, commit SHA, tokei version, and analysis options. Re-analyzing the same commit returns the cached result instantly.

### How accurate are OctoCounts reports?

Reports are exact for the downloaded source archive and selected analysis options. They reflect the public archive at one commit, not the full git history.

## Privacy, API, and project

### Does OctoCounts support private repositories?

No. OctoCounts analyzes public GitHub repositories only. It does not request GitHub account access, does not support private repositories, and does not accept source-code uploads. If you need to count lines of code in a private repository, run tokei locally: download it from github.com/XAMPPRocky/tokei, clone your repository, and run tokei in the repository root. tokei is free, open source, and produces the same output format that OctoCounts uses.

### Does OctoCounts store my source code?

No. OctoCounts analyzes public repositories and stores only aggregated statistics — file counts and line counts split into code, comment, and blank lines, plus per-language totals — keyed by commit SHA and analysis options. Source files from the downloaded archive are not persisted, no account is required, and there is nothing to upload. See the [privacy policy](https://octocounts.com/privacy) for the full data-handling details.

### Is there an API or CLI?

The OctoCounts API is a public HTTP interface for counting source lines of code in public GitHub repositories without cloning them. Endpoints cover starting a SLOC analysis, fetching cached reports, listing analysis jobs, generating README badges, and building compare and diff URLs, each documented with request parameters and JSON response schemas in the [API docs](https://octocounts.com/docs/api) (updated September 2026). Beyond the API, OctoCounts ships a zero-install CLI via `npx octocounts`, an MCP server so AI assistants can pull SLOC data during conversations, and a GitHub Action that comments size deltas on pull requests. All of it requires no account or sign-up.

### Can I use OctoCounts in CI or GitHub Actions?

Yes. The OctoCounts GitHub Action runs on pull requests and comments how the change affects source lines of code, so reviewers see size deltas next to the diff. The CLI (`npx octocounts`) works in any terminal or CI script and outputs JSON that pipelines can consume for reporting or custom checks.

### What happens if a repository is too large?

Very large repositories may exceed the analyzer's archive-size or time limits, in which case the analysis fails with a clear error instead of returning partial numbers. Workarounds: retry later, analyze a smaller branch or tag of the same repository, or run tokei locally where no download limits apply. Reports that succeeded earlier stay cached and keep serving instantly.

### How do I cite an OctoCounts report?

Cite the canonical report URL together with the commit SHA and generated date shown on the page, for example: `OctoCounts, "torvalds/linux: lines of code", https://octocounts.com/github/torvalds/linux, counted at commit <sha> on <date>`. Every report page includes a ready-to-copy recommended citation block, and appending `.md` to any report URL returns the same content as Markdown for quoting in documentation.

### Who maintains OctoCounts?

OctoCounts is built and maintained by [huanglizhuo](https://github.com/huanglizhuo), who also wrote the browser extensions and the Rust backend. The project is [open source on GitHub](https://github.com/huanglizhuo/OctoCounts) under the MIT license, accepts issues and pull requests, and documents its counting methodology publicly. For background and contact details see the [About OctoCounts](https://octocounts.com/about) page.
