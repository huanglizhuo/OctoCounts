import i18n from "./i18n";
import type { AnalysisOptions, AnalysisSource, AnalyzeResponse, GrowthStats, JobRecord, RepoHistory, Report } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8080";

export class ApiRequestError extends Error {
  code?: string;
  status: number;
  retryAfterMs?: number;
  requestAccepted?: boolean;

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
  signal?: AbortSignal;
  onRetry?: (waitMs: number) => void;
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
    signal: request.signal,
  }, { onRetry: request.onRetry });
}

export function fetchGrowthStats() {
  return fetchJson<GrowthStats>("/api/stats");
}

export async function analyzeAndWait(request: { repoUrl: string; refName: string; options?: AnalysisOptions; signal?: AbortSignal }): Promise<Report> {
  const controller = new AbortController();
  const deadline = Date.now() + 300_000;
  const abort = () => controller.abort(request.signal?.reason);
  request.signal?.throwIfAborted();
  request.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException(i18n.t("compare.analysisTimedOut"), "TimeoutError")), 300_000);
  let jobId: string | undefined;
  try {
    const result = await analyzeRepository({ ...request, forceRefresh: false, signal: controller.signal });
    if (result.kind === "cached") return result.report;
    if (result.kind !== "job" || !result.jobId) throw new Error(i18n.t("error.requestFailed"));
    jobId = result.jobId;
    while (Date.now() < deadline) {
      const job = await fetchJson<JobRecord>(`/api/jobs/${encodeURIComponent(jobId)}?wait=20`, { signal: controller.signal }, { deadline });
      if (job.status === "failed") throw new Error(localizedErrorCodeMessage(job.error?.code, job.error?.message ?? "", "compare.analysisFailed"));
      if (job.status === "completed" && job.reportId) return await fetchJson<Report>(`/api/reports/${encodeURIComponent(job.reportId)}`, { signal: controller.signal }, { deadline });
      await waitForRetry(250, controller.signal);
    }
    throw new Error(i18n.t("compare.analysisTimedOut"));
  } catch (error) {
    if (jobId) throw new Error(`${error instanceof Error ? error.message : i18n.t("error.requestFailed")} · ${i18n.t("error.resumeJob", { jobId })}`);
    throw error;
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", abort);
  }
}

export function fetchRepoHistory(provider: string, owner: string, repo: string) {
  const params = new URLSearchParams({ provider, owner, repo });
  return fetchJson<RepoHistory>(`/api/seo/repo-history?${params.toString()}`);
}

// The canonical (default-analysis-profile) report the indexed report page
// serves. The growth animation's history series is sampled under this same
// profile, so building its finale from the interactive report would show one
// profile's numbers under another's counter whenever a visitor re-analyzed
// with custom options — this fetch keeps the finale and the count-up on the
// same footing. The SEO projection differs from Report only in flattening
// repository identity to top-level owner/repo fields; the adapter below is
// the whole mapping.
export async function fetchCanonicalReport(provider: string, owner: string, repo: string): Promise<Report> {
  const params = new URLSearchParams({ provider, owner, repo });
  const seo = await fetchJson<SeoReportSnapshot>(`/api/seo/report?${params.toString()}`);
  return {
    id: seo.reportId ?? "",
    repository: { owner: seo.owner, name: seo.repo, htmlUrl: seo.htmlUrl, provider: "github" },
    refName: seo.refName,
    commitSha: seo.commitSha,
    generatedAt: seo.generatedAt,
    durationMs: seo.durationMs,
    cached: true,
    tokeiVersion: seo.tokeiVersion,
    analysisKey: seo.analysisKey,
    analysisOptions: seo.analysisOptions,
    countingPolicy: seo.countingPolicy,
    snapshotUrl: seo.snapshotUrl,
    languages: seo.languages,
    total: seo.total,
  };
}

// Raw shape of GET /api/seo/report (see backend/src/seo.rs SeoReport).
type SeoReportSnapshot = {
  reportId?: string;
  countingPolicy?: Report["countingPolicy"];
  provider: string;
  owner: string;
  repo: string;
  repoFullName: string;
  htmlUrl: string;
  publicPath: string;
  canonicalUrl: string;
  generatedAt: string;
  refName: string;
  commitSha: string;
  tokeiVersion: string;
  analysisKey: string;
  analysisOptions: Report["analysisOptions"];
  snapshotUrl?: string;
  durationMs: number;
  total: Report["total"];
  languages: Report["languages"];
};

