# About OctoCounts

OctoCounts is a free source lines of code (SLOC) counter for public GitHub repositories. It shows files, total lines, code, comments, blanks, and per-language totals without cloning.

## What OctoCounts does

GitHub shows language percentages in the repository sidebar, but it does not show actual file counts or line counts. OctoCounts fills that gap by:

- Downloading a source archive for a pinned commit instead of cloning full git history.
- Counting every source file with [tokei](https://github.com/XAMPPRocky/tokei).
- Reporting files, total lines, code lines, comment lines, blank lines, and per-language totals.
- Caching reports by commit SHA so repeated analyses are instant.
- Offering stable report URLs, README badges, PNG cards, JSON export, an API, a CLI, a GitHub Action, and browser extensions.

## Open source

OctoCounts is open source under the MIT license. The source code, issue tracker, and contribution guidelines live on GitHub:

[github.com/huanglizhuo/OctoCounts](https://github.com/huanglizhuo/OctoCounts)

## Maintainer

OctoCounts is built and maintained by [huanglizhuo](https://github.com/huanglizhuo).

## Contact

For bug reports, feature requests, or questions, please open an issue on [GitHub Issues](https://github.com/huanglizhuo/OctoCounts/issues).

## Related pages

- [GitHub SLOC counter guide](/docs/github-sloc-counter)
- [Counting methodology](/docs/methodology)
- [API docs](/docs/api)
- [FAQ](/docs/faq)
- [Privacy](/privacy)
