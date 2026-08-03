use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    Json,
};
use uuid::Uuid;

use crate::{
    cache::AppCaches,
    coordinator::AnalysisCoordinator,
    error::ApiError,
    models::{AnalyzeRequest, AnalyzeResponse, GrowthStats, JobRecord},
};

#[derive(Clone)]
pub struct AppState {
    pub coordinator: AnalysisCoordinator,
    pub caches: AppCaches,
}

pub async fn analyze(
    State(state): State<AppState>,
    Json(request): Json<AnalyzeRequest>,
) -> Result<Json<AnalyzeResponse>, ApiError> {
    state.coordinator.submit(request).await.map(Json)
}

pub async fn job_status(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
) -> Result<(HeaderMap, Json<JobRecord>), ApiError> {
    let Some(job) = state
        .coordinator
        .store()
        .job(job_id)
        .await
        .map_err(ApiError::internal)?
    else {
        return Err(ApiError::not_found("job_not_found", "job was not found"));
    };
    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok((headers, Json(job)))
}

/// Echoes the stored report document.
///
/// The response is served straight from the database as JSON text instead of
/// being deserialized into `Report` and re-serialized. Report bodies routinely
/// run to hundreds of kilobytes and this endpoint is a verbatim, immutably
/// cached passthrough, so the round trip bought nothing.
///
/// `cached` is whatever the stored body says, exactly as before: unlike the
/// analyze cache-hit path, this handler never forces it to `true`.
pub async fn report(
    State(state): State<AppState>,
    Path(report_id): Path<String>,
) -> Result<Response, ApiError> {
    let Some(body) = state
        .coordinator
        .store()
        .report_json(&report_id)
        .await
        .map_err(ApiError::internal)?
    else {
        return Err(ApiError::not_found(
            "report_not_found",
            "report was not found",
        ));
    };

    Ok((
        [
            (header::CONTENT_TYPE, "application/json"),
            (
                header::CACHE_CONTROL,
                "public, max-age=31536000, immutable",
            ),
        ],
        body,
    )
        .into_response())
}

pub async fn stats(
    State(state): State<AppState>,
) -> Result<(HeaderMap, Json<GrowthStats>), ApiError> {
    let cache_key = "stats".to_string();
    if let Some(stats) = state.caches.stats.get(&cache_key).await {
        return Ok((stats_cache_headers(), Json(stats)));
    }

    let stats = state
        .coordinator
        .store()
        .growth_stats()
        .await
        .map_err(ApiError::internal)?;
    state.caches.stats.insert(cache_key, stats.clone()).await;

    Ok((stats_cache_headers(), Json(stats)))
}

fn stats_cache_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=60, s-maxage=60, stale-while-revalidate=300"),
    );
    headers
}
