// Bumped by scripts/refresh-llms-lastupdated.mjs on every push to main that
// touches frontend content, in step with index.html's dateModified and the
// noscript freshness line.
export const siteLastUpdated = "2026-09-17";

export const sourceRepoUrl = "https://github.com/huanglizhuo/OctoCounts";

// Homepage demo seed repository. Regenerate src/initialReport.json and the
// pinned ref with scripts/refresh-demo-seed.mjs (repo root).
export const defaultRepoUrl = "https://github.com/facebook/react";
export const defaultRefName = "v19.3.0";
export const extensionInfo = {
  name: "OctoCounts – GitHub SLOC & Code Statistics",
  chromeWebStoreUrl: "https://chromewebstore.google.com/detail/octocounts-%E2%80%94-github-sloc/gkgjpjdnaklagijmekoolhcpebmoldbj",
  edgeAddOnsUrl: "https://microsoftedge.microsoft.com/addons/detail/octocounts-%E2%80%93-github-sloc-/ehifednhpbpekkadndaipnngopbhpoim",
  firefoxAddOnsUrl: "https://addons.mozilla.org/en-US/firefox/addon/octocounts-github-sloc/",
  // Live Chrome Web Store listing figures, read off the store page by hand.
  // Refresh when they move; Edge/Firefox are not shown (2 users / 0 reviews).
  chromeRating: { score: "5.0", ratings: 2, users: 169, asOf: "2026-10-03" },
};
