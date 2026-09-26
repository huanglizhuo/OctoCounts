// Client entry: mounts (or, on the prerendered homepage, hydrates) the App
// tree described in src/App.tsx.
//
// Two mount modes, keyed off an explicit build-time marker instead of sniffing:
//   - the Pages Function serves / from the build-time prerender (dist/home.html
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
import React from "react";
import { ready as i18nReady, setLanguageForRender } from "./i18n";
import { App, createAppQueryClient } from "./App";
import { SchemeProvider } from "./scheme";
import { PrerenderedHomeProvider, ExtensionPromoContext } from "./prerenderContext";
import { initAnalytics, trackAiVisitIfReferred } from "./analytics";

const rootElement = document.getElementById("root")!;
const prerenderedHome = rootElement.dataset.ocPrerender === "home";
const prerenderLocale = rootElement.dataset.ocLocale === "zh" ? "zh" : "en";

// The visitor's own language preference, captured BEFORE any forced
// changeLanguage: i18next's language detector persists every language change
// to localStorage, so reading after the forced hydration language would see
// the value we just wrote. An explicit ?lng= param already decided the served
// variant (function + boot script honor it), so it is not a "preference" to
// sync back against; everything else — stored choice, then navigator — is
// client-only knowledge the server could not bake into the page.
function clientPreferredLanguage(): "en" | "zh" | null {
  if (new URLSearchParams(window.location.search).get("lng")) return null;
  try {
    const stored = localStorage.getItem("i18nextLng");
    if (stored) return stored.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    /* storage blocked — fall through to the navigator */
  }
  const navigatorLanguage = (navigator.languages?.[0] ?? navigator.language ?? "").toLowerCase();
  return navigatorLanguage.startsWith("zh") ? "zh" : null;
}
const preferredLanguage = prerenderedHome ? clientPreferredLanguage() : null;

const queryClient = createAppQueryClient();

// Fires once the hydration render has actually committed: passive effects
// run after commit, so anything that must NOT be part of the first client
// tree (a language switch the server could not have known about) is safe to
// run here. hydrateRoot() itself returns before React renders — switching
// languages immediately after the call races the hydration pass and flips the
// tree mid-render.
function AfterHydration({ onCommitted }: { onCommitted: () => void }) {
  const fired = React.useRef(false);
  React.useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    onCommitted();
  });
  return null;
}

const appTree = ({ eagerPromo, onHydrated }: { eagerPromo?: React.ComponentType<{ compact?: boolean }>; onHydrated?: () => void } = {}) => (
  <PrerenderedHomeProvider value={prerenderedHome}>
    <SchemeProvider>
      <QueryClientProvider client={queryClient}>
        <App />
        {onHydrated ? <AfterHydration onCommitted={onHydrated} /> : null}
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
        {appTree({ eagerPromo, onHydrated: () => {
          // Controlled post-hydration sync: only now may the tree adopt a
          // language the server could not have baked into the page. React
          // re-renders through the same i18n instance; nothing is unmounted
          // and no second root is involved.
          if (preferredLanguage && preferredLanguage !== prerenderLocale) {
            void setLanguageForRender(preferredLanguage);
          }
        } })}
      </ExtensionPromoContext.Provider>
    ));
  } else {
    createRoot(rootElement).render(appTree());
  }
});
