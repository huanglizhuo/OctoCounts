const DARK_COLORS  = ['#3fb950','#58a6ff','#d29922','#79c0ff','#d2a8ff','#f85149'];
const LIGHT_COLORS = ['#1a7f37','#0969da','#9a6700','#0550ae','#6639ba','#d1242f'];

export function languageColor(name, theme = 'dark') {
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
