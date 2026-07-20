import type { Scheme } from "./types";

type Rgb = [number, number, number];

// This is intentionally lighter than the computed Matrix panel color so the
// adjusted language colors keep at least 3:1 contrast on every dark surface.
const MATRIX_SURFACE_RGB: Rgb = [20, 27, 23];
export const MIN_GRAPHIC_CONTRAST = 3.2;

export function visibleLanguageColor(color: string, scheme: Scheme): string {
  if (scheme !== "matrix") return color;
  const rgb = parseHexColor(color);
  if (!rgb || contrastRatio(rgb, MATRIX_SURFACE_RGB) >= MIN_GRAPHIC_CONTRAST) return color;
  const [h, s, l] = rgbToHsl(rgb);
  let low = l;
  let high = 1;
  for (let i = 0; i < 18; i += 1) {
    const mid = (low + high) / 2;
    if (contrastRatio(hslToRgb(h, s, mid), MATRIX_SURFACE_RGB) >= MIN_GRAPHIC_CONTRAST) high = mid;
    else low = mid;
  }
  return rgbToHex(hslToRgb(h, s, high));
}

export function contrastRatio(left: Rgb, right: Rgb) {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

export function parseHexColor(color: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function relativeLuminance([r, g, b]: Rgb) {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === rn) hue = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) hue = ((bn - rn) / delta + 2) * 60;
  else hue = ((rn - gn) / delta + 4) * 60;
  return [hue, saturation, lightness];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = h / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const [rn, gn, bn] =
    segment < 1 ? [chroma, x, 0]
      : segment < 2 ? [x, chroma, 0]
        : segment < 3 ? [0, chroma, x]
          : segment < 4 ? [0, x, chroma]
            : segment < 5 ? [x, 0, chroma]
              : [chroma, 0, x];
  const offset = l - chroma / 2;
  return [rn, gn, bn].map((value) => Math.round((value + offset) * 255)) as Rgb;
}

function rgbToHex(rgb: Rgb): string {
  const toHex = (value: number) => value.toString(16).padStart(2, "0");
  return `#${rgb.map(toHex).join("")}`;
}
