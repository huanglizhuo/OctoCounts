import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const extensionPackage = JSON.parse(
  readFileSync(new URL("../extension/package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  plugins: [
    react(),
    {
      name: "inject-extension-version",
      transformIndexHtml(html) {
        return html.replaceAll("__EXTENSION_VERSION__", extensionPackage.version);
      },
    },
  ],
  build: {
    modulePreload: { polyfill: false },
  },
  server: {
    // Dev-only: lets the browser talk to the Rust backend through this same
    // origin (matching how production serves both from octocounts.com), so
    // things like the OAuth callback's redirect land back on a page this
    // server actually renders instead of the bare API's own port.
    proxy: {
      "/api": "http://127.0.0.1:8095",
      "/og": "http://127.0.0.1:8095",
      "/badge": "http://127.0.0.1:8095",
    },
  },
});
