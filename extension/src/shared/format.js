import { t } from '../i18n/index.js';

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
  const pct = value / total * 100;
  if (pct < 0.1) return '<0.1%';
  const fixed = pct.toFixed(1);
  return fixed.endsWith('.0') ? `${Math.round(pct)}%` : `${fixed}%`;
}

export function textReport(report) {
  const { owner, name } = report.repository;
  const sha = report.commitSha.slice(0, 12);
  const header = `${t('textReport.language').padEnd(14)} ${t('textReport.files').padStart(6)} ${t('textReport.lines').padStart(10)} ${t('textReport.code').padStart(10)} ${t('textReport.comments').padStart(10)} ${t('textReport.blanks').padStart(10)}`;
  const lines = [
    `${owner}/${name} ${sha}`,
    header,
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
  const totalLabel = t('textReport.total');
  const total = report.total;
  lines.push(
    `${totalLabel.padEnd(14)} ` +
    `${String(total.files).padStart(6)} ` +
    `${String(total.lines).padStart(10)} ` +
    `${String(total.code).padStart(10)} ` +
    `${String(total.comments).padStart(10)} ` +
    `${String(total.blanks).padStart(10)}`
  );
  return lines.join('\n');
}
