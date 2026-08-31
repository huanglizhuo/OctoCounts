use std::time::Duration;

use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use chrono::NaiveDate;
use uuid::Uuid;

use crate::{
    api::AppState,
    coordinator::{job_is_finished, AnalysisCoordinator},
    models::{AnalysisSource, AnalyzeRequest, AnalyzeResponse, JobStatus, Report, RepositoryProvider},
    repo_history::ensure_repo_history,
};

#[derive(serde::Deserialize)]
pub(crate) struct BadgeParams {
    lang: Option<String>,
    #[serde(rename = "type")]
    badge_type: Option<String>,
}

pub async fn badge_default(
    State(state): State<AppState>,
    Path((owner, repo)): Path<(String, String)>,
    Query(params): Query<BadgeParams>,
) -> Response {
    serve_badge(state, owner, repo, None, false, params).await
}

pub async fn badge_branch(
    State(state): State<AppState>,
    Path((owner, repo, branch)): Path<(String, String, String)>,
    Query(params): Query<BadgeParams>,
) -> Response {
    serve_badge(state, owner, repo, Some(branch), false, params).await
}

pub async fn badge_tag(
    State(state): State<AppState>,
    Path((owner, repo, tag)): Path<(String, String, String)>,
    Query(params): Query<BadgeParams>,
) -> Response {
    serve_badge(state, owner, repo, Some(tag), true, params).await
}

pub async fn badge_commit(
    State(state): State<AppState>,
    Path((owner, repo, sha)): Path<(String, String, String)>,
    Query(params): Query<BadgeParams>,
) -> Response {
    serve_badge(state, owner, repo, Some(sha), true, params).await
}

/// `owner:repo:ref:badge_type:lang` — everything that can change the rendered
/// SVG. `badge_type` is normalized first so that aliases (`sloc`, `code-lines`,
/// ...) share one entry.
fn badge_cache_key(
    owner: &str,
    repo: &str,
    ref_name: Option<&str>,
    params: &BadgeParams,
) -> String {
    let badge_type = params
        .badge_type
        .as_deref()
        .map(normalize_badge_type)
        .unwrap_or_default();
    format!(
        "{owner}:{repo}:{}:{badge_type}:{}",
        ref_name.unwrap_or_default(),
        params.lang.as_deref().unwrap_or_default(),
    )
}

async fn serve_badge(
    state: AppState,
    owner: String,
    repo: String,
    ref_name: Option<String>,
    is_immutable: bool,
    params: BadgeParams,
) -> Response {
    let cache = if is_immutable {
        "public, max-age=31536000, immutable"
    } else {
        "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400"
    };

    // Tags and commits cannot move, so their rendered SVG is cached for much
    // longer than a branch's.
    let svg_cache = if is_immutable {
        &state.caches.badge_svg_immutable
    } else {
        &state.caches.badge_svg
    };
    let cache_key = badge_cache_key(&owner, &repo, ref_name.as_deref(), &params);
    if let Some(svg) = svg_cache.get(&cache_key).await {
        return svg_response(svg, cache);
    }

    let request = AnalyzeRequest {
        repo_url: format!("https://github.com/{}/{}", owner, repo),
        ref_name,
        force_refresh: false,
        options: Default::default(),
        source: AnalysisSource::Api,
    };

    // Only successful renders are memoized. Pending ("...") and error ("—")
    // badges are transient states that must be re-checked on the next request,
    // which is also why they keep their `no-cache, no-store` header.
    let report = match state.coordinator.submit(request).await {
        Ok(AnalyzeResponse::Cached { report, .. }) => report,
        Ok(AnalyzeResponse::Job { job_id, .. }) => {
            match wait_for_job(&state.coordinator, job_id, Duration::from_secs(30)).await {
                Some(report) => report,
                None => {
                    return svg_response(render_pending_for_params(&params), "no-cache, no-store")
                }
            }
        }
        Err(_) => return svg_response(render_error_for_params(&params), "no-cache, no-store"),
    };

    let svg = render_for_params(&report, &params);
    svg_cache.insert(cache_key, svg.clone()).await;
    svg_response(svg, cache)
}

