// Shared by the app and static articles; no React or application bundle needed.
const AI_REFERRERS = [
  [/(^|\.)chatgpt\.com$|^chat\.openai\.com$/, "chatgpt"],
  [/(^|\.)(perplexity\.ai|pplx\.ai)$/, "perplexity"],
  [/^gemini\.google\.com$/, "gemini"],
  [/^copilot\.microsoft\.com$/, "copilot"],
  [/(^|\.)claude\.ai$/, "claude"],
  [/(^|\.)kimi\.com$/, "kimi"],
];
const SESSION_KEY = "octocounts.ai_visit";
const queuedSources = new Set();
const watchedScripts = new WeakSet();
const pending = [];
let plausibleEnabled = false;

export function aiReferrerSource(referrer) {
  try {
    const hostname = new URL(referrer).hostname.toLowerCase();
    return AI_REFERRERS.find(([host]) => host.test(hostname))?.[1];
  } catch {
    return undefined;
  }
}

function flush() {
  for (const event of pending) {
    for (const provider of [...event.providers]) {
      const send = provider === "umami" ? window.umami?.track?.bind(window.umami) : window.plausible;
      if (!send) continue;
      try {
        const result = send(event.name, provider === "plausible" ? { props: event.props } : event.props);
        // SDK acceptance is measurable here; delivery blocked by the browser is not.
        result?.catch?.(() => {});
        event.providers.delete(provider);
        event.onAccepted?.();
        event.onAccepted = undefined;
      } catch {
        // An unavailable SDK must never interrupt the user's action.
      }
    }
  }
  for (let index = pending.length - 1; index >= 0; index--) {
    if (!pending[index].providers.size) pending.splice(index, 1);
  }
}

function watchScript(script) {
  if (watchedScripts.has(script)) return;
  watchedScripts.add(script);
  script.addEventListener("load", flush);
}

export function initAnalytics({ domain, scriptSrc = "https://plausible.io/js/script.js" } = {}) {
  let umami = document.querySelector('script[data-website-id="4f3a87a4-fd4c-4dc5-8959-8fcf93e858c7"]');
  if (!umami) {
    umami = document.createElement("script");
    umami.defer = true;
    umami.src = "https://cloud.umami.is/script.js";
    umami.dataset.websiteId = "4f3a87a4-fd4c-4dc5-8959-8fcf93e858c7";
    watchScript(umami);
    document.head.appendChild(umami);
  } else watchScript(umami);
  if (domain) {
    plausibleEnabled = true;
    let plausible = document.querySelector("script[data-domain]");
    if (!plausible) {
      plausible = document.createElement("script");
      plausible.defer = true;
      plausible.dataset.domain = domain;
      plausible.src = scriptSrc;
      watchScript(plausible);
      document.head.appendChild(plausible);
    } else watchScript(plausible);
  }
  flush();
}

export function trackEvent(name, props, onAccepted) {
  const providers = new Set(["umami"]);
  if (plausibleEnabled || window.plausible) providers.add("plausible");
  pending.push({ name, props, providers, onAccepted });
  flush();
}

function seenSources() {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (!saved) return [];
    // Preserve the old single-source session marker during rollout.
    if (!saved.startsWith("[")) return [saved];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function trackAiVisitIfReferred() {
  const referrerSource = aiReferrerSource(document.referrer);
  // Known AI referrers take precedence over user-editable campaign tags.
  const source = referrerSource || (new URLSearchParams(window.location.search).get("utm_source") === "chatgpt.com" ? "chatgpt" : undefined);
  if (!source || queuedSources.has(source) || seenSources().includes(source)) return;
  queuedSources.add(source);
  const path = window.location.pathname;
  trackEvent("ai_visit", { source, path, attribution: referrerSource ? "referrer" : "utm" }, () => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify([...new Set([...seenSources(), source])]));
    } catch {
      // Storage-blocked browsers deduplicate within this page's lifetime only.
    }
  });
}
