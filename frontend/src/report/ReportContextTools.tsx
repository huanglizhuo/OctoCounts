// Pure move from main.tsx — behavior unchanged.
import { Clipboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { trackEvent } from "../analytics";
import { copyText, formatNumber } from "../reportUtils";
import type { Report } from "../types";
import { buildSnapshotReportUrl, useCopied } from "./shared";

// A citation the reader can paste anywhere (SG-04): repository, code lines,
// date, commit, a one-line configuration summary, and the snapshot URL that
// reproduces exactly this configuration. Text-only by design so it survives
// clipboard, issues, and plain-text contexts.
function reportCitation(report: Report) {
  const options = report.analysisOptions;
  const ignores = [...options.ignoredDirs, ...options.ignoredLanguages];
  const toggles: string[] = [];
  if (!options.includeTests) toggles.push("tests excluded");
  if (!options.includeDocs) toggles.push("docs excluded");
  if (!options.includeGenerated) toggles.push("generated excluded");
  if (options.profile && options.profile !== "default") toggles.push(`profile: ${options.profile}`);
  const configuration = ignores.length || toggles.length
    ? `custom configuration (${[...toggles, ...ignores.map((entry) => `ignoring ${entry}`)].join(", ")})`
    : "default configuration";
  const countedAt = report.generatedAt.slice(0, 10);
  return `${report.repository.owner}/${report.repository.name} has ${formatNumber(report.total.code)} lines of code (SLOC counted ${countedAt} at commit ${report.commitSha.slice(0, 12)}, ${configuration}, via OctoCounts/tokei): ${buildSnapshotReportUrl(report)}`;
}

export function ReportContextTools({ report, repoUrl, refName }: { report: Report | null; repoUrl: string; refName: string }) {
  const { t } = useTranslation();
  return (
    <section className="report-context-tools" aria-label={t("reportTools.ariaLabel")}>
      <div className="section-h">
        <h2>{t("reportTools.title")}</h2>
        <span className="sub">{t("reportTools.subtitle")}</span>
      </div>
      <ReportToolLinks report={report} repoUrl={repoUrl} refName={refName} />
    </section>
  );
}

// The action row itself: citation copy plus the compare/diff/badges deep
// links with this repository and ref preselected. Extracted so the report
// page's "Share & embed" section and the standalone section render the exact
// same actions (and fire the exact same analytics events) from one place.
export function ReportToolLinks({ report, repoUrl, refName }: { report: Report | null; repoUrl: string; refName: string }) {
  const { t } = useTranslation();
  const copied = useCopied();
  const targetRepo = report?.repository.htmlUrl || repoUrl;
  const targetRef = report?.commitSha || report?.refName || refName;
  const query = new URLSearchParams({ repo: targetRepo });
  if (targetRef) query.set("ref", targetRef);
  const compare = new URLSearchParams({ left: targetRepo, right: targetRepo });
  if (targetRef) { compare.set("leftRef", targetRef); compare.set("rightRef", targetRef); }
  const diff = new URLSearchParams({ repo: targetRepo, base: targetRef, head: targetRef });
  return (
    <div className="report-tool-links">
      <button
        type="button"
        className="copybtn"
        disabled={!report}
        onClick={() => {
          if (!report) return;
          void copyText(reportCitation(report)).then((ok) => {
            copied.showCopied("citation");
            trackEvent("report_citation_copied", { provider: "github" });
            if (!ok) window.prompt(t("reportCta.copyFailed"), reportCitation(report));
          });
        }}
      >
        <Clipboard size={14} />
        {copied.copiedKey === "citation" ? t("reportCta.copied") : t("reportTools.copyCitation")}
      </button>
      <a className="copybtn" href={`/compare?${compare.toString()}`}>{t("reportTools.compare")}</a>
      <a className="copybtn" href={`/diff?${diff.toString()}`}>{t("reportTools.diff")}</a>
      <a className="copybtn" href={`/badges?${query.toString()}`}>{t("reportTools.badges")}</a>
    </div>
  );
}