/// Blocks the badge request until its analysis finishes, or gives up and lets
/// the caller render the pending badge.
///
/// The wait is event-driven: the first status check is immediate (an already
/// finished job used to cost a mandatory 500ms sleep) and the job's own worker
/// wakes this task the instant it commits a result, instead of this task
/// rediscovering it on the next 500ms database poll.
async fn wait_for_job(
    coordinator: &AnalysisCoordinator,
    job_id: Uuid,
    timeout: Duration,
) -> Option<Report> {
    let job = coordinator
        .await_job(job_id, timeout, |job| job_is_finished(job.status))
        .await
        .ok()??;
    if job.status != JobStatus::Completed {
        return None;
    }
    let report_id = job.report_id?;
    coordinator.store().report(&report_id).await.ok().flatten()
}

fn svg_response(body: String, cache_control: &'static str) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "image/svg+xml"),
            (header::CACHE_CONTROL, cache_control),
        ],
        body,
    )
        .into_response()
}

fn format_stat(n: usize) -> String {
    if n <= 999_999 {
        comma_format(n)
    } else if n < 1_000_000_000 {
        compact_suffix(n as f64 / 1_000_000.0, 'M')
    } else {
        compact_suffix(n as f64 / 1_000_000_000.0, 'B')
    }
}

fn comma_format(n: usize) -> String {
    let s = n.to_string();
    let chars: Vec<char> = s.chars().collect();
    let mut result = String::new();
    let len = chars.len();
    for (i, &ch) in chars.iter().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            result.push(',');
        }
        result.push(ch);
    }
    result
}

fn compact_suffix(val: f64, suffix: char) -> String {
    let tenths = (val * 10.0).round() as u64;
    if tenths % 10 == 0 {
        format!("{}{}", tenths / 10, suffix)
    } else {
        format!("{}.{}{}", tenths / 10, tenths % 10, suffix)
    }
}

fn render_badge_svg(report: &Report) -> String {
    badge_svg(
        &format_stat(report.total.code),
        &format_stat(report.total.files),
        &format_stat(report.total.lines),
        &format_stat(report.total.comments),
        false,
    )
}

fn render_pending_svg() -> String {
    badge_svg(
        "\u{00B7}\u{00B7}\u{00B7}",
        "\u{00B7}\u{00B7}\u{00B7}",
        "\u{00B7}\u{00B7}\u{00B7}",
        "\u{00B7}\u{00B7}\u{00B7}",
        true,
    )
}

fn render_error_svg() -> String {
    badge_svg("\u{2014}", "\u{2014}", "\u{2014}", "\u{2014}", true)
}

fn render_for_lang(report: &Report, lang: Option<&str>) -> String {
    let Some(name) = lang else {
        return render_badge_svg(report);
    };
    let lower = name.to_lowercase();
    let color = language_color(&lower);
    match report
        .languages
        .iter()
        .find(|l| l.name.to_lowercase() == lower)
    {
        Some(lr) => lang_badge_svg(name, &format_stat(lr.stats.code), color),
        None => lang_badge_svg(name, "\u{2014}", "#6e7681"),
    }
}

fn render_for_params(report: &Report, params: &BadgeParams) -> String {
    if params.lang.is_some() {
        return render_for_lang(report, params.lang.as_deref());
    }

    match params.badge_type.as_deref().map(normalize_badge_type) {
        Some("code") => single_badge_svg("code", &format_stat(report.total.code), "#78ff5b"),
        Some("lines") => single_badge_svg("lines", &format_stat(report.total.lines), "#58a6ff"),
        Some("files") => single_badge_svg("files", &format_stat(report.total.files), "#d29922"),
        Some("comments") => {
            single_badge_svg("comments", &format_stat(report.total.comments), "#d2a8ff")
        }
        Some("languages") => {
            single_badge_svg("languages", &format_stat(report.languages.len()), "#79c0ff")
        }
        Some("top-language") => match report.languages.first() {
            Some(language) => {
                let color = language_color(&language.name.to_lowercase());
                single_badge_svg("top language", &language.name, color)
            }
            None => single_badge_svg("top language", "\u{2014}", "#6e7681"),
        },
        Some("ratio") => single_badge_svg(
            "code share",
            &format_percent(report.total.code, report.total.lines),
            "#78ff5b",
        ),
        _ => render_badge_svg(report),
    }
}

