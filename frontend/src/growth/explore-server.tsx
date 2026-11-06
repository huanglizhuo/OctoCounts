import { renderToString } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SchemeProvider } from "../scheme";
import en from "../locales/en.json";
import zh from "../locales/zh.json";
import { ExploreApp } from "./ExploreApp";
import type { ExploreBootstrap } from "./ExploreContext";

export async function renderExplore(bootstrap: ExploreBootstrap) {
  // Locale and query state belong to this request, never to the shared Worker isolate.
  const i18n = createInstance();
  await i18n.init({ lng: bootstrap.locale, fallbackLng: "en", resources: { en: { translation: en }, zh: { translation: zh } }, interpolation: { escapeValue: false } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    return renderToString(<I18nextProvider i18n={i18n}>
      <SchemeProvider hydrating><QueryClientProvider client={queryClient}>
        <ExploreApp bootstrap={bootstrap} />
      </QueryClientProvider></SchemeProvider>
    </I18nextProvider>);
  } finally { queryClient.clear(); }
}

export { validateExploreList, validateExploreStats } from "./exploreData";
