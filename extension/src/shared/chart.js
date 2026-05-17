const LANGUAGE_COLORS = {
  rust: '#CE422B',
  python: '#3572A5',
  javascript: '#F1E05A',
  typescript: '#3178C6',
  go: '#00ADD8',
  ruby: '#701516',
  java: '#B07219',
  c: '#555555',
  'c++': '#F34B7D',
  'c#': '#239120',
  swift: '#F05138',
  kotlin: '#7F52FF',
  scala: '#DC322F',
  php: '#4F5D95',
  html: '#E34C26',
  css: '#563D7C',
  shell: '#89E051',
  r: '#198CE7',
  dart: '#00B4AB',
  lua: '#000080',
  haskell: '#5E5086',
  elixir: '#6E4A7E',
  clojure: '#DB5855',
  perl: '#0298C3',
  vue: '#41B883',
  svelte: '#FF3E00',
  zig: '#EC915C',
  nix: '#7E7EFF',
  ocaml: '#3BE133',
  groovy: '#4298B8',
  powershell: '#012456',
  makefile: '#427819',
  dockerfile: '#384D54',
  json: '#292929',
  yaml: '#CB171E',
  toml: '#9C4221',
  markdown: '#083FA1',
  tex: '#3D6117',
};

const DARK_COLORS  = ['#3fb950','#58a6ff','#d29922','#79c0ff','#d2a8ff','#f85149'];
const LIGHT_COLORS = ['#1a7f37','#0969da','#9a6700','#0550ae','#6639ba','#d1242f'];

export function languageColor(name, theme = 'dark') {
  const canonical = LANGUAGE_COLORS[name.toLowerCase()];
  if (canonical) return canonical;
  const palette = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const hash = [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

function polarPoint(fraction) {
  const angle = fraction * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function donutSlicePath(start, end) {
  if (end - start >= 0.9999) {
    return 'M 1 0 A 1 1 0 1 1 -1 0 A 1 1 0 1 1 1 0';
  }
  const s = polarPoint(start);
  const e = polarPoint(end);
  const largeArc = end - start > 0.5 ? 1 : 0;
  return `M 0 0 L ${s.x} ${s.y} A 1 1 0 ${largeArc} 1 ${e.x} ${e.y} Z`;
}

export function pieSlices(items) {
  const total = items.reduce((s, i) => s + i.value, 0);
  let start = 0;
  return items.map(item => {
    const fraction = total > 0 ? item.value / total : 0;
    const end = start + fraction;
    const path = donutSlicePath(start, end);
    start = end;
    return { ...item, path };
  });
}

export function buildPieItems(report, theme, n = 5) {
  const sorted = [...report.languages].sort((a, b) => b.stats.lines - a.stats.lines);
  const top = sorted.slice(0, n);
  const otherLines = sorted.slice(n).reduce((s, l) => s + l.stats.lines, 0);
  const items = top.map(l => ({
    label: l.name,
    value: l.stats.lines,
    color: languageColor(l.name, theme),
  }));
  if (otherLines > 0) items.push({ label: 'Other', value: otherLines, color: '#8b949e' });
  return pieSlices(items);
}

// Like buildPieItems but sorts/values by code lines (no comments/blanks), used by card bar/donut
export function buildBarItems(report, theme, n = 5) {
  const sorted = [...report.languages].sort((a, b) => b.stats.code - a.stats.code);
  const top = sorted.slice(0, n);
  const otherCode = sorted.slice(n).reduce((s, l) => s + l.stats.code, 0);
  const items = top.map(l => ({
    label: l.name,
    value: l.stats.code,
    color: languageColor(l.name, theme),
  }));
  if (otherCode > 0) items.push({ label: 'Other', value: otherCode, color: '#8b949e' });
  return items;
}
