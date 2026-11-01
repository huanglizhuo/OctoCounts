// Shared by the edge response and the hydrated report page (like
// report-schema.js): one source for a report's <title>, meta description and
// top-language wording, so server- and client-rendered metadata cannot drift.

export const MIN_INDEXABLE_REPORT_FILES = 5;

// Peers below this many code lines are the junk tail of the similarity
// ranking (placeholder and toy repositories surfaced as size-peers of large
// ones). RelatedReport carries only totals — no stars — so an absolute code
// floor is the simplest honest filter; when fewer peers qualify the section
// renders fewer links, and at zero it omits (both renderers already do).
export const MIN_RELATED_PEER_CODE_LINES = 10000;

// Data and prose formats by tokei display name (GitHub Linguist's "data" and
// "prose" types). They stay in every count and table; they are only skipped
// when naming a report's top programming language, so a lockfile-heavy
// TypeScript library is not summarized as "top language: JSON". Mirrored by
// DATA_AND_PROSE_LANGUAGES in backend/src/seo.rs (seo.test.mjs asserts it).
export const DATA_AND_PROSE_LANGUAGES = new Set([
  "AsciiDoc", "INI", "JSON", "Markdown", "Org", "PO File", "Plain Text",
  "ReStructuredText", "SVG", "TOML", "Unreal Markdown", "XML", "YAML",
]);

