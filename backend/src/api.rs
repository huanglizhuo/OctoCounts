use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::json;
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::{
    analyzer::{self, AnalysisInput},
    github::{GitHubClient, GitHubError},
    models::{AnalyzeRequest, AnalyzeResponse, ApiErrorBody, JobRecord},
    store::Store,
};

#[derive(Clone)]
pub struct AppState {
    pub store: Store,
    pub github: GitHubClient,
    pub semaphore: Arc<Semaphore>,
}

pub async fn analyze(
    State(state): State<AppState>,
    Json(request): Json<AnalyzeRequest>,
) -> Result<Json<AnalyzeResponse>, (StatusCode, Json<ApiErrorBody>)> {
    let repo_ref = state
        .github
        .resolve_ref(&request.repo_url, request.ref_name)
        .await
        .map_err(github_error)?;

    if let Some(report) = state
        .store
        .cached_report(&repo_ref.owner, &repo_ref.repo, &repo_ref.commit_sha, analyzer::tokei_version())
        .await
        .map_err(internal_error)?
    {
        return Ok(Json(AnalyzeResponse::Cached {
            report_id: report.id.clone(),
            report,
        }));
    }

    let archive = state
        .github
        .download_archive(&repo_ref.owner, &repo_ref.repo, &repo_ref.commit_sha, analyzer::max_archive_bytes())
        .await
        .map_err(github_error)?;

    let job_id = Uuid::new_v4();
    let job = state.store.create_job(job_id).await.map_err(internal_error)?;
    let worker_state = state.clone();

    tokio::spawn(async move {
        let permit = worker_state.semaphore.acquire().await;
        if permit.is_err() {
            let _ = worker_state.store.set_job_failed(job_id, ApiErrorBody {
                code: "internal".to_string(),
                message: "analysis worker is unavailable".to_string(),
            }).await;
            return;
        }
        let _permit = permit.unwrap();

        if let Err(error) = worker_state.store.set_job_running(job_id).await {
            tracing::error!(%error, "failed to mark job running");
        }

        match analyzer::analyze(AnalysisInput { repo_ref, archive }).await {
            Ok(report) => {
                let report_id = report.id.clone();
                if let Err(error) = worker_state.store.save_report(&report).await {
                    tracing::error!(%error, "failed to save report");
                    let _ = worker_state.store.set_job_failed(job_id, ApiErrorBody {
                        code: "internal".to_string(),
                        message: "failed to save report".to_string(),
                    }).await;
                    return;
                }
                let _ = worker_state.store.set_job_completed(job_id, report_id).await;
            }
            Err(error) => {
                tracing::warn!(%error, "analysis failed");
                let _ = worker_state.store.set_job_failed(job_id, ApiErrorBody {
                    code: "analysis_failed".to_string(),
                    message: error.to_string(),
                }).await;
            }
        }
    });

    Ok(Json(AnalyzeResponse::Job {
        job_id,
        status: job.status,
    }))
}

pub async fn job_status(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<JobRecord>, (StatusCode, Json<ApiErrorBody>)> {
    let Some(job) = state.store.job(job_id).await.map_err(internal_error)? else {
        return Err(not_found("job_not_found", "job was not found"));
    };
    Ok(Json(job))
}

pub async fn report(
    State(state): State<AppState>,
    Path(report_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiErrorBody>)> {
    let Some(report) = state.store.report(&report_id).await.map_err(internal_error)? else {
        return Err(not_found("report_not_found", "report was not found"));
    };
    Ok(Json(json!(report)))
}

fn github_error(error: GitHubError) -> (StatusCode, Json<ApiErrorBody>) {
    let (status, code, message) = match error {
        GitHubError::InvalidUrl => (StatusCode::BAD_REQUEST, "invalid_url", error.to_string()),
        GitHubError::NotFound => (StatusCode::NOT_FOUND, "not_found", error.to_string()),
        GitHubError::RefNotFound => (StatusCode::NOT_FOUND, "ref_not_found", error.to_string()),
        GitHubError::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "rate_limited", error.to_string()),
        GitHubError::TooLarge => (StatusCode::PAYLOAD_TOO_LARGE, "too_large", error.to_string()),
        GitHubError::Request(_) => (StatusCode::BAD_GATEWAY, "github_request_failed", error.to_string()),
    };
    (status, Json(ApiErrorBody { code: code.to_string(), message }))
}

fn internal_error(error: anyhow::Error) -> (StatusCode, Json<ApiErrorBody>) {
    tracing::error!(%error, "internal error");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ApiErrorBody {
            code: "internal".to_string(),
            message: "internal server error".to_string(),
        }),
    )
}

fn not_found(code: &str, message: &str) -> (StatusCode, Json<ApiErrorBody>) {
    (
        StatusCode::NOT_FOUND,
        Json(ApiErrorBody {
            code: code.to_string(),
            message: message.to_string(),
        }),
    )
}
