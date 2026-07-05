use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    api::AppState,
    error::ApiError,
    models::{LanguageReport, LanguageStats, Report, RepositoryProvider},
    store::{provider_from_str, provider_to_str},
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

#[derive(Debug, Serialize)]
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
    duration_ms: u128,
    total: LanguageStats,
    top_language: Option<TopLanguage>,
    languages: Vec<LanguageReport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopLanguage {
    name: String,
    code: usize,
    percent: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeoList {
    page: i64,
    limit: i64,
    reports: Vec<SeoReport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SitemapEntry {
    loc: String,
    lastmod: String,
}

pub async fn report(
    State(state): State<AppState>,
    Query(query): Query<SeoReportQuery>,
) -> Result<(HeaderMap, Json<SeoReport>), ApiError> {
    let provider = parse_provider(&query.provider)?;
    let Some(report) = state
        .coordinator
        .store()
        .latest_report(provider, &query.owner, &query.repo)
        .await
        .map_err(ApiError::internal)?
    else {
        return Err(ApiError::not_found(
            "report_not_found",
            "report was not found",
        ));
    };

    Ok((cache_headers(), Json(seo_report(&report))))
}

pub async fn recent(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<(HeaderMap, Json<SeoList>), ApiError> {
    let (page, limit, offset) = pagination(query);
    let reports = state
        .coordinator
        .store()
        .recent_reports(limit, offset)
        .await
        .map_err(ApiError::internal)?
        .iter()
        .map(seo_report)
        .collect();

    Ok((
        cache_headers(),
        Json(SeoList {
            page,
            limit,
            reports,
        }),
    ))
}

pub async fn popular(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<(HeaderMap, Json<SeoList>), ApiError> {
    let (page, limit, offset) = pagination(query);
    let reports = state
        .coordinator
        .store()
        .popular_reports(limit, offset)
        .await
        .map_err(ApiError::internal)?
        .iter()
        .map(seo_report)
        .collect();

    Ok((
        cache_headers(),
        Json(SeoList {
            page,
            limit,
            reports,
        }),
    ))
}

pub async fn monoliths(
    State(state): State<AppState>,
    Query(query): Query<PageQuery>,
) -> Result<(HeaderMap, Json<SeoList>), ApiError> {
    let (page, limit, offset) = pagination(query);
    let reports = state
        .coordinator
        .store()
        .monolith_reports(limit, offset)
        .await
        .map_err(ApiError::internal)?
        .iter()
        .map(seo_report)
        .collect();

    Ok((
        cache_headers(),
        Json(SeoList {
            page,
            limit,
            reports,
        }),
    ))
}

pub async fn sitemap(
    State(state): State<AppState>,
) -> Result<(HeaderMap, Json<Vec<SitemapEntry>>), ApiError> {
    let entries = state
        .coordinator
        .store()
        .sitemap_reports(45_000)
        .await
        .map_err(ApiError::internal)?
        .iter()
        .map(|report| SitemapEntry {
            loc: canonical_url(report),
            lastmod: report.generated_at.date_naive().to_string(),
        })
        .collect();

    Ok((cache_headers(), Json(entries)))
}

fn parse_provider(value: &str) -> Result<RepositoryProvider, ApiError> {
    provider_from_str(value).ok_or_else(|| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "invalid_provider",
            "provider must be github or gitlab",
        )
    })
}

fn pagination(query: PageQuery) -> (i64, i64, i64) {
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(24).clamp(1, 100);
    let offset = (page - 1) * limit;
    (page, limit, offset)
}

fn cache_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, s-maxage=300, stale-while-revalidate=3600"),
    );
    headers
}

fn seo_report(report: &Report) -> SeoReport {
    let public_path = public_path(report);
    let canonical_url = canonical_url(report);
    let repo_full_name = format!("{}/{}", report.repository.owner, report.repository.name);
    let top_language = top_language(report);
    let top_phrase = top_language
        .as_ref()
        .map(|top| format!("; top language: {} {:.1}%", top.name, top.percent))
        .unwrap_or_default();
    let title = format!(
        "{}: {} lines of code | OctoCounts",
        repo_full_name,
        format_number(report.total.code)
    );
    let description = format!(
        "{} contains {} code lines across {} files and {} languages{}.",
        repo_full_name,
        format_number(report.total.code),
        format_number(report.total.files),
        format_number(report.languages.len()),
        top_phrase
    );
    let citation = format!(
        "As of {} (commit {}), {} contains {} total lines: {} code, {} comments, {} blank, across {} files in {} languages{}. Counted with tokei via OctoCounts.",
        report.generated_at.date_naive(),
        report.commit_sha.chars().take(12).collect::<String>(),
        repo_full_name,
        format_number(report.total.lines),
        format_number(report.total.code),
        format_number(report.total.comments),
        format_number(report.total.blanks),
        format_number(report.total.files),
        format_number(report.languages.len()),
        top_language
            .as_ref()
            .map(|top| format!(" (top: {} {:.1}%)", top.name, top.percent))
            .unwrap_or_default()
    );

    SeoReport {
        provider: provider_to_str(&report.repository.provider).to_string(),
        owner: report.repository.owner.clone(),
        repo: report.repository.name.clone(),
        repo_full_name,
        html_url: report.repository.html_url.clone(),
        public_path,
        canonical_url,
        title,
        description,
        citation,
        generated_at: report.generated_at.to_rfc3339(),
        ref_name: report.ref_name.clone(),
        commit_sha: report.commit_sha.clone(),
        tokei_version: report.tokei_version.clone(),
        duration_ms: report.duration_ms,
        total: report.total.clone(),
        top_language,
        languages: report.languages.iter().take(12).cloned().collect(),
    }
}

fn top_language(report: &Report) -> Option<TopLanguage> {
    let language = report.languages.first()?;
    let percent = if report.total.code == 0 {
        0.0
    } else {
        (language.stats.code as f64 / report.total.code as f64) * 100.0
    };
    Some(TopLanguage {
        name: language.name.clone(),
        code: language.stats.code,
        percent,
    })
}

fn public_path(report: &Report) -> String {
    match report.repository.provider {
        RepositoryProvider::GitHub => format!(
            "/github/{}/{}",
            encode_segment(&report.repository.owner),
            encode_segment(&report.repository.name)
        ),
        RepositoryProvider::GitLab => format!(
            "/gitlab/{}/{}",
            report
                .repository
                .owner
                .split('/')
                .map(encode_segment)
                .collect::<Vec<_>>()
                .join("/"),
            encode_segment(&report.repository.name)
        ),
    }
}

fn canonical_url(report: &Report) -> String {
    format!("https://octocounts.com{}", public_path(report))
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
