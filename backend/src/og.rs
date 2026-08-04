use std::sync::{Arc, OnceLock};

use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use bytes::Bytes;

use crate::{
    api::AppState,
    cache::AppCaches,
    models::{Report, RepositoryProvider},
};

/// DejaVu Sans Mono, embedded so that rendering never touches the filesystem and
/// the runtime image does not need `fonts-dejavu-core` / `fontconfig`.
/// See `assets/fonts/LICENSE` for the (permissive) DejaVu font license.
const DEJAVU_SANS_MONO: &[u8] = include_bytes!("../assets/fonts/DejaVuSansMono.ttf");
const DEJAVU_SANS_MONO_BOLD: &[u8] = include_bytes!("../assets/fonts/DejaVuSansMono-Bold.ttf");

const OG_FONT_FAMILY: &str = "DejaVu Sans Mono";

static FONTDB: OnceLock<Arc<resvg::usvg::fontdb::Database>> = OnceLock::new();

/// Builds the font database exactly once for the lifetime of the process.
///
/// The previous implementation called `load_system_fonts()` on every `/og/...`
/// request, which walks and parses every font file on the host.
fn fontdb() -> Arc<resvg::usvg::fontdb::Database> {
    FONTDB
        .get_or_init(|| {
            let mut db = resvg::usvg::fontdb::Database::new();
            db.load_font_data(DEJAVU_SANS_MONO.to_vec());
            db.load_font_data(DEJAVU_SANS_MONO_BOLD.to_vec());
            db.set_monospace_family(OG_FONT_FAMILY);
            db.set_sans_serif_family(OG_FONT_FAMILY);
            db.set_serif_family(OG_FONT_FAMILY);
            db.set_cursive_family(OG_FONT_FAMILY);
            db.set_fantasy_family(OG_FONT_FAMILY);
            Arc::new(db)
        })
        .clone()
}

pub async fn github(
    State(state): State<AppState>,
    Path((owner, repo)): Path<(String, String)>,
) -> Response {
    let report = state
        .coordinator
        .store()
        .latest_report(RepositoryProvider::GitHub, &owner, &repo)
        .await
        .ok()
        .flatten();
    og_response(
        &state.caches,
        og_cache_key(RepositoryProvider::GitHub, &owner, &repo, report.as_ref()),
        report,
    )
    .await
}

pub async fn gitlab(State(state): State<AppState>, Path(path): Path<String>) -> Response {
    let segments: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    let Some((repo, owner_parts)) = segments.split_last() else {
        return og_response(&state.caches, DEFAULT_OG_CACHE_KEY.to_string(), None).await;
    };
    let owner = owner_parts.join("/");
    let report = state
        .coordinator
        .store()
        .latest_report(RepositoryProvider::GitLab, &owner, repo)
        .await
        .ok()
        .flatten();
    og_response(
        &state.caches,
        og_cache_key(RepositoryProvider::GitLab, &owner, repo, report.as_ref()),
        report,
    )
    .await
}

/// Key used for the repo-less fallback card, which is identical for every miss.
const DEFAULT_OG_CACHE_KEY: &str = "__default__";

/// `provider:owner:repo:commit_sha`. Because the commit sha is part of the key,
/// a cached PNG can never disagree with the report it was rendered from — a new
/// analysis simply produces a new key.
fn og_cache_key(
    provider: RepositoryProvider,
    owner: &str,
    repo: &str,
    report: Option<&Report>,
) -> String {
    let Some(report) = report else {
        return DEFAULT_OG_CACHE_KEY.to_string();
    };
    let provider = match provider {
        RepositoryProvider::GitHub => "github",
        RepositoryProvider::GitLab => "gitlab",
    };
    format!("{provider}:{owner}:{repo}:{}", report.commit_sha)
}

/// Rasterizing 1200x630 and PNG-encoding it takes single-digit milliseconds of
/// pure CPU. Running that inline would park a tokio worker for the whole time,
/// so it is handed to the blocking pool instead — and, once rendered, the bytes
/// are memoized so repeat traffic for the same commit never rasterizes again.
async fn og_response(caches: &AppCaches, cache_key: String, report: Option<Report>) -> Response {
    if let Some(png) = caches.og_png.get(&cache_key).await {
        return png_response(png);
    }

    let png = tokio::task::spawn_blocking(move || render_png(report.as_ref()))
        .await
        .map_err(anyhow::Error::from)
        .and_then(|result| result)
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "failed to render og image");
            Vec::new()
        });
    let png = Bytes::from(png);

    // An empty body means the render failed; never memoize a failure.
    if !png.is_empty() {
        caches.og_png.insert(cache_key, png.clone()).await;
    }

    png_response(png)
}

fn png_response(png: Bytes) -> Response {
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
    let mut options = resvg::usvg::Options {
        font_family: OG_FONT_FAMILY.to_string(),
        ..Default::default()
    };
    options.fontdb = fontdb();
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

#[cfg(test)]
mod tests {
    use http_body_util::BodyExt;

    use super::*;

    async fn body_bytes(response: Response) -> Bytes {
        response.into_body().collect().await.unwrap().to_bytes()
    }

    #[test]
    fn og_cache_key_pins_provider_owner_repo_and_commit() {
        assert_eq!(
            og_cache_key(RepositoryProvider::GitHub, "acme", "widget", None),
            DEFAULT_OG_CACHE_KEY,
        );
        assert_eq!(
            og_cache_key(RepositoryProvider::GitLab, "acme", "widget", None),
            DEFAULT_OG_CACHE_KEY,
        );
    }

    /// A cache hit must short-circuit rendering entirely, so a sentinel value
    /// under the key comes back verbatim instead of a freshly drawn PNG.
    #[tokio::test]
    async fn cached_png_is_served_without_rendering() {
        let caches = AppCaches::new();
        let key = "github:acme:widget:deadbeef".to_string();
        let sentinel = Bytes::from_static(b"not-really-a-png");
        caches.og_png.insert(key.clone(), sentinel.clone()).await;

        let response = og_response(&caches, key, None).await;
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("image/png"),
        );
        assert_eq!(body_bytes(response).await, sentinel);
    }

    #[tokio::test]
    async fn rendered_png_is_memoized_under_its_key() {
        let caches = AppCaches::new();
        let key = "github:acme:widget:cafebabe".to_string();
        assert!(caches.og_png.get(&key).await.is_none());

        let first = body_bytes(og_response(&caches, key.clone(), None).await).await;
        assert_eq!(&first[..8], b"\x89PNG\r\n\x1a\n");

        let cached = caches.og_png.get(&key).await.expect("png was memoized");
        assert_eq!(cached, first);

        let second = body_bytes(og_response(&caches, key, None).await).await;
        assert_eq!(second, first);
    }

    #[test]
    fn render_png_is_deterministic_across_calls() {
        let first = render_png(None).expect("first render");
        let second = render_png(None).expect("second render");
        assert!(!first.is_empty(), "rendered png must not be empty");
        assert_eq!(&first[..8], b"\x89PNG\r\n\x1a\n", "output must be a png");
        assert_eq!(first, second, "repeated renders must be byte-identical");
    }

    #[test]
    fn embedded_font_is_the_only_source() {
        let db = fontdb();
        assert_eq!(db.len(), 2, "only the two embedded DejaVu faces are loaded");
        assert!(db
            .faces()
            .all(|face| face.families.iter().any(|(name, _)| name == OG_FONT_FAMILY)));
    }
}
