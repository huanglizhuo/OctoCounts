import { Share2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { AnalyticsEvents, trackEvent } from "./analytics";

// One-click share row (X / Reddit / Hacker News, plus the native Web Share
// sheet where the browser offers it). Shared by the report page and the
// compare/diff results; `placement` tells the placements apart in analytics.
export function ShareButtons({ url, text, placement }: { url: string; text: string; placement: string }) {
  const { t } = useTranslation();
  const targets = [
    { key: "x", href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}` },
    { key: "reddit", href: `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}` },
    { key: "hackernews", href: `https://news.ycombinator.com/submitlink?u=${encodeURIComponent(url)}&t=${encodeURIComponent(text)}` },
  ];
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className="share-buttons" role="group" aria-label={t("share.ariaLabel")}>
      <span className="share-buttons-label">{t("share.label")}</span>
      {targets.map((target) => (
        <a
          key={target.key}
          className="copybtn"
          href={target.href}
          target="_blank"
          rel="noopener"
          onClick={() => trackEvent(AnalyticsEvents.shareClicked, { share_type: target.key, placement })}
        >
          {t(`share.${target.key}`)}
        </a>
      ))}
      {canNativeShare ? (
        <button
          className="copybtn"
          type="button"
          onClick={() => {
            trackEvent(AnalyticsEvents.shareClicked, { share_type: "native", placement });
            // User-cancelled shares reject the promise; that is not an error.
            navigator.share({ title: text, url }).catch(() => {});
          }}
        >
          <Share2 size={14} />
          {t("share.native")}
        </button>
      ) : null}
    </div>
  );
}
