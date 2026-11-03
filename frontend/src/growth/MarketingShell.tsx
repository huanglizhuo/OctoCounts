import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Topbar, publicReportLinks } from "../Topbar";
import { initAnalytics } from "../analytics";

export function MarketingShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();

  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">{t("common.skipToContent")}</a>
      <main id="main" className="page growth-page">
        <Topbar />
        {publicReportLinks.some((link) => link.href === window.location.pathname) ? <nav className="explore-nav" aria-label={t("growth.index.navAria")}>
          {publicReportLinks.map((link) => <a key={link.href} href={link.href} aria-current={window.location.pathname === link.href ? "page" : undefined}>{t(`growth.nav.${link.key}.label`)}</a>)}
        </nav> : null}
        {children}
        <footer>
          <span>{t("growth.footerTagline")}</span>
          <span>
            <a href="/stats">{t("growth.nav.stats.label")}</a> &middot; <a href="/recent">{t("growth.nav.recent.label")}</a> &middot; <a href="/popular">{t("growth.nav.popular.label")}</a> &middot; <a href="/trending">{t("growth.nav.trending.label")}</a> &middot; <a href="/hall-of-monoliths">{t("growth.nav.hall.label")}</a> &middot; <a href="/extension">{t("footer.extension")}</a> &middot; <a href="/badges">{t("footer.badges")}</a> &middot; <a href="/privacy">{t("footer.privacy")}</a>
          </span>
        </footer>
      </main>
    </>
  );
}

