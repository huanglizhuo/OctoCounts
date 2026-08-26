# OctoCounts GitHub Action

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-OctoCounts%20SLOC%20Diff-blue?logo=github)](https://github.com/marketplace/actions/octocounts-sloc-diff)

Comment on pull requests with SLOC changes between the base and head refs, with a link to the full [OctoCounts](https://octocounts.com) report.

```yaml
name: SLOC diff

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  sloc:
    runs-on: ubuntu-latest
    steps:
      - uses: huanglizhuo/OctoCounts/action@main
        with:
          github-token: ${{ github.token }}
```

Optional inputs:

- `repo`: `owner/name`, defaults to the current repository.
- `base-ref`: defaults to `pull_request.base.sha`.
- `head-ref`: defaults to `pull_request.head.sha`.
- `api-base`: defaults to `https://api.octocounts.com`.
- `comment`: set to `false` to print the markdown without writing a PR comment.

Local smoke test:

```bash
node action/src/index.js --sample-comment
```
