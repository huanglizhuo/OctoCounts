import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { onRequest } from "../functions/[[path]].js";

for (const attribution of ["referrer", "utm"]) {
test(`a static article records its ${attribution} AI landing after a delayed SDK loads under the production CSP`, async ({ page }) => {
  let releaseSdk!: () => void;
  const sdkReady = new Promise<void>((resolve) => { releaseSdk = resolve; });
  await page.route("https://cloud.umami.is/script.js", async (route) => {
    await sdkReady;
    await route.fulfill({ contentType: "application/javascript", body: "window.analyticsEvents=[];window.umami={track:(name,props)=>window.analyticsEvents.push({name,props})};" });
  });
  await page.route("**/docs/methodology*", async (route) => {
    const request = new Request(route.request().url());
    const html = await readFile(new URL("../public/docs/methodology.html", import.meta.url), "utf8");
    const response = await onRequest({ request, env: { ASSETS: { fetch: async () => new Response(html, { headers: { "content-type": "text/html" } }) } } });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  await page.goto(`/docs/methodology${attribution === "utm" ? "?utm_source=chatgpt.com" : ""}`, { ...(attribution === "referrer" ? { referer: "https://chatgpt.com/" } : {}), waitUntil: "domcontentloaded" });
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://octocounts.com/docs/methodology");
  await expect(page.locator('script[src="/analytics.js"]')).toHaveCount(1);
  await expect(page.locator('script[data-website-id]')).toHaveCount(1);
  expect(await page.evaluate(() => sessionStorage.getItem("octocounts.ai_visit"))).toBeNull();
  releaseSdk();
  await expect.poll(() => page.evaluate(() => (window as any).analyticsEvents)).toEqual([
    { name: "ai_visit", props: { source: "chatgpt", path: "/docs/methodology", attribution } },
  ]);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("octocounts.ai_visit")!))).toEqual(["chatgpt"]);
});
}
