# Product

## Register

product

## Users

Developers and engineers who want to quickly inspect the size and composition of a
public GitHub repository — for due diligence, curiosity, or sharing.
Used in short sessions (a few minutes), on desktop or mobile, often during a code
review or technical conversation. The social sharing feature (PNG export) means the
audience also wants to broadcast findings.

## Product Purpose

OctoCounts adds the missing SLOC (Source Lines of Code) view to public repos without
cloning. GitHub's sidebar shows language percentages but misses actual file and line
counts; OctoCounts fills that gap. It ships as a browser extension that injects a stats
card into GitHub repo pages, and as a web app where you paste any public repo URL.
Success: a user gets an accurate per-language breakdown (files, lines, code, comments,
blanks) faster than `git clone`, and can export or share it.

## Brand Personality

Precise, fast, unapologetic. The tool is a utility — it does one thing and reports the
result. No fluff. Voice is terminal-native and confident.

## Anti-references

Generic SaaS dashboards with rounded cards, gradient text, and glassmorphism. The CRT
terminal metaphor is intentional, not a coat of paint — anything that reads as a
templated analytics dashboard is wrong.

## Design Principles

1. **Utility over decoration** — every visual element earns its place by aiding
   comprehension or reinforcing the terminal metaphor.
2. **Glows are functional, not decorative** — only status indicators (dot) and language
   color keys carry glow; text values do not.
3. **Typography as data** — JetBrains Mono throughout is intentional for a code-counting
   tool; the monospace IS the brand.
4. **Asymmetry signals hierarchy** — layouts vary intentionally to guide the eye.
5. **Theme consistency** — both themes (matrix / paper) must feel equally
   considered; neither should look like an afterthought.

## Accessibility & Inclusion

Target WCAG AA. The CRT aesthetic (scan-lines, glows, low-chroma dark backgrounds) puts
contrast and reduced-motion at particular risk; both must be verified rather than assumed.
