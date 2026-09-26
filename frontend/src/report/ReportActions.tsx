// The report's primary action bar: copy link, export (text/JSON copies plus
// the real PNG download), re-analyze, and a "more" menu with the
// compare/diff/citation/badges entries. Rendered once under the runner head
// and reused (compact) inside the sticky bar, so there is exactly one copy of
// the URL-building and clipboard logic. Copy-failure feedback keeps the
// manual-copy textarea fallback next to the actions that produced it.
import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Clipboard, Download, FileJson, Link2, MoreHorizontal, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnalyticsEvents, trackEvent } from "../analytics";
import { copyText, normalizedProvider, textReport } from "../reportUtils";
import type { Report } from "../types";
import { reportToolLinks } from "./ReportContextTools";
import { buildSnapshotReportUrl, useCopied } from "./shared";

export function ReportActions({
  report,
  onRerun,
  onReset,
  onExportPng,
  isExporting,
  exportError,
  placement,
  compact = false,
}: {
  report: Report;
  onRerun: () => void;
  onReset: () => void;
  onExportPng: () => void;
  isExporting: boolean;
  exportError: string | null;
  placement: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const copied = useCopied();
  const [manualCopyValue, setManualCopyValue] = useState<string | null>(null);
  const provider = normalizedProvider(report);
  const snapshotUrl = buildSnapshotReportUrl(report);
  const targets = reportToolLinks(report, report.repository.htmlUrl, report.refName);

  // Centralized copy-with-fallback: transient "copied" feedback on success,
  // a selectable textarea with the exact content on failure.
  const runCopy = (key: string, value: string, onCopied?: () => void) => {
    void copyText(value).then((ok) => {
      if (!ok) {
        setManualCopyValue(value);
        return;
      }
      setManualCopyValue(null);
      copied.showCopied(key);
      onCopied?.();
    });
  };

  return (
    <div className={`report-actions${compact ? " compact" : ""}`} role="group" aria-label={t("reportActions.barAria")}>
      <button
        type="button"
        className="copybtn report-action-copy"
        onClick={() => {
          runCopy("url", snapshotUrl);
          trackEvent(AnalyticsEvents.reportUrlCopied, { provider, placement });
        }}
      >
        <Link2 size={14} aria-hidden="true" />
        {copied.copiedKey === "url" ? t("reportCta.copied") : t("reportActions.copyLink")}
      </button>
      <ActionMenu label={t("reportActions.export")} icon={<Download size={14} aria-hidden="true" />}>
        <button type="button" className="copybtn" onClick={() => runCopy("text", textReport(report), () => trackEvent("report_text_copied", { provider }))}>
          <Clipboard size={14} aria-hidden="true" />
          {copied.copiedKey === "text" ? t("reportCta.copied") : t("reportActions.exportText")}
        </button>
        <button type="button" className="copybtn" onClick={() => runCopy("json", JSON.stringify(report, null, 2), () => trackEvent("report_json_copied", { provider }))}>
          <FileJson size={14} aria-hidden="true" />
          {copied.copiedKey === "json" ? t("reportCta.copied") : t("reportActions.exportJson")}
        </button>
        <button type="button" className="copybtn" disabled={isExporting} onClick={onExportPng}>
          <Download size={14} aria-hidden="true" />
          {isExporting ? t("reportActions.exporting") : t("reportActions.exportPng")}
        </button>
      </ActionMenu>
      <button type="button" className="copybtn report-action-rerun" onClick={onRerun} title={report.cached ? t("runner.cacheHit") : t("runner.freshRun")}>
        <RotateCcw size={14} aria-hidden="true" />
        {t("reportActions.rerun")}
      </button>
      {compact ? null : (
        <ActionMenu label={t("reportActions.more")} icon={<MoreHorizontal size={14} aria-hidden="true" />}>
          <a className="copybtn" href={targets.compareHref}>{t("reportTools.compare")}</a>
          <a className="copybtn" href={targets.diffHref}>{t("reportTools.diff")}</a>
          <button type="button" className="copybtn" onClick={() => runCopy("citation", targets.citation, () => trackEvent("report_citation_copied", { provider }))}>
            <Clipboard size={14} aria-hidden="true" />
            {copied.copiedKey === "citation" ? t("reportCta.copied") : t("reportTools.copyCitation")}
          </button>
          <a className="copybtn" href={targets.badgesHref}>{t("reportTools.badges")}</a>
          <button type="button" className="copybtn" onClick={onReset}>{t("reportActions.clear")}</button>
        </ActionMenu>
      )}
      {compact ? null : (
        <>
          {copied.copiedKey ? <span className="copy-feedback" role="status">{t("reportCta.copied")}</span> : null}
          {exportError ? <span className="export-failed-note" role="alert">{exportError}</span> : null}
          {manualCopyValue ? (
            <textarea
              className="manual-copy"
              readOnly
              value={manualCopyValue}
              aria-label={t("reportCta.manualContentAria")}
              onFocus={(event) => event.currentTarget.select()}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

// Small disclosure menu on the same native-<details> machinery as the topbar
// menus: real summary focus behavior, closes on item click, Escape, or an
// outside pointer press.
function ActionMenu({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  const rootRef = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      rootRef.current?.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return (
    <details ref={rootRef} className="actions-menu" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="copybtn">
        {icon}
        <span>{label}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </summary>
      {/* Any activated item collapses the menu; the popover itself is plain
          buttons/links, matching the site's other menus. */}
      <div className="actions-menu-popover" onClick={() => setOpen(false)}>
        {children}
      </div>
    </details>
  );
}
