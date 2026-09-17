use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    api::AppState,
    error::ApiError,
    models::{AnalysisOptions, AnalysisProfile, LanguageReport, LanguageStats, Report, RepositoryProvider},
    store::{provider_from_str, provider_to_str, RelatedReportRow, ReportCard},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeoReportQuery {
    provider: String,
    owner: String,
    repo: String,
    #[allow(dead_code)]
    ref_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageQuery {
    page: Option<i64>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeoReport {
    provider: String,
    owner: String,
    repo: String,
    repo_full_name: String,
    html_url: String,
    public_path: String,
    canonical_url: String,
    title: String,
    description: String,
    citation: String,
    generated_at: String,
    ref_name: String,
    commit_sha: String,
    tokei_version: String,
    /// Stable digest of the normalized effective configuration (engine version
    /// plus SHA-256 of the canonical options JSON, see
    /// `analyzer::analysis_key`). Same repository + same digest reproduces the
    /// same counts. Absent on reports stored before the field existed — see
    /// `analysis_options` for the matching rule.
    #[serde(skip_serializing_if = "Option::is_none")]
    analysis_key: Option<String>,
    /// The analysis configuration snapshot that produced these numbers:
    /// user-supplied ignores plus the docs/tests/generated toggles. Absent on
    /// reports stored before options were persisted; consumers must render
    /// that as "unknown", never as "default configuration".
    #[serde(skip_serializing_if = "Option::is_none")]
    analysis_options: Option<AnalysisOptions>,
    /// URL that reproduces exactly this result: the repository pinned at the
    /// analyzed commit with the options JSON in `?analysis=`, the same scheme
    /// the site's snapshot links use. Only present when the configuration is
    /// known, since without it the URL would not reproduce these numbers.
    #[serde(skip_serializing_if = "Option::is_none")]
    snapshot_url: Option<String>,
    duration_ms: u128,
    total: LanguageStats,
    top_language: Option<TopLanguage>,
    languages: Vec<LanguageReport>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopLanguage {
    name: String,
    code: usize,
    percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeoList {
    page: i64,
    limit: i64,
    reports: Vec<SeoReport>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SitemapEntry {
    loc: String,
    lastmod: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedReport {
    provider: String,
    owner: String,
    repo: String,
    repo_full_name: String,
    public_path: String,
    top_language: Option<String>,
    total_code: i64,
    total_lines: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedList {
    reports: Vec<RelatedReport>,
}

/// The report-page interlinking module shows at most this many similar
/// repositories; the store clamps higher requests to this as well.
const RELATED_LIMIT: i64 = 6;

pub async fn related(
    State(state): State<AppState>,
    Query(query): Query<SeoReportQuery>,
) -> Result<(HeaderMap, Json<RelatedList>), ApiError> {
    let cache_key = format!("related:{}", seo_report_cache_key(&query));
    if let Some(list) = state.caches.seo_related.get(&cache_key).await {
        return Ok((related_cache_headers(), Json(list)));
    }

    let provider = parse_provider(&query.provider)?;
    let Some(report) = state
        .coordinator
        .store()
        .latest_report_card(provider, &query.owner, &query.repo)
        .await
        .map_err(ApiError::internal)?
    else {
        return Err(ApiError::not_found(
            "report_not_found",
            "report was not found",
        ));
    };

    let card = report;
    let reports = state
        .coordinator
        .store()
        .related_reports(
            provider,
            &card.owner,
            &card.repo,
            card.languages.first().map(|language| language.name.as_str()),
            card.total.code as i64,
            RELATED_LIMIT,
        )
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .map(related_report)
        .collect();
    let list = RelatedList { reports };
    state
        .caches
        .seo_related
        .insert(cache_key, list.clone())
        .await;

    Ok((related_cache_headers(), Json(list)))
}

fn related_report(row: RelatedReportRow) -> RelatedReport {
    RelatedReport {
        provider: provider_to_str(&row.provider).to_string(),
        repo_full_name: format!("{}/{}", row.owner, row.repo),
        public_path: repository_public_path(row.provider, &row.owner, &row.repo),
        owner: row.owner,
        repo: row.repo,
        top_language: row.top_language,
        total_code: row.total_code.unwrap_or(0),
        total_lines: row.total_lines.unwrap_or(0),
    }
}

pub async fn report(
    State(state): State<AppState>,
    Query(query): Query<SeoReportQuery>,
) -> Result<(HeaderMap, Json<SeoReport>), ApiError> {
    let cache_key = seo_report_cache_key(&query);
    if let Some(report) = state.caches.seo_report.get(&cache_key).await {
        return Ok((seo_report_cache_headers(), Json(report)));
    }

    let provider = parse_provider(&query.provider)?;
    let Some(report) = state
        .coordinator
        .store()
        .latest_report_card(provider, &query.owner, &query.repo)
        .await
        .map_err(ApiError::internal)?
    else {
        return Err(ApiError::not_found(
            "report_not_found",
            "report was not found",
        ));
    };

    let report = seo_report(&report);
    state
        .caches
        .seo_report
        .insert(cache_key, report.clone())
        .await;

    Ok((seo_report_cache_headers(), Json(report)))
}

pub async fn recent(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<(HeaderMap, Json<SeoList>), ApiError> {
    let (page, limit, offset) = pagination(query);
    let cache_key = list_cache_key(page, limit);
    if let Some(list) = state.caches.seo_recent.get(&cache_key).await {
        return Ok((recent_cache_headers(), Json(list)));
    }

    let reports = state
        .coordinator
        .store()
        .recent_reports(limit, offset)
        .await
        .map_err(ApiError::internal)?
        .iter()
        .map(seo_report)
        .collect();
    let list = SeoList {
        page,
        limit,
        reports,
    };
    state
        .caches
        .seo_recent
        .insert(cache_key, list.clone())
        .await;

    Ok((recent_cache_headers(), Json(list)))
}

pub async fn popular(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<(HeaderMap, Json<SeoList>), ApiError> {
    let (page, limit, offset) = pagination(query);
    let cache_key = list_cache_key(page, limit);
    if let Some(list) = state.caches.seo_popular.get(&cache_key).await {
        return Ok((popular_cache_headers(), Json(list)));
    }

    let reports = state
        .coordinator
        .store()
        .popular_reports(limit, offset)
        .await
        .map_err(ApiError::internal)?
        .iter()
        .map(seo_report)
        .collect();
    let list = SeoList {
        page,
        limit,
        reports,
    };
    state
        .caches
        .seo_popular
        .insert(cache_key, list.clone())
        .await;

    Ok((popular_cache_headers(), Json(list)))
}

pub async fn monoliths(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<(HeaderMap, Json<SeoList>), ApiError> {
    let (page, limit, offset) = pagination(query);
    let cache_key = list_cache_key(page, limit);
    if let Some(list) = state.caches.seo_monoliths.get(&cache_key).await {
        return Ok((monoliths_cache_headers(), Json(list)));
    }

    let reports = state
        .coordinator
        .store()
        .monolith_reports(limit, offset)
        .await
        .map_err(ApiError::internal)?
        .iter()
        .map(seo_report)
        .collect();
    let list = SeoList {
        page,
        limit,
        reports,
    };
    state
        .caches
        .seo_monoliths
        .insert(cache_key, list.clone())
        .await;

    Ok((monoliths_cache_headers(), Json(list)))
}

pub async fn sitemap(
    State(state): State<AppState>,
) -> Result<(HeaderMap, Json<Vec<SitemapEntry>>), ApiError> {
    let cache_key = "sitemap".to_string();
    if let Some(entries) = state.caches.seo_sitemap.get(&cache_key).await {
        return Ok((sitemap_cache_headers(), Json(entries)));
    }

    let entries: Vec<SitemapEntry> = state
        .coordinator
        .store()
        .sitemap_entries(45_000)
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        // The site only serves /github/* report pages: the edge function and
        // the SPA have no /gitlab route, so publishing a GitLab URL here would
        // put a 404 in the sitemap. Filter until a GitLab route exists.
        .filter(|row| row.provider == RepositoryProvider::GitHub)
        .map(|row| SitemapEntry {
            loc: format!(
                "https://octocounts.com{}",
                repository_public_path(row.provider, &row.owner, &row.repo)
            ),
            lastmod: row.lastmod.to_string(),
        })
        .collect();
    state
        .caches
        .seo_sitemap
        .insert(cache_key, entries.clone())
        .await;

    Ok((sitemap_cache_headers(), Json(entries)))
}

pub(crate) fn parse_provider(value: &str) -> Result<RepositoryProvider, ApiError> {
    provider_from_str(value).ok_or_else(|| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "invalid_provider",
            "provider must be github or gitlab",
        )
    })
}

#[derive(Debug, Deserialize)]
pub struct ReposIndexableRequest {
    /// Repositories to check, most naturally taken from the compare registry.
    pub repos: Vec<RepoPair>,
}

#[derive(Debug, Deserialize)]
pub struct RepoPair {
    pub owner: String,
    pub repo: String,
    /// Optional; defaults to github, which is the only provider whose report
    /// pages the site serves.
    pub provider: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct IndexedRepo {
    pub provider: String,
    pub owner: String,
    pub repo: String,
}

/// `POST /api/seo/repos-indexable` — which of the requested repositories have
/// at least one cached report. The Pages Function's /sitemap.xml used to ask
/// this one report fetch at a time (~200 subrequests per cold sitemap against
/// a Workers budget that starts at 50 on the free plan); now it asks once.
pub async fn repos_indexable(
    State(state): State<AppState>,
    Json(request): Json<ReposIndexableRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if request.repos.len() > 1_000 {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "too_many_repos",
            "at most 1000 repositories per request",
        ));
    }

    let wanted = request
        .repos
        .iter()
        .map(|pair| {
            Ok((
                parse_provider(pair.provider.as_deref().unwrap_or("github"))?,
                pair.owner.clone(),
                pair.repo.clone(),
            ))
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    let found = state
        .coordinator
        .store()
        .repos_with_reports(&wanted)
        .await
        .map_err(ApiError::internal)?;

    let repos: Vec<IndexedRepo> = found
        .into_iter()
        .map(|(provider, owner, repo)| IndexedRepo {
            provider: provider_to_str(&provider).to_string(),
            owner,
            repo,
        })
        .collect();

    Ok(Json(serde_json::json!({ "repos": repos })))
}

fn pagination(query: PageQuery) -> (i64, i64, i64) {
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(24).clamp(1, 100);
    let offset = (page - 1) * limit;
    (page, limit, offset)
}

fn seo_report_cache_key(query: &SeoReportQuery) -> String {
    format!(
        "{}:{}:{}:{}",
        query.provider.to_ascii_lowercase(),
        query.owner.to_ascii_lowercase(),
        query.repo.to_ascii_lowercase(),
        query.ref_name.as_deref().unwrap_or_default()
    )
}

fn list_cache_key(page: i64, limit: i64) -> String {
    format!("page={page}:limit={limit}")
}

fn recent_cache_headers() -> HeaderMap {
    cache_headers("public, max-age=60, s-maxage=60, stale-while-revalidate=120")
}

fn popular_cache_headers() -> HeaderMap {
    cache_headers("public, max-age=300, s-maxage=300, stale-while-revalidate=1800")
}

fn monoliths_cache_headers() -> HeaderMap {
    cache_headers("public, max-age=900, s-maxage=900, stale-while-revalidate=3600")
}

fn sitemap_cache_headers() -> HeaderMap {
    cache_headers("public, max-age=900, s-maxage=900, stale-while-revalidate=3600")
}

fn related_cache_headers() -> HeaderMap {
    cache_headers("public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400")
}

fn seo_report_cache_headers() -> HeaderMap {
    cache_headers("public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400")
}

pub(crate) fn cache_headers(cache_control: &'static str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(cache_control),
    );
    headers
}

fn seo_report(card: &ReportCard) -> SeoReport {
    let public_path = repository_public_path(card.provider, &card.owner, &card.repo);
    let canonical_url = format!("https://octocounts.com{public_path}");
    let repo_full_name = format!("{}/{}", card.owner, card.repo);
    let top_language = top_language(card);
    let top_phrase = top_language
        .as_ref()
        .map(|top| format!("; top language: {} {:.1}%", top.name, top.percent))
        .unwrap_or_default();
    let configuration = configuration_summary(card.analysis_options.as_ref());
    let title = format!(
        "{}: {} lines of code | OctoCounts",
        repo_full_name,
        format_number(card.total.code)
    );
    let description = format!(
        "{} contains {} code lines across {} files and {} languages{}.",
        repo_full_name,
        format_number(card.total.code),
        format_number(card.total.files),
        format_number(card.language_count),
        top_phrase
    );
    let citation = format!(
        "As of {} (commit {}), {} contains {} total lines: {} code, {} comments, {} blank, across {} files in {} languages{}.{} Counted with tokei via OctoCounts.",
        card.generated_at.date_naive(),
        card.commit_sha.chars().take(12).collect::<String>(),
        repo_full_name,
        format_number(card.total.lines),
        format_number(card.total.code),
        format_number(card.total.comments),
        format_number(card.total.blanks),
        format_number(card.total.files),
        format_number(card.language_count),
        top_language
            .as_ref()
            .map(|top| format!(" (top: {} {:.1}%)", top.name, top.percent))
            .unwrap_or_default(),
        configuration
    );

    let snapshot_url = card
        .analysis_options
        .as_ref()
        .and_then(|options| snapshot_url(&canonical_url, &card.commit_sha, options));

    SeoReport {
        provider: provider_to_str(&card.provider).to_string(),
        owner: card.owner.clone(),
        repo: card.repo.clone(),
        repo_full_name,
        html_url: card.html_url.clone(),
        public_path,
        canonical_url,
        title,
        description,
        citation,
        generated_at: card.generated_at.to_rfc3339(),
        ref_name: card.ref_name.clone(),
        commit_sha: card.commit_sha.clone(),
        tokei_version: card.tokei_version.clone(),
        analysis_key: card.analysis_key.clone(),
        analysis_options: card.analysis_options.clone(),
        snapshot_url,
        duration_ms: card.duration_ms,
        total: card.total.clone(),
        top_language,
        languages: card.languages.clone(),
    }
}

/// One-line summary of the counting configuration for citation prose. Mirrors
/// the phrasing the client-side citation builder uses so both say the same
/// thing, and makes the unknown case explicit instead of calling it "default".
fn configuration_summary(options: Option<&AnalysisOptions>) -> String {
    let Some(options) = options else {
        return " Configuration unknown; this report predates option tracking.".to_string();
    };
    let mut parts: Vec<String> = Vec::new();
    if !options.include_tests {
        parts.push("tests excluded".to_string());
    }
    if !options.include_docs {
        parts.push("docs excluded".to_string());
    }
    if !options.include_generated {
        parts.push("generated excluded".to_string());
    }
    if matches!(options.profile, AnalysisProfile::SourceOnly) {
        parts.push("profile: source-only".to_string());
    }
    parts.extend(options.ignored_dirs.iter().map(|dir| format!("ignoring {dir}")));
    parts.extend(
        options
            .ignored_languages
            .iter()
            .map(|language| format!("ignoring {language}")),
    );
    if parts.is_empty() {
        " Default configuration.".to_string()
    } else {
        format!(" Custom configuration ({}).", parts.join(", "))
    }
}

/// The reproducible snapshot URL: repository pinned at the analyzed commit
/// with the options JSON in `?analysis=`, matching the site's snapshot link
/// scheme (`/github/{owner}/{repo}/commit/{sha}?analysis=...`).
fn snapshot_url(canonical_url: &str, commit_sha: &str, options: &AnalysisOptions) -> Option<String> {
    let options_json = serde_json::to_string(options).ok()?;
    Some(format!(
        "{canonical_url}/commit/{commit_sha}?analysis={}",
        urlencoding::encode(&options_json)
    ))
}

fn top_language(card: &ReportCard) -> Option<TopLanguage> {
    let language = card.languages.first()?;
    let percent = if card.total.code == 0 {
        0.0
    } else {
        (language.stats.code as f64 / card.total.code as f64) * 100.0
    };
    Some(TopLanguage {
        name: language.name.clone(),
        code: language.stats.code,
        percent,
    })
}

pub(crate) fn public_path(report: &Report) -> String {
    repository_public_path(
        report.repository.provider,
        &report.repository.owner,
        &report.repository.name,
    )
}

/// The canonical site path for a repository. Kept free of `Report` so the sitemap
/// can build it from four columns instead of a deserialized report body.
pub(crate) fn repository_public_path(
    provider: RepositoryProvider,
    owner: &str,
    repo: &str,
) -> String {
    match provider {
        RepositoryProvider::GitHub => {
            format!("/github/{}/{}", encode_segment(owner), encode_segment(repo))
        }
        // GitLab owners are nested group paths, so the separators have to survive
        // encoding.
        RepositoryProvider::GitLab => format!(
            "/gitlab/{}/{}",
            owner
                .split('/')
                .map(encode_segment)
                .collect::<Vec<_>>()
                .join("/"),
            encode_segment(repo)
        ),
    }
}

fn encode_segment(value: &str) -> String {
    urlencoding::encode(value).replace("%2F", "/")
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
    use super::{
        configuration_summary, seo_report, snapshot_url, ReportCard,
    };
    use crate::models::{AnalysisOptions, AnalysisProfile, LanguageReport, LanguageStats};
    use chrono::{TimeZone, Utc};

    /// The all-inclusive counting configuration a real analysis request gets
    /// when the client sends options explicitly (serde's field defaults).
    /// `AnalysisOptions::default()` — the derived Rust default — has the three
    /// booleans at `false`; that flavour only appears on rows written from
    /// struct-literal code, so tests that mean "what a user sees" build the
    /// options explicitly.
    fn default_options() -> AnalysisOptions {
        AnalysisOptions {
            ignored_dirs: Vec::new(),
            ignored_languages: Vec::new(),
            profile: AnalysisProfile::Default,
            include_docs: true,
            include_tests: true,
            include_generated: true,
        }
    }

    fn card(options: Option<AnalysisOptions>) -> ReportCard {
        ReportCard {
            provider: crate::models::RepositoryProvider::GitHub,
            owner: "rust-lang".to_string(),
            repo: "rust".to_string(),
            html_url: "https://github.com/rust-lang/rust".to_string(),
            ref_name: "main".to_string(),
            commit_sha: "9f8e7d6c5b4a39281706".to_string(),
            generated_at: Utc.with_ymd_and_hms(2024, 3, 14, 9, 30, 15).unwrap(),
            duration_ms: 91_234,
            tokei_version: "tokei-14.0.0".to_string(),
            analysis_key: options
                .as_ref()
                .map(|_| "tokei-14.0.0:default".to_string()),
            analysis_options: options,
            total: LanguageStats {
                files: 16_346,
                lines: 2_846_077,
                code: 2_306_821,
                comments: 329_546,
                blanks: 209_710,
            },
            language_count: 15,
            languages: vec![LanguageReport {
                name: "Rust".to_string(),
                stats: LanguageStats {
                    files: 12_345,
                    lines: 1_523_166,
                    code: 1_234_567,
                    comments: 176_366,
                    blanks: 112_233,
                },
                children: Vec::new(),
            }],
        }
    }

    #[test]
    fn known_configuration_is_exposed_with_a_reproducible_snapshot_url() {
        let report = seo_report(&card(Some(default_options())));
        let json = serde_json::to_value(&report).unwrap();

        assert_eq!(json["analysisKey"], "tokei-14.0.0:default");
        assert_eq!(
            json["analysisOptions"],
            serde_json::json!({
                "ignoredDirs": [],
                "ignoredLanguages": [],
                "profile": "default",
                "includeDocs": true,
                "includeTests": true,
                "includeGenerated": true,
            })
        );
        assert_eq!(
            json["snapshotUrl"],
            "https://octocounts.com/github/rust-lang/rust/commit/9f8e7d6c5b4a39281706?analysis=%7B%22ignoredDirs%22%3A%5B%5D%2C%22ignoredLanguages%22%3A%5B%5D%2C%22profile%22%3A%22default%22%2C%22includeDocs%22%3Atrue%2C%22includeTests%22%3Atrue%2C%22includeGenerated%22%3Atrue%7D"
        );
        assert!(
            json["citation"]
                .as_str()
                .unwrap()
                .contains("Default configuration.")
        );
    }

    /// The unknown-configuration case must omit the fields entirely (the
    /// golden fixtures and consumers key off their absence) and must not call
    /// the configuration "default".
    #[test]
    fn unknown_configuration_omits_fields_and_marks_the_citation() {
        let report = seo_report(&card(None));
        let json = serde_json::to_value(&report).unwrap();

        assert!(json.get("analysisKey").is_none());
        assert!(json.get("analysisOptions").is_none());
        assert!(json.get("snapshotUrl").is_none());
        let citation = json["citation"].as_str().unwrap();
        assert!(citation.contains("Configuration unknown"));
        assert!(!citation.contains("Default configuration"));
    }

    #[test]
    fn non_default_configuration_is_summarized_in_the_citation() {
        let options = AnalysisOptions {
            ignored_dirs: vec!["examples".to_string()],
            ignored_languages: vec!["CSS".to_string()],
            profile: AnalysisProfile::SourceOnly,
            include_docs: false,
            include_tests: false,
            include_generated: true,
        };
        let summary = configuration_summary(Some(&options));
        assert_eq!(
            summary,
            " Custom configuration (tests excluded, docs excluded, profile: source-only, ignoring examples, ignoring CSS)."
        );
        assert_eq!(
            configuration_summary(None),
            " Configuration unknown; this report predates option tracking."
        );
        assert_eq!(configuration_summary(Some(&default_options())), " Default configuration.");
    }

    #[test]
    fn snapshot_url_uses_the_commit_pin_scheme() {
        let options = AnalysisOptions {
            ignored_dirs: vec!["examples".to_string()],
            ..AnalysisOptions::default()
        };
        let url = snapshot_url(
            "https://octocounts.com/github/o/r",
            "abc123",
            &options,
        )
        .unwrap();
        assert!(url.starts_with("https://octocounts.com/github/o/r/commit/abc123?analysis="));
        assert!(url.contains("%22ignoredDirs%22%3A%5B%22examples%22%5D"));
    }
}

