import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnalyticsEvents, trackEvent } from "./analytics";
import { defaultRepoUrl, extensionInfo } from "./constants";
import { ChromeIcon, EdgeIcon, FirefoxIcon } from "./icons";
import { ThemeSwitch } from "./scheme";

export const publicReportLinks = [
  { href: "/stats", key: "stats", command: "stats" },
  { href: "/recent", key: "recent", command: "tail -f" },
  { href: "/popular", key: "popular", command: "sort --hits" },
  { href: "/trending", key: "trending", command: "watch --daily" },
  { href: "/hall-of-monoliths", key: "hall", command: "top --lines" },
];

type MenuId = "explore" | "tools" | "install";

export function Topbar() {
  const { t, i18n } = useTranslation();
  const path = window.location.pathname;
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const menuRefs = useRef<Record<MenuId, HTMLDetailsElement | null>>({ explore: null, tools: null, install: null });
  const isActive = (href: string) => path === href;

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!Object.values(menuRefs.current).some((menu) => menu?.contains(event.target as Node))) setOpenMenu(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  const closeOnEscape = (event: React.KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    const summary = event.currentTarget.querySelector<HTMLElement>("summary");
    setOpenMenu(null);
    requestAnimationFrame(() => summary?.focus());
  };

  const menu = (id: MenuId, label: string, children: React.ReactNode) => (
    <details
      ref={(node) => { menuRefs.current[id] = node; }}
      className={`topbar-menu ${id === "install" ? "topbar-install" : ""}`}
      open={openMenu === id}
      onKeyDown={closeOnEscape}
    >
      <summary
        onClick={(event) => {
          // Native details remains keyboard-operable; React owns the single
          // open state so an old menu cannot close the newly selected one.
          event.preventDefault();
          setOpenMenu((current) => current === id ? null : id);
        }}
      >
        <span className="topbar-menu-label">{label}</span>
        {id === "install" ? <span className="topbar-menu-short">{t("topbar.install")}</span> : null}
      </summary>
      <div className="topbar-popover">{children}</div>
    </details>
  );

  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label={t("topbar.brandName")}>
        <div className="logo"><img src="/octocounts-logo-96.webp" alt="" width="96" height="96" /></div>
        <span className="brand-name">{t("topbar.brandName")}</span>
      </a>
      <nav className="topbar-nav" aria-label={t("topbar.navigation")}>
        <a href="/" aria-current={path === "/" ? "page" : undefined}>{t("topbar.analyze")}</a>
        {menu("explore", t("topbar.explore"), publicReportLinks.map((item) => (
          <a key={item.href} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>{t(`growth.nav.${item.key}.label`)}</a>
        )))}
        {menu("tools", t("topbar.tools"), <>
          <a href="/compare" aria-current={isActive("/compare") ? "page" : undefined}>{t("topbar.compare")}</a>
          <a href="/diff" aria-current={isActive("/diff") ? "page" : undefined}>{t("topbar.diff")}</a>
          <a href="/badges" aria-current={isActive("/badges") ? "page" : undefined}>{t("topbar.badges")}</a>
        </>)}
        {menu("install", t("topbar.installExtension"), <>
          <StoreLink store="chrome" label={t("topbar.chrome")} />
          <StoreLink store="edge" label={t("topbar.edge")} />
          <StoreLink store="firefox" label={t("topbar.firefox")} />
        </>)}
      </nav>
      <div className="topbar-controls" role="group" aria-label={t("languageSwitcher.label")}>
        {/* aria-current="true" (not "page"): these are buttons marking the
            active item in a set, and styles.css keys the highlight off it. */}
        <button type="button" className="lang-btn" aria-current={i18n.language === "en" ? "true" : undefined} onClick={() => i18n.changeLanguage("en")}>EN</button>
        <button type="button" className="lang-btn" aria-current={i18n.language === "zh" ? "true" : undefined} onClick={() => i18n.changeLanguage("zh")}>中文</button>
        <ThemeSwitch />
        <a className="github-link icon-link" href={defaultRepoUrl} target="_blank" rel="noreferrer" aria-label={t("topbar.githubAria")}>GitHub</a>
      </div>
    </header>
  );
}

function StoreLink({ store, label }: { store: "chrome" | "edge" | "firefox"; label: string }) {
  const href = store === "chrome"
    ? extensionInfo.chromeWebStoreUrl
    : store === "edge" ? extensionInfo.edgeAddOnsUrl : extensionInfo.firefoxAddOnsUrl;
  const Icon = store === "chrome" ? ChromeIcon : store === "edge" ? EdgeIcon : FirefoxIcon;
  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store, placement: "topbar" })}>
      <Icon size={15} aria-hidden="true" /> {label}
    </a>
  );
}
