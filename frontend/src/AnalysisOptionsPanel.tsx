import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AnalysisOptions } from "./types";

// The form's defaults ARE the canonical public-surface profile (docs, tests
// and generated files excluded) so every surface ships one default: web UI,
// badges/embeds, CLI, MCP, SEO pages, history sampling and the growth
// animation all count the same way out of the box. Visitors who want the
// whole repository counted flip the toggles on explicitly.
export const defaultAnalysisOptions: AnalysisOptions = {
  ignoredDirs: [],
  ignoredLanguages: [],
  profile: "default",
  includeDocs: false,
  includeTests: false,
  includeGenerated: false,
};

// Kept as its own name for call sites that mean "the public profile" (embeds)
// rather than "whatever the form defaults to today" — the two coincide by
// design; if the form default ever moves again, this one must not follow.
export const canonicalAnalysisOptions: AnalysisOptions = { ...defaultAnalysisOptions };

// Reports stored before options were persisted were counted with docs, tests
// and generated files all included — the defaults of that era. Filling their
// missing options with today's defaults would relabel include-all numbers as
// canonical (isCanonicalAnalysisOptions would pass), so legacy fills use this.
export const legacyAnalysisOptions: AnalysisOptions = {
  ignoredDirs: [],
  ignoredLanguages: [],
  profile: "default",
  includeDocs: true,
  includeTests: true,
  includeGenerated: true,
};

// How many configured fields differ from the defaults — one point per field,
// array-valued fields (ignored dirs/languages) counting as a single field.
// Drives the "N modified" summary so a non-default configuration is visible
// while the panel stays collapsed.
function countModifiedAnalysisOptions(options: AnalysisOptions, defaults: AnalysisOptions): number {
  let count = 0;
  if (options.profile !== defaults.profile) count += 1;
  if (options.ignoredDirs.join("\u0000") !== defaults.ignoredDirs.join("\u0000")) count += 1;
  if (options.ignoredLanguages.join("\u0000") !== defaults.ignoredLanguages.join("\u0000")) count += 1;
  if (options.includeDocs !== defaults.includeDocs) count += 1;
  if (options.includeTests !== defaults.includeTests) count += 1;
  if (options.includeGenerated !== defaults.includeGenerated) count += 1;
  if (Boolean(options.respectGitattributes) !== Boolean(defaults.respectGitattributes)) count += 1;
  return count;
}

export function AnalysisOptionsPanel({ options, setOptions, defaults = defaultAnalysisOptions }: { options: AnalysisOptions; setOptions: (options: AnalysisOptions) => void; defaults?: AnalysisOptions }) {
  const { t } = useTranslation();
  // Keep what the person is typing separate from its parsed value. Rebuilding
  // the field from `split(',')` on each keystroke used to eat commas/spaces and
  // move the caret, making a normal `examples, fixtures` entry impossible.
  const [ignoredDirsDraft, setIgnoredDirsDraft] = useState(() => options.ignoredDirs.join(", "));
  const [ignoredLanguagesDraft, setIgnoredLanguagesDraft] = useState(() => options.ignoredLanguages.join(", "));
  const update = (patch: Partial<AnalysisOptions>) => setOptions({ ...options, ...patch });
  const modifiedCount = countModifiedAnalysisOptions(options, defaults);
  // Reset must restore the parsed options AND both CSV drafts; leaving a stale
  // draft would resurrect the old entries on the next keystroke or blur.
  const resetDefaults = () => {
    setIgnoredDirsDraft(defaults.ignoredDirs.join(", "));
    setIgnoredLanguagesDraft(defaults.ignoredLanguages.join(", "));
    setOptions(defaults);
  };
  return (
    <details className="analysis-options">
      <summary>
        {modifiedCount > 0
          ? t("analysisOptions.summaryModified", { count: modifiedCount })
          : t("analysisOptions.summary")}
      </summary>
      <div className="analysis-options-grid">
        <label>
          <span>{t("analysisOptions.profile")}</span>
          <select name="analysisProfile" value={options.profile} onChange={(event) => update({ profile: event.target.value as AnalysisOptions["profile"] })}>
            <option value="default">{t("analysisOptions.defaultProfile")}</option>
            <option value="source-only">{t("analysisOptions.sourceOnlyProfile")}</option>
          </select>
        </label>
        <label>
          <span>{t("analysisOptions.ignoredDirs")}</span>
          <input name="ignoredDirs" value={ignoredDirsDraft} onChange={(event) => { setIgnoredDirsDraft(event.target.value); update({ ignoredDirs: csvList(event.target.value) }); }} onBlur={() => update({ ignoredDirs: csvList(ignoredDirsDraft) })} placeholder="examples, fixtures" />
        </label>
        <label>
          <span>{t("analysisOptions.ignoredLanguages")}</span>
          <input name="ignoredLanguages" value={ignoredLanguagesDraft} onChange={(event) => { setIgnoredLanguagesDraft(event.target.value); update({ ignoredLanguages: csvList(event.target.value) }); }} onBlur={() => update({ ignoredLanguages: csvList(ignoredLanguagesDraft) })} placeholder="Markdown, JSON" />
        </label>
        <div className="analysis-toggles">
          <label><input type="checkbox" name="includeDocs" checked={options.includeDocs} onChange={(event) => update({ includeDocs: event.target.checked })} />{t("analysisOptions.includeDocs")}</label>
          <label><input type="checkbox" name="includeTests" checked={options.includeTests} onChange={(event) => update({ includeTests: event.target.checked })} />{t("analysisOptions.includeTests")}</label>
          <label><input type="checkbox" name="includeGenerated" checked={options.includeGenerated} onChange={(event) => update({ includeGenerated: event.target.checked })} />{t("analysisOptions.includeGenerated")}</label>
        </div>
        <label className="repository-attributes-toggle"><input type="checkbox" name="respectGitattributes" checked={Boolean(options.respectGitattributes)} onChange={(event) => update({ respectGitattributes: event.target.checked, ...(event.target.checked ? { includeGenerated: false } : {}) })} />{t("analysisOptions.respectGitattributes")}<small>{t("analysisOptions.attributesHelp")}</small></label>
        {modifiedCount > 0 ? (
          <button type="button" className="copybtn options-reset" onClick={resetDefaults}>
            {t("analysisOptions.reset")}
          </button>
        ) : null}
      </div>
    </details>
  );
}

function csvList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function parseAnalysisOptions(value: string | null): AnalysisOptions | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<AnalysisOptions>;
    if (parsed.profile !== "default" && parsed.profile !== "source-only") return null;
    if (!Array.isArray(parsed.ignoredDirs) || !Array.isArray(parsed.ignoredLanguages)) return null;
    return {
      profile: parsed.profile,
      ignoredDirs: parsed.ignoredDirs.filter((item): item is string => typeof item === "string"),
      ignoredLanguages: parsed.ignoredLanguages.filter((item): item is string => typeof item === "string"),
      // Missing booleans fill with today's default (excluded) — real snapshot
      // URLs always serialize explicit values, so this only decides hand-made
      // or legacy partial ?analysis= JSON, which should mean the current
      // default rather than the pre-unification include-everything one.
      includeDocs: typeof parsed.includeDocs === "boolean" ? parsed.includeDocs : false,
      includeTests: typeof parsed.includeTests === "boolean" ? parsed.includeTests : false,
      includeGenerated: typeof parsed.includeGenerated === "boolean" ? parsed.includeGenerated : false,
      respectGitattributes: parsed.respectGitattributes === true,
    };
  } catch {
    return null;
  }
}
