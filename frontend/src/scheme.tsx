import React, { createContext, useContext, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Scheme } from "./types";

// Theme persistence. The inline <script> in index.html sets
// html[data-scheme] before first paint to avoid a flash; this module is the
// React-side source of truth once the app mounts.

const THEME_KEY = "octocounts.theme";

export function systemScheme(): Scheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "matrix" : "paper";
}

function readStoredScheme(): Scheme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "matrix" || value === "paper" ? value : null;
  } catch {
    return null;
  }
}

export function preferredScheme(): Scheme {
  return readStoredScheme() ?? systemScheme();
}

function persistScheme(scheme: Scheme) {
  try {
    localStorage.setItem(THEME_KEY, scheme);
  } catch {
    /* storage unavailable — theme still applies for the current page */
  }
}

const SchemeContext = createContext<{ scheme: Scheme; setScheme: (scheme: Scheme) => void }>({
  scheme: "matrix",
  setScheme: () => {},
});

// Single owner of the scheme state and the html[data-scheme] / document.lang
// side effects. Mount ONCE at the root: the previous per-component useScheme()
// hung a MutationObserver on <html> from every table row (260+ observers on a
// large report).
export function SchemeProvider({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation();
  const [scheme, setScheme] = useState<Scheme>(() => preferredScheme());

  useEffect(() => {
    document.documentElement.dataset.scheme = scheme;
    persistScheme(scheme);
  }, [scheme]);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  return <SchemeContext.Provider value={{ scheme, setScheme }}>{children}</SchemeContext.Provider>;
}

export function useSchemeToggle() {
  return useContext(SchemeContext);
}

export function useScheme(): Scheme {
  return useContext(SchemeContext).scheme;
}

export function ThemeSwitch() {
  const { t } = useTranslation();
  const { scheme, setScheme } = useSchemeToggle();
  const isNight = scheme === "matrix";
  const label = t(isNight ? "theme.switchToDay" : "theme.switchToNight");
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={() => setScheme(isNight ? "paper" : "matrix")}
      aria-label={label}
      aria-pressed={isNight}
      title={label}
    >
      {isNight ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
      <span className="visually-hidden">{label}</span>
    </button>
  );
}
