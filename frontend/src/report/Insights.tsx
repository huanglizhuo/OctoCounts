// Pure move from main.tsx, then folded into the Technical details disclosure.
import { useTranslation } from "react-i18next";
import { formatNumber } from "../reportUtils";
import type { Report } from "../types";

// Speed/result readouts for the Technical details disclosure. Scale used to
// be the third card here but moved up to the runner head tag, and the
// section head went away with the merge — what remains are the two facts
// that only exist here: how fast it counted, and whether it came from cache.
export function Insights({ report }: { report: Report }) {
  const { t } = useTranslation();
  const insightItems = [
    {
      label: t("insights.speed"),
      value: `${report.durationMs}ms`,
      detail: t("insights.speedDetail", { lines: formatNumber(report.total.lines), version: report.tokeiVersion }),
      tone: "warn",
    },
    {
      label: t("insights.cacheState"),
      value: report.cached ? t("runner.cacheHit") : t("runner.freshRun"),
      detail: `${report.refName} / ${report.commitSha.slice(0, 12)}`,
      tone: "muted",
    },
  ];

  return (
    <div className="insights" role="group" aria-label={t("insights.title")}>
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