fn normalize_badge_type(value: &str) -> &str {
    match value {
        "code-lines" | "code_lines" | "sloc" => "code",
        "total" | "total-lines" | "total_lines" => "lines",
        "language-count" | "language_count" => "languages",
        "top" | "top_language" | "top-language" => "top-language",
        "code-ratio" | "code_ratio" | "code-share" | "code_share" => "ratio",
        other => other,
    }
}

fn format_percent(value: usize, total: usize) -> String {
    if total == 0 {
        return "0%".to_string();
    }
    let pct = (value as f64 / total as f64) * 100.0;
    if pct < 0.1 {
        "<0.1%".to_string()
    } else if (pct.round() - pct).abs() < 0.05 {
        format!("{}%", pct.round() as usize)
    } else {
        format!("{:.1}%", pct)
    }
}

fn render_pending_for_lang(lang: Option<&str>) -> String {
    match lang {
        None => render_pending_svg(),
        Some(name) => lang_badge_svg(name, "\u{00B7}\u{00B7}\u{00B7}", "#6e7681"),
    }
}

fn render_pending_for_params(params: &BadgeParams) -> String {
    if params.lang.is_some() {
        return render_pending_for_lang(params.lang.as_deref());
    }
    match params.badge_type.as_deref().map(normalize_badge_type) {
        Some("code") => single_badge_svg("code", "\u{00B7}\u{00B7}\u{00B7}", "#6e7681"),
        Some("lines") => single_badge_svg("lines", "\u{00B7}\u{00B7}\u{00B7}", "#6e7681"),
        Some("files") => single_badge_svg("files", "\u{00B7}\u{00B7}\u{00B7}", "#6e7681"),
        Some("comments") => single_badge_svg("comments", "\u{00B7}\u{00B7}\u{00B7}", "#6e7681"),
        Some("languages") => single_badge_svg("languages", "\u{00B7}\u{00B7}\u{00B7}", "#6e7681"),
        Some("top-language") => {
            single_badge_svg("top language", "\u{00B7}\u{00B7}\u{00B7}", "#6e7681")
        }
        Some("ratio") => single_badge_svg("code share", "\u{00B7}\u{00B7}\u{00B7}", "#6e7681"),
        _ => render_pending_svg(),
    }
}

fn render_error_for_lang(lang: Option<&str>) -> String {
    match lang {
        None => render_error_svg(),
        Some(name) => lang_badge_svg(name, "\u{2014}", "#6e7681"),
    }
}

fn render_error_for_params(params: &BadgeParams) -> String {
    if params.lang.is_some() {
        return render_error_for_lang(params.lang.as_deref());
    }
    match params.badge_type.as_deref().map(normalize_badge_type) {
        Some("code") => single_badge_svg("code", "\u{2014}", "#6e7681"),
        Some("lines") => single_badge_svg("lines", "\u{2014}", "#6e7681"),
        Some("files") => single_badge_svg("files", "\u{2014}", "#6e7681"),
        Some("comments") => single_badge_svg("comments", "\u{2014}", "#6e7681"),
        Some("languages") => single_badge_svg("languages", "\u{2014}", "#6e7681"),
        Some("top-language") => single_badge_svg("top language", "\u{2014}", "#6e7681"),
        Some("ratio") => single_badge_svg("code share", "\u{2014}", "#6e7681"),
        _ => render_error_svg(),
    }
}

fn badge_svg(code: &str, files: &str, lines: &str, comments: &str, muted: bool) -> String {
    let code_color = if muted { "#8b949e" } else { "#78ff5b" };
    let val_color = if muted { "#8b949e" } else { "#ffffff" };

    SVG_TEMPLATE
        .replace("__CODE_COLOR__", code_color)
        .replace("__VAL_COLOR__", val_color)
        .replace("__CODE__", code)
        .replace("__FILES__", files)
        .replace("__LINES__", lines)
        .replace("__COMMENTS__", comments)
}

