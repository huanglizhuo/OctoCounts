# Product Marketing Context

**Document version:** v1
**Last updated:** 2026-10-03

## Product Overview
**One-liner:** OctoCounts is a free SLOC counter for public GitHub repositories — actual file and line counts, without cloning.

**What it does:** GitHub shows language percentages; OctoCounts shows the actual numbers — files, total lines, code, comments, blanks, and per-language totals. Paste a public GitHub URL (optionally a branch, tag, or commit SHA), and it downloads the source archive for one pinned commit, runs tokei, and returns a cached, shareable report with a permanent URL.

**Product category:** Developer tools — code metrics / SLOC counting (the shelf where people search "count lines of code github", "SLOC counter", "GitHub line count").

**Product type:** Free, open-source (MIT) self-serve web tool with six surfaces: web app, browser extensions (Chrome/Edge/Firefox), CLI (`npx octocounts`), GitHub Action, MCP server, and HTTP API — plus README badges and embeds.

**Business model:** Free. No accounts, no ads, no paid tier, no personal data collection. Value is reach and utility, not revenue.

## Target Audience
**Target companies:** None in the buying sense — users are individual developers and open-source participants; secondary audiences are engineering teams (PR size deltas via GitHub Action) and researchers/analysts citing repo size.

**Decision-makers:** The developer doing the search, individually.

**Primary use case:** "How big is this repo, really?" — sizing up a repository before cloning, depending on it, forking it, or reading it.

**Jobs to be done:**
- Size up a dependency or repo before adopting/forking it ("check a repo's size before cloning")
- Settle "how big is this thing" with an actual count instead of a guess or a percentage
- Communicate and cite a repo's size to others — badges, shareable report URLs, PNG cards, PR comments

**Use cases:**
- Pre-adoption dependency sizing
- Comparing forks or alternative libraries (also /compare and /diff)
- Curiosity browsing of open-source projects ("weekend-devouring monolith or 2k lines?")
- PR review context via the GitHub Action
- Research/citation of repo size with a reproducible commit-pinned report

## Personas
Skipped — self-serve free tool, no buying committee. See Target Audience for segments.

## Problems & Pain Points
**Core problem:** GitHub's language bar shows percentages of bytes, not files or lines — it can't answer "how many lines is this?" Cloning a repo just to run tokei/cloc locally works but is tedious, especially for repos with long git history, and done often it gets old.

**Why alternatives fall short:**
- GitHub language bar: bytes-based percentages, no code/comment/blank split, excludes vendored/generated files from its own classification, no permalink
- Local CLIs (tokei, cloc, scc): require install + a local clone, no shareable URL, results not reproducible/citable across machines without pinning versions
- sloccount: unmaintained, weak modern-language support

**What it costs them:** Time (clone + install ritual per question), and adoption uncertainty — committing to a dependency without knowing its real size.

**Emotional tension:** "Am I about to depend on a weekend-devouring monolith?" — wanting a real number instead of a guess.

## Competitive Landscape
**Direct:** None does exactly this (hosted, no-install SLOC reports for public GitHub repos). Closest space is generic repo-stat sites.

