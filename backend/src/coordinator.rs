use std::sync::Arc;

use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::{
    analyzer::{self, AnalysisInput},
    error::ApiError,
    github::GitHubClient,
    models::{AnalyzeRequest, AnalyzeResponse, ApiErrorBody, RepoRef},
    store::Store,
};

#[derive(Clone)]
pub struct AnalysisCoordinator {
    store: Store,
    github: GitHubClient,
    semaphore: Arc<Semaphore>,
}

impl AnalysisCoordinator {
    pub fn new(store: Store, github: GitHubClient, concurrency: usize) -> Self {
        Self {
            store,
            github,
            semaphore: Arc::new(Semaphore::new(concurrency)),
        }
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    pub async fn submit(&self, request: AnalyzeRequest) -> Result<AnalyzeResponse, ApiError> {
        let repo_ref = self
            .github
            .resolve_ref(&request.repo_url, request.ref_name, request.force_refresh)
            .await
            .map_err(ApiError::from)?;

        if !request.force_refresh {
            if let Some(report) = self
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
                return Ok(AnalyzeResponse::Cached {
                    report_id: report.id.clone(),
                    report,
                });
            }
        }

        let job = self.store.create_job().await.map_err(ApiError::internal)?;
        self.spawn_analysis_job(job.id, repo_ref);

        Ok(AnalyzeResponse::Job {
            job_id: job.id,
            status: job.status,
        })
    }

    fn spawn_analysis_job(&self, job_id: Uuid, repo_ref: RepoRef) {
        let coordinator = self.clone();
        tokio::spawn(async move {
            let Ok(_permit) = coordinator.semaphore.acquire().await else {
                mark_job_failed(
                    &coordinator.store,
                    job_id,
                    "internal",
                    "analysis worker is unavailable",
                )
                .await;
                return;
            };

            if let Err(error) = coordinator.store.set_job_running(job_id).await {
                tracing::error!(%error, "failed to mark job running");
            }

            let archive = match coordinator
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
                        &coordinator.store,
                        job_id,
                        &api_error.body().code,
                        &api_error.body().message,
                    )
                    .await;
                    return;
                }
            };

            match analyzer::analyze(AnalysisInput { repo_ref, archive }).await {
                Ok(report) => complete_job(&coordinator.store, job_id, report).await,
                Err(error) => {
                    tracing::warn!(%error, "analysis failed");
                    mark_job_failed(
                        &coordinator.store,
                        job_id,
                        "analysis_failed",
                        &error.to_string(),
                    )
                    .await;
                }
            }
        });
    }
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
