use std::time::Duration;

use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use uuid::Uuid;

use crate::{
    api::AppState,
    models::{AnalyzeRequest, AnalyzeResponse, JobStatus, Report},
    store::Store,
};

pub async fn badge_default(
    State(state): State<AppState>,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    serve_badge(state, owner, repo, None, false).await
}

pub async fn badge_branch(
    State(state): State<AppState>,
    Path((owner, repo, branch)): Path<(String, String, String)>,
) -> Response {
    serve_badge(state, owner, repo, Some(branch), false).await
}

pub async fn badge_tag(
    State(state): State<AppState>,
    Path((owner, repo, tag)): Path<(String, String, String)>,
) -> Response {
    serve_badge(state, owner, repo, Some(tag), true).await
}

pub async fn badge_commit(
    State(state): State<AppState>,
    Path((owner, repo, sha)): Path<(String, String, String)>,
) -> Response {
    serve_badge(state, owner, repo, Some(sha), true).await
}

async fn serve_badge(
    state: AppState,
    owner: String,
    repo: String,
    ref_name: Option<String>,
    is_immutable: bool,
) -> Response {
    let request = AnalyzeRequest {
        repo_url: format!("https://github.com/{}/{}", owner, repo),
        ref_name,
        force_refresh: false,
    };

    let cache = if is_immutable {
        "public, max-age=31536000, immutable"
    } else {
        "public, s-maxage=3600, stale-while-revalidate=86400"
    };

    match state.coordinator.submit(request).await {
        Ok(AnalyzeResponse::Cached { report, .. }) => svg_response(render_badge_svg(&report), cache),
        Ok(AnalyzeResponse::Job { job_id, .. }) => {
            match wait_for_job(state.coordinator.store(), job_id, Duration::from_secs(30)).await {
                Some(report) => svg_response(render_badge_svg(&report), cache),
                None => svg_response(render_pending_svg(), "no-cache, no-store"),
            }
        }
        Err(_) => svg_response(render_error_svg(), "no-cache, no-store"),
    }
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
    badge_svg("\u{00B7}\u{00B7}\u{00B7}", "\u{00B7}\u{00B7}\u{00B7}", "\u{00B7}\u{00B7}\u{00B7}", "\u{00B7}\u{00B7}\u{00B7}", true)
}

fn render_error_svg() -> String {
    badge_svg("\u{2014}", "\u{2014}", "\u{2014}", "\u{2014}", true)
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

const SVG_TEMPLATE: &str = r##"<svg width="358" height="34" viewBox="0 0 358 34" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="0.75" y="0.75" width="329" height="32" rx="3.75" fill="#30363D" stroke="#30363D" stroke-width="1.5"/>
  <g font-family="Inter,Arial,Helvetica,sans-serif">
    <text x="3.5" y="21.75" fill="#ffffff" font-size="15.6" font-weight="700" letter-spacing="-0.6">OctoCounts</text>
    <g font-size="13.2" font-weight="700" fill="__VAL_COLOR__">
      <text x="95.8" y="18.2" fill="__CODE_COLOR__">__CODE__</text>
      <text x="158.1" y="18.2">__FILES__</text>
      <text x="204.7" y="18.2">__LINES__</text>
      <text x="272.6" y="18.2">__COMMENTS__</text>
    </g>
    <g font-size="8.2" font-weight="400" fill="#8B949E">
      <text x="96.1" y="29.2">code</text>
      <text x="158.2" y="29.2">files</text>
      <text x="205" y="29.2">lines</text>
      <text x="272.8" y="29.2">comments</text>
    </g>
  </g>
</svg>"##;

#[cfg(test)]
mod tests {
    use super::format_stat;

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
}
