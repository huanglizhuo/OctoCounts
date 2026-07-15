# OctoCounts Extension

## How releases work

Versions are defined in one place: `package.json`. The build injects the version everywhere else automatically — you never edit the manifest files or the popup HTML directly.

At build time (`npm run build:all`), `vite.config.js` reads the version from `package.json` and:
- Writes it into `dist/chrome/manifest.json`, `dist/edge/manifest.json`, and `dist/firefox/manifest.json`
- Replaces the `v__VERSION__` placeholder in the popup footer with the real version
- Writes target-specific store metadata to each artifact's `build-info.json`

The manifest source files under `manifests/` and `src/popup/index.html` intentionally hold placeholder versions — the build injects the package version.

The Edge build defaults to the released [Microsoft Edge Add-ons listing](https://microsoftedge.microsoft.com/addons/detail/octocounts-%E2%80%93-github-sloc-/ehifednhpbpekkadndaipnngopbhpoim). You can override its listing and review destinations for release testing:

```bash
EDGE_STORE_URL=https://microsoftedge.microsoft.com/addons/detail/... \
EDGE_STORE_REVIEW_URL=https://microsoftedge.microsoft.com/addons/detail/.../reviews \
npm run package:release
```

`npm run package:artifacts` creates versioned Chrome, Edge, and Firefox archives for local/CI verification. It never re-labels the Chrome directory as an Edge build.

## How to release

From the `extension/` directory:

```bash
npm run release patch   # 0.1.7 → 0.1.8
npm run release minor   # 0.1.7 → 0.2.0
npm run release major   # 0.1.7 → 1.0.0
npm run release 0.2.3   # explicit version
```

`scripts/release.js` will:
1. Bump the version in `package.json` (and `package-lock.json`)
2. Create a commit: `update to extension-v<version>`
3. Create a git tag: `extension-v<version>`
4. Push the commit and tag to origin

The `extension-v*` tag triggers the GitHub Actions workflow (`.github/workflows/extension-release.yml`), which builds Chrome, Edge, and Firefox independently and publishes target-named zip files. The Edge artifact uses the released Microsoft Edge Add-ons listing by default; repository secrets can override the URLs when needed.
