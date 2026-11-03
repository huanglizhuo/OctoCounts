// Client entry: mounts (or, on the prerendered homepage, hydrates) the App
// tree described in src/App.tsx.
//
// Two mount modes, keyed off an explicit build-time marker instead of sniffing:
//   - the Pages Function serves / and /zh from the build-time prerender (dist/home.html
//     or dist/home-zh.html), whose #root carries
//     data-oc-prerender="home" data-oc-locale="en|zh".
//     React hydrates: the first client tree must equal the served tree, so the
//     i18n language is forced to the served variant's locale BEFORE the first
//     render, and every visitor-private value (stored theme, recent chips,
//     relative timestamps) stays at its server-renderable default until after
//     hydration (see src/prerenderContext.ts).
//   - Explore hydrates the shared server/client tree after its module and
//     locale are ready. Static VPS, report and tool routes use createRoot.
import { createRoot, hydrateRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import i18n, { ready as i18nReady, setLanguageForRender } from "./i18n";
import { App, createAppQueryClient } from "./App";
import { SchemeProvider } from "./scheme";
import { PrerenderedHomeProvider, ExtensionPromoContext } from "./prerenderContext";
import { initAnalytics, trackAiVisitIfReferred } from "./analytics";
import type { ExploreBootstrap } from "./growth/ExploreContext";
import { exploreKind, loadExplorePages, loadedExplorePages } from "./growth/explorePages";

const rootElement = document.getElementById("root")!;
const prerenderedHome = rootElement.dataset.ocPrerender === "home";
const prerenderLocale = rootElement.dataset.ocLocale === "zh" ? "zh" : "en";
// Start page code alongside locale loading, with a handled failure for both mount paths.
const exploreReady = exploreKind(window.location.pathname)
  ? loadExplorePages().then(() => true, () => false) : undefined;

function readExploreBootstrap(): ExploreBootstrap | undefined {
  if (rootElement.dataset.ocHydrate !== "explore") return;
  try {
    const value = JSON.parse(document.getElementById("octocounts-explore-bootstrap")?.textContent || "null");
    if (value?.pathname === window.location.pathname && typeof value.search === "string"
      && Number.isFinite(value.now) && (value.locale === "en" || value.locale === "zh")
      && value.seeds && typeof value.seeds === "object" && !Array.isArray(value.seeds)) return value;
  } catch { /* Keep the server content when bootstrap data is corrupt. */ }
}
const exploreBootstrap = readExploreBootstrap();
const queryClient = createAppQueryClient();

const appTree = () => {
  const Explore = loadedExplorePages()?.ExploreApp;
  return (
  <PrerenderedHomeProvider value={prerenderedHome}>
    <SchemeProvider hydrating={!!exploreBootstrap}>
      <QueryClientProvider client={queryClient}>
        {Explore ? <Explore bootstrap={exploreBootstrap} /> : <App />}
      </QueryClientProvider>
    </SchemeProvider>
  </PrerenderedHomeProvider>
);
};

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
    if (rootElement.dataset.ocSsr === "explore" && exploreReady && (!await exploreReady || (rootElement.dataset.ocHydrate === "explore" && !exploreBootstrap))) {
      // Preserve readable server content even when a stale/offline chunk cannot load.
      const notice = document.createElement("div");
      notice.className = "growth-state explore-bootstrap-error";
      notice.setAttribute("role", "alert");
      const message = document.createElement("span");
      message.textContent = i18n.t("growth.explore.moduleFailed");
      const reload = document.createElement("button");
      reload.type = "button";
      reload.className = "copybtn";
      reload.textContent = i18n.t("growth.explore.reload");
      reload.addEventListener("click", () => window.location.reload());
      notice.append(message, reload);
      rootElement.before(notice);
      return;
    }
    if (exploreBootstrap) {
      await setLanguageForRender(exploreBootstrap.locale);
      hydrateRoot(rootElement, appTree());
    } else {
      createRoot(rootElement).render(appTree());
    }
  }
});
