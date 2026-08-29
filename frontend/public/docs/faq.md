# OctoCounts FAQ

Frequently asked questions about OctoCounts, source lines of code counting, GitHub support, browser extensions, badges, and the API.

## Getting started

### What is OctoCounts?

OctoCounts is a free source lines of code (SLOC) counter for public GitHub repositories. It shows files, total lines, code lines, comments, blanks, and per-language totals without cloning.

### What is SLOC?

SLOC stands for Source Lines of Code. It is a software metric used to measure the size of a program by counting the lines in its source code. Unlike raw line count, SLOC distinguishes between code lines (actual instructions the compiler or interpreter processes), comment lines (documentation and explanations), and blank lines (whitespace). This breakdown matters because a 10,000-line file that is 40% comments tells a different story than one that is 95% code.

Developers use SLOC to estimate project complexity, compare codebases when evaluating dependencies, scope billing and audit work, and communicate repository size to stakeholders who may not read code. OctoCounts reports SLOC at two levels: per programming language and as aggregate totals across the entire repository. The underlying counter is tokei, which is significantly faster than alternatives like cloc or sloccount because it is written in Rust and uses parallel file processing.

### How do I count lines of code in a GitHub repository?

Paste a public GitHub URL into the OctoCounts web app, optionally specify a branch, tag, or commit SHA, and click Analyze. OctoCounts resolves the ref, downloads the source archive, runs tokei, and returns a sortable breakdown.

### Is OctoCounts free?

Yes. OctoCounts is completely free to use for public GitHub repositories. There is no account required, no API key, no sign-up, and no rate limit that is publicly documented. Both the web app and the browser extensions are free with no premium tier. The backend is open source, written in Rust using the Axum framework, and the frontend is written in React with TypeScript. If you prefer, you can self-host the entire stack; the source code is available on GitHub at github.com/huanglizhuo/OctoCounts.

OctoCounts intentionally analyzes public repositories only and has no advertising and collects no personal data.

## Features and integrations

### Does OctoCounts have a browser extension?

Yes. OctoCounts has browser extensions for Chrome, Edge, and Firefox, all named OctoCounts – GitHub SLOC & Code Statistics. They add a compact SLOC card directly to GitHub repository sidebars, appearing automatically on any public repository page and showing the total line count and analysis status. Clicking the card opens the full panel with files, total lines, code lines, comment lines, and blank lines per language — the same breakdown as the web app.

A local cache makes repeat visits to the same repository and ref instant, the auto-analyze setting controls whether counts fetch on page load or on demand, and a placement setting controls where the card appears in the sidebar. No GitHub account or API token is required, and the extension source code is publicly available on GitHub.

### What programming languages does OctoCounts support?

OctoCounts uses tokei for language detection, which supports over 200 programming languages and file types, including Rust, Python, JavaScript, TypeScript, Go, Java, C, C++, C#, Ruby, Swift, Kotlin, PHP, Scala, Haskell, Elixir, Erlang, Clojure, F#, Lua, R, Julia, Dart, Perl, Shell, Bash, PowerShell, HTML, CSS, SCSS, SQL, GraphQL, Dockerfile, YAML, JSON, TOML, XML, Markdown, and many more.

tokei detects languages primarily by file extension, with fallback to shebang lines and content-based detection for ambiguous files, and supports configuration to exclude directories such as node_modules, vendor, or build output folders. OctoCounts automatically skips heavy generated folders before passing the archive to tokei, so the SLOC count reflects actual human-written source code rather than auto-generated files that would inflate the numbers.

### Can I export the results?

Yes. OctoCounts supports three export formats, available from the action buttons below the analysis results. Plain text copies a formatted table to your clipboard, showing language name, file count, total lines, code lines, comment lines, and blank lines in a column-aligned layout suitable for pasting into README files, GitHub issues, or documentation. JSON downloads the full structured report, including per-language stats and aggregate totals, formatted for scripts, CI pipelines, or other tools that consume JSON.

PNG downloads a 1200x630 image card showing the language breakdown, suitable for sharing on social media, GitHub READMEs, or portfolio pages. All three formats are generated client-side from the analysis data already loaded in your browser, so no additional server request is needed.

### How do I add a SLOC badge to my README?

Use the badge builder on /badges to pick a badge type, copy the Markdown snippet, and paste it into your README.md.

### Can I compare two repositories?

Yes. Use /compare to compare two public repositories side by side, or visit curated comparison pages such as /compare/react-vs-vue.

## Methodology and accuracy

### How does OctoCounts count lines of code?

OctoCounts resolves the requested branch, tag, or commit SHA to a pinned commit, downloads the GitHub source archive for that exact ref, extracts it, and counts every source file with tokei. Heavy dependency folders are ignored by default.

### How is OctoCounts different from GitHub's language bar?

GitHub's language bar shows language percentages. OctoCounts shows actual file counts and line counts: total lines, code lines, comments, blanks, and per-language totals, pinned to a specific commit. See the full [GitHub language bar alternative](https://octocounts.com/docs/github-language-bar-alternative) comparison for details.

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

No. OctoCounts analyzes public repositories and stores only aggregated statistics such as file counts and line counts.

### Is there an API or CLI?

Yes. OctoCounts offers a public API, a CLI via `npx octocounts`, an MCP server, and a GitHub Action. See /docs/api for details.

### Can I use OctoCounts in CI or GitHub Actions?

Yes. The OctoCounts GitHub Action comments SLOC changes on pull requests.

### What happens if a repository is too large?

Very large repositories may hit analyzer size or timeout limits. Retry later, specify a smaller ref, or run tokei locally.

### How do I cite an OctoCounts report?

Every report page includes a recommended citation. Prefer citing the canonical report URL and include the generated date and commit SHA.

### Who maintains OctoCounts?

OctoCounts is built and maintained by huanglizhuo. The project is open source on GitHub under the MIT license.
