use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};

use crate::{
    api::AppState,
    models::{Report, RepositoryProvider},
};

pub async fn github(
    State(state): State<AppState>,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    og_response(
        state
            .coordinator
            .store()
            .latest_report(RepositoryProvider::GitHub, &owner, &repo)
            .await
            .ok()
            .flatten()
            .as_ref(),
    )
}

pub async fn gitlab(State(state): State<AppState>, Path(path): Path<String>) -> Response {
    let segments: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    let Some((repo, owner_parts)) = segments.split_last() else {
        return og_response(None);
    };
    let owner = owner_parts.join("/");
    og_response(
        state
            .coordinator
            .store()
            .latest_report(RepositoryProvider::GitLab, &owner, repo)
            .await
            .ok()
            .flatten()
            .as_ref(),
    )
}

fn og_response(report: Option<&Report>) -> Response {
    let png = render_png(report).unwrap_or_else(|error| {
        tracing::warn!(%error, "failed to render og image");
        Vec::new()
    });

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "image/png"),
            (
                header::CACHE_CONTROL,
                "public, s-maxage=86400, stale-while-revalidate=604800",
            ),
        ],
        png,
    )
        .into_response()
}

fn render_png(report: Option<&Report>) -> anyhow::Result<Vec<u8>> {
    let svg = render_svg(report);
    let mut options = resvg::usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    options.font_family = "DejaVu Sans Mono".to_string();
    let tree = resvg::usvg::Tree::from_str(&svg, &options)?;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(1200, 630)
        .ok_or_else(|| anyhow::anyhow!("failed to allocate pixmap"))?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::identity(),
        &mut pixmap.as_mut(),
    );
    pixmap
        .encode_png()
        .map_err(|error| anyhow::anyhow!("failed to encode png: {error}"))
}

fn render_svg(report: Option<&Report>) -> String {
    let (repo, ref_line, total, code, comments, blanks, languages) = match report {
        Some(report) => (
            format!("{}/{}", report.repository.owner, report.repository.name),
            format!(
                "{} / {} / {}ms",
                report.ref_name,
                report.commit_sha.chars().take(12).collect::<String>(),
                report.duration_ms
            ),
            format_number(report.total.lines),
            format_number(report.total.code),
            format_number(report.total.comments),
            format_number(report.total.blanks),
            report.languages.iter().take(5).cloned().collect::<Vec<_>>(),
        ),
        None => (
            "OctoCounts".to_string(),
            "public repository SLOC reports".to_string(),
            "actual".to_string(),
            "code".to_string(),
            "comments".to_string(),
            "blanks".to_string(),
            Vec::new(),
        ),
    };

    let bars = if languages.is_empty() {
        r#"<text x="760" y="278" class="muted">paste a public GitHub or GitLab repo</text>
<text x="760" y="324" class="muted">count files, code, comments, blanks</text>
<text x="760" y="370" class="accent">no clone required</text>"#
            .to_string()
    } else {
        let max = languages
            .iter()
            .map(|language| language.stats.code)
            .max()
            .unwrap_or(1)
            .max(1);
        languages
            .iter()
            .enumerate()
            .map(|(index, language)| {
                let y = 206 + index * 62;
                let width = ((language.stats.code as f64 / max as f64) * 260.0).max(6.0);
                format!(
                    r##"<text x="760" y="{label_y}" class="row">{name}</text>
<rect x="760" y="{bar_y}" width="300" height="15" fill="#152116" />
<rect x="760" y="{bar_y}" width="{width:.1}" height="15" fill="{color}" />
<text x="1082" y="{label_y}" class="row end">{value}</text>"##,
                    label_y = y,
                    bar_y = y + 15,
                    name = escape_xml(&language.name),
                    width = width,
                    color = language_color(&language.name),
                    value = format_number(language.stats.code)
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<style>
  text {{ font-family: "DejaVu Sans Mono", "Menlo", monospace; fill: #e8f5e1; }}
  .muted {{ fill: #8ca18c; font-size: 18px; }}
  .accent {{ fill: #78ff5b; font-size: 18px; }}
  .repo {{ font-size: 34px; font-weight: 700; }}
  .big {{ font-size: 88px; font-weight: 700; }}
  .label {{ fill: #78ff5b; font-size: 24px; font-weight: 700; }}
  .stat {{ font-size: 26px; }}
  .row {{ font-size: 18px; }}
  .end {{ text-anchor: end; }}
</style>
<rect width="1200" height="630" fill="#050a06" />
<circle cx="1020" cy="105" r="230" fill="#0f2510" opacity="0.55" />
<rect x="46" y="46" width="1108" height="538" fill="#081108" stroke="#2b3b2c" />
<rect x="46" y="46" width="1108" height="54" fill="#0d170f" stroke="#2b3b2c" />
<circle cx="78" cy="73" r="8" fill="#ff5f56" />
<circle cx="104" cy="73" r="8" fill="#d29922" />
<circle cx="130" cy="73" r="8" fill="#78ff5b" />
<text x="1086" y="80" class="muted end">octocounts.com</text>
<text x="88" y="158" class="repo">{repo}</text>
<text x="88" y="196" class="muted">{ref_line}</text>
<text x="88" y="286" class="label">TOTAL LINES</text>
<text x="88" y="374" class="big">{total}</text>
<text x="92" y="464" class="stat">code</text>
<text x="360" y="464" class="stat end">{code}</text>
<text x="92" y="510" class="muted">comments</text>
<text x="360" y="510" class="muted end">{comments}</text>
<text x="92" y="552" class="muted">blanks</text>
<text x="360" y="552" class="muted end">{blanks}</text>
<rect x="722" y="138" width="386" height="394" fill="#060b07" stroke="#2b3b2c" />
<text x="760" y="174" class="label">TOP LANGUAGES</text>
{bars}
</svg>"##,
        repo = escape_xml(&truncate(&repo, 42)),
        ref_line = escape_xml(&truncate(&ref_line, 58)),
        total = escape_xml(&total),
        code = escape_xml(&code),
        comments = escape_xml(&comments),
        blanks = escape_xml(&blanks),
        bars = bars
    )
}

fn language_color(name: &str) -> &'static str {
    match name.to_ascii_lowercase().as_str() {
        "rust" => "#dea584",
        "typescript" => "#3178c6",
        "javascript" => "#f1e05a",
        "python" => "#3572a5",
        "go" => "#00add8",
        "java" => "#b07219",
        "c" => "#555555",
        "c++" => "#f34b7d",
        "html" => "#e34c26",
        "css" => "#563d7c",
        _ => "#78ff5b",
    }
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut out = value
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    out.push('…');
    out
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn format_number(value: usize) -> String {
    let raw = value.to_string();
    let mut out = String::with_capacity(raw.len() + raw.len() / 3);
    for (index, ch) in raw.chars().rev().enumerate() {
        if index > 0 && index % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    out.chars().rev().collect()
}
