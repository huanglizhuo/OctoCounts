// Report-page share surface: the one-click share targets and the
// badge-markdown / embed-iframe copies. (The card preview that used to live
// here was retired — the growth finale frame now doubles as the share card,
// see exportGrowthPng. The sticky-bar PNG export still captures an offscreen
// ShareTickerCard below the fold in Runner.tsx.) The primary copy-URL action
// and the compare/diff/citation/badges links live in the ReportActions bar.
import React, { useState } from "react";
import { Clipboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnalyticsEvents, trackEvent } from "../analytics";
import { buildBadgeUrl, buildEmbedSnippet, buildEmbedUrl } from "../badges";
import { ShareButtons } from "../ShareButtons";
import { copyText, formatNumber, formatPercent, normalizedProvider, tickerRows, visibleLanguageColor } from "../reportUtils";
import type { Report } from "../types";
import { StarBadge, buildSnapshotReportUrl, useCopied } from "./shared";

// The "Share & embed" surface: the one-click share targets plus the
// badge-markdown / embed-iframe copies. (The old card preview lived here too;
// it was retired in favor of the growth finale frame, which doubles as the
// share card — see exportGrowthPng. Runner still captures an offscreen
// ShareTickerCard for the sticky-bar PNG export.)
export function ShareSection({ report, stars }: { report: Report; stars: number | null }) {
  const { t } = useTranslation();
  const isGitHub = normalizedProvider(report) === "github";
  const copied = useCopied();
  const [copyFeedback, setCopyFeedback] = useState<"copied" | "failed" | null>(null);
  const [manualCopyValue, setManualCopyValue] = useState<string | null>(null);
  const runCopy = async (action: () => Promise<boolean>, fallbackValue?: string) => {
    const ok = await action();
    setCopyFeedback(ok ? "copied" : "failed");
    setManualCopyValue(ok ? null : fallbackValue ?? null);
  };

  const copyBadge = async () => {
    const url = buildSnapshotReportUrl(report);
    const badgeUrl = isGitHub
      ? buildBadgeUrl(report.repository.owner, report.repository.name, report.refName, "summary", "")
      : "";
    if (!badgeUrl) return false;
    const ok = await copyText(`[![OctoCounts](${badgeUrl})](${url})`);
    if (ok) { copied.showCopied("badge"); trackEvent(AnalyticsEvents.badgeMarkdownCopied, { provider: "github", placement: "report_utility" }); }
    return ok;
  };

  const copyEmbed = async () => {
    const provider = normalizedProvider(report);
    const ok = await copyText(buildEmbedSnippet(buildEmbedUrl(provider, report.repository.owner, report.repository.name)));
    if (ok) { copied.showCopied("embed"); trackEvent(AnalyticsEvents.embedSnippetCopied, { provider, placement: "report_utility" }); }
    return ok;
  };

  return (
    <section id="share-showcase" className="share-showcase" aria-label={t("reportCta.ariaLabel")}>
      <div className="share-showcase-head">
        <strong>{t("reportCta.title")}</strong>
        <span>{t("reportCta.subtitle")}</span>
      </div>
      <div className="share-showcase-body">
        <div className="share-showcase-actions">
          <ShareButtons
            url={buildSnapshotReportUrl(report)}
            text={t("share.reportText", { repo: `${report.repository.owner}/${report.repository.name}`, code: formatNumber(report.total.code) })}
            placement="report"
          />
          <div className="row-flex">
            {isGitHub ? (
              <button className="copybtn" type="button" onClick={() => void runCopy(copyBadge)}>
                <Clipboard size={14} />
                {copied.copiedKey === "badge" ? t("reportCta.copied") : t("reportCta.copyBadge")}
              </button>
            ) : null}
            <button className="copybtn" type="button" onClick={() => void runCopy(copyEmbed)}>
              <Clipboard size={14} />
              {copied.copiedKey === "embed" ? t("reportCta.copied") : t("reportCta.copyEmbed")}
            </button>
          </div>
          {copyFeedback ? <span className="copy-feedback" role="status">{copyFeedback === "copied" ? t("reportCta.copied") : t("reportCta.copyFailedShort")}</span> : null}
          {manualCopyValue ? <textarea className="manual-copy utility-manual-copy" readOnly value={manualCopyValue} aria-label={t("reportCta.manualContentAria")} onFocus={(event) => event.currentTarget.select()} /> : null}
        </div>
      </div>
    </section>
  );
}

export const ShareTickerCard = React.forwardRef<HTMLDivElement, { report: Report; stars?: number | null }>(function ShareTickerCard({ report, stars }, ref) {
  const { t } = useTranslation();
  const rows = tickerRows(report).slice(0, 6);
  const hasMoreLanguages = report.languages.length > rows.length;
  const total = report.total.code + report.total.comments + report.total.blanks;
  return (
    <div className="share-card" ref={ref}>
      <div className="share-window">
        <div className="share-head">
          <div className="lights"><span className="r" /><span className="y" /><span className="g" /></div>
          <span>{t("shareCard.title")}</span>
        </div>
        <div className="share-body">
          <div className="share-kicker-row">
            <div className="share-kicker">{report.repository.owner}/{report.repository.name}</div>
            {typeof stars === "number" ? (
              <StarBadge className="share-stars" size={15} stars={stars} />
            ) : null}
          </div>
          <div className="share-ref">{report.refName} / {report.commitSha.slice(0, 12)}</div>
          <div className="share-total">
            <span>{t("shareCard.totalLoc")}</span>
            <strong>{formatNumber(report.total.lines)}</strong>
          </div>
          <div className="share-breakdown">
            <ShareStat color="var(--accent)" label={t("shareCard.labelCode")} value={report.total.code} />
            <ShareStat color="var(--accent-2)" label={t("shareCard.labelComments")} value={report.total.comments} />
            <ShareStat color="var(--violet)" label={t("shareCard.labelBlanks")} value={report.total.blanks} />
          </div>
          <div className="share-ticker">
            <div className="share-ticker-list">
              {rows.map((row) => (
                <div className="share-ticker-row" key={row.label}>
                  <span>{row.label}</span>
                  <i><b style={{ width: `${row.percent}%`, background: visibleLanguageColor(row.color, "matrix") }} /></i>
                  <em>{formatNumber(row.value)}</em>
                </div>
              ))}
            </div>
            {hasMoreLanguages ? <div className="share-ticker-note">{t("shareCard.topLanguages")}</div> : null}
          </div>
          <div className="share-foot">
            <span>{t("shareCard.percentCode", { percent: formatPercent(report.total.code, total) })}</span>
            <span>{t("shareCard.generatedBy")}</span>
          </div>
        </div>
      </div>
    </div>
  );
});

function ShareStat({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="share-stat">
      <span style={{ background: color }} />
      <p>{label}</p>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}
