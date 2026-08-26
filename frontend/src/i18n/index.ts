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
    // Without this, switching to Chinese in a running page left the entire UI in
    // English until something else forced a re-render — in practice, until a
    // reload. react-i18next re-renders on `languageChanged`, and with the config
    // below i18next emits that *synchronously* — `resources` is inline and there
    // is no backend plugin or `partialBundledLanguages`, so `loadResources` has
    // nothing to await and calls back at once, before the lazy zh chunk above
    // has resolved. Every `t()` in that render falls back to English. The chunk
    // then lands and
    // `addResourceBundle` emits `added` on the resource store, which
    // react-i18next does not listen to by default, so nothing repaints and the
    // fallback render is the one the visitor keeps until an unrelated state
    // change happens to schedule one.
    //
    // The first-load path never showed this because main.tsx awaits `ready`
    // before mounting, so the bundle is already in place by the first render.
    // Only the in-page switch was broken, which is why it survived: the
    // language persists to localStorage, so a reload looks correct and hides it.
    react: { bindI18nStore: "added" },
  });

export default i18n;