function formatCount(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/// The canonical public options every public report page uses: tests, docs
/// and generated files excluded, default profile, no ignores or repository
/// declarations (backend AnalysisOptions::canonical()).
export function isCanonicalAnalysisOptions(options) {
  return Boolean(options) && typeof options === "object"
    && options.includeTests === false && options.includeDocs === false && options.includeGenerated === false
    && (options.profile ?? "default") === "default"
    && !(Array.isArray(options.ignoredDirs) && options.ignoredDirs.length)
    && !(Array.isArray(options.ignoredLanguages) && options.ignoredLanguages.length)
    && !options.respectGitattributes;
}

/// Short label for options that narrow a count beyond the canonical public
/// options. Null for the canonical set, for options that exclude nothing, and
/// for older reports whose options were never recorded (nothing may be claimed).
export function analysisOptionsLabel(options) {
  if (!options || typeof options !== "object" || isCanonicalAnalysisOptions(options)) return null;
  const parts = [];
  if (options.includeTests === false) parts.push("tests excluded");
  if (options.includeDocs === false) parts.push("docs excluded");
  if (options.includeGenerated === false) parts.push("generated excluded");
  if (options.profile === "source-only") parts.push("source-only profile");
  const ignored = [
    ...(Array.isArray(options.ignoredDirs) ? options.ignoredDirs : []),
    ...(Array.isArray(options.ignoredLanguages) ? options.ignoredLanguages : []),
  ];
  if (ignored.length) parts.push(`${ignored.length} custom ${ignored.length === 1 ? "ignore" : "ignores"}`);
  if (options.respectGitattributes) parts.push("repository declarations applied");
  return parts.length ? parts.join(", ") : null;
}

/// The language a summary should name: the largest programming language by
/// code lines, or the largest language overall when the repository has only
/// data and prose formats. `programming` is false only in that fallback.
export function primaryLanguage(languages, totalCode) {
  const list = Array.isArray(languages) ? languages : [];
  const byCode = (best, language) => ((Number(language?.stats?.code) || 0) > (Number(best?.stats?.code) || 0) ? language : best);
  const programming = list.filter((language) => !DATA_AND_PROSE_LANGUAGES.has(language?.name) && (Number(language?.stats?.code) || 0) > 0);
  const pick = programming.reduce(byCode, programming[0]) ?? list.reduce(byCode, list[0]);
  if (!pick) return null;
  const code = Number(pick.stats?.code) || 0;
  const total = Number(totalCode) || 0;
  return { name: pick.name, code, percent: total ? (code / total) * 100 : 0, programming: programming.includes(pick) };
}

/// "top language: Go 98.5%" when the largest language is a programming
/// language; "top programming language: TypeScript 25.3%" when data or prose
/// formats outweigh it; "" when nothing was counted.
export function primaryLanguagePhrase(languages, totalCode) {
  const primary = primaryLanguage(languages, totalCode);
  if (!primary) return "";
  const list = Array.isArray(languages) ? languages : [];
  const outweighed = primary.programming && list.some((language) => (Number(language?.stats?.code) || 0) > primary.code);
  return `${outweighed ? "top programming language" : "top language"}: ${primary.name} ${primary.percent.toFixed(1)}%`;
}

export function reportPageTitle({ repoFullName, total, analysisOptions }) {
  const label = analysisOptionsLabel(analysisOptions);
  return label
    ? `${repoFullName}: ${formatCount(total.code)} code lines (${label}) | OctoCounts`
    : `${repoFullName}: ${formatCount(total.code)} lines of code | OctoCounts`;
}

/// languageCount is the report's full language count; SEO payloads carry
/// only their first twelve languages, so languages.length can undercount.
export function reportPageDescription({ repoFullName, total, languages, languageCount, analysisOptions }) {
  const label = analysisOptionsLabel(analysisOptions);
  const count = label ? `${formatCount(total.code)} code lines (${label})` : `${formatCount(total.code)} lines of code`;
  const languagesCounted = Number.isSafeInteger(languageCount) ? languageCount : Array.isArray(languages) ? languages.length : 0;
  const phrase = primaryLanguagePhrase(languages, total.code);
  const rules = isCanonicalAnalysisOptions(analysisOptions) ? " Tests, docs and generated files excluded." : "";
  return `${repoFullName} has ${count} across ${formatCount(total.files)} files and ${formatCount(languagesCounted)} languages${phrase ? `; ${phrase}` : ""}.${rules}`;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/// "October 23, 2026" for an RFC 3339 instant: the UTC calendar date its
/// prefix names, the same day the docs pages' "Updated" lines use.
export function readableDate(value) {
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return MONTH_NAMES[month - 1] && day ? `${MONTH_NAMES[month - 1]} ${day}, ${year}` : String(value).slice(0, 10);
}

// The report prose below is rendered twice: by the edge into the pre-render
// HTML (what non-JS AI fetchers read) and by the client report page, because
// createRoot() discards the server markup and Google indexes the rendered DOM.
// One builder per sentence keeps the two renderings word-for-word identical.

/// One sentence naming the counting rules behind the capsule's figures, so
/// the quotable opening never implies a whole-repository count.
function reportRulesSentence(report) {
  if (!report.analysisOptions) return " The counting rules of this older report were not recorded.";
  if (isCanonicalAnalysisOptions(report.analysisOptions)) return " Tests, docs and generated files are excluded under OctoCounts' canonical public options.";
  const label = analysisOptionsLabel(report.analysisOptions);
  return label ? ` Counting options: ${label}.` : " Tests, docs and generated files are included.";
}

/// Declarative answer capsule for report pages, rendered right after the h1
/// in the SSR body and as the first body paragraph of the markdown twin.
/// Every figure comes straight from the report payload so the capsule cannot
/// disagree with the table, FAQ, or client summary it sits next to.
export function reportCapsuleText(report) {
  return `${report.repoFullName} has ${formatCount(report.total.code)} source lines of code out of ${formatCount(report.total.lines)} total lines across ${formatCount(report.total.files)} files, counted with tokei from the ${report.refName} ref at commit ${report.commitSha.slice(0, 12)} on ${readableDate(report.generatedAt)}.${reportRulesSentence(report)}`;
}

export function reportInsightsText(report) {
  const lines = Math.max(Number(report.total.lines) || 0, 1);
  const files = Math.max(Number(report.total.files) || 0, 1);
  const codeRatio = ((Number(report.total.code) || 0) / lines) * 100;
  const commentRatio = ((Number(report.total.comments) || 0) / lines) * 100;
  const codePerFile = (Number(report.total.code) || 0) / files;
  const scale = report.total.code >= 1_000_000 ? "very large" : report.total.code >= 100_000 ? "large" : report.total.code >= 10_000 ? "medium-sized" : "small";
  const primary = primaryLanguage(report.languages, report.total.code);
  const concentration = !primary
    ? "No single top language was identified"
    : primaryLanguagePhrase(report.languages, report.total.code).startsWith("top programming")
      ? `${primary.name} is the largest programming language at ${primary.percent.toFixed(1)}% of counted code; data and prose formats such as JSON or YAML hold a larger share`
      : `${primary.name} accounts for ${primary.percent.toFixed(1)}% of counted code`;
  return `This is a ${scale} codebase by counted code lines. Code represents ${codeRatio.toFixed(1)}% of all lines, comments represent ${commentRatio.toFixed(1)}%, and the repository averages ${formatCount(Math.round(codePerFile))} code lines per file. ${concentration}.`;
}

export function reportFaq(report) {
  const shortSha = report.commitSha.slice(0, 12);
  return [
    {
      question: `How many lines of code does ${report.repoFullName} have?`,
      answer: `${report.repoFullName} has ${formatCount(report.total.code)} lines of code, plus ${formatCount(report.total.comments)} comment lines and ${formatCount(report.total.blanks)} blank lines, for ${formatCount(report.total.lines)} total lines at commit ${shortSha} on ${readableDate(report.generatedAt)}.${reportRulesSentence(report)}`,
    },
    {
      question: `How was the ${report.repoFullName} line count measured?`,
      answer: `OctoCounts resolved the public GitHub repository to commit ${shortSha}, downloaded the source archive, counted it with tokei, and cached the report by commit, tokei version, and analysis options.`,
    },
    {
      question: `What commit was counted for ${report.repoFullName}?`,
      answer: `This OctoCounts report was generated from ${report.refName} at commit ${shortSha} on ${readableDate(report.generatedAt)}.`,
    },
  ];
}
