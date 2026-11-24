// Crawler parity for report pages: the edge writes this capsule, insights
// paragraph, FAQ and comparison links into the pre-render HTML, but
// createRoot() discards that markup and Google indexes the rendered DOM. The
// same builders (functions/report-copy.js, compare-registry.js) render them
// here so both versions of the page say the same thing, word for word.
import { primaryLanguage, reportCapsuleText, reportFaq, reportInsightsText, reportSourceLinks } from "../../functions/report-copy.js";
import { relatedComparisons } from "../../functions/compare-registry.js";
import type { Report } from "../types";

export function ReportAbout({ report }: { report: Report }) {
  const copy = { ...report, repoFullName: `${report.repository.owner}/${report.repository.name}` };
  const comparisons = relatedComparisons(copy.repoFullName, primaryLanguage(report.languages, report.total.code)?.name);
  // Same links the server HTML renders under the citation: the counted
  // repository and the exact commit, built from the report's own identity.
  const source = reportSourceLinks({ provider: "github", owner: report.repository.owner, repo: report.repository.name, commitSha: report.commitSha });
  // English like the server copy it mirrors, whatever the UI language.
  return (
    <section className="report-about" lang="en" aria-labelledby="report-about-title">
      <div className="section-h">
        <h2 id="report-about-title">About this report</h2>
      </div>
      <p>{reportCapsuleText(copy)}</p>
      {source ? (
        <p>
          Source: <a href={source.repositoryUrl}>{copy.repoFullName} on GitHub</a> · counted commit{" "}
          <a href={source.commitUrl}>{source.shortSha}</a>
        </p>
      ) : null}
      <p>{reportInsightsText(copy)}</p>
      <p>
        See the <a href="/docs/glossary">SLOC and code metrics glossary</a> and{" "}
        <a href="/research">how test, docs, and generated-file filtering changes SLOC counts</a>.
      </p>
      {reportFaq(copy).map((item) => (
        <div key={item.question}>
          <h3>{item.question}</h3>
          <p>{item.answer}</p>
        </div>
      ))}
      {comparisons.length ? (
        <p>
          Related comparisons:{" "}
          {comparisons.map((entry, index) => (
            <span key={entry.slug}>
              {index ? " · " : ""}
              <a href={`/compare/${entry.slug}`}>{entry.name}</a>
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}
