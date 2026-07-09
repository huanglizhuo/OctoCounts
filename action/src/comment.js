export const COMMENT_MARKER = "<!-- octocounts-sloc-diff -->";

export function buildComment({ repo, baseRef, headRef, baseReport, headReport }) {
  const baseTotal = baseReport.total;
  const headTotal = headReport.total;
  const rows = languageDiffRows(baseReport, headReport).slice(0, 12);
  const reportUrl = `https://octocounts.com/github/${encodeURIComponent(headReport.repository.owner)}/${encodeURIComponent(headReport.repository.name)}/commit/${encodeURIComponent(headReport.commitSha)}`;

  return `${COMMENT_MARKER}
## OctoCounts SLOC diff

\`${repo}\` from \`${shortRef(baseRef)}\` to \`${shortRef(headRef)}\`

| Metric | Base | Head | Δ |
|---|---:|---:|---:|
| Files | ${formatNumber(baseTotal.files)} | ${formatNumber(headTotal.files)} | ${formatSigned(headTotal.files - baseTotal.files)} |
| Total lines | ${formatNumber(baseTotal.lines)} | ${formatNumber(headTotal.lines)} | ${formatSigned(headTotal.lines - baseTotal.lines)} |
| Code | ${formatNumber(baseTotal.code)} | ${formatNumber(headTotal.code)} | ${formatSigned(headTotal.code - baseTotal.code)} |
| Comments | ${formatNumber(baseTotal.comments)} | ${formatNumber(headTotal.comments)} | ${formatSigned(headTotal.comments - baseTotal.comments)} |
| Blanks | ${formatNumber(baseTotal.blanks)} | ${formatNumber(headTotal.blanks)} | ${formatSigned(headTotal.blanks - baseTotal.blanks)} |

${rows.length ? languageTable(rows) : "_No per-language changes detected._"}

[Open OctoCounts report](${reportUrl})
`;
}

function languageTable(rows) {
  return `| Language | Base code | Head code | Δ code |
|---|---:|---:|---:|
${rows.map((row) => `| ${escapeMarkdown(row.name)} | ${formatNumber(row.base)} | ${formatNumber(row.head)} | ${formatSigned(row.delta)} |`).join("\n")}`;
}

function languageDiffRows(baseReport, headReport) {
  const names = new Set([
    ...baseReport.languages.map((language) => language.name),
    ...headReport.languages.map((language) => language.name),
  ]);
  return [...names]
    .map((name) => {
      const base = baseReport.languages.find((language) => language.name === name)?.stats.code ?? 0;
      const head = headReport.languages.find((language) => language.name === name)?.stats.code ?? 0;
      return { name, base, head, delta: head - base };
    })
    .filter((row) => row.delta !== 0 || row.base !== 0 || row.head !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.head - a.head);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatSigned(value) {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "-"}${formatNumber(Math.abs(value))}`;
}

function shortRef(value) {
  return String(value || "").slice(0, 12);
}

function escapeMarkdown(value) {
  return String(value).replace(/\|/g, "\\|");
}
