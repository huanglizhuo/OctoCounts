document.documentElement.dataset.scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "matrix" : "paper";

try {
  const params = new URLSearchParams(window.location.search);
  const language = params.get("lng") || localStorage.getItem("i18nextLng") || navigator.language.split("-")[0];
  if (language && language !== "en") document.documentElement.lang = language;
} catch {
  // Storage can be unavailable in private browsing; English remains the fallback.
}
