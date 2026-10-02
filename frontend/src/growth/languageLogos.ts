// Icon set trimmed to languages that actually appear in reports — the six
// dropped entries (Erlang, Elixir, F#, Julia, R, Haskell) were ~15% of the
// growth chunk for near-zero coverage. Their buildings render name+LOC only,
// and the hover detail still shows full stats.
import {
  siC, siCplusplus, siCss, siDart, siDocker, siGnubash, siGo,
  siHtml5, siJavascript, siJson, siKotlin, siMarkdown, siOpenjdk,
  siPhp, siPython, siReact, siRuby, siRust, siScala, siSvelte,
  siToml, siTypescript, siVuedotjs, siYaml, siZig,
} from "simple-icons";

const icons: Record<string, string> = {
  C: siC.path,
  "C++": siCplusplus.path,
  CSS: siCss.path,
  Dart: siDart.path,
  Dockerfile: siDocker.path,
  Go: siGo.path,
  HTML: siHtml5.path,
  Java: siOpenjdk.path,
  JavaScript: siJavascript.path,
  JSON: siJson.path,
  JSX: siReact.path,
  Kotlin: siKotlin.path,
  Markdown: siMarkdown.path,
  PHP: siPhp.path,
  Python: siPython.path,
  Ruby: siRuby.path,
  Rust: siRust.path,
  Scala: siScala.path,
  Shell: siGnubash.path,
  Bash: siGnubash.path,
  Svelte: siSvelte.path,
  TOML: siToml.path,
  TSX: siReact.path,
  TypeScript: siTypescript.path,
  Vue: siVuedotjs.path,
  YAML: siYaml.path,
  Zig: siZig.path,
};

export function roofTextColors(roofColor: string): { color: string; textColor: string; valueColor: string } {
  const rgb = /^#([0-9a-f]{6})$/i.exec(roofColor);
  const channels = rgb
    ? [0, 2, 4].map((i) => {
        const c = parseInt(rgb[1].slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
    : [0, 0, 0];
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  const light = luminance > 0.179;
  return {
    color: light ? "#000000" : "#ffffff",
    // Name and LOC read on the roof itself; both follow the roof's contrast.
    textColor: light ? "#111111" : "#f8f8f8",
    valueColor: light ? "#2f3337" : "#d7dce2",
  };
}

export function languageLogo(
  name: string,
  roofColor: string,
): { path: string; color: string; textColor: string; valueColor: string } | undefined {
  const icon = Object.prototype.hasOwnProperty.call(icons, name) ? icons[name] : undefined;
  if (!icon) return undefined;
  return { path: icon, ...roofTextColors(roofColor) };
}
