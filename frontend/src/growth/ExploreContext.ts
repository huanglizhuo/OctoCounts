import { createContext } from "react";

export type ExploreBootstrap = {
  pathname: string;
  search: string;
  now: number;
  locale: "en" | "zh";
  seeds: Record<string, unknown>;
};

export const ExploreContext = createContext<Omit<ExploreBootstrap, "locale">>({ pathname: "", search: "", now: 0, seeds: {} });

export function exploreHref(path: string, locale: string) {
  if (locale !== "zh") return path;
  return `${path}${path.includes("?") ? "&" : "?"}lng=zh`;
}
