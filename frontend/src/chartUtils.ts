import i18n from "./i18n";
import type { LanguageReport, PieItem } from "./types";
import { languageColor } from "./reportUtils";

export function languagePieItems(languages: LanguageReport[]): PieItem[] {
  const sorted = [...languages].filter((language) => language.stats.lines > 0).sort((a, b) => b.stats.lines - a.stats.lines);
  const visible = sorted.slice(0, 5).map((language) => ({
    label: language.name,
    value: language.stats.lines,
    color: languageColor(language.name),
  }));
  const other = sorted.slice(5).reduce((sum, language) => sum + language.stats.lines, 0);
  if (other > 0) visible.push({ label: i18n.t("charts.other"), value: other, color: "var(--fg-mute)" });
  return visible.length > 0 ? visible : [{ label: i18n.t("charts.noData"), value: 0, color: "var(--fg-mute)" }];
}

export function pieSlices(items: PieItem[]) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let start = 0;
  return items.map((item) => {
    const fraction = total > 0 ? item.value / total : 0;
    const end = start + fraction;
    const path = donutSlicePath(start, end);
    start = end;
    return { ...item, path };
  });
}

function donutSlicePath(startFraction: number, endFraction: number) {
  if (endFraction - startFraction >= 0.9999) {
    return "M 1 0 A 1 1 0 1 1 -1 0 A 1 1 0 1 1 1 0";
  }
  const start = polarPoint(startFraction);
  const end = polarPoint(endFraction);
  const largeArc = endFraction - startFraction > 0.5 ? 1 : 0;
  return `M 0 0 L ${start.x} ${start.y} A 1 1 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function polarPoint(fraction: number) {
  const angle = fraction * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