export async function fetchJson<T>(path: string, init: RequestInit = {}, options: { onRetry?: (waitMs: number) => void; deadline?: number } = {}): Promise<T> {
  const deadline = options.deadline ?? Date.now() + 300_000;
  const isGet = !init.method || init.method === "GET";
  for (let attempt = 0; ; attempt += 1) {
    init.signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new DOMException("Request timed out", "TimeoutError");
    const controller = new AbortController();
    const abort = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), Math.min(30_000, deadline - Date.now()));
    let failure: unknown;
    try {
      const response = await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
      const body = await response.json().catch((error) => { if (controller.signal.aborted) throw error; return null; });
      if (response.ok && body !== null) return body as T;
      const error = new ApiRequestError(apiErrorMessage(body, response.statusText || i18n.t("error.requestFailed")), response.status, apiErrorCode(body));
      error.retryAfterMs = retryAfterMs(response.headers.get("retry-after"));
      error.requestAccepted = body?.requestAccepted;
      if (error.retryAfterMs !== undefined) error.message += ` ${i18n.t("error.retryAfter", { seconds: Math.ceil(error.retryAfterMs / 1000) })}`;
      throw error;
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", abort);
    }
    init.signal?.throwIfAborted();
    const canRetry = failure instanceof ApiRequestError
      ? [429, 500, 502, 503, 504].includes(failure.status) && (isGet || failure.requestAccepted === false)
      : isGet && (failure instanceof TypeError || (failure instanceof DOMException && failure.name === "TimeoutError"));
    const waitMs = failure instanceof ApiRequestError && failure.retryAfterMs !== undefined
      ? failure.retryAfterMs : 500 * 2 ** attempt + Math.random() * 250;
    if (!canRetry || attempt >= 3 || !Number.isFinite(waitMs) || Date.now() + waitMs >= deadline) throw failure;
    options.onRetry?.(waitMs);
    await waitForRetry(waitMs, init.signal);
  }
}

export function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function waitForRetry(ms: number, signal?: AbortSignal | null) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function apiErrorCode(body: unknown) {
  if (!body || typeof body !== "object") return undefined;
  return "code" in body && typeof body.code === "string" ? body.code : undefined;
}

function apiErrorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback || i18n.t("error.requestFailed");

  const code = "code" in body && typeof body.code === "string" ? body.code : "";
  const message = "message" in body && typeof body.message === "string" ? body.message : "";
  // Not a field the API sends yet — see `localizedErrorCodeMessage`. Read
  // defensively so that the day it appears, no client release is needed.
  const defaultBranch =
    "defaultBranch" in body && typeof body.defaultBranch === "string" ? body.defaultBranch : undefined;
  return localizedErrorCodeMessage(code, message || fallback, "error.requestFailed", defaultBranch);
}

// Single source of truth for error-code → i18n mapping; shared with useAnalysisRunner.
//
// Two arms below are dormant, and are forward compatibility rather than live
// behaviour. `ApiErrorBody` is `{ code, message }` and carries no
// `defaultBranch`; and an empty repository is reported as `ref_not_found`
// (`resolve_github_ref` has no default branch to resolve), so the code
// `empty_repository` is not one the API emits today. Both were written for the
// reading `defaultBranch` would give a `ref_not_found` — "then what should I
// have asked for?" — which is the one fact that would make the error
// actionable, and localizing by code throws the server's own message away, so
// there is nowhere else to put it.
//
// Neither dormant arm is observable: a `ref_not_found` without a
// `defaultBranch` renders exactly the string it renders today, and an
// unmatched code falls through to `fallback`. The ternary is what keeps that
// true and is load-bearing — i18next emits `{{branch}}` verbatim when the
// variable is missing, so `error.refNotFoundWithDefault` must never be reached
// without one.
export function localizedErrorCodeMessage(
  code: string | undefined,
  fallback: string,
  fallbackKey: string,
  defaultBranch?: string,
) {
  if (code === "private_repo") return i18n.t("error.privateRepo");
  if (code === "invalid_url") return i18n.t("error.invalidUrl");
  if (code === "ref_not_found") {
    return defaultBranch
      ? i18n.t("error.refNotFoundWithDefault", { branch: defaultBranch })
      : i18n.t("error.refNotFound");
  }
  if (code === "empty_repository") return i18n.t("error.emptyRepository");
  if (code === "rate_limited") return i18n.t("error.rateLimited");
  if (code === "github_unavailable") return i18n.t("error.githubUnavailable");
  if (code === "too_large") return i18n.t("error.tooLarge");
  if (code === "not_found") return i18n.t("error.notFound");
  if (code === "github_request_failed") return i18n.t("error.githubRequestFailed");
  if (code === "analysis_failed") return i18n.t("error.analysisFailed");
  return fallback || i18n.t(fallbackKey);
}
