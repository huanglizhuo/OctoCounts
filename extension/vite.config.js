import { build, defineConfig } from 'vite';
import { resolve, join } from 'path';
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const TARGETS = new Set(['chrome', 'edge', 'firefox']);
const EDGE_LISTING_URL = 'https://microsoftedge.microsoft.com/addons/detail/octocounts-%E2%80%93-github-sloc-/ehifednhpbpekkadndaipnngopbhpoim';
const EDGE_REVIEW_URL = EDGE_LISTING_URL;

const STORES = {
  chrome: {
    store: 'chrome',
    storeName: 'Chrome Web Store',
    listingUrl: 'https://chromewebstore.google.com/detail/octocounts-%E2%80%94-github-sloc/gkgjpjdnaklagijmekoolhcpebmoldbj',
    reviewUrl: 'https://chromewebstore.google.com/detail/octocounts-%E2%80%94-github-sloc/gkgjpjdnaklagijmekoolhcpebmoldbj/reviews',
    storeConfigured: true,
    ratingPromptEnabled: true,
  },
  firefox: {
    store: 'firefox',
    storeName: 'Firefox Add-ons',
    listingUrl: 'https://addons.mozilla.org/en-US/firefox/addon/octocounts-github-sloc/',
    reviewUrl: 'https://addons.mozilla.org/en-US/firefox/addon/octocounts-github-sloc/reviews/',
    storeConfigured: true,
    ratingPromptEnabled: false,
  },
};

function edgeStore() {
  const listingUrl = process.env.EDGE_STORE_URL || EDGE_LISTING_URL;
  const reviewUrl = process.env.EDGE_STORE_REVIEW_URL || EDGE_REVIEW_URL;
  validateEdgeUrl('EDGE_STORE_URL', listingUrl);
  validateEdgeUrl('EDGE_STORE_REVIEW_URL', reviewUrl);
  return {
    store: 'edge',
    storeName: 'Microsoft Edge Add-ons',
    listingUrl,
    reviewUrl,
    storeConfigured: true,
    ratingPromptEnabled: true,
  };
}

function validateEdgeUrl(name, value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'microsoftedge.microsoft.com') {
    throw new Error(`${name} must be an https://microsoftedge.microsoft.com/ URL`);
  }
}

function buildInfo(target, version) {
  const store = target === 'edge' ? edgeStore() : STORES[target];
  return { target, ...store, version };
}

function buildDefines(info) {
  return {
    __OCTO_BUILD_TARGET__: JSON.stringify(info.target),
    __OCTO_STORE__: JSON.stringify(info.store),
    __OCTO_STORE_NAME__: JSON.stringify(info.storeName),
    __OCTO_LISTING_URL__: JSON.stringify(info.listingUrl),
    __OCTO_REVIEW_URL__: JSON.stringify(info.reviewUrl),
    __OCTO_EXTENSION_VERSION__: JSON.stringify(info.version),
    __OCTO_STORE_CONFIGURED__: JSON.stringify(info.storeConfigured),
    __OCTO_RATING_PROMPT_ENABLED__: JSON.stringify(info.ratingPromptEnabled),
  };
}

export default defineConfig(({ mode }) => {
  if (!TARGETS.has(mode)) {
    throw new Error(`Unsupported extension build target "${mode}". Expected chrome, edge, or firefox.`);
  }

  const target = mode;
  const outDir = `dist/${target}`;
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  const info = buildInfo(target, version);
  const define = buildDefines(info);

  return {
    define,
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          background: resolve(__dirname, 'src/background/index.js'),
          popup:      resolve(__dirname, 'src/popup/index.html'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: '[name][extname]',
        },
      },
    },
    plugins: [
      {
        // Build content.js as a separate IIFE bundle so all modules are
        // compiled in a single scope — prevents variable name collisions
        // that occur when independently-minified shared chunks are concatenated.
        name: 'build-content-script',
        async closeBundle() {
          await build({
            configFile: false,
            logLevel: 'warn',
            define,
            build: {
              outDir,
              emptyOutDir: false,
              rollupOptions: {
                input: { content: resolve(__dirname, 'src/content/index.js') },
                output: {
                  entryFileNames: '[name].js',
                  format: 'iife',
                },
              },
            },
          });
        },
      },
      {
        name: 'copy-manifest-icons-and-build-info',
        closeBundle() {
          const manifestData = JSON.parse(readFileSync(`manifests/manifest.${target}.json`, 'utf8'));
          manifestData.version = version;
          writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifestData, null, 2));
          writeFileSync(join(outDir, 'build-info.json'), JSON.stringify(info, null, 2));
          mkdirSync(join(outDir, 'icons'), { recursive: true });
          for (const size of [16, 48, 128]) {
            copyFileSync(`icons/icon${size}.png`, join(outDir, `icons/icon${size}.png`));
          }
          const nestedHtml = join(outDir, 'src/popup/index.html');
          const html = readFileSync(nestedHtml, 'utf8').replace('v__VERSION__', `v${version}`);
          writeFileSync(join(outDir, 'popup.html'), html);
          cpSync('src/manifest-locales', join(outDir, '_locales'), { recursive: true });
        },
      },
    ],
  };
});
