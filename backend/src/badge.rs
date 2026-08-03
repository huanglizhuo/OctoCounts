use std::time::Duration;

use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use uuid::Uuid;

use crate::{
    api::AppState,
    models::{AnalysisSource, AnalyzeRequest, AnalyzeResponse, JobStatus, Report},
    store::Store,
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
            match wait_for_job(state.coordinator.store(), job_id, Duration::from_secs(30)).await {
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

async fn wait_for_job(store: &Store, job_id: Uuid, timeout: Duration) -> Option<Report> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if tokio::time::Instant::now() >= deadline {
            return None;
        }
        match store.job(job_id).await {
            Ok(Some(job)) => match job.status {
                JobStatus::Completed => {
                    let report_id = job.report_id?;
                    return store.report(&report_id).await.ok().flatten();
                }
                JobStatus::Failed => return None,
                _ => {}
            },
            _ => return None,
        }
    }
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

#[cfg(test)]
mod tests {
    use super::{badge_cache_key, format_percent, format_stat, normalize_badge_type, BadgeParams};
    use crate::cache::AppCaches;

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
