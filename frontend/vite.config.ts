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
    modulePreload: { polyfill: true },
  },
});
