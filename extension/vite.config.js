import { defineConfig, build } from 'vite';
import { resolve, join } from 'path';
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

export default defineConfig(({ mode }) => {
  const isFirefox = mode === 'firefox';
  const outDir = isFirefox ? 'dist/firefox' : 'dist/chrome';

  return {
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
        name: 'copy-manifest-and-icons',
        closeBundle() {
          const manifest = isFirefox ? 'manifest.firefox.json' : 'manifest.chrome.json';
          copyFileSync(`manifests/${manifest}`, join(outDir, 'manifest.json'));
          mkdirSync(join(outDir, 'icons'), { recursive: true });
          for (const size of [16, 48, 128]) {
            copyFileSync(`icons/icon${size}.png`, join(outDir, `icons/icon${size}.png`));
          }
          const nestedHtml = join(outDir, 'src/popup/index.html');
          let html = readFileSync(nestedHtml, 'utf8');
          writeFileSync(join(outDir, 'popup.html'), html);
          cpSync('src/manifest-locales', join(outDir, '_locales'), { recursive: true });
        },
      },
    ],
  };
});
