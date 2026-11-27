use std::sync::{Arc, OnceLock};

use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use serde::Deserialize;

use crate::{
    api::AppState,
    cache::AppCaches,
    models::RepositoryProvider,
    store::OgReportSummary,
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
    let generation = state.caches.generation();
    let latest_key = format!("{generation}:github:{owner}:{repo}");
    if let Some(png) = state.caches.og_latest.get(&latest_key).await {
        return png_response(png);
    }

    let report = state
        .coordinator
        .store()
        .latest_og_summary(RepositoryProvider::GitHub, &owner, &repo)
        .await
        .ok()
        .flatten();
    let png = render_or_cached_png(
        &state.caches,
        og_cache_key(RepositoryProvider::GitHub, &owner, &repo, report.as_ref()),
        move || render_png(&render_svg(report.as_ref())),
    )
    .await;
    if !png.is_empty() && generation == state.caches.generation() {
        state.caches.og_latest.insert(latest_key, png.clone()).await;
    }
    png_response(png)
}

/// `GET /og/compare?left=owner/repo&right=owner/repo`: the share card of a
/// curated comparison. Both sides come from the same lookup the single-report
/// card uses, and the card falls back to the repo-less default when either
/// side has no cached report, so a share URL never fails to produce an image.
pub async fn compare(State(state): State<AppState>, Query(query): Query<CompareQuery>) -> Response {
    // Missing parameters are read as an empty slug, so a malformed share URL
    // still produces an image instead of a 400.
    let left = query.left.as_deref().and_then(parse_slug);
    let right = query.right.as_deref().and_then(parse_slug);
    let (Some(left), Some(right)) = (left, right) else {
        return og_response(&state.caches, DEFAULT_OG_CACHE_KEY.to_string(), move || {
            render_png(&render_svg(None))
        })
        .await;
    };
    let generation = state.caches.generation();
    let latest_key = format!(
        "{generation}:compare:{}/{}:{}/{}",
        left.0, left.1, right.0, right.1
    );
    if let Some(png) = state.caches.og_latest.get(&latest_key).await {
        return png_response(png);
    }

    let store = state.coordinator.store();
    let (left_report, right_report) = tokio::join!(
        store.latest_og_summary(RepositoryProvider::GitHub, &left.0, &left.1),
        store.latest_og_summary(RepositoryProvider::GitHub, &right.0, &right.1),
    );
    // A failed lookup is treated like a missing report: the card degrades to
    // the repo-less default rather than failing the share URL.
    let (left_report, right_report) = (left_report.ok().flatten(), right_report.ok().flatten());
    let card = CompareCard::build(left_report.as_ref(), right_report.as_ref());
    let png = render_or_cached_png(
        &state.caches,
        compare_cache_key(left_report.as_ref(), right_report.as_ref()),
        move || render_png(&render_compare_svg(card.as_deref())),
    )
    .await;
    if !png.is_empty() && generation == state.caches.generation() {
        state.caches.og_latest.insert(latest_key, png.clone()).await;
    }
    png_response(png)
}

#[derive(Deserialize)]
pub struct CompareQuery {
    #[serde(default)]
    left: Option<String>,
    #[serde(default)]
    right: Option<String>,
}

/// `owner/repo` with GitHub's path characters only, so a query string can
/// never place markup or a foreign host in the card.
fn parse_slug(value: &str) -> Option<(String, String)> {
    let (owner, repo) = value.split_once('/')?;
    let valid = |part: &str| {
        !part.is_empty()
            && part.len() <= 100
            && part
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || "_.-".contains(ch))
    };
    (valid(owner) && valid(repo)).then(|| (owner.to_string(), repo.to_string()))
}

/// Both sides of a comparison card, reduced to what the image shows.
pub struct CompareCard {
    left: CompareSide,
    right: CompareSide,
}

struct CompareSide {
    full_name: String,
    code: usize,
    lines: usize,
    files: usize,
    top_language: Option<(String, f64)>,
}

