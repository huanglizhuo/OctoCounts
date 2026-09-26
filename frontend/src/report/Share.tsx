// Report-page share surface, restructured from the old ShareShowcase +
// ReportUtilityActions pair into ONE "Share & embed" section: the primary
// copy-URL action, the PNG card, the one-click share targets, the citation /
// compare / diff / badges links, and the badge-markdown / embed-iframe
// copies. Raw text/JSON export moved to the Technical details disclosure in
// Runner.tsx. Analytics event names and clipboard-fallback behavior are
// unchanged from the pre-merge components.
import React, { useEffect, useRef, useState } from "react";
import { Clipboard, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ShareButtons } from "../ShareButtons";
import { formatNumber, formatPercent, normalizedProvider, tickerRows, visibleLanguageColor } from "../reportUtils";
import type { Report } from "../types";
import { ReportToolLinks } from "./ReportContextTools";
import { StarBadge, buildSnapshotReportUrl } from "./shared";

// Scales a fixed-size child (the 1200x630 share card) down to fit whatever
// width its wrapper actually ends up with. A handful of guessed breakpoints
// clipped the card at in-between widths once page padding was accounted for
// — measuring is the only way to always match exactly. Written straight to
// the CSS variable via the DOM node rather than through React state: the
// value only ever feeds that one property, so there's no reason to re-render
// the share card and its buttons on every resize tick.
function useElementScale(baseWidth: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) el.style.setProperty("--card-scale", String(width / baseWidth));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [baseWidth]);
  return ref;
}

// The visual and behavioral centerpiece of the "make this grow" funnel: the
// shareable card is rendered for real (it used to sit off-screen, used only
// as an export source — nobody ever saw the thing they'd be posting) next to
// the one-click share targets, the primary copy-URL CTA, and every other
// thing this report can be turned into.
export function ShareSection({
  report,
  stars,
  cardRef,
  copiedCta,
  isExporting,
  exportError,
  copyError,
  onCopyUrl,
  onExportPng,
  onCopyBadge,
  onCopyEmbed,
}: {
  report: Report;
  stars: number | null;
  cardRef: React.RefObject<HTMLDivElement | null>;
  copiedCta: string | null;
  isExporting: boolean;
  exportError: string | null;
  copyError: string | null;
  onCopyUrl: () => void;
  onExportPng: () => void;
  onCopyBadge: () => Promise<boolean>;
  onCopyEmbed: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const cardWrapRef = useElementScale(1200);
  // Expanded by default wherever the summary is a comfortable read (desktop),
  // collapsed under 720px where the card would otherwise dominate the first
  // screenful. The toggle reflects and controls this state.
  const [previewOpen, setPreviewOpen] = useState(() => !window.matchMedia("(max-width: 720px)").matches);
  const isGitHub = normalizedProvider(report) === "github";
  const [copyFeedback, setCopyFeedback] = useState<"copied" | "failed" | null>(null);
  const [manualCopyValue, setManualCopyValue] = useState<string | null>(null);
  const runCopy = async (action: () => Promise<boolean>, fallbackValue?: string) => {
    const copied = await action();
    setCopyFeedback(copied ? "copied" : "failed");
    setManualCopyValue(copied ? null : fallbackValue ?? null);
  };

  return (
    <section id="share-showcase" className="share-showcase" aria-label={t("reportCta.ariaLabel")}>
      <div className="share-showcase-head">
        <span className="chart-tag">{t("reportCta.kicker")}</span>
        <strong>{t("reportCta.title")}</strong>
        <span>{t("reportCta.subtitle")}</span>
      </div>
      <div className="share-showcase-body">
        <div className="share-preview-col">
          <p className="share-theme-note">{t("reportCta.darkThemeNote")}</p>
          <details className="share-preview" open={previewOpen} onToggle={(event) => setPreviewOpen(event.currentTarget.open)}>
            <summary>{previewOpen ? t("reportCta.hidePreview") : t("reportCta.showPreview")}</summary>
            <div className="share-showcase-card" ref={cardWrapRef}>
              <ShareTickerCard ref={cardRef} report={report} stars={stars} />
            </div>
          </details>
        </div>
        <div className="share-showcase-actions">
          <div className="row-flex">
            <button className="btn install-btn" type="button" onClick={onCopyUrl}>
              <Clipboard size={14} />
              {copiedCta === "url" ? t("reportCta.copied") : t("reportCta.copyUrl")}
            </button>
            <button className="copybtn" type="button" disabled={isExporting} onClick={onExportPng}>
              <Download size={14} />
              {t("reportCta.exportPng")}
            </button>
          </div>
          <ShareButtons
            url={buildSnapshotReportUrl(report)}
            text={t("share.reportText", { repo: `${report.repository.owner}/${report.repository.name}`, code: formatNumber(report.total.code) })}
            placement="report"
          />
          <ReportToolLinks report={report} repoUrl={report.repository.htmlUrl} refName={report.refName} />
          <div className="row-flex">
            {isGitHub ? (
              <button className="copybtn" type="button" onClick={() => void runCopy(onCopyBadge)}>
                <Clipboard size={14} />
                {copiedCta === "badge" ? t("reportCta.copied") : t("reportCta.copyBadge")}
              </button>
            ) : null}
            <button className="copybtn" type="button" onClick={() => void runCopy(onCopyEmbed)}>
              <Clipboard size={14} />
              {copiedCta === "embed" ? t("reportCta.copied") : t("reportCta.copyEmbed")}
            </button>
          </div>
          {copyFeedback ? <span className="copy-feedback" role="status">{copyFeedback === "copied" ? t("reportCta.copied") : t("reportCta.copyFailedShort")}</span> : null}
          {exportError || copyError ? <div className="export-error" role="alert"><p>{exportError ?? copyError}</p>{copyError ? <textarea className="manual-copy" readOnly value={buildSnapshotReportUrl(report)} aria-label={t("reportCta.manualCopyAria")} onFocus={(event) => event.currentTarget.select()} /> : null}</div> : null}
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
