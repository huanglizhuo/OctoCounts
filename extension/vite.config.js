import { defineConfig } from 'vite';
import { resolve, join } from 'path';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

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
          content:    resolve(__dirname, 'src/content/index.js'),
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
        name: 'copy-manifest-and-icons',
        closeBundle() {
          const manifest = isFirefox ? 'manifest.firefox.json' : 'manifest.chrome.json';
          copyFileSync(`manifests/${manifest}`, join(outDir, 'manifest.json'));
          mkdirSync(join(outDir, 'icons'), { recursive: true });
          for (const size of [16, 48, 128]) {
            copyFileSync(`icons/icon${size}.png`, join(outDir, `icons/icon${size}.png`));
          }
          // Vite nests HTML at src/popup/index.html; flatten to popup.html at root
          const nestedHtml = join(outDir, 'src/popup/index.html');
          let html = readFileSync(nestedHtml, 'utf8');
          // Asset paths are already absolute (e.g. /popup.js) — correct for extension root
          writeFileSync(join(outDir, 'popup.html'), html);
        },
      },
    ],
  };
});
