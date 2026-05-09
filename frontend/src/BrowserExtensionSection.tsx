import { ExternalLink } from "lucide-react";
import { ChromeIcon, FirefoxIcon } from "./icons";
import { defaultRepoUrl, extensionInfo } from "./constants";

const features = [
  "Repo sidebar card",
  "Language table",
  "Local cache",
  "Auto-analyze setting",
  "Placement setting",
];

export default function BrowserExtensionSection() {
  return (
    <div className="extension-panel">
      <div className="extension-preview">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcSet="/octocounts-dark-card.webp" />
          <source media="(prefers-color-scheme: light)" srcSet="/octocounts-light-card.webp" />
          <img src="/octocounts-light-card.webp" alt="OctoCounts browser extension showing SLOC results on a GitHub repository" loading="lazy" />
        </picture>
      </div>
      <div className="extension-copy">
        <div className="terminal-label">browser-extension@octocounts</div>
        <h3>{extensionInfo.name}</h3>
        <p>Open a GitHub repository and OctoCounts adds a compact SLOC card to the repo sidebar. Click the card for the full panel with totals, language rows, and cached results.</p>
        <ul className="extension-features">
          {features.map((feature) => <li key={feature}>{feature}</li>)}
        </ul>
        <div className="extension-actions">
          <a className="btn install-btn" href={extensionInfo.chromeWebStoreUrl} target="_blank" rel="noreferrer">
            <ChromeIcon size={15} />
            Install from Chrome Web Store
          </a>
          <a className="copybtn install-btn secondary-install" href={extensionInfo.firefoxAddOnsUrl} target="_blank" rel="noreferrer">
            <FirefoxIcon size={14} />
            Install from Firefox Add-ons
          </a>
          <a className="copybtn" href={defaultRepoUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            View source
          </a>
        </div>
      </div>
    </div>
  );
}
