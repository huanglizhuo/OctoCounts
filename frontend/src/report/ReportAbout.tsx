// Crawler parity for report pages: the edge writes this capsule, insights
// paragraph, FAQ and comparison links into the pre-render HTML, but
// createRoot() discards that markup and Google indexes the rendered DOM. The
// same builders (functions/report-copy.js, compare-registry.js) render them
// here so both versions of the page say the same thing, word for word.
import { primaryLanguage, reportCapsuleText, reportFaq, reportInsightsText } from "../../functions/report-copy.js";
import { relatedComparisons } from "../../functions/compare-registry.js";
import type { Report } from "../types";

export function ReportAbout({ report }: { report: Report }) {
  const copy = { ...report, repoFullName: `${report.repository.owner}/${report.repository.name}` };
  const comparisons = relatedComparisons(copy.repoFullName, primaryLanguage(report.languages, report.total.code)?.name);
  // English like the server copy it mirrors, whatever the UI language.
  return (
    <section className="report-about" lang="en" aria-labelledby="report-about-title">
      <div className="section-h">
        <h2 id="report-about-title">About this report</h2>
      </div>
      <p>{reportCapsuleText(copy)}</p>
      <p>{reportInsightsText(copy)}</p>
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