impl CompareCard {
    /// `None` unless both sides have a report: a comparison of one
    /// repository is not a comparison.
    fn build(left: Option<&OgReportSummary>, right: Option<&OgReportSummary>) -> Option<Box<Self>> {
        let side = |report: &OgReportSummary| {
            let top = report
                .languages
                .iter()
                .max_by_key(|language| language.stats.code)
                .filter(|language| language.stats.code > 0)
                .map(|language| {
                    (
                        language.name.clone(),
                        language.stats.code as f64 / report.total.code.max(1) as f64 * 100.0,
                    )
                });
            CompareSide {
                full_name: format!("{}/{}", report.owner, report.repo),
                code: report.total.code,
                lines: report.total.lines,
                files: report.total.files,
                top_language: top,
            }
        };
        Some(Box::new(Self {
            left: side(left?),
            right: side(right?),
        }))
    }
}

/// `compare:owner/repo:commit:owner/repo:commit`. Like the single-report key,
/// the commits are part of it, so a cached PNG can never disagree with the
/// reports it was rendered from.
fn compare_cache_key(left: Option<&OgReportSummary>, right: Option<&OgReportSummary>) -> String {
    let side = |report: Option<&OgReportSummary>| {
        report
            .map(|report| format!("{}/{}:{}", report.owner, report.repo, report.commit_sha))
            .unwrap_or_default()
    };
    format!("compare:{}:{}", side(left), side(right))
}

pub async fn gitlab(State(state): State<AppState>, Path(path): Path<String>) -> Response {
    let segments: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    let Some((repo, owner_parts)) = segments.split_last() else {
        return og_response(&state.caches, DEFAULT_OG_CACHE_KEY.to_string(), move || {
            render_png(&render_svg(None))
        })
        .await;
    };
    let owner = owner_parts.join("/");
    let generation = state.caches.generation();
    let latest_key = format!("{generation}:gitlab:{owner}:{repo}");
    if let Some(png) = state.caches.og_latest.get(&latest_key).await {
        return png_response(png);
    }

    let report = state
        .coordinator
        .store()
        .latest_og_summary(RepositoryProvider::GitLab, &owner, repo)
        .await
        .ok()
        .flatten();
    let png = render_or_cached_png(
        &state.caches,
        og_cache_key(RepositoryProvider::GitLab, &owner, repo, report.as_ref()),
        move || render_png(&render_svg(report.as_ref())),
    )
    .await;
    if !png.is_empty() && generation == state.caches.generation() {
        state.caches.og_latest.insert(latest_key, png.clone()).await;
    }
    png_response(png)
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
    report: Option<&OgReportSummary>,
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
/// are memoized (and coalesced via `try_get_with`) so concurrent and repeat
/// traffic for the same commit key never rasterizes more than once.
async fn render_or_cached_png<F>(caches: &AppCaches, cache_key: String, render: F) -> Bytes
where
    F: FnOnce() -> anyhow::Result<Vec<u8>> + Send + 'static,
{
    match caches
        .og_png
        .try_get_with(cache_key, async {
            let png = tokio::task::spawn_blocking(render)
                .await
                .map_err(anyhow::Error::from)
                .and_then(|result| result)?;
            anyhow::ensure!(!png.is_empty(), "rendered og png was empty");
            anyhow::Ok(Bytes::from(png))
        })
        .await
    {
        Ok(png) => png,
        Err(error) => {
            tracing::warn!(%error, "failed to render og image");
            Bytes::new()
        }
    }
}

async fn og_response<F>(caches: &AppCaches, cache_key: String, render: F) -> Response
where
    F: FnOnce() -> anyhow::Result<Vec<u8>> + Send + 'static,
{
    png_response(render_or_cached_png(caches, cache_key, render).await)
}

fn png_response(png: Bytes) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "image/png"),
            (
                header::CACHE_CONTROL,
                "public, max-age=300, s-maxage=86400, stale-while-revalidate=3600",
            ),
        ],
        png,
    )
        .into_response()
}

