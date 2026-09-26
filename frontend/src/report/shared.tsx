// Helpers shared between the report-page components extracted from main.tsx.
// Pure move from main.tsx — behavior unchanged.
import { useEffect, useRef, useState } from "react";
import { buildPublicReportUrl } from "../badges";
import { formatCompactNumber } from "../reportUtils";
import type { Report } from "../types";

export function StarBadge({ stars, size = 11, className }: { stars: number; size?: number; className?: string }) {
  return (
    <span className={className} aria-label={`${formatCompactNumber(stars)} stars`}>
      <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 .25a.75.75 0 0 1 .67.42l1.88 3.8 4.2.61a.75.75 0 0 1 .42 1.28l-3.04 2.96.72 4.17a.75.75 0 0 1-1.09.79L8 12.35l-3.76 1.97a.75.75 0 0 1-1.09-.79l.72-4.17L.83 6.36a.75.75 0 0 1 .42-1.28l4.2-.6L6.66.66A.75.75 0 0 1 8 .25Z"/></svg>
      {formatCompactNumber(stars)}
    </span>
  );
}

// Copy-with-feedback state shared by the badge/url/report copy buttons.
export function useCopied(timeoutMs = 1800) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const showCopied = (key: string) => {
    setCopiedKey(key);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopiedKey(null), timeoutMs);
  };
  return { copiedKey, showCopied };
}

// Canonical URLs stay clean for search. Shared URLs deliberately pin the
// resolved commit and include the user-visible counting options, so reopening
// one can reproduce this report instead of silently recounting a branch with
// default options.
export function buildSnapshotReportUrl(report: Report) {
  const ref = report.commitSha || report.refName;
  const base = buildPublicReportUrl(report.repository.owner, report.repository.name, ref);
  const params = new URLSearchParams();
  params.set("analysis", JSON.stringify(report.analysisOptions));
  return `${base}?${params.toString()}`;
}
