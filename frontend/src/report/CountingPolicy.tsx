import { useTranslation } from "react-i18next";
import { policySummary } from "../reportUtils";
import type { Report } from "../types";
import { TrustDetails } from "./TrustDetails";

export function CountingPolicyCard({ report }: { report: Report }) {
  const { t } = useTranslation();
  const policy = report.countingPolicy;
  const attributes = policy?.repositoryAttributes;
  const timestamp = new Date(report.generatedAt).toISOString().slice(0, 19).replace("T", " ");
  return (
    <section className="counting-policy" aria-label={t("countingPolicy.title")}>
      <div className="counting-policy-head"><strong>{t("countingPolicy.title")}</strong><span>{policySummary(report)}</span></div>
      <p>{t("countingPolicy.definition")}</p>
      <details>
        <summary>{t("countingPolicy.details")}</summary>
        {!policy ? <p role="status">{t("countingPolicy.legacy")}</p> : null}
        <TrustDetails report={report} />
        <p>{t("countingPolicy.engineDefaults")}</p>
        <p>{t("countingPolicy.directoryMatching")}</p>
        {attributes ? <p>{t(`countingPolicy.attributes.${attributes.status}`, { count: attributes.excludedFiles, generated: attributes.generatedFiles, vendored: attributes.vendoredFiles })}</p> : null}
        <p><time dateTime={report.generatedAt}>{timestamp} UTC</time> · {report.tokeiVersion}{policy ? ` · ${policy.version}` : ""}</p>
        <a href="/docs/methodology">{t("runner.methodologyLink")}</a>
      </details>
    </section>
  );
}

export { comparePolicies } from "../../functions/counting-policy.js";
