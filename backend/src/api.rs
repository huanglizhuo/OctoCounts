use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue},
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

pub async fn report(
    State(state): State<AppState>,
    Path(report_id): Path<String>,
) -> Result<(HeaderMap, Json<crate::models::Report>), ApiError> {
    let Some(report) = state
        .coordinator
        .store()
        .report(&report_id)
        .await
        .map_err(ApiError::internal)?
    else {
        return Err(ApiError::not_found(
            "report_not_found",
            "report was not found",
        ));
    };
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    Ok((headers, Json(report)))
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
