import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ChromeIcon, EdgeIcon, FirefoxIcon } from "./icons";
import { defaultRepoUrl, extensionInfo } from "./constants";
import { AnalyticsEvents, trackEvent } from "./analytics";

export default function BrowserExtensionSection({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const features = (t("extensionSection.features", { returnObjects: true }) as string[]).slice(0, compact ? 3 : undefined);

  return (
    <div className={`extension-panel ${compact ? "extension-panel-compact" : ""}`}>
      <div className="extension-preview">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcSet="/octocounts-dark-card-768.webp 768w, /octocounts-dark-card.webp 1280w" sizes="(max-width: 900px) 100vw, 50vw" />
          <source media="(prefers-color-scheme: light)" srcSet="/octocounts-light-card-768.webp 768w, /octocounts-light-card.webp 1280w" sizes="(max-width: 900px) 100vw, 50vw" />
          <img src="/octocounts-light-card-768.webp" alt={t("extensionSection.previewAlt")} loading="lazy" width="1280" height="800" />
        </picture>
      </div>
      <div className="extension-copy">
        <div className="terminal-label">{t("extensionSection.terminalLabel")}</div>
        <h3>{t("extensionSection.name")}</h3>
        <p>{t("extensionSection.description")}</p>
        <ul className="extension-features">
          {features.map((feature) => <li key={feature}>{feature}</li>)}
        </ul>
        <div className="extension-actions">
          <a className="copybtn" href="/extension">{t("extensionSection.learnMore")}</a>
          <a className="btn install-btn primary-install" href={extensionInfo.chromeWebStoreUrl} target="_blank" rel="noreferrer" onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store: "chrome", placement: "extension_section" })}>
            <ChromeIcon size={15} />
            {t("extensionSection.installChrome")}
          </a>
          {/* Pre-rendered coarse-pointer replacement for the install buttons —
              toggled purely by the pointer:coarse media block in styles.css. */}
          <p className="mobile-install-note">
            {t("extensionSection.desktopOnly")} <a href="/extension">{t("extensionSection.learnMore")}</a>
          </p>
          {compact ? (
            <details className="extension-other-stores">
              <summary>{t("hero.otherBrowsers")}</summary>
              <div>
                <StoreLink store="edge" label={t("extensionSection.installEdge")} />
                <StoreLink store="firefox" label={t("extensionSection.installFirefox")} />
              </div>
            </details>
          ) : <>
            <StoreLink store="edge" label={t("extensionSection.installEdge")} />
            <StoreLink store="firefox" label={t("extensionSection.installFirefox")} />
            <a className="copybtn" href={defaultRepoUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />
              {t("extensionSection.viewSource")}
            </a>
          </>}
        </div>
      </div>
    </div>
  );
}

function StoreLink({ store, label }: { store: "edge" | "firefox"; label: string }) {
  const href = store === "edge" ? extensionInfo.edgeAddOnsUrl : extensionInfo.firefoxAddOnsUrl;
  const Icon = store === "edge" ? EdgeIcon : FirefoxIcon;
  return <a className="copybtn install-btn secondary-install" href={href} target="_blank" rel="noreferrer" onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store, placement: "extension_section" })}>
    <Icon size={14} />
    {label}
  </a>;
}
