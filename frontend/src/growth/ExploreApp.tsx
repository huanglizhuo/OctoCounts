import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExploreContext, type ExploreBootstrap } from "./ExploreContext";
import { ExploreFrame } from "./ExploreRoute";
import { exploreKind } from "./explorePages";
import { StatsPage, ReportListPage, TrendingPage } from "../pages/explore";

export function ExploreApp({ bootstrap }: { bootstrap?: ExploreBootstrap }) {
  const { t, i18n } = useTranslation();
  const [route, setRoute] = useState(() => bootstrap ?? {
    pathname: window.location.pathname, search: window.location.search, now: Date.now(), seeds: {},
  });
  const initial = useRef(true);
  const scrollTarget = useRef(0);
  const kind = exploreKind(route.pathname)!;

  useEffect(() => {
    const root = document.getElementById("root")!;
    root.dataset.ocReady = "explore";
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    let scrollFrame = 0;
    const saveScroll = () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => history.replaceState({ ...history.state, exploreScroll: window.scrollY }, ""));
    };
    const navigate = (url: URL, scroll: number) => {
      scrollTarget.current = scroll;
      setRoute((current) => ({ ...current, pathname: url.pathname, search: url.search, now: Date.now() }));
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href);
      if (url.origin !== location.origin || !exploreKind(url.pathname) || url.hash) return;
      const page = url.searchParams.get("page");
      if (page && (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)))) return;
      if (i18n.language === "zh") url.searchParams.set("lng", "zh");
      event.preventDefault();
      if (url.href === location.href) return;
      cancelAnimationFrame(scrollFrame);
      history.replaceState({ ...history.state, exploreScroll: window.scrollY }, "");
      history.pushState({ exploreScroll: 0 }, "", url);
      navigate(url, 0);
    };
    const pop = async (event: PopStateEvent) => {
      if (!exploreKind(location.pathname)) { location.reload(); return; }
      cancelAnimationFrame(scrollFrame);
      const url = new URL(location.href);
      const language = url.searchParams.get("lng");
      if (language && language !== i18n.language) {
        const { setLanguageForRender } = await import("../i18n");
        await setLanguageForRender(language === "zh" ? "zh" : "en");
      }
      if (url.href === location.href) navigate(url, Number(event.state?.exploreScroll) || 0);
    };
    document.addEventListener("click", click);
    window.addEventListener("popstate", pop);
    window.addEventListener("scroll", saveScroll, { passive: true });
    return () => {
      cancelAnimationFrame(scrollFrame);
      history.scrollRestoration = previous;
      delete root.dataset.ocReady;
      document.removeEventListener("click", click);
      window.removeEventListener("popstate", pop);
      window.removeEventListener("scroll", saveScroll);
    };
  }, [i18n]);

  useEffect(() => {
    if (initial.current) { initial.current = false; return; }
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".growth-hero h1")?.focus({ preventScroll: true });
      window.scrollTo({ top: scrollTarget.current, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [route.pathname, route.search]);

  useEffect(() => {
    const url = new URL(location.href);
    if (i18n.language === "zh" || url.searchParams.has("lng")) {
      url.searchParams.set("lng", i18n.language === "zh" ? "zh" : "en");
      history.replaceState(history.state, "", url);
    }
    const key = kind === "stats" ? "growth.stats" : `growth.pages.${kind === "monoliths" ? "hall" : kind}`;
    const title = `${t(`${key}.title`)} | OctoCounts`;
    const description = t(`${key}.subtitle`);
    const canonical = new URL(route.pathname, "https://octocounts.com");
    const page = Number(new URLSearchParams(route.search).get("page"));
    if (page > 1) canonical.searchParams.set("page", String(page));
    document.title = title;
    document.querySelector('link[rel="canonical"]')?.setAttribute("href", canonical.href);
    for (const [selector, value] of [
      ['meta[name="description"]', description], ['meta[property="og:description"]', description],
      ['meta[property="og:title"]', title], ['meta[name="twitter:title"]', title],
      ['meta[name="twitter:description"]', description], ['meta[property="og:url"]', canonical.href],
      ['meta[name="robots"]', page > 1 ? "noindex,follow" : "index,follow,max-image-preview:large,max-snippet:-1"],
    ]) document.querySelector(selector)?.setAttribute("content", value);
    // A client navigation must not leave the previous collection's ItemList in the head.
    if (bootstrap && (route.pathname !== bootstrap.pathname || route.search !== bootstrap.search)) {
      document.querySelectorAll('script[type="application/ld+json"], link[rel="alternate"][type]').forEach((node) => node.remove());
    }
  }, [route.pathname, route.search, i18n.language, t, kind, bootstrap]);

  return <ExploreContext.Provider value={route}>
    <ExploreFrame kind={kind}>
      {kind === "stats" ? <StatsPage /> : kind === "trending" ? <TrendingPage /> : <ReportListPage kind={kind} />}
    </ExploreFrame>
  </ExploreContext.Provider>;
}
