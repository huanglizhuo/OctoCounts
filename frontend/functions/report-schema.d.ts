import type { Report } from "../src/types";

export function reportJsonLd(report: Pick<Report, "generatedAt" | "analysisKey" | "commitSha" | "refName" | "languages" | "total"> & {
  canonicalUrl: string;
  repoFullName: string;
  description: string;
  htmlUrl: string;
  provider: string;
  owner: string;
  repo: string;
  reportId?: string;
}): Record<string, unknown>;
