#!/usr/bin/env node
// One-off helper: obtains a long-lived refresh token for the Chrome Web
// Store Publish API. Run it once per OAuth client; the printed refresh token
// goes into the CHROME_REFRESH_TOKEN GitHub secret.
//
// Prereq: a Google Cloud OAuth client of type "Web application" whose
// authorized redirect URIs include http://localhost:8765 and with the
// Chrome Web Store API enabled in the same project.
//
// Usage:
//   node scripts/get-chrome-refresh-token.mjs <client_id> <client_secret>
// (Or set CHROME_CLIENT_ID / CHROME_CLIENT_SECRET and run with no args.)

import { createServer } from "node:http";

const clientId = process.argv[2] ?? process.env.CHROME_CLIENT_ID;
const clientSecret = process.argv[3] ?? process.env.CHROME_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("usage: node scripts/get-chrome-refresh-token.mjs <client_id> <client_secret>");
  process.exit(1);
}

const PORT = 8765;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("access_type", "offline"); // ask for a refresh token
authUrl.searchParams.set("prompt", "consent"); // even if previously granted
authUrl.searchParams.set("scope", SCOPE);

const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const error = url.searchParams.get("error");
    const c = url.searchParams.get("code");
    if (!error && !c) return; // favicon etc.
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(error ? "Authorization failed — you can close this tab." : "Authorized — you can close this tab.");
    server.close();
    if (error) reject(new Error(`Google returned error: ${error}`));
    else resolve(c);
  });
  server.on("error", reject);
  server.listen(PORT, () => {
    console.log("Waiting for authorization...");
    console.log("");
    console.log(`  1. Open this URL in your browser (as the account that owns the store listing):`);
    console.log("");
    console.log(`  ${authUrl.toString()}`);
    console.log("");
    console.log(`  2. Approve the Chrome Web Store access request.`);
    console.log("");
  });
  setTimeout(() => {
    server.close();
    reject(new Error("timed out after 5 minutes waiting for the callback"));
  }, 5 * 60_000).unref();
});

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  }),
});

if (!tokenResponse.ok) {
  console.error(await tokenResponse.text());
  process.exit(1);
}
const tokens = await tokenResponse.json();

if (!tokens.refresh_token) {
  // Google only returns a refresh token on first consent; re-run after
  // revoking at https://security.google.com/settings/security/permissions
  console.error("No refresh_token in the response (access token only).");
  console.error("Revoke the app at https://myaccount.google.com/connections, then re-run.");
  process.exit(1);
}

console.log("refresh_token (store as GitHub secret CHROME_REFRESH_TOKEN):");
console.log("");
console.log(`  ${tokens.refresh_token}`);
console.log("");
console.log("Keep it secret; it does not expire unless you revoke it.");
