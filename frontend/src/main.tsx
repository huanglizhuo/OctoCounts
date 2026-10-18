// Client entry: mounts (or, on the prerendered homepage, hydrates) the App
// tree described in src/App.tsx.
//
// Two mount modes, keyed off an explicit build-time marker instead of sniffing:
//   - the Pages Function serves / and /zh from the build-time prerender (dist/home.html
//     or dist/home-zh.html), whose #root carries
//     data-oc-prerender="home" data-oc-locale="en|zh". There, and only there,
//     React hydrates: the first client tree must equal the served tree, so the
//     i18n language is forced to the served variant's locale BEFORE the first
//     render, and every visitor-private value (stored theme, recent chips,
//     relative timestamps) stays at its server-renderable default until after
//     hydration (see src/prerenderContext.ts).
//   - every other load (report/tool routes, dev, vite preview) has an empty
//     #root and keeps today's createRoot().render() behavior.
import { createRoot, hydrateRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ready as i18nReady, setLanguageForRender } from "./i18n";
import { App, createAppQueryClient } from "./App";
import { SchemeProvider } from "./scheme";
import { PrerenderedHomeProvider, ExtensionPromoContext } from "./prerenderContext";
import { initAnalytics, trackAiVisitIfReferred } from "./analytics";

const rootElement = document.getElementById("root")!;
const prerenderedHome = rootElement.dataset.ocPrerender === "home";
const prerenderLocale = rootElement.dataset.ocLocale === "zh" ? "zh" : "en";

const queryClient = createAppQueryClient();

const appTree = () => (
  <PrerenderedHomeProvider value={prerenderedHome}>
    <SchemeProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </SchemeProvider>
  </PrerenderedHomeProvider>
);

// Wait for the locale bundle (lazy zh chunk) before first render.
void i18nReady.then(async () => {
  // Analytics must init before App renders: the marketing routes in App()
  // early-return before any hook below them runs, so an in-component effect
  // would never fire on /recent, /compare, /stats, etc.
  initAnalytics();
  trackAiVisitIfReferred();
  if (prerenderedHome) {
    // Force the served variant's locale and load the extension promo chunk
    // (in parallel) so the first client render matches the prerendered markup
    // byte for byte: en is bundled, the zh locale and the promo chunk are
    // dynamic imports awaited here, before hydrateRoot.
    const [eagerPromo] = await Promise.all([
      import("./BrowserExtensionSection").then((m) => m.default),
      setLanguageForRender(prerenderLocale),
    ]);
    hydrateRoot(rootElement, (
      <ExtensionPromoContext.Provider value={eagerPromo}>
        {appTree()}
      </ExtensionPromoContext.Provider>
    ));
  } else {
    createRoot(rootElement).render(appTree());
  }
});
