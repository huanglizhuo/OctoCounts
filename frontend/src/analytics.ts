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
  pngExported: "png_exported",
  extensionStoreClick: "extension_store_click",
  reportUrlCopied: "report_url_copied",
  shareClicked: "share_clicked",
  aiVisit: "ai_visit",
} as const;

// Answer-engine referrers we want to measure GEO outcomes for: which report
// pages actually get visited from AI search results.
const AI_REFERRER_HOSTS: Array<{ host: RegExp; source: string }> = [
  { host: /(^|\.)chatgpt\.com$/, source: "chatgpt" },
  { host: /(^|\.)openai\.com$/, source: "chatgpt" },
  { host: /(^|\.)perplexity\.ai$/, source: "perplexity" },
  { host: /(^|\.)pplx\.ai$/, source: "perplexity" },
  { host: /(^|\.)gemini\.google\.com$/, source: "gemini" },
  { host: /(^|\.)copilot\.microsoft\.com$/, source: "copilot" },
  { host: /(^|\.)claude\.ai$/, source: "claude" },
  { host: /(^|\.)kimi\.com$/, source: "kimi" },
];

export function aiReferrerSource(referrer: string | undefined): string | undefined {
  if (!referrer) return undefined;
  try {
    const hostname = new URL(referrer).hostname.toLowerCase();
    return AI_REFERRER_HOSTS.find((entry) => entry.host.test(hostname))?.source;
  } catch {
    return undefined;
  }
}

export function trackAiVisitIfReferred() {
  if (typeof document === "undefined") return;
  const source = aiReferrerSource(document.referrer);
  if (!source || sessionStorage.getItem("octocounts.ai_visit") === source) return;
  sessionStorage.setItem("octocounts.ai_visit", source);
  trackEvent(AnalyticsEvents.aiVisit, { source, path: window.location.pathname });
}

export function initAnalytics() {
  if (!domain || typeof document === "undefined" || document.querySelector("script[data-domain][src*='plausible']")) {
    return;
  }
  const script = document.createElement("script");
  script.defer = true;
  script.dataset.domain = domain;
  script.src = scriptSrc;
  document.head.appendChild(script);
}

export function trackEvent(eventName: string, props?: AnalyticsProps) {
  window.plausible?.(eventName, props ? { props } : undefined);
  window.umami?.track(eventName, props);
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
