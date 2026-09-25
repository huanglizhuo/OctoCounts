# OctoCounts agent instructions

## Workspace changes and shell commands

- Preserve existing user and other-agent changes; do not revert unrelated work.
- Prefix shell commands with `rtk`; use `rtk proxy` for tools without a filter.
- Keep local diagnostic logs, generated databases, and build artifacts outside
  tracked product source.
