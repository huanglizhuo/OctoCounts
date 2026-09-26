// Pure move from main.tsx — behavior unchanged.
import { useTranslation } from "react-i18next";
import { formatNumber } from "../reportUtils";
import type { Report } from "../types";

export function Insights({ report }: { report: Report }) {
  const { t } = useTranslation();
  const totalLines = report.total.lines;
  const totalCode = report.total.code;
  const scale = projectScale(totalCode);
  const cacheState = report.cached ? t("runner.cacheHit") : t("runner.freshRun");
  const commitLabel = `${report.refName} / ${report.commitSha.slice(0, 12)}`;
  // Primary language / code share / language mix used to live here too, but
  // the donut + table right above already show all three at a glance —
  // keeping them here just repeated the chart in prose.
  const insightItems = [
    {
      label: t("insights.scale"),
      value: t(`insights.scaleValues.${scale}`),
      detail: t(`insights.scaleDetails.${scale}`),
      tone: "accent",
    },
    {
      label: t("insights.speed"),
      value: `${report.durationMs}ms`,
      detail: t("insights.speedDetail", { lines: formatNumber(totalLines), version: report.tokeiVersion }),
      tone: "warn",
    },
    {
      label: t("insights.cacheState"),
      value: cacheState,
      detail: commitLabel,
      tone: "muted",
    },
  ];

  return (
    <div className="insights" role="group" aria-label={t("insights.title")}>
      <div className="insights-head">
        <span className="chart-tag">{t("insights.kicker")}</span>
        <h3>{t("insights.title")}</h3>
      </div>
      <div className="insight-grid">
        {insightItems.map((item) => (
          <div className={`insight-card ${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function projectScale(codeLines: number) {
  if (codeLines < 1_000) return "tiny";
  if (codeLines < 10_000) return "small";
  if (codeLines < 100_000) return "medium";
  if (codeLines < 500_000) return "large";
  return "huge";
}
