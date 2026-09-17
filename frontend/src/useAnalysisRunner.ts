import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import i18n from "./i18n";
import { AnalyticsEvents, providerFromRepoUrl, trackEvent } from "./analytics";
import { analyzeRepository, ApiRequestError, fetchJson, localizedErrorCodeMessage } from "./api";
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
  // Network aborts are advisory: a completed request can still resolve after it
  // has been aborted. The monotonically increasing operation is the authority
  // for every state write, so an older sample/recent click cannot replace the
  // report the visitor most recently asked for.
  const operationRef = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const deadlineTimer = useRef<number | null>(null);
  const [jobOperation, setJobOperation] = useState(0);

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
    // Long-poll: the backend holds each request until the job's status
    // changes or 20s elapse (its cap is 25s), so one request covers one
    // status change instead of one 1.2–5s slice. TanStack Query never
    // overlaps refetches of the same key, and the interval below becomes
    // just the gap between polls.
    queryFn: () => fetchJson<JobRecord>(`/api/jobs/${jobId}?wait=20`),
  });

  useEffect(() => {
    const reportId = jobQuery.data?.reportId;
    if (jobQuery.data?.status !== "completed" || !reportId || report) {
      return;
    }

    const operation = jobOperation;
    let cancelled = false;
    fetchJson<Report>(`/api/reports/${reportId}`)
      .then((nextReport) => {
        if (cancelled || operation !== operationRef.current) return;
        clearDeadline(deadlineTimer);
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
        if (cancelled || operation !== operationRef.current) return;
        clearDeadline(deadlineTimer);
        setError(toAnalysisError(err));
        setJobId(null);
        setJobStartedAt(null);
      });

    return () => {
      cancelled = true;
    };
  }, [jobQuery.data?.status, jobQuery.data?.reportId, report, jobOperation]);

  useEffect(() => {
    if (jobQuery.data?.status === "failed" && jobOperation === operationRef.current) {
      setError(errorMessage(jobQuery.data.error));
      clearDeadline(deadlineTimer);
      setJobId(null);
      setJobStartedAt(null);
    }
  }, [jobQuery.data, jobOperation]);

  useEffect(() => {
    if (!jobQuery.isError || jobOperation !== operationRef.current) return;
    setError(toAnalysisError(jobQuery.error));
    clearDeadline(deadlineTimer);
    setJobId(null);
    setJobStartedAt(null);
  }, [jobQuery.isError, jobQuery.error, jobOperation]);

  useEffect(() => () => { activeController.current?.abort(); clearDeadline(deadlineTimer); }, []);

  const runAnalysis = async (forceRefresh: boolean, overrides?: { repoUrl?: string; refName?: string }) => {
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    activeController.current?.abort();
    clearDeadline(deadlineTimer);
    const controller = new AbortController();
    activeController.current = controller;
    deadlineTimer.current = window.setTimeout(() => {
      if (operation !== operationRef.current) return;
      operationRef.current += 1;
      controller.abort();
      setError({ message: i18n.t("runner.status.timedOut") });
      setJobId(null);
      setJobStartedAt(null);
      setIsSubmitting(false);
    }, 120_000);
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
      const result = await analyzeRepository({ repoUrl: effectiveRepoUrl, refName: effectiveRefName, forceRefresh, options: analysisOptions, signal: controller.signal });
      if (operation !== operationRef.current) return;
      if (result.kind === "cached") {
        clearDeadline(deadlineTimer);
        setReport(result.report);
        trackEvent(AnalyticsEvents.analyzeCompleted, {
          provider: normalizedProvider(result.report.repository.provider, effectiveRepoUrl),
          cached: true,
          code: result.report.total.code,
          languages: result.report.languages.length,
        });
      } else {
        setJobStartedAt(Date.now());
        setJobOperation(operation);
        setJobId(result.jobId);
      }
    } catch (err) {
      if (operation !== operationRef.current || (err instanceof DOMException && err.name === "AbortError")) return;
      clearDeadline(deadlineTimer);
      setError(toAnalysisError(err));
    } finally {
      if (operation === operationRef.current) setIsSubmitting(false);
    }
  };

  const reset = () => {
    operationRef.current += 1;
    activeController.current?.abort();
    clearDeadline(deadlineTimer);
    setReport(null);
    setError(null);
    setJobId(null);
    setJobStartedAt(null);
    setIsSubmitting(false);
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

function clearDeadline(timer: MutableRefObject<number | null>) {
  if (timer.current !== null) window.clearTimeout(timer.current);
  timer.current = null;
}

function pollingInterval(elapsedMs: number) {
  if (elapsedMs < 5_000) return 1_200;
  if (elapsedMs < 30_000) return 2_500;
  return 5_000;
}

function normalizedProvider(provider: Report["repository"]["provider"], fallbackUrl: string) {
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
  return localizedErrorCodeMessage(code, fallback, "runner.status.failed");
}
