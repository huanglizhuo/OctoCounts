# OctoCounts GitHub Action: comment SLOC changes on pull requests

Updated November 24, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

The OctoCounts GitHub Action comments on a pull request with the change in source lines of code between the base and head refs: files, total lines, code lines, comment lines and blank lines before and after, with a link to the full OctoCounts report. It runs on pull_request events, counts both refs under the same rules, and needs only the token GitHub already provides to the workflow. The repository is never cloned by the action itself; the OctoCounts API counts both refs.

Canonical page: https://octocounts.com/docs/github-action

## How do I add an SLOC diff comment to pull requests?

Add the action to a workflow that runs on pull requests. It needs permission to write pull-request comments:

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

The action is listed on GitHub Marketplace as OctoCounts SLOC Diff. The OctoCounts repository keeps the development copy under `action/`.

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Required. Token used to create or update the pull-request comment. |
| `repo` | The current repository | The repository to analyze, in `owner/name` form. |
| `base-ref` | `pull_request.base.sha` | Base ref, which may be a branch, tag, or SHA. |
| `head-ref` | `pull_request.head.sha` | Head ref, which may be a branch, tag, or SHA. |
| `api-base` | `https://api.octocounts.com` | OctoCounts API base URL. |
| `comment` | `true` | Whether to create or update the pull-request comment. Set `false` to print the Markdown without posting it. |
| `respect-gitattributes` | `false` | Apply repository linguist-generated and linguist-vendored declarations to both refs. |

## What the comment reports

The comment states the net change in counted size between the base and head refs and links to the full OctoCounts report. Both refs are counted with the same canonical options; the comment says whether the effective policies match and links both saved results. The delta is a net size change between two counted trees, not the number of lines Git lists as added or deleted.

Set `respect-gitattributes: true` to exclude repository-declared generated and vendored files from both counts. It is off by default.

## How the action handles failures

Each analysis has a five-minute total deadline with bounded safe retries and long-polling. A failure keeps the job ID so the analysis can be recovered. GitHub comment writes have a 30-second request timeout and are never replayed automatically, so a write whose outcome is unknown is not repeated. Saved report IDs stay subject to cache retention.

## Requirements and scope

The action works on public GitHub repositories; private repositories and source uploads are not supported, and no OctoCounts account is needed. The workflow needs the `pull-requests: write` permission to post the comment. Counting follows the rules on the [methodology page](https://octocounts.com/docs/methodology), and the underlying endpoints are described in the [API docs](https://octocounts.com/docs/api).

## GitHub Action FAQ

### Is the OctoCounts GitHub Action free?

Yes. It calls the public OctoCounts API, which counts public GitHub repositories without an account or token. The API rate-limits how many analyses one IP address may start per minute; see the API docs.

### Does the action upload my code?

No. The action sends the repository name and the two refs to the OctoCounts API, which downloads the source archives from GitHub and counts them with tokei. The workflow does not check out or upload the code for the count.

### Which refs does the action compare?

By default the pull request's base SHA and head SHA. base-ref and head-ref accept any branch, tag, or SHA of the repository when the comparison should use other refs.

### Can I see the comment without posting it?

Yes. Set comment: false and the action prints the Markdown it would have posted instead of writing to the pull request.

### Does the action work on private repositories?

No. OctoCounts analyzes public GitHub repositories only and does not accept source uploads. To measure a private repository inside CI, run tokei or cloc on the checked-out code instead.

## Related OctoCounts pages

- [OctoCounts CLI: count SLOC from a terminal](https://octocounts.com/docs/cli)
- [MCP server for AI coding assistants](https://octocounts.com/docs/mcp-server)
- [OctoCounts API docs](https://octocounts.com/docs/api)
- [OctoCounts Methodology](https://octocounts.com/docs/methodology)
- [All OctoCounts guides](https://octocounts.com/docs)