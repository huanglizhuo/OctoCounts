import type { Report } from "../src/types";

export function reportJsonLd(report: Pick<Report, "generatedAt" | "analysisKey" | "commitSha" | "refName" | "languages" | "total"> & Partial<Pick<Report, "tokeiVersion" | "countingPolicy">> & {
  canonicalUrl: string;
  repoFullName: string;
  description: string;
  htmlUrl: string;
  provider: string;
  owner: string;
  repo: string;
  reportId?: string;
  requestedRef?: string;
  refKind?: "tree" | "commit";
}): Record<string, unknown>;
