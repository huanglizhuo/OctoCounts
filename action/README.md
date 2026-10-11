# OctoCounts GitHub Action

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-OctoCounts%20SLOC%20Diff-blue?logo=github)](https://github.com/marketplace/actions/octocounts-sloc-diff)

Comment on pull requests with SLOC changes between the base and head refs, with a link to the full [OctoCounts](https://octocounts.com) report.

Published from [huanglizhuo/octocounts-sloc-diff-action](https://github.com/huanglizhuo/octocounts-sloc-diff-action) — GitHub Marketplace only lists actions whose `action.yml` sits at a repository root, so the published action lives in its own repo. The code below in this directory is the development copy; changes here should be mirrored there before tagging a new release.

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
      - uses: huanglizhuo/octocounts-sloc-diff-action@v1
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

## Counting policy and request reliability

Set `respect-gitattributes: true` to exclude repository-declared generated and vendored files. Base and head use the same canonical options; the PR comment states whether the effective policies match and links both saved results. Deltas describe net counted size, not Git added/deleted lines.

Each analysis has a five-minute total deadline with bounded safe retries and long-polling. Failures retain the job ID for recovery. GitHub comment writes have a 30-second request timeout and are never automatically replayed. Saved report IDs remain subject to cache retention.
