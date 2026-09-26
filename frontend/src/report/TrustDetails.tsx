// Pure move from main.tsx — behavior unchanged.
import { useTranslation } from "react-i18next";
import { formatCompactNumber } from "../reportUtils";
import type { Report } from "../types";

// Tracks html[data-scheme] was replaced by the SchemeProvider context — see scheme.tsx.
const defaultIgnoredDirs = [".cache", ".git", ".next", "build", "dist", "node_modules", "target", "vendor"];

export function TrustDetails({ report, stars }: { report: Report; stars?: number | null }) {
  const { t } = useTranslation();
  const details = [
    { label: t("trust.commit"), value: report.commitSha },
    { label: t("trust.ref"), value: report.refName },
    { label: t("trust.counter"), value: report.tokeiVersion },
    { label: t("trust.cache"), value: report.cached ? t("runner.cacheHit") : t("runner.freshRun") },
    ...(typeof stars === "number" ? [{ label: t("trust.stars"), value: formatCompactNumber(stars) }] : []),
    { label: t("trust.profile"), value: t(`analysisOptions.profiles.${report.analysisOptions.profile}`) },
    { label: t("trust.ignored"), value: [...defaultIgnoredDirs, ...report.analysisOptions.ignoredDirs].join(", ") },
    { label: t("trust.languages"), value: report.analysisOptions.ignoredLanguages.join(", ") || t("trust.none") },
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
