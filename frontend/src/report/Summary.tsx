// Pure move from main.tsx — behavior unchanged.
import { useTranslation } from "react-i18next";
import { formatCompactNumber, formatNumber, summaryScopeLabel } from "../reportUtils";
import type { Report, Stats } from "../types";

export function Summary({ stats, report }: { stats: Stats; report?: Report }) {
  const { t } = useTranslation();
  // The counting-scope chip rides in the same grid (full row): the headline
  // numbers and the rules that produced them must be readable together, or
  // visitors compare this page's totals against a differently-scoped count.
  const scope = report ? summaryScopeLabel(report) : null;
  return (
    <div className="summary">
      <Metric label={t("summary.code")} value={stats.code} accent />
      <Metric label={t("summary.files")} value={stats.files} />
      <Metric label={t("summary.lines")} value={stats.lines} />
      <Metric label={t("summary.comments")} value={stats.comments} />
      <Metric label={t("summary.blanks")} value={stats.blanks} />
      {scope ? <p className="summary-scope">{scope}</p> : null}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  const exact = formatNumber(value);
  return <div className={`cell ${accent ? "accent" : ""}`}><div className="lbl">{label}</div><div className="val" title={exact}>{formatCompactNumber(value)}</div></div>;
}
