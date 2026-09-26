// Pure move from main.tsx — behavior unchanged.
import React, { useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { languagePieItems, pieSlices } from "../chartUtils";
import { formatCompactNumber, formatNumber, formatPercent, languageColor, sortRows, visibleLanguageColor } from "../reportUtils";
import { useScheme } from "../scheme";
import type { LanguageReport, PieItem, Report, SortKey } from "../types";

export function Charts({ report }: { report: Report }) {
  const { t, i18n } = useTranslation();
  const scheme = useScheme();
  const languageItems = useMemo(() => languagePieItems(report.languages, t("charts.other"), t("charts.noData")), [report.languages, i18n.language, t]);
  // Lift near-black language colors so slices/swatches stay visible on the dark scheme.
  const visibleItems = useMemo(
    () => languageItems.map((item) => ({ ...item, color: visibleLanguageColor(item.color, scheme) })),
    [languageItems, scheme],
  );
  const totalLines = report.total.code;
  const [hoveredSlice, setHoveredSlice] = useState<string | null>(null);
  const [showFullStats, setShowFullStats] = useState(false);
  const otherLabel = t("charts.other");
  const sliceLabels = useMemo(() => new Set(visibleItems.map((item) => item.label)), [visibleItems]);
  const sliceForLanguage = useCallback(
    (name: string) => (sliceLabels.has(name) ? name : sliceLabels.has(otherLabel) ? otherLabel : null),
    [sliceLabels, otherLabel],
  );
  const onHoverLanguage = useCallback(
    (name: string | null) => setHoveredSlice(name === null ? null : sliceForLanguage(name)),
    [sliceForLanguage],
  );
  const leading = [...report.languages].sort((a, b) => b.stats.code - a.stats.code)[0];

  return (
    <>
      {leading ? <div className="mobile-code-summary"><span>{leading.name}</span><strong>{formatNumber(leading.stats.code)} {t("table.code")}</strong><em>{formatPercent(leading.stats.code, report.total.code)}</em></div> : null}
      <button type="button" className="full-stats-toggle copybtn" onClick={() => setShowFullStats((value) => !value)} aria-expanded={showFullStats}>{showFullStats ? t("charts.compactStats") : t("charts.fullStats")}</button>
      <div className="charts-grid">
      <div className="chart-card donut-card">
        <div className="chart-h"><span className="chart-tag">chart</span>{t("charts.languageShare")}</div>
        <Donut items={visibleItems} total={totalLines} hovered={hoveredSlice} onHover={setHoveredSlice} />
      </div>
      <div className="chart-card table-card">
        <div className="chart-h"><span className="chart-tag">table</span>{t("charts.report")}</div>
        <ReportTable report={report} compact={!showFullStats} fullStats={showFullStats} hoveredSlice={hoveredSlice} sliceForLanguage={sliceForLanguage} onHoverLanguage={onHoverLanguage} />
      </div>
      </div>
    </>
  );
}

export function Donut({ items, total, hovered, onHover }: { items: PieItem[]; total: number; hovered: string | null; onHover: (label: string | null) => void }) {
  const { t } = useTranslation();
  const exactTotal = formatNumber(total);
  const slices = useMemo(() => pieSlices(items), [items]);
  return (
    <>
      <div className="donut-wrap" role="img" aria-label={t("charts.languageShare")}>
        <svg viewBox="-1 -1 2 2" onMouseLeave={() => onHover(null)}>
          {slices.map((slice) => (
            <path
              key={slice.label}
              d={slice.path}
              fill={slice.color}
              className={hovered && hovered !== slice.label ? "dim" : undefined}
              onMouseEnter={() => onHover(slice.label)}
            />
          ))}
          <circle r="0.58" fill="var(--bg-2)" />
        </svg>
        <div className="donut-center" title={t("charts.totalCodeTooltip", { count: exactTotal })}>
          <span className="mute">{t("table.code")}</span>
          <strong>{formatCompactNumber(total)}</strong>
        </div>
      </div>
      <ul className="visually-hidden">
        {items.map((item) => (
          <li key={item.label}>{item.label}: {formatPercent(item.value, total)}</li>
        ))}
      </ul>
      <div className="legend" onMouseLeave={() => onHover(null)}>
        {items.map((item) => (
          <span
            className={`legend-row ${hovered === item.label ? "hl" : ""}`}
            key={item.label}
            onMouseEnter={() => onHover(item.label)}
          >
            <span className="key-sw" style={{ background: item.color }} />
            <span className="lname">{item.label}</span>
            <span className="lval">{formatCompactNumber(item.value)}</span>
            <span>{formatPercent(item.value, total)}</span>
          </span>
        ))}
      </div>
    </>
  );
}

const SORT_KEYS: SortKey[] = ["name", "files", "lines", "code", "comments", "blanks"];

function initialSortFromLocation(): { key: SortKey; dir: "asc" | "desc" } {
  const params = new URLSearchParams(window.location.search);
  const key = params.get("sort") as SortKey | null;
  const dir = params.get("dir");
  return {
    key: key && SORT_KEYS.includes(key) ? key : "code",
    dir: dir === "asc" || dir === "desc" ? dir : "desc",
  };
}

function persistSortInLocation(key: SortKey, dir: "asc" | "desc") {
  const params = new URLSearchParams(window.location.search);
  if (key === "code" && dir === "desc") {
    params.delete("sort");
    params.delete("dir");
  } else {
    params.set("sort", key);
    params.set("dir", dir);
  }
  const query = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
}

export function ReportTable({ report, compact, fullStats, hoveredSlice, sliceForLanguage, onHoverLanguage }: { report: Report; compact?: boolean; fullStats?: boolean; hoveredSlice?: string | null; sliceForLanguage?: (name: string) => string | null; onHoverLanguage?: (name: string | null) => void }) {
  const { t } = useTranslation();
  const initialSort = useMemo(() => initialSortFromLocation(), []);
  const [sortKey, setSortKey] = useState<SortKey>(initialSort.key);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialSort.dir);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rows = useMemo(() => sortRows(report.languages, sortKey, sortDir), [report.languages, sortKey, sortDir]);

  const updateSort = (key: SortKey) => {
    let nextDir: "asc" | "desc";
    if (sortKey === key) {
      nextDir = sortDir === "asc" ? "desc" : "asc";
      setSortDir(nextDir);
    } else {
      nextDir = key === "name" ? "asc" : "desc";
      setSortKey(key);
      setSortDir(nextDir);
    }
    persistSortInLocation(key, nextDir);
  };

  const toggle = useCallback((name: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);

  return (
    <div className={`table-wrap ${compact ? "compact" : ""} ${fullStats ? "is-full-stats" : ""}`}>
      <table className="report">
        <caption className="visually-hidden">{t("table.caption", { repo: `${report.repository.owner}/${report.repository.name}` })}</caption>
        <thead>
          <tr>
            <SortHead label={t("table.language")} active={sortKey === "name"} dir={sortDir} onClick={() => updateSort("name")} className="lang" scope="col" />
            {(["files", "lines", "code", "comments", "blanks"] as const).map((key) => (
              <SortHead key={key} label={t("table." + key)} active={sortKey === key} dir={sortDir} onClick={() => updateSort(key)} scope="col" />
            ))}
          </tr>
        </thead>
        <tbody onMouseLeave={() => onHoverLanguage?.(null)}>
          {rows.map((row) => (
            <React.Fragment key={row.name}>
              <LanguageRow
                row={row}
                totalCode={report.total.code}
                expanded={expanded.has(row.name)}
                onToggle={toggle}
                highlighted={Boolean(hoveredSlice && sliceForLanguage?.(row.name) === hoveredSlice)}
                onHover={onHoverLanguage}
              />
              {expanded.has(row.name) && row.children.map((child) => <LanguageRow key={`${row.name}:${child.name}`} row={child} child totalCode={report.total.code} />)}
            </React.Fragment>
          ))}
          <tr className="totals">
            <td className="lang">{t("table.total")}</td>
            <NumberCell value={report.total.files} />
            <NumberCell value={report.total.lines} />
            <NumberCell value={report.total.code} />
            <NumberCell value={report.total.comments} />
            <NumberCell value={report.total.blanks} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SortHead({ label, active, dir, onClick, className, scope }: { label: string; active: boolean; dir: string; onClick: () => void; className?: string; scope?: "col" | "row" }) {
  return (
    <th
      className={className}
      scope={scope}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button type="button" className="sort-btn" onClick={onClick}>
        {label} <span className="arr" aria-hidden="true">{active ? (dir === "asc" ? "^" : "v") : ""}</span>
      </button>
    </th>
  );
}

export const LanguageRow = React.memo(function LanguageRow({ row, totalCode, expanded, child, onToggle, highlighted, onHover }: { row: LanguageReport; totalCode: number; expanded?: boolean; child?: boolean; onToggle?: (name: string) => void; highlighted?: boolean; onHover?: (name: string | null) => void }) {
  const { t } = useTranslation();
  const scheme = useScheme();
  const hasChildren = row.children.length > 0;
  const expandable = hasChildren && !child;
  const ratioTotal = row.stats.code + row.stats.comments + row.stats.blanks;
  // The code/comments/blanks proportions moved out of the visual bar into
  // this tooltip; the bar itself now shows the language's share of the
  // codebase (see below).
  const ratioTitle = `${formatPercent(row.stats.code, ratioTotal)} ${t("table.code")} · ${formatPercent(row.stats.comments, ratioTotal)} ${t("table.comments")} · ${formatPercent(row.stats.blanks, ratioTotal)} ${t("table.blanks")}`;
  const languageColorStyle = visibleLanguageColor(languageColor(row.name), scheme);
  return (
    <tr
      className={`${child ? "file-row" : "lang-row"} ${expandable ? "expandable" : ""} ${expanded ? "expanded" : ""} ${highlighted ? "hl-row" : ""}`}
      title={!child && ratioTotal > 0 ? ratioTitle : undefined}
      onMouseEnter={child ? undefined : () => onHover?.(row.name)}
      onClick={expandable ? () => onToggle?.(row.name) : undefined}
    >
      <td className="lang">
        {hasChildren ? <button className="expand" type="button" aria-label={t(expanded ? "table.collapseLanguage" : "table.expandLanguage", { language: row.name })} aria-expanded={Boolean(expanded)} onClick={(e) => { e.stopPropagation(); onToggle?.(row.name); }}>{expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}</button> : <span className="expand-spacer" />}
        <span className="swatch" style={{ color: languageColorStyle }} />
        {row.name}
        {!child && totalCode > 0 ? (
          <i
            className="row-share"
            style={{ width: `${(row.stats.code / totalCode) * 100}%`, background: languageColorStyle }}
            aria-hidden="true"
          />
        ) : null}
      </td>
      <NumberCell value={row.stats.files} />
      <NumberCell value={row.stats.lines} />
      <NumberCell value={row.stats.code} share={formatPercent(row.stats.code, totalCode)} />
      <NumberCell value={row.stats.comments} />
      <NumberCell value={row.stats.blanks} />
    </tr>
  );
});

function NumberCell({ value, share }: { value: number; share?: string }) {
  return <td><span>{formatNumber(value)}</span>{share ? <small className="mobile-code-share">{share}</small> : null}</td>;
}
