// Shared by the edge response and the hydrated report page (like
// report-schema.js): one source for a report's <title>, meta description and
// top-language wording, so server- and client-rendered metadata cannot drift.

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
