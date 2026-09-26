import React, { useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnalyticsEvents, trackEvent } from "./analytics";
import { sourceRepoUrl, extensionInfo } from "./constants";
import { ChromeIcon, EdgeIcon, FirefoxIcon } from "./icons";
import { ThemeSwitch } from "./scheme";

export const publicReportLinks = [
  { href: "/stats", key: "stats" },
  { href: "/recent", key: "recent" },
  { href: "/popular", key: "popular" },
  { href: "/trending", key: "trending" },
  { href: "/hall-of-monoliths", key: "hall" },
];

type MenuId = "explore" | "tools" | "install" | "site";

export function Topbar() {
  const { t, i18n } = useTranslation();
  const path = window.location.pathname;
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const menuRefs = useRef<Record<MenuId, HTMLDetailsElement | null>>({ explore: null, tools: null, install: null, site: null });
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

  const menu = (id: MenuId, label: React.ReactNode, children: React.ReactNode) => (
    <details
      ref={(node) => { menuRefs.current[id] = node; }}
      className={`topbar-menu ${id === "install" ? "topbar-install" : ""} ${id === "site" ? "topbar-site-menu" : ""}`}
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
        aria-expanded={openMenu === id}
        aria-controls={`topbar-popover-${id}`}
      >
        <span className="topbar-menu-label">{label}</span>
        {id === "install" ? <i className="install-dot" aria-hidden="true" /> : null}
        {id === "install" ? <span className="topbar-menu-short">{t("topbar.install")}</span> : null}
      </summary>
      <div className="topbar-popover" id={`topbar-popover-${id}`}>{children}</div>
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
        <a className="github-link icon-link" href={sourceRepoUrl} target="_blank" rel="noreferrer" aria-label={t("topbar.githubAria")}>GitHub</a>
      </div>
      {/* Mobile (<=720px) whole-site menu: the nav and controls above are
          display:none there and this panel carries them instead. Same
          topbar-menu machinery, so mutual exclusivity and Escape-to-focus
          behave exactly like the desktop menus. */}
      {menu("site", <>
        <Menu size={16} aria-hidden="true" />
        <span className="visually-hidden">{t("topbar.menu")}</span>
      </>, <>
        <div className="site-menu-group">
          <a href="/" aria-current={path === "/" ? "page" : undefined}>{t("topbar.analyze")}</a>
          {publicReportLinks.map((item) => (
            <a key={item.href} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>{t(`growth.nav.${item.key}.label`)}</a>
          ))}
          <a href="/compare" aria-current={isActive("/compare") ? "page" : undefined}>{t("topbar.compare")}</a>
          <a href="/diff" aria-current={isActive("/diff") ? "page" : undefined}>{t("topbar.diff")}</a>
          <a href="/badges" aria-current={isActive("/badges") ? "page" : undefined}>{t("topbar.badges")}</a>
          <a href="/extension" aria-current={isActive("/extension") ? "page" : undefined}>{t("footer.extension")}</a>
        </div>
        <div className="site-menu-group">
          <StoreLink store="chrome" label={t("topbar.chrome")} />
          <StoreLink store="edge" label={t("topbar.edge")} />
          <StoreLink store="firefox" label={t("topbar.firefox")} />
        </div>
        <div className="site-menu-group site-menu-preferences">
          <button type="button" className="lang-btn" aria-current={i18n.language === "en" ? "true" : undefined} onClick={() => i18n.changeLanguage("en")}>EN</button>
          <button type="button" className="lang-btn" aria-current={i18n.language === "zh" ? "true" : undefined} onClick={() => i18n.changeLanguage("zh")}>中文</button>
          <ThemeSwitch />
          <a href={sourceRepoUrl} target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </>)}
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
