import React from "react";
import { AnalyticsEvents, trackEvent } from "./analytics";
import { extensionInfo } from "./constants";
import { ChromeIcon, EdgeIcon, FirefoxIcon } from "./icons";

// Single builder for extension store links: href + tracking + noreferrer in one place.
export function StoreLink({ store, placement, size = 15, className, children }: { store: "chrome" | "edge" | "firefox"; placement: string; size?: number; className?: string; children?: React.ReactNode }) {
  const href = store === "chrome" ? extensionInfo.chromeWebStoreUrl : store === "edge" ? extensionInfo.edgeAddOnsUrl : extensionInfo.firefoxAddOnsUrl;
  const Icon = store === "chrome" ? ChromeIcon : store === "edge" ? EdgeIcon : FirefoxIcon;
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer" onClick={() => trackEvent(AnalyticsEvents.extensionStoreClick, { store, placement })}>
      <Icon size={size} aria-hidden="true" />
      {children}
    </a>
  );
}
