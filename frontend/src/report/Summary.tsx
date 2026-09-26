// Pure move from main.tsx — behavior unchanged.
import { useTranslation } from "react-i18next";
import { formatCompactNumber, formatNumber } from "../reportUtils";
import type { Stats } from "../types";

export function Summary({ stats }: { stats: Stats }) {
  const { t } = useTranslation();
  return (
    <div className="summary">
      <Metric label={t("summary.code")} value={stats.code} accent />
      <Metric label={t("summary.files")} value={stats.files} />
      <Metric label={t("summary.lines")} value={stats.lines} />
      <Metric label={t("summary.comments")} value={stats.comments} />
      <Metric label={t("summary.blanks")} value={stats.blanks} />
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  const exact = formatNumber(value);
  return <div className={`cell ${accent ? "accent" : ""}`}><div className="lbl">{label}</div><div className="val" title={exact}>{formatCompactNumber(value)}</div></div>;
}