const SVG_TEMPLATE: &str = r##"<svg width="264" height="33" viewBox="0 0 264 33" xmlns="http://www.w3.org/2000/svg">
  <rect x="0.75" y="0.75" width="262.5" height="31.5" rx="3" fill="#30363D" stroke="#30363D" stroke-width="1.5"/>
  <g font-family="Inter, Arial, Helvetica, sans-serif">
    <text x="10" y="20.8" fill="#fff" font-size="14.5" font-weight="700" letter-spacing="0.3">SLOC</text>
    <g text-anchor="middle" font-weight="700" font-size="12.5" fill="__VAL_COLOR__">
      <text x="80" y="16.5" fill="__CODE_COLOR__">__CODE__</text>
      <text x="130" y="16.5">__FILES__</text>
      <text x="180" y="16.5">__LINES__</text>
      <text x="230" y="16.5">__COMMENTS__</text>
    </g>
    <g text-anchor="middle" fill="#8B949E" font-size="9.5" font-weight="400">
      <text x="80" y="27">code</text>
      <text x="130" y="27">files</text>
      <text x="180" y="27">lines</text>
      <text x="230" y="27">comments</text>
    </g>
  </g>
</svg>"##;

fn language_color(name: &str) -> &'static str {
    match name {
        "rust" => "#CE422B",
        "python" => "#3572A5",
        "javascript" => "#F1E05A",
        "typescript" => "#3178C6",
        "go" => "#00ADD8",
        "ruby" => "#701516",
        "java" => "#B07219",
        "c" => "#555555",
        "c++" => "#F34B7D",
        "c#" => "#239120",
        "swift" => "#F05138",
        "kotlin" => "#7F52FF",
        "scala" => "#DC322F",
        "php" => "#4F5D95",
        "html" => "#E34C26",
        "css" => "#563D7C",
        "shell" => "#89E051",
        "r" => "#198CE7",
        "dart" => "#00B4AB",
        "lua" => "#000080",
        "haskell" => "#5E5086",
        "elixir" => "#6E4A7E",
        "clojure" => "#DB5855",
        "perl" => "#0298C3",
        "vue" => "#41B883",
        "svelte" => "#FF3E00",
        "zig" => "#EC915C",
        "nix" => "#7E7EFF",
        "ocaml" => "#3BE133",
        "groovy" => "#4298B8",
        "powershell" => "#012456",
        "makefile" => "#427819",
        "dockerfile" => "#384D54",
        "json" => "#292929",
        "yaml" => "#CB171E",
        "toml" => "#9C4221",
        "markdown" => "#083FA1",
        "tex" => "#3D6117",
        _ => "#6e7681",
    }
}

fn char_width(c: char) -> u32 {
    match c {
        ' ' => 36,
        '!' | ',' | '.' => 38,
        '\'' | 'i' | 'j' | 'l' | 'I' | 'J' => 33,
        '(' | ')' | ':' | ';' => 43,
        '-' | '/' => 43,
        'f' | 'r' | 't' | '*' => 43,
        'F' | 'L' => 57,
        'c' | 's' | 'z' => 57,
        'E' | 'T' | '?' => 62,
        'k' | 'v' | 'x' | 'y' => 62,
        '0'..='9' => 66,
        'P' | 'S' | 'Y' => 66,
        'a' | 'b' | 'd' | 'e' | 'g' | 'h' | 'n' | 'o' | 'p' | 'q' | 'u' => 68,
        'A' | 'R' | 'V' | 'C' | 'Z' => 74,
        'B' | 'K' | 'X' => 73,
        'D' | 'H' | 'N' | 'U' => 83,
        'G' | 'O' | 'Q' => 85,
        '+' | '<' | '=' | '>' | '#' => 79,
        'w' | '&' => 89,
        'm' | '%' => 104,
        'M' | 'W' => 98,
        '@' => 120,
        _ => 65,
    }
}

fn text_width(s: &str) -> u32 {
    s.chars().map(char_width).sum()
}

