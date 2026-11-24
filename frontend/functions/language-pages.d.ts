export type LanguagePageCell = { text: string; href?: string };
export type LanguagePageModel = {
  kind: "hub" | "leaderboard";
  slug?: string;
  language?: string;
  title: string;
  heading: string;
  description: string;
  intro: string;
  columns: string[];
  rows: LanguagePageCell[][];
  afterTable: string;
  faq: Array<{ question: string; answer: string }>;
  comparisons?: Array<{ slug: string; name: string }>;
  relatedLinks: Array<{ href: string; label: string }>;
};
export type LanguageIndexEntry = { language: string; slug: string; repositories: number; code: number; lines: number };
export type LanguageIndex = { languages: LanguageIndexEntry[]; minRepositories: number; leaderboardSize: number };

// Pages Functions compiles every file under functions/ as a route module, so
// this file must also be valid as plain TypeScript: constants need literal
// initializers (an uninitialized `export const` fails that build).
export const LANGUAGES_PATH = "/languages";
export const LANGUAGE_HUB_TITLE = "Largest codebases by programming language | OctoCounts";
export function languageHubModel(index: LanguageIndex): LanguagePageModel;
export function languageLeaderboardModel(page: unknown, index: LanguageIndex): LanguagePageModel;
export function languagePageJsonLd(model: LanguagePageModel): Record<string, unknown>;
