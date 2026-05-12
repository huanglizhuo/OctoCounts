import en from '../locales/en.json';
import zh from '../locales/zh.json';

const dictionaries = { en, zh };

function detectLocale() {
  if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
    const ui = chrome.i18n.getUILanguage();
    if (ui) return normalizeLocale(ui);
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    return normalizeLocale(navigator.language);
  }
  return 'en';
}

function normalizeLocale(raw) {
  const base = raw.toLowerCase().split('-')[0];
  if (dictionaries[base]) return base;
  return 'en';
}

const currentLocale = detectLocale();
const dict = dictionaries[currentLocale] || dictionaries.en;

export function t(key, vars = {}) {
  let value = key.split('.').reduce((obj, k) => obj?.[k], dict);
  if (typeof value !== 'string') return key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    return vars[name] !== undefined ? String(vars[name]) : `{{${name}}}`;
  });
}

export function plural(keySingular, keyPlural, n, vars = {}) {
  const k = n === 1 ? keySingular : keyPlural;
  return t(k, { ...vars, count: n });
}

export { currentLocale };
