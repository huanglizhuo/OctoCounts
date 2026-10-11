import { useTranslation } from "react-i18next";
import { formatCompactNumber } from "../reportUtils";
import type { Report } from "../types";

export function TrustDetails({ report, stars }: { report: Report; stars?: number | null }) {
  const { t } = useTranslation();
  const policy = report.countingPolicy;
  const details = [
    { label: t("trust.commit"), value: report.commitSha },
    { label: t("trust.ref"), value: report.refName },
    { label: t("trust.counter"), value: report.tokeiVersion },
    { label: t("trust.cache"), value: report.cached ? t("runner.cacheHit") : t("runner.freshRun") },
    ...(typeof stars === "number" ? [{ label: t("trust.stars"), value: formatCompactNumber(stars) }] : []),
    { label: t("trust.profile"), value: policy ? t(`analysisOptions.profiles.${report.analysisOptions.profile}`) : t("countingPolicy.unknown") },
    { label: t("trust.ignored"), value: policy ? policy.ignoredDirs.join(", ") : t("countingPolicy.unknown") },
    { label: t("trust.languages"), value: policy ? policy.ignoredLanguages.join(", ") || t("trust.none") : t("countingPolicy.unknown") },
  ];

  return (
    <div className="trust-details" role="group" aria-label={t("trust.title")}>
      {details.map((detail) => (
        <div key={detail.label}>
          <span>{detail.label}</span>
          <code>{detail.value}</code>
        </div>
      ))}
    </div>
  );
}
