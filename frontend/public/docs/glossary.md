# SLOC Glossary

Updated August 27, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

> Precise definitions of source lines of code terms, and how each one appears in OctoCounts reports. OctoCounts counts public GitHub repositories with [tokei](https://github.com/XAMPPRocky/tokei) at a pinned commit; see the [methodology](https://octocounts.com/docs/methodology) for the full counting policy.

Canonical page: https://octocounts.com/docs/glossary

## SLOC

SLOC (Source Lines of Code) is a measure of software size obtained by counting the number of lines in a program's source files. Because a raw line count mixes very different content, a SLOC report normally separates code lines, comment lines, and blank lines, and "lines of code" without qualification usually means code lines only. SLOC is only comparable across projects when the counting rules are stated, since language syntax and tool rules shift the totals. OctoCounts reports code, comments, and blanks separately for every repository and language so that two reports can be compared directly.

## Physical vs Logical SLOC

Physical SLOC is a count of the raw text lines in source files, while logical SLOC counts executable statements rather than lines. One logical statement can span several physical lines, and one physical line can hold several statements, so the two figures diverge most in languages with flexible formatting. Physical SLOC is cheaper to compute and far more reproducible across tools, which is why most counters default to it. OctoCounts reports physical line counts, split by tokei into code, comments, and blanks.

## Code lines

Code lines are source lines that contain executable statements or declarations, excluding comments and blank lines. They are the figure people usually mean by "lines of code," and the most useful single indicator of a codebase's size. What qualifies depends on language parsing rules, so counts from different tools can differ slightly on edge cases such as docstrings or inline code after a comment. In OctoCounts reports this is the `code` column, computed per language and in the repository total.

## Comment lines

Comment lines are source lines that contain only human-readable documentation, recognized by each language's comment syntax. Line comments and block comments both count, and a line that mixes code with a trailing comment is classified as code by most counters. Comment volume reflects documentation habits more than program size, so it is best read alongside code lines rather than alone. OctoCounts reports comments as a separate column for every language, and exposes them through the `type=comments` badge.

## Blank lines

Blank lines are source lines that contain nothing but whitespace and carry no code or comment content. They exist purely for visual separation, so their share of a file says more about formatting style than about the software itself. Blank lines still matter for arithmetic: total lines equal code plus comments plus blanks, and any report that omits them understates file size. OctoCounts reports blanks explicitly so its totals always reconcile.

## Comment ratio

Comment ratio is the share of a codebase made up of comment lines, usually expressed as comment lines divided by total lines. It is a rough proxy for documentation density, though heavy generated comments or license headers can inflate it. Some reports instead track code share, the complementary figure of code lines over total lines. OctoCounts' `type=ratio` badge displays code share: code lines as a percentage of total lines for the repository.

## tokei

tokei is a fast, open-source code statistics tool written in Rust that counts files, total lines, code lines, comments, and blanks across many programming languages. It uses language-specific rules to classify each line and processes directories in parallel, which makes it quick on large trees. Because its counting rules are explicit and stable per version, results can be reproduced by pinning the tool version. OctoCounts runs tokei on the extracted source archive of a pinned commit and includes the tokei version in every report's cache key.

## cloc

cloc (Count Lines of Code) is an open-source command-line tool written in Perl that counts blank lines, comment lines, and physical lines of source code in many programming languages. It is one of the oldest widely used counters and is a common baseline for comparing code-counting results. Like tokei, it classifies lines with language-specific rules, so its figures may differ slightly from other tools on ambiguous lines. OctoCounts uses tokei rather than cloc, but the reported metrics map one-to-one, so cloc output for the same tree is a reasonable cross-check.

## scc

scc (Sloc Cloc and Code) is an open-source code counter written in Go that reports code, comment, and blank line counts along with complexity and COCOMO-style cost estimates. It is designed for speed on very large repositories and adds derived metrics beyond raw line counts. Its cost and effort numbers come from applying a COCOMO-like model to the measured SLOC. OctoCounts reports line counts only; tools like scc are the reference when an estimated cost figure is needed.

## COCOMO

COCOMO (Constructive Cost Model) is a software cost estimation model, published by Barry Boehm in 1981, that predicts development effort, schedule, and cost from estimated source lines of code. The basic model applies an equation of the form effort = a × (KLOC)^b, where KLOC is thousands of source lines and the constants depend on the project's development mode. Later revisions added cost-driver multipliers, but SLOC remains the central input. OctoCounts supplies the measured SLOC input for public GitHub repositories; it does not itself compute COCOMO estimates.

## Repository language breakdown

A repository language breakdown is a per-language table showing how a repository's files, code lines, comments, and blanks are distributed across detected programming languages. It reveals the dominant implementation language, the presence of supporting languages, and where documentation-heavy code lives. Languages are detected from file extensions and content rules, so generated or vendored files can skew the breakdown unless excluded. Every OctoCounts report includes a language breakdown sorted by code lines, and single-language badges are available with the `lang` query parameter.

## SLOC delta

A SLOC delta is the change in line counts between two revisions of a codebase, such as the code, comment, and blank lines added or removed by a pull request. Deltas are more informative than absolute counts for review work, because they show whether a change grew the code, the comments, or only whitespace. Comparing deltas across revisions requires counting both sides with the same tool and rules. OctoCounts supports revision comparison through its `/diff` URLs, which count two refs of the same repository and show how the line counts moved.

## Frequently Asked Questions

### What is SLOC?

SLOC (Source Lines of Code) is a measure of software size obtained by counting the number of lines in a program's source files. A SLOC report normally separates code lines, comment lines, and blank lines, and is only comparable across projects when the counting rules are stated.

### What is the difference between physical and logical SLOC?

Physical SLOC counts raw text lines in source files; logical SLOC counts executable statements, so one logical statement may span several physical lines. OctoCounts and tokei report physical line counts split into code, comments, and blanks.

### Which tool does OctoCounts use to count lines of code?

OctoCounts counts public GitHub repositories with tokei, a fast code statistics tool written in Rust, run against the source archive of a pinned commit.
