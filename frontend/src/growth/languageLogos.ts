import {
  siC, siCplusplus, siCss, siDart, siDocker, siElixir, siErlang,
  siFsharp, siGnubash, siGo, siHaskell, siHtml5, siJavascript,
  siJson, siJulia, siKotlin, siMarkdown, siOpenjdk,
  siPhp, siPython, siR, siReact, siRuby, siRust, siScala, siSvelte,
  siToml, siTypescript, siVuedotjs, siYaml, siZig,
} from "simple-icons";

const icons: Record<string, string> = {
  C: siC.path,
  "C++": siCplusplus.path,
  CSS: siCss.path,
  Dart: siDart.path,
  Dockerfile: siDocker.path,
  Elixir: siElixir.path,
  Erlang: siErlang.path,
  "F#": siFsharp.path,
  Go: siGo.path,
  Haskell: siHaskell.path,
  HTML: siHtml5.path,
  Java: siOpenjdk.path,
  JavaScript: siJavascript.path,
  JSON: siJson.path,
  JSX: siReact.path,
  Julia: siJulia.path,
  Kotlin: siKotlin.path,
  Markdown: siMarkdown.path,
  PHP: siPhp.path,
  Python: siPython.path,
  R: siR.path,
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

export function languageLogo(name: string, roofColor: string): { path: string; color: string } | undefined {
  const icon = Object.prototype.hasOwnProperty.call(icons, name) ? icons[name] : undefined;
  if (!icon) return undefined;
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(roofColor.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return { path: icon, color: luminance > 0.179 ? "#000000" : "#ffffff" };
}