**Secondary:** Local CLIs — tokei (fast local counting; needs local clone, no sharing), cloc (widest language support; Perl, slower, local), scc (adds complexity/COCOMO estimates; counts won't match tokei exactly), sloccount (legacy). All handle private repos, which OctoCounts deliberately does not.

**Indirect:** GitHub's built-in language bar (zero setup, on every repo page, but bytes-not-lines and no permalink); `git ls-files | wc -l` habit; eyeballing the file tree.

## Differentiation
**Key differentiators:**
- No install, no account — paste a URL in a browser
- Archive download for one pinned commit instead of a full clone — fast, no git-history overhead
- Commit pinning: same commit + same options = same numbers; every report is reproducible and citable (citation block included)
- Shareable surface area: permanent report URLs, README badges, PNG cards, JSON/text export, compare/diff pages
- Six integration surfaces: web, extensions, CLI, GitHub Action, MCP, API
- Runs tokei (open-source Rust counter, 200+ languages); every report carries its tokei version
- Privacy: no personal data, no ads, public repos only; self-hostable

**How we do it differently:** We wrap tokei in hosting, caching (keyed by repo + commit SHA + tokei version + options), and sharing — the thing local CLIs don't do.

**Why that's better:** The answer arrives in seconds in a browser, and it's a link you can cite, badge, or embed — not a terminal dump.

**Why customers choose us:** Fastest no-setup path from "how big is this repo?" to a number they can share and verify.

## Objections
| Objection | Response |
|-----------|----------|
| "Doesn't GitHub already show this?" | The language bar shows byte percentages, not files or lines, and has no permalink. OctoCounts shows actual counts pinned to a commit. |
| "Is it accurate?" | Reports are exact for the downloaded archive at the pinned commit with the selected options; engine is tokei, version shown on every report; methodology is public. |
| "Why not just run tokei/cloc myself?" | You can — for private repos you should. For public repos OctoCounts skips the clone/install and gives you a shareable, cached, citable URL. |
| "Does it store my code / need my account?" | No. Public repos only, no account access, no uploads, source archives not persisted — only aggregated counts are stored. |

**Anti-persona:** Teams needing private-repo analysis or custom CI counting rules (use tokei/cloc/scc locally); anyone wanting complexity, quality, or COCOMO cost metrics (use scc — SLOC measures size, not quality).

## Switching Dynamics
**Push:** Language bar's percentages keep failing to answer "how many lines"; the clone-just-to-count ritual.
**Pull:** Instant browser answer, permanent URL, badge they can paste immediately.
**Habit:** tokei/cloc already installed locally; the reflex to just look at the language bar and move on.
**Anxiety:** Trusting a third party's numbers over a local run — mitigated by commit pinning, published methodology, tokei versioning, and the open-source backend.

## Customer Language
**How they describe the problem:**
- "how big is this thing, really"
- "I want to know how big a repository actually was before depending on it, forking it, or spending an afternoon reading it"
- "check a repo's size before cloning"
- "GitHub shows language bars... the actual line counts" (the gap in one line)

**How they describe us:**
- "the SLOC panel GitHub forgot" (own tagline — validated internally, not yet external voice-of-customer)

**Words to use:** SLOC, lines of code, code statistics, without cloning, no install, public GitHub repositories, commit-pinned, shareable report, badge, tokei, per-language breakdown.

**Words to avoid:** GitLab (support deliberately removed — never re-advertise); any speed/size multiple ("10x faster") unless backed by a published, reproducible experiment — state the mechanism (archive download vs. clone) instead; "unlimited" (no publicly documented rate limit — say exactly that); any quality implication (SLOC ≠ quality).

**Glossary:**
| Term | Meaning |
|------|---------|
| SLOC | Source Lines of Code — split into code, comment, and blank lines |
| Commit pinning | Every analysis resolves to one exact commit SHA; the cache key includes it |
| Report | The permanent per-repo page at /github/:owner/:repo |
| Growth view | Animated visualization of a repo's SLOC history (shareable as WebM/GIF/PNG) |

## Brand Voice
**Tone:** Developer-to-developer: precise, plain, honest about limitations (we say what we don't do, and who should use a local tool instead).
**Style:** Direct and technically concrete — numbers, mechanisms, and links over adjectives. Claims are evidenced or mechanism-only.
**Personality:** Precise, honest, utilitarian, understated, open-source-native.

## Proof Points
**Metrics:** [Fill from Plausible: monthly analyses, completion rate, extension store installs; stats page aggregates are public at /stats]
**Customers:** [Fill: extension store user counts, notable repos frequently analyzed]
**Testimonials:** [None collected yet — store reviews are the nearest source]

**Value themes:**
| Theme | Proof |
|-------|-------|
| Real numbers, not percentages | Files/lines/code/comments/blanks per language vs. GitHub's byte bar |
| No setup | Browser-based, no account, no install; extensions work on any public repo page |
| Reproducible | Commit SHA pinning + tokei version + published methodology + citation block |
| Shareable | Permanent URLs, badges, PNG cards, /compare, embeds |
| Trustworthy | Open source (MIT), no personal data, no ads, self-hostable |

## Goals
**Business goal:** Grow usage and distribution of a free tool — more analyses, more extension installs, more badges/embeds in the wild (each badge is a permanent backlink loop).

**Conversion actions:** (1) Paste a repo URL and run an analysis; (2) install the browser extension; (3) copy a badge/embed snippet into a README.

**Current metrics:** Plausible custom events already track the funnel: `analyze_submitted` → `analyze_completed`, `extension_store_click`, `badge_markdown_copied`, `embed_snippet_copied`, `report_url_copied`, `share_clicked`, `ai_visit`, plus growth-view export events.

## Changelog
*Newest first. One line per revision: what changed and why.*
- v1 (2026-10-03) — Initial context, auto-drafted from README, about page, store listing, FAQ, comparison docs, and frontend/content/product-facts.json.
