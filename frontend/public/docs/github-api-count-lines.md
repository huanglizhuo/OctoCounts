# Can the GitHub API count lines of code?

Updated October 25, 2026 · Maintained by [huanglizhuo](https://github.com/huanglizhuo)

No — neither the GitHub REST API nor the GraphQL API has an endpoint that returns line counts. The closest signal, `GET /repos/{owner}/{repo}/languages`, returns **bytes** per language, and the GraphQL `Repository.diskUsage` field returns kilobytes. For actual line counts over an API, use the [OctoCounts API](https://octocounts.com/docs/api): it downloads a public repository's source archive, counts it with tokei, and returns files, code lines, comment lines, blank lines, and per-language totals as JSON, pinned to a commit SHA.

## Why doesn't the GitHub API return line counts?

GitHub's language API reports bytes per detected language, not source lines. Linguist uses language detection and repository attributes, and excludes categories such as vendored and generated files from language statistics. Byte share can differ from code-line share, and the API does not expose code, comment, or blank line totals. See GitHub Linguist's documentation at [GitHub Linguist](https://github.com/github-linguist/linguist) for its classification rules.

## Which API returns line counts for a public GitHub repository?

The OctoCounts API does it in three calls, with no token:

```sh
curl -s -X POST https://api.octocounts.com/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"repoUrl": "https://github.com/react/react"}'
# => {"jobId": "..."}

curl -s "https://api.octocounts.com/api/jobs/:jobId?wait=20"
# => {"status": "completed", "reportId": "..."}

curl -s https://api.octocounts.com/api/reports/:reportId
# => totals for files, lines, code, comments, blanks + per-language rows
```

The long-poll form `GET /api/jobs/:jobId?wait=20` holds the request until a status change (capped at 25 seconds), which is usually one round trip for a small repository. Reports are cached by repository, commit SHA, tokei version, and analysis options, so a warm repository can return `completed` from cache. The full request body — including `refName` for a branch, tag, or commit and the analysis options — is documented in the [OctoCounts API docs](https://octocounts.com/docs/api).

## How do I count lines of code in Python or JavaScript?

The same three calls in Python:

```python
import json, time, urllib.request

API = "https://api.octocounts.com/api"
body = json.dumps({"repoUrl": "https://github.com/torvalds/linux"}).encode()
job = json.load(urllib.request.urlopen(urllib.request.Request(
    f"{API}/analyze", data=body, headers={"Content-Type": "application/json"})))

while True:
    status = json.load(urllib.request.urlopen(f"{API}/jobs/{job['jobId']}?wait=20"))
    if status["status"] in ("completed", "failed"):
        break
report = json.load(urllib.request.urlopen(f"{API}/reports/{status['reportId']}"))
print(report["totals"])  # {"files": ..., "lines": ..., "code": ..., ...}
```

Retry semantics matter in CI: treat 429 and 503 responses as retryable using their `Retry-After` header, never replay an analyze POST after an ambiguous network failure, and resume from `jobId` instead of submitting again. The [API docs](https://octocounts.com/docs/api) spell out the full failure-handling contract.

## Can I get line counts without writing any code?

Yes — two zero-code routes. The [badge endpoints](https://octocounts.com/badges) return an SVG with the number inside, usable anywhere an image works:

```text
https://api.octocounts.com/badge/:owner/:repo                 # total code lines
https://api.octocounts.com/badge/:owner/:repo?type=lines      # all lines
https://api.octocounts.com/badge/:owner/:repo?lang=Rust       # one language
```

And every report page renders as plain markdown by appending `.md`, so an agent or script can read the counts as text: `https://octocounts.com/github/react/react.md`. The [web app](https://octocounts.com/) itself needs nothing but a pasted URL.

## How do I count lines of code at a specific commit via API?

Set refName to a branch, tag, or full commit SHA. The report records the resolved commit and engine version. Matching results require the same source tree, engine version, and effective counting rules; matching retained cache entries avoid a new count. A commit URL selects the current canonical analysis for that commit, while a saved-report link and exported JSON identify a particular analysis while it is retained.

## Does the OctoCounts API need a token or account?

No. It analyzes public github.com repositories only, does not require GitHub account access for analysis, and does not accept uploads. Default analyze limits are 5 requests/minute per IP (burst 10); force-refresh also defaults to 2 requests/minute (burst 2). Deployments may configure different limits. For private repositories, clone locally and run [tokei](https://github.com/XAMPPRocky/tokei) or [cloc](https://github.com/AlDanial/cloc) — the [tokei online guide](https://octocounts.com/docs/tokei-online) compares the two workflows.

## Related OctoCounts pages

- [OctoCounts API docs: endpoints, fields, retries](https://octocounts.com/docs/api)
- [Count lines of code without cloning](https://octocounts.com/docs/count-lines-without-cloning)
- [How to count lines of code in a GitHub repository](https://octocounts.com/docs/count-lines-of-code-github)
- [Counting methodology](https://octocounts.com/docs/methodology)
- [GitHub SLOC counter guide](https://octocounts.com/docs/github-sloc-counter)