fn render_png(svg: &str) -> anyhow::Result<Vec<u8>> {
    let mut options = resvg::usvg::Options {
        font_family: OG_FONT_FAMILY.to_string(),
        ..Default::default()
    };
    options.fontdb = fontdb();
    let tree = resvg::usvg::Tree::from_str(svg, &options)?;
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

fn render_svg(report: Option<&OgReportSummary>) -> String {
    let (repo, ref_line, total, code, comments, blanks, languages) = match report {
        Some(report) => (
            format!("{}/{}", report.owner, report.repo),
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

/// The comparison card: both repositories side by side, code lines as the
/// headline figure, a bar sized against the larger side. Without two reports
/// it is the repo-less default card, like a single-report miss.
fn render_compare_svg(card: Option<&CompareCard>) -> String {
    let Some(card) = card else {
        return render_svg(None);
    };
    // DejaVu Sans Mono advances 0.602 em, so a name at 24px fits 31
    // characters in a panel and a 34px title fits 50 across the card.
    let title = truncate(
        &format!("{} vs {}", card.left.full_name, card.right.full_name),
        50,
    );
    let larger = card.left.code.max(card.right.code).max(1);
    let panel = |side: &CompareSide, x: i32| {
        let bar = ((side.code as f64 / larger as f64) * 440.0).max(6.0);
        let language = side
            .top_language
            .as_ref()
            .map(|(name, share)| format!("{} {:.1}%", name, share))
            .unwrap_or_else(|| "no language counted".to_string());
        format!(
            r##"<rect x="{x}" y="240" width="496" height="290" fill="#060b07" stroke="#2b3b2c" />
<text x="{x36}" y="284" class="side">{name}</text>
<text x="{x36}" y="376" class="big">{code}</text>
<text x="{x36}" y="406" class="muted">code lines</text>
<rect x="{x36}" y="430" width="440" height="15" fill="#152116" />
<rect x="{x36}" y="430" width="{bar:.1}" height="15" fill="#78ff5b" />
<text x="{x36}" y="484" class="row">{lines} total lines · {files} files</text>
<text x="{x36}" y="514" class="row">{language}</text>"##,
            x36 = x + 36,
            name = escape_xml(&truncate(&side.full_name, 31)),
            code = escape_xml(&format_number(side.code)),
            lines = escape_xml(&format_number(side.lines)),
            files = escape_xml(&format_number(side.files)),
            language = escape_xml(&truncate(&language, 42)),
        )
    };

    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<style>
  text {{ font-family: "DejaVu Sans Mono", "Menlo", monospace; fill: #e8f5e1; }}
  .muted {{ fill: #8ca18c; font-size: 18px; }}
  .title {{ font-size: 34px; font-weight: 700; }}
  .side {{ font-size: 24px; font-weight: 700; }}
  .big {{ font-size: 64px; font-weight: 700; fill: #78ff5b; }}
  .row {{ font-size: 18px; }}
  .end {{ text-anchor: end; }}
</style>
<rect width="1200" height="630" fill="#050a06" />
<rect x="46" y="46" width="1108" height="538" fill="#081108" stroke="#2b3b2c" />
<rect x="46" y="46" width="1108" height="54" fill="#0d170f" stroke="#2b3b2c" />
<circle cx="78" cy="73" r="8" fill="#ff5f56" />
<circle cx="104" cy="73" r="8" fill="#d29922" />
<circle cx="130" cy="73" r="8" fill="#78ff5b" />
<text x="1086" y="80" class="muted end">octocounts.com</text>
<text x="88" y="166" class="title">{title}</text>
<text x="88" y="204" class="muted">source lines of code, counted with tokei under the same rules</text>
{left}{right}
</svg>"##,
        title = escape_xml(&title),
        left = panel(&card.left, 88),
        right = panel(&card.right, 616),
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

    fn default_render() -> anyhow::Result<Vec<u8>> {
        render_png(&render_svg(None))
    }

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

        let response = og_response(&caches, key, default_render).await;
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

        let first = body_bytes(og_response(&caches, key.clone(), default_render).await).await;
        assert_eq!(&first[..8], b"\x89PNG\r\n\x1a\n");

        let cached = caches.og_png.get(&key).await.expect("png was memoized");
        assert_eq!(cached, first);

        let second = body_bytes(og_response(&caches, key, default_render).await).await;
        assert_eq!(second, first);
    }

    #[test]
    fn render_png_is_deterministic_across_calls() {
        let first = default_render().expect("first render");
        let second = default_render().expect("second render");
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
