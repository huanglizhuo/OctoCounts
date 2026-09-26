// Build-time SSR entry for the homepage prerender. NOT part of the browser
// bundle: scripts/prerender-home.mjs esbuild-bundles this module for Node,
// with a minimal `window` shim installed BEFORE the import (the app modules
// read window.location.pathname during render; everything browser-only is
// behind effects, which renderToString never runs).
//
// It renders the exact App tree the browser hydrates — same providers, same
// PrerenderedHomeProvider, and the extension promo injected eagerly exactly
// like main.tsx's hydrate path injects it — so the emitted markup is by
// construction the tree hydrateRoot expects on the served page.
//
// renderToString is only correct here because NOTHING in the prerendered tree
// suspends: the extension promo is the one lazily loaded section of the
// homepage and it is swapped for its eager form via ExtensionPromoContext (a
// React.lazy boundary cannot be part of the deterministic first tree — its
// streamed $RC bootstrap script is refused by this site's CSP, and a boundary
// left pending aborts loudly during hydration). scripts/prerender-home.mjs
// asserts the rendered output contains the promo content and no Suspense
// markers, so a future lazy boundary fails the build instead of shipping
// mismatching markup.
import { renderToString } from "react-dom/server";
import { QueryClientProvider } from "@tanstack/react-query";
import { setLanguageForRender } from "./i18n";
import { SchemeProvider } from "./scheme";
import { PrerenderedHomeProvider, ExtensionPromoContext } from "./prerenderContext";
import BrowserExtensionSection from "./BrowserExtensionSection";
import { App, createAppQueryClient } from "./App";

export async function renderHome(locale: "en" | "zh"): Promise<string> {
  await setLanguageForRender(locale);
  const queryClient = createAppQueryClient();
  try {
    return renderToString(
      <PrerenderedHomeProvider value={true}>
        <ExtensionPromoContext.Provider value={BrowserExtensionSection}>
          <SchemeProvider>
            <QueryClientProvider client={queryClient}>
              <App />
            </QueryClientProvider>
          </SchemeProvider>
        </ExtensionPromoContext.Provider>
      </PrerenderedHomeProvider>,
    );
  } finally {
    queryClient.clear();
  }
}
