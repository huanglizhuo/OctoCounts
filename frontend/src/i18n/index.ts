import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "../locales/en.json";
import zh from "../locales/zh.json";

const resources = {
  en: { translation: en },
  zh: { translation: zh },
} as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    detection: {
      order: ["querystring", "localStorage", "navigator"],
      caches: ["localStorage"],
    },
  });

export async function loadLocale(lng: string) {
  if (lng === "en" || i18n.hasResourceBundle(lng, "translation")) return;
  const mod = await import(`../locales/${lng}.json`);
  i18n.addResourceBundle(lng, "translation", mod.default, true, true);
}

export default i18n;
