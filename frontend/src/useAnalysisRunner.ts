import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import i18n from "./i18n";
import { AnalyticsEvents, providerFromRepoUrl, trackEvent } from "./analytics";
import { analyzeRepository, ApiRequestError, fetchJson } from "./api";
import { commandText } from "./reportUtils";
import type { AnalysisOptions, AppStatus, JobRecord, Report } from "./types";

type AnalysisError = {
  code?: string;
  message: string;
};

export function useAnalysisRunner({
  repoUrl,
  refName,
  defaultRepoUrl,
  defaultRefName,
  seedReport,
  analysisOptions,
}: {
  repoUrl: string;
  refName: string;
  defaultRepoUrl: string;
  defaultRefName: string;
  seedReport: Report | null;
  analysisOptions: AnalysisOptions;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStartedAt, setJobStartedAt] = useState<number | null>(null);
  const [report, setReport] = useState<Report | null>(seedReport);
  const [error, setError] = useState<AnalysisError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastCommand, setLastCommand] = useState(commandText(defaultRepoUrl, defaultRefName, false));

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    enabled: Boolean(jobId && !report),
    refetchInterval: (query) => {
      const data = query.state.data as JobRecord | undefined;
      if (data?.status === "completed" || data?.status === "failed") {
        return false;
      }
      return pollingInterval(Date.now() - (jobStartedAt ?? Date.now()));
    },
    queryFn: () => fetchJson<JobRecord>(`/api/jobs/${jobId}`),
  });

  useEffect(() => {
    const reportId = jobQuery.data?.reportId;
    if (jobQuery.data?.status !== "completed" || !reportId || report) {
      return;
    }

    let cancelled = false;
    fetchJson<Report>(`/api/reports/${reportId}`)
      .then((nextReport) => {
        if (cancelled) return;
        setReport(nextReport);
        trackEvent(AnalyticsEvents.analyzeCompleted, {
          provider: normalizedProvider(nextReport.repository.provider, nextReport.repository.htmlUrl),
          cached: nextReport.cached,
          code: nextReport.total.code,
          languages: nextReport.languages.length,
        });
        setJobId(null);
        setJobStartedAt(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(toAnalysisError(err));
        setJobId(null);
        setJobStartedAt(null);
      });

    return () => {
      cancelled = true;
    };
  }, [jobQuery.data?.status, jobQuery.data?.reportId, report]);

  useEffect(() => {
    if (jobQuery.data?.status === "failed") {
      setError(errorMessage(jobQuery.data.error));
      setJobId(null);
      setJobStartedAt(null);
    }
  }, [jobQuery.data]);

  const runAnalysis = async (forceRefresh: boolean, overrides?: { repoUrl?: string; refName?: string }) => {
    const requestedRepoUrl = overrides?.repoUrl ?? repoUrl;
    const requestedRefName = overrides?.refName ?? refName;
    const effectiveRepoUrl = requestedRepoUrl.trim() || defaultRepoUrl;
    const effectiveRefName = requestedRefName.trim() || (requestedRepoUrl.trim() ? "" : defaultRefName);
    setError(null);
    setReport(null);
    setJobId(null);
    setJobStartedAt(null);
    setIsSubmitting(true);
    const command = commandText(effectiveRepoUrl, effectiveRefName, forceRefresh);
    setLastCommand(command);
    trackEvent(AnalyticsEvents.analyzeSubmitted, {
      provider: providerFromRepoUrl(effectiveRepoUrl),
      forceRefresh,
    });

    try {
      const result = await analyzeRepository({ repoUrl: effectiveRepoUrl, refName: effectiveRefName, forceRefresh, options: analysisOptions });
      if (result.kind === "cached") {
        setReport(result.report);
        trackEvent(AnalyticsEvents.analyzeCompleted, {
          provider: normalizedProvider(result.report.repository.provider, effectiveRepoUrl),
          cached: true,
          code: result.report.total.code,
          languages: result.report.languages.length,
        });
      } else {
        setJobStartedAt(Date.now());
        setJobId(result.jobId);
      }
    } catch (err) {
      setError(toAnalysisError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const reset = () => {
    setReport(null);
    setError(null);
    setJobId(null);
    setJobStartedAt(null);
  };

  const status: AppStatus = error
    ? "failed"
    : report
      ? report.cached
        ? "cached"
        : "completed"
      : jobQuery.data?.status ?? (jobId || isSubmitting ? "queued" : "idle");

  return {
    report,
    error: error?.message ?? jobQuery.data?.error?.message ?? null,
    errorCode: error?.code ?? jobQuery.data?.error?.code,
    isSubmitting,
    lastCommand,
    status,
    setLastCommand,
    runAnalysis,
    reset,
  };
}

function pollingInterval(elapsedMs: number) {
  if (elapsedMs < 5_000) return 1_200;
  if (elapsedMs < 30_000) return 2_500;
  return 5_000;
}

function normalizedProvider(provider: Report["repository"]["provider"], fallbackUrl: string) {
  if (provider === "gitlab" || provider === "gitLab") return "gitlab";
  if (provider === "github" || provider === "gitHub") return "github";
  return providerFromRepoUrl(fallbackUrl);
}

function errorMessage(error: JobRecord["error"]): AnalysisError {
  if (!error) return { message: i18n.t("runner.status.failed") };
  return { code: error.code, message: localizedErrorMessage(error.code, error.message) };
}

function toAnalysisError(error: unknown): AnalysisError {
  if (error instanceof ApiRequestError) {
    return { code: error.code, message: error.message };
  }
  return { message: error instanceof Error ? error.message : i18n.t("error.requestFailed") };
}

function localizedErrorMessage(code: string | undefined, fallback: string) {
  if (code === "private_repo") return i18n.t("error.privateRepo");
  if (code === "invalid_url") return i18n.t("error.invalidUrl");
  if (code === "ref_not_found") return i18n.t("error.refNotFound");
  if (code === "rate_limited") return i18n.t("error.rateLimited");
  if (code === "github_unavailable") return i18n.t("error.githubUnavailable");
  if (code === "too_large") return i18n.t("error.tooLarge");
  if (code === "not_found") return i18n.t("error.notFound");
  if (code === "github_request_failed") return i18n.t("error.githubRequestFailed");
  if (code === "analysis_failed") return i18n.t("error.analysisFailed");
  return fallback || i18n.t("runner.status.failed");
}
