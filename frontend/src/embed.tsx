import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import React, { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { fetchJson } from "./api";
import { buildEmbedUrl, buildPublicReportUrl, type EmbedProvider } from "./badges";
import { formatCompactNumber, formatNumber, formatPercent, languageColor } from "./reportUtils";

// iframe-embeddable SLOC card served at /embed/:provider/:owner/:repo. No page
// chrome, transparent background, fixed light palette so it drops cleanly into
// blog/docs iframes (the edge function relaxes frame-ancestors for /embed/
// only). Data comes from the public SEO report summary endpoint: cached and
// never triggers a fresh analysis, so embedding is cheap at any traffic level.

export type EmbedRoute = { provider: EmbedProvider; owner: string; repo: string };

type EmbedReportSummary = {
  repoFullName: string;
  provider: string;
  publicPath: string;
  refName: string;
  total: { lines: number; code: number };
  languages: Array<{ name: string; stats: { lines: number; code: number } }>;
};

export function parseEmbedPath(pathname: string): EmbedRoute | null {
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments[0] !== "embed") return null;
  const provider = segments[1];
  if (provider !== "github" && provider !== "gitlab") return null;
  // GitLab owners can be nested groups, so everything between the provider and
  // the last segment is the owner path — same convention as buildPublicReportUrl.
  if (segments.length < 4) return null;
  const owner = segments.slice(2, -1).join("/");
  const repo = segments[segments.length - 1];
  if (!owner || !repo) return null;
  return { provider, owner, repo };
}

export function EmbedPage() {
  const { t } = useTranslation();
  const route = useMemo(() => parseEmbedPath(window.location.pathname), []);

  // The card must blend into the host page: kill the app's dark scheme
  // background and grid overlay for the lifetime of the embed view.
  useEffect(() => {
    document.body.classList.add("embed-mode");
    return () => document.body.classList.remove("embed-mode");
  }, []);

  const query = useQuery({
    queryKey: ["embed-report", route?.provider, route?.owner, route?.repo],
    enabled: Boolean(route),
    staleTime: 60 * 60 * 1000,
    retry: 0,
    queryFn: () => {
      const params = new URLSearchParams({ provider: route!.provider, owner: route!.owner, repo: route!.repo });
      return fetchJson<EmbedReportSummary>(`/api/seo/report?${params.toString()}`);
    },
  });

  const report = query.data ?? null;
  const reportUrl = report
    ? `${window.location.origin}${report.publicPath}`
    : route
      ? buildPublicReportUrl(route.owner, route.repo, "", route.provider)
      : window.location.origin;

  useEffect(() => {
    document.title = report
      ? `${report.repoFullName} SLOC card | OctoCounts`
      : t("embedCard.loading");
  }, [report, t]);

  if (!route) {
    return (
      <main className="embed-page">
        <div className="embed-card embed-state" role="alert">{t("embedCard.unavailable")}</div>
      </main>
    );
  }

  return (
    <main className="embed-page">
      {report ? (
        <EmbedCard report={report} reportUrl={reportUrl} />
      ) : (
        <div className="embed-card embed-state" role="status">
          {query.isError ? (
            <>
              <span>{t("embedCard.unavailable")}</span>
              <a href={reportUrl} target="_blank" rel="noreferrer">{t("embedCard.viewReport")} <ExternalLink size={11} aria-hidden="true" /></a>
            </>
          ) : (
            <><Loader2 className="spin" size={14} aria-hidden="true" /> {t("embedCard.loading")}</>
          )}
        </div>
      )}
    </main>
  );
}

function EmbedCard({ report, reportUrl }: { report: EmbedReportSummary; reportUrl: string }) {
  const { t } = useTranslation();
  const segments = languageSegments(report.languages);
  const totalLines = Math.max(report.total.lines, 1);

  return (
    <div className="embed-card" role="group" aria-label={t("embedCard.ariaLabel", { repo: report.repoFullName })}>
      <div className="embed-card-head">
        <a className="embed-card-repo" href={reportUrl} target="_blank" rel="noreferrer">{report.repoFullName}</a>
        <span className="embed-card-ref">{report.refName}</span>
      </div>
      <div className="embed-card-stats">
        <span><strong>{formatCompactNumber(report.total.lines)}</strong> {t("embedCard.lines")}</span>
        <span><strong>{formatCompactNumber(report.total.code)}</strong> {t("embedCard.code")}</span>
      </div>
      <div className="embed-card-bar" role="img" aria-label={segments.map((segment) => `${segment.name} ${formatPercent(segment.lines, totalLines)}`).join(", ")}>
        {segments.map((segment) => (
          <i key={segment.name} style={{ width: `${Math.max((segment.lines / totalLines) * 100, 0.5)}%`, background: languageColor(segment.name) }} />
        ))}
      </div>
      <div className="embed-card-legend">
        {segments.slice(0, 3).map((segment) => (
          <span key={segment.name}>
            <b style={{ background: languageColor(segment.name) }} />
            {segment.name} {formatPercent(segment.lines, totalLines)}
          </span>
        ))}
      </div>
      <a className="embed-card-powered" href={reportUrl} target="_blank" rel="noreferrer" title={formatNumber(report.total.lines)}>
        {t("embedCard.poweredBy")}
      </a>
    </div>
  );
}

// Top 5 languages by total lines plus an "Other" bucket — the same shape the
// report donut chart uses (chartUtils.languagePieItems), kept local so the
// embed chunk stays small.
function languageSegments(languages: EmbedReportSummary["languages"]) {
  const sorted = [...languages].filter((language) => language.stats.lines > 0).sort((a, b) => b.stats.lines - a.stats.lines);
  const top = sorted.slice(0, 5).map((language) => ({ name: language.name, lines: language.stats.lines }));
  const rest = sorted.slice(5).reduce((sum, language) => sum + language.stats.lines, 0);
  if (rest > 0) top.push({ name: "Other", lines: rest });
  return top;
}
