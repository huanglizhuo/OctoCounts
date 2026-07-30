use std::sync::Arc;

use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::{
    analyzer::{self, AnalysisInput},
    error::ApiError,
    github::GitHubClient,
    indexnow::IndexNowService,
    models::{AnalysisSource, AnalyzeRequest, AnalyzeResponse, ApiErrorBody, RepoRef},
    store::{JobKey, Store},
};

#[derive(Clone)]
pub struct AnalysisCoordinator {
    store: Store,
    github: GitHubClient,
    semaphore: Arc<Semaphore>,
    indexnow: Option<IndexNowService>,
}

impl AnalysisCoordinator {
    pub fn new(
        store: Store,
        github: GitHubClient,
        concurrency: usize,
        indexnow: Option<IndexNowService>,
    ) -> Self {
        Self {
            store,
            github,
            semaphore: Arc::new(Semaphore::new(concurrency)),
            indexnow,
        }
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    pub async fn submit(&self, request: AnalyzeRequest) -> Result<AnalyzeResponse, ApiError> {
        let options = request.options.clone();
        let source = request.source;
        let analysis_key = analyzer::analysis_key(&options);
        let repo_ref = self
            .github
            .resolve_ref(&request.repo_url, request.ref_name, request.force_refresh)
            .await
            .map_err(ApiError::from)?;

        if !request.force_refresh {
            if let Some(report) = self
                .store
                .cached_report_for_provider(
                    repo_ref.provider.clone(),
                    &repo_ref.owner,
                    &repo_ref.repo,
                    &repo_ref.commit_sha,
                    &analysis_key,
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

        let (job, created) = self
            .store
            .create_or_get_active_job(JobKey {
                provider: repo_ref.provider.clone(),
                owner: &repo_ref.owner,
                repo: &repo_ref.repo,
                commit_sha: &repo_ref.commit_sha,
                tokei_version: &analysis_key,
                source,
            })
            .await
            .map_err(ApiError::internal)?;
        if created {
            self.spawn_analysis_job(job.id, repo_ref, options, analysis_key, source);
        }

        Ok(AnalyzeResponse::Job {
            job_id: job.id,
            status: job.status,
        })
    }

    fn spawn_analysis_job(
        &self,
        job_id: Uuid,
        repo_ref: RepoRef,
        options: crate::models::AnalysisOptions,
        analysis_key: String,
        source: AnalysisSource,
    ) {
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
                    &repo_ref.provider,
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

            match analyzer::analyze(AnalysisInput {
                repo_ref,
                archive,
                options,
                analysis_key,
            })
            .await
            {
                Ok(report) => complete_job(&coordinator, job_id, report, source).await,
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

async fn complete_job(
    coordinator: &AnalysisCoordinator,
    job_id: Uuid,
    report: crate::models::Report,
    source: AnalysisSource,
) {
    let store = &coordinator.store;
    let report_id = report.id.clone();
    if let Err(error) = store.save_report(&report, source).await {
        tracing::error!(%error, "failed to save report");
        mark_job_failed(store, job_id, "internal", "failed to save report").await;
        return;
    }
    // The report page was newly created or materially updated (save_report
    // upserts the body); cache hits never reach this path. Submitting is
    // fire-and-forget and must not affect job completion.
    if let Some(indexnow) = &coordinator.indexnow {
        indexnow.submit_report(&report);
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
