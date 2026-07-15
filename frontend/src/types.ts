export type JobStatus = "queued" | "running" | "completed" | "failed";
export type AppStatus = JobStatus | "idle" | "cached";
export type Scheme = "matrix" | "paper" | "amber";
export type SortKey = "name" | keyof Stats;
export type PieItem = { label: string; value: number; color: string };
export type TickerRow = { label: string; value: number; color: string; percent: number };
export type AnalysisProfile = "default" | "source-only";

export type AnalysisOptions = {
  ignoredDirs: string[];
  ignoredLanguages: string[];
  profile: AnalysisProfile;
  includeDocs: boolean;
  includeTests: boolean;
  includeGenerated: boolean;
};

export type Stats = {
  files: number;
  lines: number;
  code: number;
  comments: number;
  blanks: number;
};

export type LanguageReport = {
  name: string;
  stats: Stats;
  children: LanguageReport[];
};

export type RepositoryProvider = "github" | "gitlab" | "gitHub" | "gitLab";
export type AnalysisSource = "web" | "extension" | "github_action" | "cli" | "mcp" | "api" | "seed" | "github_trending" | "unknown";

export type Report = {
  id: string;
  repository: { owner: string; name: string; htmlUrl: string; provider?: RepositoryProvider };
  refName: string;
  commitSha: string;
  generatedAt: string;
  durationMs: number;
  cached: boolean;
  tokeiVersion: string;
  analysisKey: string;
  analysisOptions: AnalysisOptions;
  languages: LanguageReport[];
  total: Stats;
};

export type AnalyzeResponse =
  | { kind: "cached"; reportId: string; report: Report }
  | { kind: "job"; jobId: string; status: JobStatus };

export type JobRecord = {
  id: string;
  status: JobStatus;
  reportId?: string;
  error?: { code: string; message: string };
};

export type GrowthStats = {
  totals: {
    reportsGenerated: number;
    repositoriesAnalyzed: number;
    linesCounted: number;
    codeLinesCounted: number;
    languagesDetected: number;
  };
  windows: {
    reportsToday: number;
    reports7d: number;
    reports30d: number;
    repositoriesToday: number;
    repositories7d: number;
    repositories30d: number;
  };
  sources: Array<{ source: AnalysisSource; reports: number }>;
  languages: Array<{ language: string; code: number; lines: number; reports: number }>;
  topRepositories: GrowthRepositoryStat[];
  recentRepositories: GrowthRepositoryStat[];
};

export type GrowthRepositoryStat = {
  provider: RepositoryProvider;
  owner: string;
  repo: string;
  publicPath: string;
  htmlUrl: string;
  refName: string;
  generatedAt: string;
  total: Stats;
  topLanguage?: string;
};
