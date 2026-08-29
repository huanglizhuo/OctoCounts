# OctoCounts FAQ

Frequently asked questions about OctoCounts, source lines of code counting, GitHub support, browser extensions, badges, and the API.

## Getting started

### What is OctoCounts?

OctoCounts is a free source lines of code (SLOC) counter for public GitHub repositories. It shows files, total lines, code lines, comments, blanks, and per-language totals without cloning.

### What is SLOC?

SLOC stands for Source Lines of Code. It is a software metric that counts lines in source files and normally separates them into code lines, comment lines, and blank lines.

### How do I count lines of code in a GitHub repository?

Paste a public GitHub URL into the OctoCounts web app, optionally specify a branch, tag, or commit SHA, and click Analyze. OctoCounts resolves the ref, downloads the source archive, runs tokei, and returns a sortable breakdown.

### Is OctoCounts free?

Yes. OctoCounts is completely free to use for public GitHub repositories. There is no account, API key, sign-up, or premium tier.

## Features and integrations

### Does OctoCounts have a browser extension?

Yes. Extensions for Chrome, Edge, and Firefox add a compact SLOC card to GitHub repository sidebars.

### What programming languages does OctoCounts support?

OctoCounts uses tokei for language detection, which supports over 200 programming languages and file types.

### Can I export the results?

Yes. Every report page offers plain text, JSON, and a 1200x630 PNG share card.

### How do I add a SLOC badge to my README?

Use the badge builder on /badges to pick a badge type, copy the Markdown snippet, and paste it into your README.md.

### Can I compare two repositories?

Yes. Use /compare to compare two public repositories side by side, or visit curated comparison pages such as /compare/react-vs-vue.

## Methodology and accuracy

### How does OctoCounts count lines of code?

OctoCounts resolves the requested branch, tag, or commit SHA to a pinned commit, downloads the GitHub source archive for that exact ref, extracts it, and counts every source file with tokei. Heavy dependency folders are ignored by default.

### How is OctoCounts different from GitHub's language bar?

GitHub's language bar shows language percentages. OctoCounts shows actual file counts and line counts: total lines, code lines, comments, blanks, and per-language totals, pinned to a specific commit.

### How is OctoCounts different from running tokei or cloc locally?

OctoCounts downloads a compressed archive instead of doing a full git clone, requires no local installation, caches reports by commit SHA, and provides shareable report URLs, README badges, an API, a CLI, and a GitHub Action.

### What is a cached report?

A cached report is a stored SLOC result keyed by repository, commit SHA, tokei version, and analysis options. Re-analyzing the same commit returns the cached result instantly.

### How accurate are OctoCounts reports?

Reports are exact for the downloaded source archive and selected analysis options. They reflect the public archive at one commit, not the full git history.

## Privacy, API, and project

### Does OctoCounts support private repositories?

No. OctoCounts analyzes public GitHub repositories only.

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
