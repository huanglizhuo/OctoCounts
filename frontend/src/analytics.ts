type AnalyticsProps = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    plausible?: (eventName: string, options?: { props?: AnalyticsProps }) => void;
    umami?: {
      track: (eventName: string, eventData?: AnalyticsProps) => void;
    };
  }
}

const domain = import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined;
const scriptSrc = (import.meta.env.VITE_PLAUSIBLE_SRC as string | undefined) ?? "https://plausible.io/js/script.js";

export const AnalyticsEvents = {
  analyzeSubmitted: "analyze_submitted",
  analyzeCompleted: "analyze_completed",
  badgeMarkdownCopied: "badge_markdown_copied",
  embedSnippetCopied: "embed_snippet_copied",
  pngExported: "png_exported",
  growthPlayed: "growth_played",
  growthLoopToggled: "growth_loop_toggled",
  growthGifExported: "growth_gif_exported",
  growthWebmExported: "growth_webm_exported",
  growthPngExported: "growth_png_exported",
  growthExportCancelled: "growth_export_cancelled",
  extensionStoreClick: "extension_store_click",
  reportUrlCopied: "report_url_copied",
  shareClicked: "share_clicked",
  aiVisit: "ai_visit",
} as const;

type AnalyticsRuntime = {
  initAnalytics: (options: { domain?: string; scriptSrc?: string }) => void;
  trackAiVisitIfReferred: () => void;
  trackEvent: (eventName: string, props?: AnalyticsProps) => void;
};

const runtimeUrl = "/analytics-runtime.js";
function runtime(): Promise<AnalyticsRuntime> {
  return import(/* @vite-ignore */ new URL(runtimeUrl, window.location.origin).href);
}

export function trackAiVisitIfReferred() {
  void runtime().then((analytics) => analytics.trackAiVisitIfReferred()).catch(() => {});
}

export function initAnalytics() {
  if (typeof document === "undefined") return;
  void runtime().then((analytics) => analytics.initAnalytics({ domain, scriptSrc })).catch(() => {});
}

export function trackEvent(eventName: string, props?: AnalyticsProps) {
  void runtime().then((analytics) => analytics.trackEvent(eventName, props)).catch(() => {});
}

export function providerFromRepoUrl(repoUrl: string) {
  try {
    const normalized = repoUrl.trim().startsWith("git@github.com:")
      ? repoUrl.trim().replace("git@github.com:", "https://github.com/")
      : repoUrl.trim();
    const hostname = new URL(normalized).hostname;
    if (hostname === "github.com") return "github";
  } catch {
    return "unknown";
  }
  return "unknown";
}
