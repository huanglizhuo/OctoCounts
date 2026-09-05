import { exchangeGithubCode } from './api.js';

// OAuth client IDs are public by design (they identify the app, not a
// secret) — safe to ship in the bundle. This is a dedicated extension-only
// GitHub OAuth App, distinct from any web-facing one, because
// chrome.identity's redirect URL is fixed to this extension's own
// https://<id>.chromiumapp.org/ address.
export const GITHUB_EXTENSION_CLIENT_ID = 'Ov23liY7HsMdrzErq8Qv';

const STORAGE_KEYS = { login: 'githubLogin', token: 'githubToken' };

// chrome.identity is unavailable on Firefox's `browser.*` namespace in a
// stable enough shape to trust here (its equivalent redirect UUID is not
// guaranteed stable across installs), so login is Chrome/Edge-only for now —
// callers should hide the entry point entirely when this is false rather
// than let launchWebAuthFlow fail at click time.
export function isLoginSupported() {
  return typeof chrome !== 'undefined' && typeof chrome.identity?.launchWebAuthFlow === 'function';
}

function randomState() {
  return crypto.randomUUID();
}

export async function loginWithGithub() {
  if (!isLoginSupported()) {
    throw new Error('GitHub login is not supported in this browser');
  }
  const redirectUri = chrome.identity.getRedirectURL();
  const state = randomState();
  const authorizeUrl = `https://github.com/login/oauth/authorize?${new URLSearchParams({
    client_id: GITHUB_EXTENSION_CLIENT_ID,
    scope: 'public_repo',
    state,
    redirect_uri: redirectUri,
  })}`;

  const resultUrl = await chrome.identity.launchWebAuthFlow({ url: authorizeUrl, interactive: true });
  if (!resultUrl) {
    throw new Error('GitHub login was cancelled');
  }
  const params = new URL(resultUrl).searchParams;
  if (params.get('error')) {
    throw new Error(`GitHub login failed: ${params.get('error')}`);
  }
  if (params.get('state') !== state) {
    throw new Error('GitHub login failed: state mismatch');
  }
  const code = params.get('code');
  if (!code) {
    throw new Error('GitHub login failed: no authorization code returned');
  }

  const { login, token } = await exchangeGithubCode(code, redirectUri);
  await chrome.storage.local.set({ [STORAGE_KEYS.login]: login, [STORAGE_KEYS.token]: token });
  return { login };
}

export async function logout() {
  await chrome.storage.local.remove([STORAGE_KEYS.login, STORAGE_KEYS.token]);
}

// `{ loggedIn, login }` — deliberately never returns the token itself; only
// the background service worker (via getStoredToken) ever reads it back out.
export async function getAuthState() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.login, STORAGE_KEYS.token]);
  const login = stored[STORAGE_KEYS.login];
  const token = stored[STORAGE_KEYS.token];
  return { loggedIn: Boolean(login && token), login: login ?? null };
}

export async function getStoredToken() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.token]);
  return stored[STORAGE_KEYS.token] ?? null;
}
