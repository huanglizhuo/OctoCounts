import React from "react";
import { useTranslation } from "react-i18next";
import { AnalyticsEvents, trackEvent } from "./analytics";
import { defaultRepoUrl, extensionInfo } from "./constants";
import { ChromeIcon, EdgeIcon, FirefoxIcon } from "./icons";

// Shared site header (home + marketing pages).
export const publicReportLinks = [
  { href: "/stats", key: "stats", command: "stats" },
  { href: "/recent", key: "recent", command: "tail -f" },
  { href: "/popular", key: "popular", command: "sort --hits" },
  { href: "/trending", key: "trending", command: "watch --daily" },
  { href: "/hall-of-monoliths", key: "hall", command: "top --lines" },
];

export function Topbar() {
  const { t } = useTranslation();
  const path = window.location.pathname;
  const isActive = (href: string) => path === href || (href === "/stats" && path.startsWith("/stats"));
  const reportsActive = publicReportLinks.slice(1).some((item) => isActive(item.href));
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label={t("topbar.brandName")}>
        <div className="logo"><img src="/octocounts-logo-96.webp" alt={t("topbar.brandName") + " logo"} width="96" height="96" /></div>
        <div>
          <span className="brand-name">{t("topbar.brandName")}</span>
        </div>
      </a>
      <div className="topbar-links">
        <div className="topbar-links-scroll">
          <a className={`github-link signal-link ${isActive("/stats") ? "active" : ""}`} href="/stats" aria-current={isActive("/stats") ? "page" : undefined}>
            <span>{t("growth.nav.stats.label")}</span>
          </a>
          <nav className={`report-rail ${reportsActive ? "active" : ""}`} aria-label={t("growth.navAria")}>
            {publicReportLinks.slice(1).map((item) => (
              <a key={item.href} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>
                {t(`growth.nav.${item.key}.label`)}
              </a>
            ))}
          </nav>
          <a className="github-link install-link" href={extensionInfo.chromeWebStoreUrl} target="_blank" rel="noreferrer" aria-label={t("topbar.chrome")} onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store: "chrome", placement: "topbar" })}>
            <ChromeIcon size={18} aria-hidden="true" />
            <span>{t("topbar.chrome")}</span>
          </a>
          <a className="github-link install-link" href={extensionInfo.edgeAddOnsUrl} target="_blank" rel="noreferrer" aria-label={t("topbar.edge")} onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store: "edge", placement: "topbar" })}>
            <EdgeIcon size={18} />
            <span>{t("topbar.edge")}</span>
          </a>
          <a className="github-link install-link" href={extensionInfo.firefoxAddOnsUrl} target="_blank" rel="noreferrer" aria-label={t("topbar.firefox")} onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store: "firefox", placement: "topbar" })}>
            <FirefoxIcon size={18} aria-hidden="true" />
            <span>{t("topbar.firefox")}</span>
          </a>
          <a className="github-link icon-link" href={defaultRepoUrl} target="_blank" rel="noreferrer" aria-label={t("topbar.githubAria")}>
            <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>
          </a>
        </div>
      </div>
    </header>
  );
}
