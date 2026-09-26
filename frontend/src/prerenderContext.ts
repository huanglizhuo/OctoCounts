import { createContext, lazy, useContext } from "react";
import type { ComponentType } from "react";

// The compact extension promo on the homepage. Default: the lazy chunk every
// createRoot load uses today (report/tool routes, dev, preview). The
// prerendered-home render path — the build-time prerender AND main.tsx's
// hydrateRoot — injects the eagerly loaded component instead: a React.lazy
// boundary cannot be part of the deterministic first tree (a lazy boundary
// either ships fallback-vs-content markers the site CSP refuses to execute,
// or aborts the boundary loudly during hydration). Eager here costs one
// already-split ~1 KB gz chunk that the hydrate path loads in parallel with
// the locale bundle before the first render; every other route keeps the
// deferred behavior.
const LazyBrowserExtensionSection = lazy(() => import("./BrowserExtensionSection"));

export const ExtensionPromoContext = createContext<ComponentType<{ compact?: boolean }>>(LazyBrowserExtensionSection);

export function useExtensionPromo(): ComponentType<{ compact?: boolean }> {
  return useContext(ExtensionPromoContext);
}

// Marks the homepage's deterministic render mode — the mode the build-time
// prerender (scripts/prerender-home.mjs) and the client's first hydration
// render share, so both produce the identical tree React requires.
//
// In this mode the render must be a pure function of (tree, locale): no
// window/localStorage/matchMedia/Date.now reads. Everything user-specific
// (stored theme, recent chips, relative timestamps) starts at its
// server-renderable default and syncs in a controlled way AFTER hydration:
//   - SchemeProvider starts on the "matrix" default and adopts the visitor's
//     preference on mount (the boot script already set the correct
//     html[data-scheme] before paint, so there is no flash);
//   - recent chips start empty and load from localStorage in an effect;
//   - the runner head's relative time renders as a UTC-stamped absolute date
//     and switches to the live relative form after mount;
//   - DeferredContent sections render eagerly (their HTML already shipped in
//     the page), instead of mounting only near the viewport.
//
// The provider is ONLY mounted by the prerender script and by main.tsx's
// hydrateRoot path; every createRoot load (report routes, tool routes, plain
// SPA dev/preview) keeps the false default and today's behavior.
export const PrerenderedHomeProvider = createContext(false);

export function usePrerenderedHome(): boolean {
  return useContext(PrerenderedHomeProvider);
}
