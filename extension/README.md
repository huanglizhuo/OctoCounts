# OctoCounts Extension

## How releases work

Versions are defined in one place: `package.json`. The build injects the version everywhere else automatically — you never edit the manifest files or the popup HTML directly.

At build time (`npm run build`), `vite.config.js` reads the version from `package.json` and:
- Writes it into `dist/chrome/manifest.json` and `dist/firefox/manifest.json`
- Replaces the `v__VERSION__` placeholder in the popup footer with the real version

The manifest source files (`manifests/manifest.chrome.json`, `manifests/manifest.firefox.json`) and `src/popup/index.html` intentionally hold placeholder values — editing them has no effect on built output.

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

The `extension-v*` tag triggers the GitHub Actions workflow (`.github/workflows/extension-release.yml`), which builds both the Chrome and Firefox extensions and publishes them as a GitHub release with the zip files attached.