fn is_light_color(hex: &str) -> bool {
    let hex = hex.trim_start_matches('#');
    if hex.len() != 6 {
        return false;
    }
    let Ok(r) = u8::from_str_radix(&hex[0..2], 16) else {
        return false;
    };
    let Ok(g) = u8::from_str_radix(&hex[2..4], 16) else {
        return false;
    };
    let Ok(b) = u8::from_str_radix(&hex[4..6], 16) else {
        return false;
    };
    0.2126 * (r as f64 / 255.0) + 0.7152 * (g as f64 / 255.0) + 0.0722 * (b as f64 / 255.0) > 0.5
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn lang_badge_svg(lang: &str, value: &str, color: &str) -> String {
    let label_tenths = text_width(lang) + 100;
    let value_tenths = text_width(value) + 100;
    let left_w = (label_tenths + 9) / 10;
    let right_w = (value_tenths + 9) / 10;
    let total_w = left_w + right_w;
    let left_cx = left_w / 2;
    let right_cx = left_w + right_w / 2;
    let val_color = if is_light_color(color) {
        "#333"
    } else {
        "#fff"
    };
    let lang_esc = xml_escape(lang);
    let value_esc = xml_escape(value);

    format!(
        r##"<svg width="{total_w}" height="20" viewBox="0 0 {total_w} 20" xmlns="http://www.w3.org/2000/svg">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="{total_w}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="{left_w}" height="20" fill="#555"/>
    <rect x="{left_w}" width="{right_w}" height="20" fill="{color}"/>
    <rect width="{total_w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="{left_cx}" y="15" fill="#010101" fill-opacity=".3">{lang_esc}</text>
    <text x="{left_cx}" y="14">{lang_esc}</text>
    <text x="{right_cx}" y="15" fill="#010101" fill-opacity=".3">{value_esc}</text>
    <text x="{right_cx}" y="14" fill="{val_color}">{value_esc}</text>
  </g>
</svg>"##
    )
}

fn single_badge_svg(label: &str, value: &str, color: &str) -> String {
    lang_badge_svg(label, value, color)
}

/// `GET /badge/{owner}/{repo}/star-history.svg` — a server-rendered chart
/// meant for embedding in a README (`![Stars](...)`, same pattern as the
/// SLOC badges above), which is why this is a plain SVG rather than the
/// client-rendered/GIF chart on the report page: GitHub's markdown renderer
/// only ever shows a static image for an embedded README asset, so a chart
/// that needs to *be* an image has to be built server-side.
///
/// Shares its data path with the JSON endpoint at `repo_history::repo_history`
/// via `ensure_repo_history` — the first request for a repo from either
/// endpoint triggers the same one-time watch/backfill. Only the star series
/// is rendered here; the SLOC series has no SVG badge (it lives on the
/// interactive report-page chart only).
pub async fn star_history_badge(
    State(state): State<AppState>,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let cache_key = format!("star-history-svg:{owner}:{repo}");
    if let Some(svg) = state.caches.badge_svg.get(&cache_key).await {
        return svg_response(svg, "public, s-maxage=3600, stale-while-revalidate=86400");
    }

    let (history, current_stars, _, _) =
        match ensure_repo_history(&state, RepositoryProvider::GitHub, &owner, &repo).await {
            Ok(result) => result,
            Err(_) => {
                return svg_response(render_star_history_svg(&[], None), "no-cache, no-store");
            }
        };

    let svg = render_star_history_svg(&history, current_stars);
    state.caches.badge_svg.insert(cache_key, svg.clone()).await;
    svg_response(svg, "public, s-maxage=3600, stale-while-revalidate=86400")
}

const STAR_CHART_WIDTH: f64 = 480.0;
const STAR_CHART_HEIGHT: f64 = 140.0;
const STAR_CHART_PAD_LEFT: f64 = 16.0;
const STAR_CHART_PAD_RIGHT: f64 = 16.0;
const STAR_CHART_PAD_TOP: f64 = 42.0;
const STAR_CHART_PAD_BOTTOM: f64 = 28.0;

fn render_star_history_svg(points: &[(NaiveDate, i64)], current_stars: Option<u64>) -> String {
    let current_label = current_stars
        .map(|n| format_stat(n as usize))
        .unwrap_or_else(|| "\u{2014}".to_string());

    if points.len() < 2 {
        return format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
  <rect x="0.5" y="0.5" width="{wm1}" height="{hm1}" rx="8" fill="#fff" stroke="#d0d7de"/>
  <text x="16" y="26" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="13" font-weight="bold" fill="#1f2328">&#9733; Star History</text>
  <text x="16" y="{mid}" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="12" fill="#57606a">Not enough history yet &#8212; check back tomorrow</text>
</svg>"##,
            w = STAR_CHART_WIDTH,
            h = STAR_CHART_HEIGHT,
            wm1 = STAR_CHART_WIDTH - 1.0,
            hm1 = STAR_CHART_HEIGHT - 1.0,
            mid = STAR_CHART_HEIGHT / 2.0 + 6.0,
        );
    }

    let min_date = points[0].0;
    let max_date = points[points.len() - 1].0;
    let span_days = (max_date - min_date).num_days().max(1) as f64;
    let max_star = points.iter().map(|(_, count)| *count).max().unwrap_or(1).max(1) as f64;

    let plot_width = STAR_CHART_WIDTH - STAR_CHART_PAD_LEFT - STAR_CHART_PAD_RIGHT;
    let plot_height = STAR_CHART_HEIGHT - STAR_CHART_PAD_TOP - STAR_CHART_PAD_BOTTOM;
    let baseline_y = STAR_CHART_PAD_TOP + plot_height;

    let coords: Vec<(f64, f64)> = points
        .iter()
        .map(|(date, count)| {
            let x = STAR_CHART_PAD_LEFT + ((*date - min_date).num_days() as f64 / span_days) * plot_width;
            let y = baseline_y - (*count as f64 / max_star) * plot_height;
            (x, y)
        })
        .collect();

    let line_path = coords
        .iter()
        .enumerate()
        .map(|(i, (x, y))| format!("{}{x:.1},{y:.1}", if i == 0 { "M" } else { "L" }))
        .collect::<Vec<_>>()
        .join(" ");

    let area_path = format!(
        "{line_path} L{lx:.1},{baseline_y:.1} L{fx:.1},{baseline_y:.1} Z",
        lx = coords.last().map(|(x, _)| *x).unwrap_or_default(),
        fx = coords.first().map(|(x, _)| *x).unwrap_or_default(),
    );

    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
  <rect x="0.5" y="0.5" width="{wm1}" height="{hm1}" rx="8" fill="#fff" stroke="#d0d7de"/>
  <text x="16" y="26" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="13" font-weight="bold" fill="#1f2328">&#9733; Star History</text>
  <text x="{w_minus_16}" y="26" text-anchor="end" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="13" font-weight="bold" fill="#6f42c1">{current_label}</text>
  <path d="{area_path}" fill="#6f42c1" fill-opacity="0.12" stroke="none"/>
  <path d="{line_path}" fill="none" stroke="#6f42c1" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  <text x="16" y="{label_y}" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="10" fill="#8b949e">{min_date}</text>
  <text x="{w_minus_16}" y="{label_y}" text-anchor="end" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="10" fill="#8b949e">{max_date}</text>
</svg>"##,
        w = STAR_CHART_WIDTH,
        h = STAR_CHART_HEIGHT,
        wm1 = STAR_CHART_WIDTH - 1.0,
        hm1 = STAR_CHART_HEIGHT - 1.0,
        w_minus_16 = STAR_CHART_WIDTH - 16.0,
        label_y = STAR_CHART_HEIGHT - 10.0,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        badge_cache_key, format_percent, format_stat, normalize_badge_type, render_star_history_svg,
        BadgeParams,
    };
    use crate::cache::AppCaches;
    use chrono::NaiveDate;

    fn date(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn star_history_svg_shows_a_placeholder_with_fewer_than_two_points() {
        let empty = render_star_history_svg(&[], None);
        assert!(empty.contains("Not enough history yet"));
        assert!(!empty.contains("<path"), "no chart geometry without data");

        let one_point = render_star_history_svg(&[(date("2026-01-01"), 5)], Some(5));
        assert!(one_point.contains("Not enough history yet"));
    }

    #[test]
    fn star_history_svg_renders_a_line_spanning_first_to_last_point() {
        let svg = render_star_history_svg(
            &[
                (date("2026-01-01"), 10),
                (date("2026-02-01"), 50),
                (date("2026-03-01"), 100),
            ],
            Some(100),
        );

        assert!(svg.contains("<path d=\"M"), "line path should start with a moveto");
        assert!(svg.contains("2026-01-01"), "first date label");
        assert!(svg.contains("2026-03-01"), "last date label");
        assert!(svg.contains("100"), "current star count label");
        assert!(!svg.contains("Not enough history"));
    }

    #[test]
    fn star_history_svg_never_divides_by_zero_when_every_point_is_the_same_day() {
        // Two snapshots recorded the same day (a backfill point and today's
        // exact snapshot can land on the same date) must not produce a NaN
        // or infinite coordinate from a zero-day span.
        let svg = render_star_history_svg(
            &[(date("2026-01-01"), 1), (date("2026-01-01"), 2)],
            Some(2),
        );
        assert!(!svg.contains("NaN"));
        assert!(!svg.contains("inf"));
    }

    #[test]
    fn star_history_svg_never_divides_by_zero_when_stars_never_change() {
        // A flat line (star count identical at every sampled point) exercises
        // the max_star normalization the same way a zero-day span exercises
        // the x-axis normalization above.
        let svg = render_star_history_svg(
            &[(date("2026-01-01"), 10), (date("2026-01-02"), 10)],
            Some(10),
        );
        assert!(!svg.contains("NaN"));
        assert!(!svg.contains("inf"));
    }

    fn params(badge_type: Option<&str>, lang: Option<&str>) -> BadgeParams {
        BadgeParams {
            lang: lang.map(str::to_string),
            badge_type: badge_type.map(str::to_string),
        }
    }

    #[test]
    fn cache_key_collapses_badge_type_aliases() {
        let canonical = badge_cache_key("acme", "widget", None, &params(Some("code"), None));
        for alias in ["code", "code-lines", "code_lines", "sloc"] {
            assert_eq!(
                badge_cache_key("acme", "widget", None, &params(Some(alias), None)),
                canonical,
                "alias {alias} must share one cache entry",
            );
        }
    }

    #[test]
    fn cache_key_separates_every_rendering_input() {
        let base = badge_cache_key("acme", "widget", None, &params(None, None));
        let variants = [
            badge_cache_key("other", "widget", None, &params(None, None)),
            badge_cache_key("acme", "other", None, &params(None, None)),
            badge_cache_key("acme", "widget", Some("main"), &params(None, None)),
            badge_cache_key("acme", "widget", None, &params(Some("lines"), None)),
            badge_cache_key("acme", "widget", None, &params(None, Some("Rust"))),
        ];
        for variant in &variants {
            assert_ne!(&base, variant);
        }
        // ...and no two variants collide with each other either.
        for (index, left) in variants.iter().enumerate() {
            for right in &variants[index + 1..] {
                assert_ne!(left, right);
            }
        }
    }

    #[tokio::test]
    async fn badge_cache_round_trips_and_separates_mutable_from_immutable() {
        let caches = AppCaches::new();
        let key = badge_cache_key("acme", "widget", Some("v1.0.0"), &params(None, None));

        caches
            .badge_svg_immutable
            .insert(key.clone(), "<svg/>".to_string())
            .await;

        assert_eq!(
            caches.badge_svg_immutable.get(&key).await.as_deref(),
            Some("<svg/>"),
        );
        assert!(
            caches.badge_svg.get(&key).await.is_none(),
            "immutable entries must not leak into the short-TTL cache",
        );

        let mutable_ttl = caches.badge_svg.policy().time_to_live().unwrap();
        let immutable_ttl = caches.badge_svg_immutable.policy().time_to_live().unwrap();
        assert!(
            immutable_ttl > mutable_ttl,
            "tag/commit badges should outlive branch badges in cache",
        );
    }

    #[test]
    fn format_stat_small_numbers() {
        assert_eq!(format_stat(0), "0");
        assert_eq!(format_stat(62), "62");
        assert_eq!(format_stat(999), "999");
        assert_eq!(format_stat(1_000), "1,000");
        assert_eq!(format_stat(10_718), "10,718");
        assert_eq!(format_stat(999_999), "999,999");
    }

    #[test]
    fn format_stat_compact_millions() {
        assert_eq!(format_stat(1_000_000), "1M");
        assert_eq!(format_stat(1_200_000), "1.2M");
        assert_eq!(format_stat(1_234_567), "1.2M");
        assert_eq!(format_stat(10_000_000), "10M");
        assert_eq!(format_stat(10_500_000), "10.5M");
    }

    #[test]
    fn format_stat_compact_billions() {
        assert_eq!(format_stat(1_000_000_000), "1B");
        assert_eq!(format_stat(1_500_000_000), "1.5B");
    }

    #[test]
    fn normalizes_badge_type_aliases() {
        assert_eq!(normalize_badge_type("sloc"), "code");
        assert_eq!(normalize_badge_type("total-lines"), "lines");
        assert_eq!(normalize_badge_type("language-count"), "languages");
        assert_eq!(normalize_badge_type("code-share"), "ratio");
    }

    #[test]
    fn formats_percent() {
        assert_eq!(format_percent(0, 0), "0%");
        assert_eq!(format_percent(9, 10), "90%");
        assert_eq!(format_percent(1, 3), "33.3%");
    }
}
