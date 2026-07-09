# OctoCounts GitHub Action

Comment on pull requests with SLOC changes between the base and head refs.

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
      - uses: huanglizhuo/OctoCount/action@main
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
