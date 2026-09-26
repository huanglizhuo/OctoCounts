import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "../locales/en.json";

// English is bundled (default UI language); Chinese is a lazy chunk so English
// visitors never download it. `ready` resolves from i18next's init callback —
// AFTER language detection has settled — plus the detected language's bundle,
// so main.tsx's first render (and, on the prerendered home, the hydration
// render) always runs with the final language and its translations in place.
// Resolving on the first languageChanged event instead was racy: init can emit
// a transient language before detection finishes, letting a render start in
// one language and flip mid-render.
export const ready = new Promise<void>((resolve) => {
  i18n.use(LanguageDetector).use(initReactI18next).init(
    {
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
      // below i18next emits that *synchronously* — `resources` is inline and
      // there is no backend plugin or `partialBundledLanguages`, so `loadResources`
      // has nothing to await and calls back at once, before the lazy zh chunk above
      // has resolved. Every `t()` in that render falls back to English. The chunk
      // then lands and
      // `addResourceBundle` emits `added` on the resource store, which
      // react-i18next does not listen to by default, so nothing repaints and
      // the fallback render is the one the visitor keeps until an unrelated state
      // change happens to schedule one.
      //
      // The first-load path never showed this because main.tsx awaits `ready`
      // before mounting, so the bundle is already in place by the first render.
      // Only the in-page switch was broken, which is why it survived: the
      // language persists to localStorage, so a reload looks correct and hides it.
      react: { bindI18nStore: "added" },
    },
    () => {
      void loadBundle(i18n.language).then(resolve).catch(resolve);
    },
  );
});

async function loadBundle(language: string) {
  if (language === "zh" && !i18n.hasResourceBundle("zh", "translation")) {
    const zh = await import("../locales/zh.json");
    i18n.addResourceBundle("zh", "translation", zh.default, true, true);
  }
}

// The bundle-loading half of the old listener stays (language switches in a
// running page still need their chunk); it no longer resolves `ready`.
i18n.on("languageChanged", (language) => {
  void loadBundle(language).catch(() => {});
});

/**
 * Switch to `language` and resolve once the language is active AND its bundle
 * is in place — the guarantee a deterministic first render needs (the zh bundle
 * is a lazy chunk; changeLanguage alone fires languageChanged before the chunk
 * lands). Used by main.tsx around homepage hydration and by the build-time
 * prerender to pin the rendered locale.
 */
export function setLanguageForRender(language: "en" | "zh"): Promise<void> {
  return new Promise((resolve) => {
    void loadBundle(language)
      .then(async () => {
        if (i18n.language === language) return;
        await new Promise<void>((settled) => {
          i18n.once("languageChanged", () => settled());
          void i18n.changeLanguage(language);
        });
      })
      .catch(() => {})
      .finally(resolve);
  });
}

export default i18n;
