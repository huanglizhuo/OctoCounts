# DOM fixtures

Deterministic GitHub page shapes for `tests/github-dom.test.mjs`. Every CSS
Module class is written as `...__HASH`; the test substitutes a fresh random
value per run, so a resolver that keys off a literal build hash (the original
`Lpx5q` bug) cannot pass.

| Fixture | Shape it pins down |
| --- | --- |
| `github-sidebar-live-capture.html` | Real markup captured from github.com — sections have headings, links are not yet hydrated |
| `github-sidebar-css-module.html` | New code view, fully hydrated (section links present) |
| `github-sidebar-border-grid.html` | Pre-migration Primer `.BorderGrid`, no sidebar links |
| `github-sidebar-no-languages.html` | Small repo with no Languages section, non-English UI |
| `github-private-repo.html` | Private repo whose only visibility signal is the embedded payload |
| `github-non-repo.html` | Two-segment non-repo path with a sidebar-shaped container |

## Refreshing the live capture

When GitHub changes its layout, re-capture rather than hand-editing:

```sh
curl -sL -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
  AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' \
  https://github.com/huanglizhuo/OctoCounts -o /tmp/page.html
```

Then take the `[class*="-module__borderGrid"]` subtree, strip `svg`/`img`/
`script`/`style` and every attribute except `class`, `href`, `aria-label`,
`data-testid` and `id`, and replace the build hashes with `__HASH`. Keep the
surrounding `main`/README/file-table scaffolding so the main-content rejection
stays covered.
