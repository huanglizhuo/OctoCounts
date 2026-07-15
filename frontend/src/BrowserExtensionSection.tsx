import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ChromeIcon, EdgeIcon, FirefoxIcon } from "./icons";
import { defaultRepoUrl, extensionInfo } from "./constants";
import { AnalyticsEvents, trackEvent } from "./analytics";

export default function BrowserExtensionSection() {
  const { t } = useTranslation();
  const features = t("extensionSection.features", { returnObjects: true }) as string[];

  return (
    <div className="extension-panel">
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
          <a className="btn install-btn" href={extensionInfo.chromeWebStoreUrl} target="_blank" rel="noreferrer" onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store: "chrome", placement: "extension_section" })}>
            <ChromeIcon size={15} />
            {t("extensionSection.installChrome")}
          </a>
          <a className="copybtn install-btn secondary-install" href={extensionInfo.edgeAddOnsUrl} target="_blank" rel="noreferrer" onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store: "edge", placement: "extension_section" })}>
            <EdgeIcon size={14} />
            {t("extensionSection.installEdge")}
          </a>
          <a className="copybtn install-btn secondary-install" href={extensionInfo.firefoxAddOnsUrl} target="_blank" rel="noreferrer" onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store: "firefox", placement: "extension_section" })}>
            <FirefoxIcon size={14} />
            {t("extensionSection.installFirefox")}
          </a>
          <a className="copybtn" href={defaultRepoUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            {t("extensionSection.viewSource")}
          </a>
        </div>
      </div>
    </div>
  );
}
