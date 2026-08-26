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

// Statuspage's aggregate `indicator` vocabulary, of which "none" is the
// healthy value. Kept as data next to the predicate below so that the one
// place in this codebase that knows GitHub's status vocabulary is also the one
// place that decides what it means.
const DEGRADED_INDICATORS = new Set(["minor", "major", "critical", "maintenance"]);

/**
 * Whether the repository host is reporting trouble, i.e. whether a "this may
 * fail" hint is honest.
 *
 * The healthy `indicator` is "none", *not* "operational" — "All Systems
 * Operational" is the human-readable `description` beside it. Mistaking one
 * for the other is not hypothetical: both call sites shipped
 * `indicator !== "operational"`, which is true precisely when GitHub is
 * healthy, so the homepage showed every visitor "All Systems Operational —
 * analyses may fail until it recovers" on every load, and the error path's
 * "status page reports normal operation" copy was unreachable except when the
 * fetch itself failed.
 *
 * An unrecognised indicator counts as healthy, deliberately. This is
 * supplementary context and never a dependency of the analysis flow (see
 * `fetchGithubStatus`), so failing quiet costs a missing hint during an
 * outage, while failing loud costs a permanent scare line under the hero —
 * which is the bug this function exists to prevent, not to re-enact under a
 * new spelling.
 */
export function isHostDegraded(status: HostStatus | null): status is HostStatus {
  return status !== null && DEGRADED_INDICATORS.has(status.indicator);
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
