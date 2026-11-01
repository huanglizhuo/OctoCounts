import type { AnalysisOptions, Stats } from "../src/types";

export const MIN_INDEXABLE_REPORT_FILES = 5;
export const MIN_RELATED_PEER_CODE_LINES = 10000;

type CopyLanguage = { name: string; stats: Pick<Stats, "code"> };
type CopyReport = {
  repoFullName: string;
  total: Pick<Stats, "code" | "files">;
  languages: CopyLanguage[];
  languageCount?: number;
  analysisOptions?: Partial<AnalysisOptions> | null;
};
type ProseReport = Omit<CopyReport, "total"> & {
  total: Pick<Stats, "code" | "files" | "lines" | "comments" | "blanks">;
  refName: string;
  commitSha: string;
  generatedAt: string;
};

// Pages Functions compiles every file under functions/ as a route module, so
// this file must also be valid as plain TypeScript: constants need literal
// initializers (an uninitialized `export const` fails that build).
export function isCanonicalAnalysisOptions(options: Partial<AnalysisOptions> | null | undefined): boolean;
export function analysisOptionsLabel(options: Partial<AnalysisOptions> | null | undefined): string | null;
export function primaryLanguage(languages: CopyLanguage[], totalCode: number): { name: string; code: number; percent: number; programming: boolean } | null;
export function primaryLanguagePhrase(languages: CopyLanguage[], totalCode: number): string;
export function reportPageTitle(report: Pick<CopyReport, "repoFullName" | "total" | "analysisOptions">): string;
export function reportPageDescription(report: CopyReport): string;
export function readableDate(value: string): string;
export function reportCapsuleText(report: ProseReport): string;
export function reportInsightsText(report: ProseReport): string;
export function reportFaq(report: ProseReport): Array<{ question: string; answer: string }>;
