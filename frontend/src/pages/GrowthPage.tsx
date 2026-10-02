// The standalone growth-replay page: /growth/:owner/:repo. A focused view of
// the "Watch this repo grow" animation for sharing and embedding — the same
// GrowthSection the report page renders, fed by the canonical (SEO) report so
// the URL works without running an analysis first. Client-routed like the
// other tool pages; edge SSR for this route remains a v2 item (plan §12).
import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "lucide-react";
import { fetchCanonicalReport } from "../api";
import { GrowthSection } from "../report/GrowthSection";

export function GrowthPage({ path }: { path: string }) {
  const { t } = useTranslation();
  const segments = path.slice("/growth/".length).split("/").filter(Boolean).map(decodeURIComponent);
  const [owner = "", repo = ""] = segments;
  const valid = segments.length === 2 && owner.length > 0 && repo.length > 0;

  const canonical = useQuery({
    queryKey: ["canonical-report", "github", owner, repo],
    queryFn: () => fetchCanonicalReport("github", owner, repo),
    staleTime: 60 * 1000,
    retry: false,
    enabled: valid,
  });

  useEffect(() => {
    document.title = valid ? `${owner}/${repo} · Growth · OctoCounts` : "Growth · OctoCounts";
  }, [valid, owner, repo]);

  return (
    <main className="growth-page">
      <header className="growth-page-head">
        <h1 className="runner-repo">{valid ? `${owner}/${repo}` : "Growth"}</h1>
        {valid ? (
          <a className="copybtn growth-page-report-link" href={`/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`}>
            <Link size={13} aria-hidden="true" /> {t("growth.animation.fullReport")}
          </a>
        ) : null}
      </header>
      {!valid ? (
        <p className="growth-empty" role="alert">{t("growth.animation.unavailable")}</p>
      ) : canonical.isLoading ? (
        <div className="growth-skeleton" role="status" aria-label={t("growth.animation.loadingHistory")} />
      ) : canonical.data ? (
        <GrowthSection report={canonical.data} />
      ) : (
        <p className="growth-empty" role="alert">{t("growth.animation.unavailable")}</p>
      )}
    </main>
  );
}
