import panelCss from '../styles/panel.css?inline';
import { formatNumber, formatCompact, formatPercent, textReport } from '../shared/format.js';
import { buildPieItems, languageColor } from '../shared/chart.js';
import { sortRows } from '../shared/sort.js';

let _panelHost = null;

export function unmountPanel() {
  if (_panelHost) {
    _panelHost.remove();
    _panelHost = null;
  }
  document.removeEventListener('keydown', _escHandler);
}

function _escHandler(e) {
  if (e.key === 'Escape') unmountPanel();
}

export function mountPanel({ report, owner, repo, theme }) {
  unmountPanel();

  _panelHost = document.createElement('div');
  const shadow = _panelHost.attachShadow({ mode: 'open' });
  _panelHost.setAttribute('data-theme', theme);

  shadow.innerHTML = `<style>${panelCss}</style>${buildPanelHTML(report, theme)}`;
  document.body.appendChild(_panelHost);

  // Animate open
  requestAnimationFrame(() => {
    requestAnimationFrame(() => shadow.querySelector('.oc-panel')?.classList.add('open'));
  });

  // Close handlers
  shadow.querySelector('.oc-pclose').addEventListener('click', unmountPanel);
  shadow.querySelector('.oc-backdrop').addEventListener('click', e => {
    if (e.target === shadow.querySelector('.oc-backdrop')) unmountPanel();
  });
  document.addEventListener('keydown', _escHandler);

  // Export
  shadow.querySelector('.oc-btn-txt').addEventListener('click', () => {
    navigator.clipboard.writeText(textReport(report)).catch(() => {});
  });
  shadow.querySelector('.oc-btn-json').addEventListener('click', () => {
    navigator.clipboard.writeText(JSON.stringify(report, null, 2)).catch(() => {});
  });

  // Sortable table
  bindTableSort(shadow, report, theme, 'code', 'desc');
}

function buildPanelHTML(report, theme) {
  const t   = report.total;
  const sha = report.commitSha.slice(0, 12);
  const webUrl = `https://octocounts.com/?url=${encodeURIComponent(report.repository.htmlUrl)}`;

  const summaryHTML = ['files', 'lines', 'code', 'comments', 'blanks'].map(k => `
    <div class="oc-sum-cell">
      <span class="oc-sum-val${k === 'code' ? ' accent' : ''}">${formatNumber(t[k])}</span>
      <span class="oc-sum-label">${k}</span>
    </div>`).join('');

  const cacheInfo = report.cached ? 'cached' : 'fresh';

  const logoUrl = chrome.runtime.getURL('icons/icon128.png');

  return `
  <div class="oc-backdrop">
    <div class="oc-panel">
      <div class="oc-pheader">
        <div class="oc-pheader-brand">
          <img class="oc-plogo-img" src="${logoUrl}" alt="">
          <span class="oc-plogo-text">OctoCounts</span>
        </div>
        <div class="oc-pheader-right">
          <span class="oc-prepo">${report.repository.owner}/${report.repository.name} @ ${sha}</span>
          <a class="oc-popen" href="${webUrl}" target="_blank" rel="noopener noreferrer">↗ open</a>
          <button class="oc-pclose" title="Close (Esc)">×</button>
        </div>
      </div>

      <div class="oc-summary">${summaryHTML}</div>

      <div class="oc-charts">
        <div class="oc-donut-wrap">
          ${buildDonutHTML(report, theme)}
        </div>
        <div class="oc-table-wrap">
          ${buildTableHTML(report, theme, 'code', 'desc')}
        </div>
      </div>

      <div class="oc-pfooter">
        <div class="left">
          <button class="oc-export-btn oc-btn-txt">txt</button>
          <button class="oc-export-btn oc-btn-json">json</button>
        </div>
        <div class="right">
          ${cacheInfo} · ${report.refName} → ${sha}
        </div>
      </div>
    </div>
  </div>`;
}

function buildDonutHTML(report, theme) {
  const items  = buildPieItems(report, theme);
  const total  = report.total.lines;
  const r = 40, cx = 60, cy = 60, strokeW = 22;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const arcs = items.map(item => {
    const frac = total > 0 ? item.value / total : 0;
    const dash = frac * circ;
    const svg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${item.color}" stroke-width="${strokeW}"
      stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += dash;
    return svg;
  });

  const legend = items.map(item => {
    const pct = formatPercent(item.value, total);
    return `<div class="oc-legend-row">
      <span class="oc-legend-dot" style="background:${item.color}"></span>
      <span>${item.label} ${pct}</span>
    </div>`;
  }).join('');

  return `
    <svg class="oc-donut-svg" viewBox="0 0 120 120">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#3d444d" stroke-width="${strokeW}"/>
      ${arcs.join('')}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" dominant-baseline="middle"
        fill="currentColor" font-size="11" font-family="-apple-system,sans-serif">${formatCompact(total)}</text>
      <text x="${cx}" y="${cy + 9}" text-anchor="middle" dominant-baseline="middle"
        fill="#8b949e" font-size="9" font-family="-apple-system,sans-serif">lines</text>
    </svg>
    <div class="oc-legend">${legend}</div>`;
}

function buildTableHTML(report, theme, sortKey, sortDir) {
  const cols   = ['name', 'files', 'lines', 'code', 'comments', 'blanks'];
  const sorted = sortRows(report.languages, sortKey, sortDir);

  const headers = cols.map(c => {
    const active = c === sortKey ? ' active' : '';
    const arrow  = c === sortKey ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    const label  = c === 'name' ? 'Language' : c;
    return `<th class="col-${c}${active}" data-col="${c}">${label}${arrow}</th>`;
  }).join('');

  const rows = sorted.map(lang => `
    <tr>
      <td>${lang.name}</td>
      ${['files', 'lines', 'code', 'comments', 'blanks'].map(k =>
        `<td${k === 'code' ? ' class="accent"' : ''}>${formatNumber(lang.stats[k])}</td>`
      ).join('')}
    </tr>`).join('');

  const t = report.total;
  const totalsRow = `
    <tr class="totals">
      <td>Total</td>
      ${['files', 'lines', 'code', 'comments', 'blanks'].map(k =>
        `<td${k === 'code' ? ' class="accent"' : ''}>${formatNumber(t[k])}</td>`
      ).join('')}
    </tr>`;

  return `
    <table class="oc-table" data-sort-key="${sortKey}" data-sort-dir="${sortDir}">
      <thead><tr>${headers}</tr></thead>
      <tbody>${rows}${totalsRow}</tbody>
    </table>`;
}

function bindTableSort(shadow, report, theme, initKey, initDir) {
  let key = initKey, dir = initDir;

  const onHeaderClick = e => {
    const th = e.target.closest('th[data-col]');
    if (!th) return;
    const col = th.dataset.col;
    if (col === key) {
      dir = dir === 'asc' ? 'desc' : 'asc';
    } else {
      key = col;
      dir = col === 'name' ? 'asc' : 'desc';
    }
    const wrap = shadow.querySelector('.oc-table-wrap');
    wrap.innerHTML = buildTableHTML(report, theme, key, dir);
    wrap.querySelector('.oc-table thead').addEventListener('click', onHeaderClick);
  };

  shadow.querySelector('.oc-table thead')?.addEventListener('click', onHeaderClick);
}
