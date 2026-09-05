import { t } from '../i18n/index.js';
import { formatNumber } from '../shared/format.js';

// A compact, single-series line+area chart for the panel's star-history
// section — a simplified vanilla-JS port of the math in
// frontend/src/RepoHistoryChart.tsx's project()/linePath()/areaPath(), with
// only one series (stars) and no dual-axis, since the extension only shows
// star history, not the web app's combined star+SLOC view.
const WIDTH = 280;
const HEIGHT = 96;
const PAD = { left: 4, right: 4, top: 6, bottom: 18 };
const PLOT_WIDTH = WIDTH - PAD.left - PAD.right;
const PLOT_HEIGHT = HEIGHT - PAD.top - PAD.bottom;
const BASELINE_Y = PAD.top + PLOT_HEIGHT;

function project(points) {
  const times = points.map(p => new Date(`${p.date}T00:00:00Z`).getTime());
  const minTime = times[0];
  const span = Math.max(times[times.length - 1] - minTime, 1);
  const maxStars = Math.max(...points.map(p => p.stars), 1);
  return points.map((p, i) => ({
    x: PAD.left + ((times[i] - minTime) / span) * PLOT_WIDTH,
    y: BASELINE_Y - (p.stars / maxStars) * PLOT_HEIGHT,
    point: p,
  }));
}

function linePath(coords) {
  return coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
}

function areaPath(coords) {
  const first = coords[0];
  const last = coords[coords.length - 1];
  return `${linePath(coords)} L${last.x.toFixed(1)},${BASELINE_Y} L${first.x.toFixed(1)},${BASELINE_Y} Z`;
}

// Returns the HTML string to drop into the panel's star-history wrap. Caller
// is responsible for checking `points.length >= 2` first — this assumes a
// drawable series.
export function buildStarHistoryHTML(points) {
  const coords = project(points);
  const current = points[points.length - 1].stars;

  return `
    <div class="oc-star-history">
      <div class="oc-star-history-hd">
        <span class="oc-star-history-title">${t('panel.starHistory')}</span>
        <span class="oc-star-history-count">&#9733; ${formatNumber(current)}</span>
      </div>
      <svg class="oc-star-history-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${t('panel.starHistory')}">
        <path d="${areaPath(coords)}" class="oc-star-history-area"></path>
        <path d="${linePath(coords)}" class="oc-star-history-line"></path>
      </svg>
      <div class="oc-star-history-axis">
        <span>${points[0].date}</span>
        <span>${points[points.length - 1].date}</span>
      </div>
    </div>`;
}
