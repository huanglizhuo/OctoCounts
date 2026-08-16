import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "../locales/en.json";

// English is bundled (default UI language); Chinese is a lazy chunk so English
// visitors never download it. `ready` resolves after any needed bundle is in
// place — main.tsx waits on it before the first render so zh users never see
// an English flash.
let markReady: () => void = () => {};
export const ready = new Promise<void>((resolve) => {
  markReady = resolve;
});

async function loadBundle(language: string) {
  if (language === "zh" && !i18n.hasResourceBundle("zh", "translation")) {
    const zh = await import("../locales/zh.json");
    i18n.addResourceBundle("zh", "translation", zh.default, true, true);
  }
}

i18n.on("languageChanged", (language) => {
  void loadBundle(language).then(markReady).catch(markReady);
});

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    fallbackLng: "en",
    supportedLngs: ["en", "zh"],
    interpolation: { escapeValue: false },
    detection: {
      order: ["querystring", "localStorage", "navigator"],
      caches: ["localStorage"],
    },
  });

export default i18n;
