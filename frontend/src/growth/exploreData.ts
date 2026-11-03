import type { GrowthStats } from "../types";

export type ExploreRepository = {
  owner: string;
  repo: string;
  publicPath: string;
  generatedAt: string;
  total: { code: number; files?: number; lines?: number };
  topLanguage?: string | { name: string; code: number; percent: number } | null;
  languageCount?: number;
  languages?: Array<{ name: string; stats: { code: number } }>;
};

export type ExploreList = { page: number; limit: number; hasNext?: boolean; reports: ExploreRepository[] };
export type CollectionKind = "recent" | "popular" | "monoliths";

const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";

function validRepository(value: unknown): value is ExploreRepository {
  if (!record(value) || !record(value.total)) return false;
  return typeof value.owner === "string" && typeof value.repo === "string"
    && typeof value.publicPath === "string" && /^\/github\/[^/?#]+\/[^/?#]+$/.test(value.publicPath)
    && typeof value.generatedAt === "string" && Number.isFinite(Date.parse(value.generatedAt))
    && count(value.total.code) && (value.total.lines === undefined || count(value.total.lines)) && (value.total.files === undefined || count(value.total.files))
    && (value.languageCount === undefined || count(value.languageCount))
    && (value.topLanguage == null || typeof value.topLanguage === "string" || (record(value.topLanguage) && typeof value.topLanguage.name === "string"))
    && (value.languages === undefined || (Array.isArray(value.languages) && value.languages.every((row) => record(row) && typeof row.name === "string" && record(row.stats) && count(row.stats.code))));
}

export function validateExploreList(value: unknown): ExploreList | undefined {
  if (!record(value) || !count(value.page) || value.page < 1 || !count(value.limit) || value.limit < 1
    || (value.hasNext !== undefined && typeof value.hasNext !== "boolean")
    || !Array.isArray(value.reports) || !value.reports.every(validRepository)) return undefined;
  return value as ExploreList;
}

export function validateExploreStats(value: unknown): GrowthStats | undefined {
  if (!record(value) || !record(value.totals) || !record(value.windows)) return undefined;
  const { totals, windows } = value;
  if (!["reportsGenerated", "repositoriesAnalyzed", "linesCounted", "codeLinesCounted", "languagesDetected"].every((key) => count(totals[key]))
    || !["reportsToday", "reports7d", "reports30d", "repositoriesToday", "repositories7d", "repositories30d"].every((key) => count(windows[key]))
    || !Array.isArray(value.sources) || !value.sources.every((row) => record(row) && typeof row.source === "string" && count(row.reports))
    || !Array.isArray(value.languages) || !value.languages.every((row) => record(row) && typeof row.language === "string" && count(row.code))
    || !Array.isArray(value.topRepositories) || !value.topRepositories.every(validRepository)
    || !Array.isArray(value.recentRepositories) || !value.recentRepositories.every(validRepository)) return undefined;
  return value as GrowthStats;
}

export function languageShares(report: ExploreRepository) {
  if (!report.total.code || !report.languages?.length) return [];
  const rows = [...report.languages].filter((row) => row.stats.code > 0).sort((a, b) => b.stats.code - a.stats.code).slice(0, 3)
    .map((row) => ({ name: row.name, code: row.stats.code }));
  const other = report.total.code - rows.reduce((sum, row) => sum + row.code, 0);
  if (other < 0) return [];
  if (other > 0) rows.push({ name: "", code: other });
  return rows;
}

export function readExploreSeed(id: string): unknown {
  try { return JSON.parse(document.getElementById(id)?.textContent || "null"); }
  catch { return null; }
}
