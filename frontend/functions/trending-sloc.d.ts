export type TrendingRepository = {
  rank: number;
  fullName: string;
  description: string;
  language: string | null;
  starsToday: number;
  totalStars?: number;
  publicPath: string;
  sloc?: { code: number; generatedAt: string; reportId: string } | null;
};
export type TrendingSnapshot = {
  source: string;
  generatedAt: string;
  date: string;
  repositories: TrendingRepository[];
};
export function trendingSloc(value: unknown): NonNullable<TrendingRepository["sloc"]> | null;
export function trendingReportPath(repo: TrendingRepository): string;
export function trendingIsStale(snapshot: TrendingSnapshot, now?: number): boolean;
export function validateTrendingSnapshot(value: unknown): TrendingSnapshot | null;
