// Pure constructors — the UI lives in ReportActions, which renders these
// links in its "more" menu so every surface fires the same URL semantics.
import { formatNumber } from "../reportUtils";
import type { Report } from "../types";
import { buildSnapshotReportUrl } from "./shared";

// A citation the reader can paste anywhere (SG-04): repository, code lines,
// date, commit, a one-line configuration summary, and the snapshot URL that
// reproduces exactly this configuration. Text-only by design so it survives
// clipboard, issues, and plain-text contexts.
export function reportCitation(report: Report) {
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

// Every "continue with this repository" deep link, built from one place so
// the report action bar and any other surface can never drift apart on URL
// semantics (repo, resolved ref/commit kept intact).
export function reportToolLinks(report: Report, repoUrl: string, refName: string) {
  const targetRepo = report.repository.htmlUrl || repoUrl;
  const targetRef = report.commitSha || report.refName || refName;
  const query = new URLSearchParams({ repo: targetRepo });
  if (targetRef) query.set("ref", targetRef);
  const compare = new URLSearchParams({ left: targetRepo, right: targetRepo });
  if (targetRef) { compare.set("leftRef", targetRef); compare.set("rightRef", targetRef); }
  const diff = new URLSearchParams({ repo: targetRepo, base: targetRef, head: targetRef });
  return {
    compareHref: `/compare?${compare.toString()}`,
    diffHref: `/diff?${diff.toString()}`,
    badgesHref: `/badges?${query.toString()}`,
    citation: reportCitation(report),
  };
}
