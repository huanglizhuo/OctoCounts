import { useEffect, useState } from "react";

export type HostStatus = {
  indicator: string;
  description: string;
};

const STATUS_URL = "https://www.githubstatus.com/api/v2/status.json";
// The status page reports minute-scale changes; polling faster than this
// adds requests without adding information.
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { at: number; value: HostStatus | null } | null = null;
let inflight: Promise<HostStatus | null> | null = null;

/**
 * GitHub's official aggregate status, or null when it could not be fetched.
 * Failures are silent on purpose: the status is supplementary context for
 * error attribution, never a dependency of the analysis flow itself.
 */
export function fetchGithubStatus(): Promise<HostStatus | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return Promise.resolve(cache.value);
  if (inflight) return inflight;
  inflight = fetch(STATUS_URL)
    .then((response) => (response.ok ? response.json() : null))
    .then((body: unknown) => {
      const status =
        body && typeof body === "object" && "status" in body
          ? (body as { status?: { indicator?: unknown; description?: unknown } }).status
          : undefined;
      const value =
        typeof status?.indicator === "string" && typeof status?.description === "string"
          ? { indicator: status.indicator, description: status.description }
          : null;
      cache = { at: Date.now(), value };
      return value;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Live host status for components; re-renders once the fetch settles. */
export function useGithubStatus(): HostStatus | null {
  const [status, setStatus] = useState<HostStatus | null>(() => cache?.value ?? null);
  useEffect(() => {
    let cancelled = false;
    fetchGithubStatus().then((value) => {
      if (!cancelled) setStatus(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}
