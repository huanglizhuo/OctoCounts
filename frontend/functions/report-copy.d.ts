import type { AnalysisOptions, Stats } from "../src/types";

type CopyLanguage = { name: string; stats: Pick<Stats, "code"> };
type CopyReport = {
  repoFullName: string;
  total: Pick<Stats, "code" | "files">;
  languages: CopyLanguage[];
  languageCount?: number;
  analysisOptions?: Partial<AnalysisOptions> | null;
};

export const DATA_AND_PROSE_LANGUAGES: Set<string>;
export function isCanonicalAnalysisOptions(options: Partial<AnalysisOptions> | null | undefined): boolean;
export function analysisOptionsLabel(options: Partial<AnalysisOptions> | null | undefined): string | null;
export function primaryLanguage(languages: CopyLanguage[], totalCode: number): { name: string; code: number; percent: number; programming: boolean } | null;
export function primaryLanguagePhrase(languages: CopyLanguage[], totalCode: number): string;
export function reportPageTitle(report: Pick<CopyReport, "repoFullName" | "total" | "analysisOptions">): string;
export function reportPageDescription(report: CopyReport): string;
