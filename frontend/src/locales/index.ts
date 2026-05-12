export const supportedLocales = ["en", "zh"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
