export function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

export function formatCompact(value) {
  if (value <= 99_999) return formatNumber(value);
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value, total) {
  if (total === 0) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

export function textReport(report) {
  const { owner, name } = report.repository;
  const sha = report.commitSha.slice(0, 12);
  const lines = [
    `${owner}/${name} ${sha}`,
    'Language        Files      Lines       Code   Comments     Blanks',
  ];
  for (const row of report.languages) {
    lines.push(
      `${row.name.padEnd(14)} ` +
      `${String(row.stats.files).padStart(6)} ` +
      `${String(row.stats.lines).padStart(10)} ` +
      `${String(row.stats.code).padStart(10)} ` +
      `${String(row.stats.comments).padStart(10)} ` +
      `${String(row.stats.blanks).padStart(10)}`
    );
  }
  const t = report.total;
  lines.push(
    `${'Total'.padEnd(14)} ` +
    `${String(t.files).padStart(6)} ` +
    `${String(t.lines).padStart(10)} ` +
    `${String(t.code).padStart(10)} ` +
    `${String(t.comments).padStart(10)} ` +
    `${String(t.blanks).padStart(10)}`
  );
  return lines.join('\n');
}
