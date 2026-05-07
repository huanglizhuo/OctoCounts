import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { analyzeRepository, fetchJson } from "./api";
import { commandText } from "./reportUtils";
import type { AppStatus, JobRecord, Report } from "./types";

export function useAnalysisRunner({
  repoUrl,
  refName,
  defaultRepoUrl,
  defaultRefName,
  seedReport,
}: {
  repoUrl: string;
  refName: string;
  defaultRepoUrl: string;
  defaultRefName: string;
  seedReport: Report | null;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(seedReport);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastCommand, setLastCommand] = useState(commandText(defaultRepoUrl, defaultRefName, false));

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    enabled: Boolean(jobId && !report),
    refetchInterval: (query) => {
      const data = query.state.data as JobRecord | undefined;
      return data?.status === "completed" || data?.status === "failed" ? false : 1200;
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
        setJobId(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to fetch completed report");
        setJobId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [jobQuery.data?.status, jobQuery.data?.reportId, report]);

  useEffect(() => {
    if (jobQuery.data?.status === "failed") {
      setError(errorMessage(jobQuery.data.error));
      setJobId(null);
    }
  }, [jobQuery.data]);

  const runAnalysis = async (forceRefresh: boolean) => {
    const effectiveRepoUrl = repoUrl.trim() || defaultRepoUrl;
    const effectiveRefName = refName.trim() || (repoUrl.trim() ? "" : defaultRefName);
    setError(null);
    setReport(null);
    setJobId(null);
    setIsSubmitting(true);
    const command = commandText(effectiveRepoUrl, effectiveRefName, forceRefresh);
    setLastCommand(command);

    try {
      const result = await analyzeRepository({ repoUrl: effectiveRepoUrl, refName: effectiveRefName, forceRefresh });
      if (result.kind === "cached") {
        setReport(result.report);
      } else {
        setJobId(result.jobId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network request failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const reset = () => {
    setReport(null);
    setError(null);
    setJobId(null);
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
    error: error ?? jobQuery.data?.error?.message ?? null,
    isSubmitting,
    lastCommand,
    status,
    setLastCommand,
    runAnalysis,
    reset,
  };
}

function errorMessage(error: JobRecord["error"]) {
  if (error?.code === "private_repo") return "Private repositories are not supported.";
  return error?.message ?? "Analysis failed.";
}
