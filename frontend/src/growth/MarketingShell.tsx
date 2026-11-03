import React, { useContext, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Topbar, publicReportLinks } from "../Topbar";
import { ExploreContext, exploreHref } from "./ExploreContext";
import { initAnalytics } from "../analytics";

export function MarketingShell({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const { pathname } = useContext(ExploreContext);
  const path = pathname || window.location.pathname;

  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <>
      <a className="skip-link" href="#main">{t("common.skipToContent")}</a>
      <main id="main" className="page growth-page">
        <Topbar />
        {publicReportLinks.some((link) => link.href === path) ? <nav className="explore-nav" aria-label={t("growth.index.navAria")}>
          {publicReportLinks.map((link) => <a key={link.href} href={exploreHref(link.href, i18n.language)} aria-current={path === link.href ? "page" : undefined}>{t(`growth.nav.${link.key}.label`)}</a>)}
        </nav> : null}
        {children}
        <footer>
          <span>{t("growth.footerTagline")}</span>
          <span>
            <a href={exploreHref("/stats", i18n.language)}>{t("growth.nav.stats.label")}</a> &middot; <a href={exploreHref("/recent", i18n.language)}>{t("growth.nav.recent.label")}</a> &middot; <a href={exploreHref("/popular", i18n.language)}>{t("growth.nav.popular.label")}</a> &middot; <a href={exploreHref("/trending", i18n.language)}>{t("growth.nav.trending.label")}</a> &middot; <a href={exploreHref("/hall-of-monoliths", i18n.language)}>{t("growth.nav.hall.label")}</a> &middot; <a href="/extension">{t("footer.extension")}</a> &middot; <a href="/badges">{t("footer.badges")}</a> &middot; <a href="/privacy">{t("footer.privacy")}</a>
          </span>
        </footer>
      </main>
    </>
  );
}

