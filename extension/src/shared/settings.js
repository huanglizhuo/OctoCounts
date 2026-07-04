// Single source of truth for user settings stored in chrome.storage.sync.
// Both the background service worker and the popup read/write through here so
// defaults can never drift between the two.
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_SETTINGS = {
  cardPlacement: 'top',
  cacheTtlMs: DEFAULT_TTL_MS,
  replaceGhLanguages: true,
  silentUntilSuccess: false,
  skipForks: true,
  cardTitle: '',
};

export async function getSettings() {
  return chrome.storage.sync.get(DEFAULT_SETTINGS);
}
