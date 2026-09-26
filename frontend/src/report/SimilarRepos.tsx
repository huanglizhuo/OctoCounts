// Pure move from main.tsx — behavior unchanged.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchJson } from "../api";
import { trackEvent } from "../analytics";
import { formatNumber, normalizedProvider } from "../reportUtils";
import type { RelatedReport, Report } from "../types";

// "Similar repositories" cards under a finished report. The data comes from
// the public /api/seo/related endpoint (same feed the edge SSR embeds for
// crawlers); any failure simply hides the module.
export function SimilarRepos({ report }: { report: Report }) {
  const { t } = useTranslation();
  const provider = normalizedProvider(report);
  const query = useQuery({
    queryKey: ["related-reports", provider, report.repository.owner, report.repository.name],
    queryFn: () =>
      fetchJson<{ reports: RelatedReport[] }>(
        `/api/seo/related?provider=${encodeURIComponent(provider)}&owner=${encodeURIComponent(report.repository.owner)}&repo=${encodeURIComponent(report.repository.name)}`,
      ),
    staleTime: 60 * 60 * 1000,
    retry: 0,
  });
  const related = (query.data?.reports ?? []).slice(0, 6);
  if (related.length === 0) return null;

  return (
    <section className="similar-repos" aria-label={t("similarRepos.ariaLabel")}>
      <div className="section-h">
        <h2>{t("similarRepos.title")}</h2>
        <span className="sub">{t("similarRepos.subtitle")}</span>
      </div>
      <div className="growth-repo-grid">
        {related.map((item) => (
          <a
            className="growth-repo-card"
            href={item.publicPath}
            key={item.publicPath}
            onClick={() =>
              trackEvent("similar_repo_clicked", {
                provider,
                placement: "report_similar",
                target: `${item.owner}/${item.repo}`,
              })
            }
          >
            <span className="chart-tag">{item.provider}</span>
            <strong>{item.repoFullName}</strong>
            <span>{item.topLanguage ?? t("similarRepos.mixed")} · {formatNumber(item.totalCode)} {t("similarRepos.codeLines")}</span>
            <em>{item.publicPath}</em>
          </a>
        ))}
      </div>
    </section>
  );
}
