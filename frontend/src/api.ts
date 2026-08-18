import i18n from "./i18n";
import type { AnalysisOptions, AnalysisSource, AnalyzeResponse, GrowthStats } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8080";

export class ApiRequestError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

export async function analyzeRepository(request: {
  repoUrl: string;
  refName: string;
  forceRefresh: boolean;
  options?: AnalysisOptions;
  source?: AnalysisSource;
}): Promise<AnalyzeResponse> {
  return fetchJson<AnalyzeResponse>("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repoUrl: request.repoUrl,
      refName: request.refName || undefined,
      forceRefresh: request.forceRefresh,
      options: request.options,
      source: request.source ?? "web",
    }),
  });
}

export function fetchGrowthStats() {
  return fetchJson<GrowthStats>("/api/stats");
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = apiErrorCode(body);
    throw new ApiRequestError(apiErrorMessage(body, response.statusText), response.status, code);
  }
  return body as T;
}

function apiErrorCode(body: unknown) {
  if (!body || typeof body !== "object") return undefined;
  return "code" in body && typeof body.code === "string" ? body.code : undefined;
}

function apiErrorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback || i18n.t("error.requestFailed");

  const code = "code" in body && typeof body.code === "string" ? body.code : "";
  const message = "message" in body && typeof body.message === "string" ? body.message : "";
  return localizedErrorCodeMessage(code, message || fallback, "error.requestFailed");
}

// Single source of truth for error-code → i18n mapping; shared with useAnalysisRunner.
export function localizedErrorCodeMessage(code: string | undefined, fallback: string, fallbackKey: string) {
  if (code === "private_repo") return i18n.t("error.privateRepo");
  if (code === "invalid_url") return i18n.t("error.invalidUrl");
  if (code === "ref_not_found") return i18n.t("error.refNotFound");
  if (code === "rate_limited") return i18n.t("error.rateLimited");
  if (code === "github_unavailable") return i18n.t("error.githubUnavailable");
  if (code === "too_large") return i18n.t("error.tooLarge");
  if (code === "not_found") return i18n.t("error.notFound");
  if (code === "github_request_failed") return i18n.t("error.githubRequestFailed");
  if (code === "analysis_failed") return i18n.t("error.analysisFailed");
  return fallback || i18n.t(fallbackKey);
}
