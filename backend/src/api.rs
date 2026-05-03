use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::{
    analyzer::{self, AnalysisInput},
    github::{GitHubClient, GitHubError},
    models::{AnalyzeRequest, AnalyzeResponse, ApiErrorBody, JobRecord, RepoRef},
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
) -> Result<Json<AnalyzeResponse>, ApiError> {
    let repo_ref = state
        .github
        .resolve_ref(&request.repo_url, request.ref_name)
        .await
        .map_err(ApiError::from)?;

    if !request.force_refresh {
        if let Some(report) = state
            .store
            .cached_report(
                &repo_ref.owner,
                &repo_ref.repo,
                &repo_ref.commit_sha,
                analyzer::tokei_version(),
            )
            .await
            .map_err(ApiError::internal)?
        {
            return Ok(Json(AnalyzeResponse::Cached {
                report_id: report.id.clone(),
                report,
            }));
        }
    }

    let job = state.store.create_job().await.map_err(ApiError::internal)?;
    spawn_analysis_job(state, job.id, repo_ref);

    Ok(Json(AnalyzeResponse::Job {
        job_id: job.id,
        status: job.status,
    }))
}

pub async fn job_status(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<JobRecord>, ApiError> {
    let Some(job) = state.store.job(job_id).await.map_err(ApiError::internal)? else {
        return Err(ApiError::not_found("job_not_found", "job was not found"));
    };
    Ok(Json(job))
}

pub async fn report(
    State(state): State<AppState>,
    Path(report_id): Path<String>,
) -> Result<Json<crate::models::Report>, ApiError> {
    let Some(report) = state
        .store
        .report(&report_id)
        .await
        .map_err(ApiError::internal)?
    else {
        return Err(ApiError::not_found(
            "report_not_found",
            "report was not found",
        ));
    };
    Ok(Json(report))
}

fn spawn_analysis_job(state: AppState, job_id: Uuid, repo_ref: RepoRef) {
    tokio::spawn(async move {
        let Ok(_permit) = state.semaphore.acquire().await else {
            mark_job_failed(
                &state.store,
                job_id,
                "internal",
                "analysis worker is unavailable",
            )
            .await;
            return;
        };

        if let Err(error) = state.store.set_job_running(job_id).await {
            tracing::error!(%error, "failed to mark job running");
        }

        let archive = match state
            .github
            .download_archive(
                &repo_ref.owner,
                &repo_ref.repo,
                &repo_ref.commit_sha,
                analyzer::max_archive_bytes(),
            )
            .await
        {
            Ok(archive) => archive,
            Err(error) => {
                tracing::warn!(%error, "archive download failed");
                let api_error = ApiError::from(error);
                mark_job_failed(
                    &state.store,
                    job_id,
                    &api_error.body.code,
                    &api_error.body.message,
                )
                .await;
                return;
            }
        };

        match analyzer::analyze(AnalysisInput { repo_ref, archive }).await {
            Ok(report) => complete_job(&state.store, job_id, report).await,
            Err(error) => {
                tracing::warn!(%error, "analysis failed");
                mark_job_failed(&state.store, job_id, "analysis_failed", &error.to_string()).await;
            }
        }
    });
}

async fn complete_job(store: &Store, job_id: Uuid, report: crate::models::Report) {
    let report_id = report.id.clone();
    if let Err(error) = store.save_report(&report).await {
        tracing::error!(%error, "failed to save report");
        mark_job_failed(store, job_id, "internal", "failed to save report").await;
        return;
    }
    if let Err(error) = store.set_job_completed(job_id, report_id).await {
        tracing::error!(%error, "failed to mark job completed");
    }
}

async fn mark_job_failed(store: &Store, job_id: Uuid, code: &str, message: &str) {
    if let Err(error) = store
        .set_job_failed(
            job_id,
            ApiErrorBody {
                code: code.to_string(),
                message: message.to_string(),
            },
        )
        .await
    {
        tracing::error!(%error, "failed to mark job failed");
    }
}

pub struct ApiError {
    status: StatusCode,
    body: ApiErrorBody,
}

impl ApiError {
    fn new(status: StatusCode, code: &str, message: impl Into<String>) -> Self {
        Self {
            status,
            body: ApiErrorBody {
                code: code.to_string(),
                message: message.into(),
            },
        }
    }

    fn internal(error: anyhow::Error) -> Self {
        tracing::error!(%error, "internal error");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "internal server error",
        )
    }

    fn not_found(code: &str, message: &str) -> Self {
        Self::new(StatusCode::NOT_FOUND, code, message)
    }
}

impl From<GitHubError> for ApiError {
    fn from(error: GitHubError) -> Self {
        match error {
            GitHubError::InvalidUrl => {
                Self::new(StatusCode::BAD_REQUEST, "invalid_url", error.to_string())
            }
            GitHubError::NotFound => {
                Self::new(StatusCode::NOT_FOUND, "not_found", error.to_string())
            }
            GitHubError::RefNotFound => {
                Self::new(StatusCode::NOT_FOUND, "ref_not_found", error.to_string())
            }
            GitHubError::RateLimited => Self::new(
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
                error.to_string(),
            ),
            GitHubError::TooLarge => Self::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "too_large",
                error.to_string(),
            ),
            GitHubError::Request(_) => Self::new(
                StatusCode::BAD_GATEWAY,
                "github_request_failed",
                error.to_string(),
            ),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}
