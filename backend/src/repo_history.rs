use std::time::Duration;

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    Json,
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    api::AppState,
    coordinator::job_is_finished,
    error::ApiError,
    github::GitHubClient,
    models::{AnalysisSource, AnalyzeRequest, AnalyzeResponse, JobStatus, RepositoryProvider},
    seo::{cache_headers, parse_provider},
};

/// Generous relative to the analyzer's own internal timeout (300s, see
/// `analyzer::JOB_TIMEOUT`) so a legitimately slow backfill sample is not
/// abandoned just short of the analyzer giving up on it too.
const SLOC_BACKFILL_JOB_TIMEOUT: Duration = Duration::from_secs(320);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoHistoryQuery {
    provider: String,
    owner: String,
    repo: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarHistoryPoint {
    date: String,
    stars: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlocHistoryPoint {
    date: String,
    total_lines: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoHistoryResponse {
    provider: String,
    owner: String,
    repo: String,
    current_stars: Option<u64>,
    /// Oldest first, one exact point per day since this repo was first
    /// watched (see `spawn_star_snapshot_task` in main.rs). GitHub's
    /// per-star timestamp API was restricted to repo owners/collaborators in
    /// June 2026, so unlike the SLOC series below there is no historical
    /// backfill here — the series simply starts on the day this repo was
    /// first viewed on octocounts.com.
    star_points: Vec<StarHistoryPoint>,
    /// Oldest first. Sampled from historical commits on the default branch
    /// (see `run_sloc_backfill`) — git history has no access restriction, so
    /// unlike stars this can be backfilled all the way to the repo's creation.
    sloc_points: Vec<SlocHistoryPoint>,
    /// True while the one-time SLOC backfill for this repo is still running
    /// in the background. The frontend polls while this is true and stops
    /// once it flips to false.
    sloc_backfill_in_progress: bool,
    /// True when this repo's real star history hasn't been backfilled yet and
    /// isn't currently being backfilled — the frontend shows the "connect
    /// your repo" card only in this state (see `oauth.rs`).
    star_backfill_available: bool,
    /// True while a caller-authorized real star-history backfill is running
    /// in the background (see `oauth::authorize_and_backfill`).
    star_backfill_in_progress: bool,
}

/// Shared core behind both `repo_history` (JSON API) and `badge.rs`'s
/// `star_history_badge` (SVG), so the watch/backfill-triggering logic and its
/// cost exist in one place.
///
/// Returns `(star_history, current_stars, sloc_history, sloc_backfill_in_progress,
/// star_backfill_available, star_backfill_in_progress)`.
pub(crate) async fn ensure_repo_history(
    state: &AppState,
    provider: RepositoryProvider,
    owner: &str,
    repo: &str,
) -> anyhow::Result<(Vec<(NaiveDate, i64)>, Option<u64>, Vec<(NaiveDate, i64)>, bool, bool, bool)> {
    let store = state.coordinator.store();
    let github = state.coordinator.github();
    let current_stars = github.repo_stars(&provider, owner, repo).await;

    let just_started_watching = store.watch_repo_for_stars(provider, owner, repo).await?;
    if just_started_watching {
        if let Some(current) = current_stars {
            store
                .record_star_snapshot(provider, owner, repo, Utc::now().date_naive(), current as i64)
                .await?;
        }
    }
    let star_history = store.star_history(provider, owner, repo).await?;

    // SLOC backfill has no access restriction, but is only implemented for
    // GitHub so far (commit-listing and archive download both go through
    // `GitHubClient`'s GitHub-specific paths).
    if matches!(provider, RepositoryProvider::GitHub)
        && store.start_sloc_backfill_if_needed(provider, owner, repo).await?
    {
        spawn_sloc_backfill(
            state.clone(),
            provider,
            owner.to_string(),
            repo.to_string(),
            state.sloc_history_max_samples,
        );
    }

    let sloc_history = store.sloc_history(provider, owner, repo).await?;
    let sloc_backfill_in_progress = store.sloc_backfill_in_progress(provider, owner, repo).await?;

    let star_backfilled = store.star_history_is_backfilled(provider, owner, repo).await?;
    let star_backfill_in_progress = store.star_backfill_in_progress(provider, owner, repo).await?;
    let star_backfill_available =
        matches!(provider, RepositoryProvider::GitHub) && !star_backfilled && !star_backfill_in_progress;

    Ok((
        star_history,
        current_stars,
        sloc_history,
        sloc_backfill_in_progress,
        star_backfill_available,
        star_backfill_in_progress,
    ))
}

pub async fn repo_history(
    State(state): State<AppState>,
    Query(query): Query<RepoHistoryQuery>,
) -> Result<(HeaderMap, Json<RepoHistoryResponse>), ApiError> {
    let cache_key = format!("repo-history:{}:{}:{}", query.provider, query.owner, query.repo);
    if let Some(response) = state.caches.seo_repo_history.get(&cache_key).await {
        return Ok((repo_history_cache_headers(), Json(response)));
    }

    let provider = parse_provider(&query.provider)?;
    if provider != RepositoryProvider::GitHub {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "unsupported_provider",
            "repo history is only available for GitHub repositories",
        ));
    }

    let (
        star_history,
        current_stars,
        sloc_history,
        sloc_backfill_in_progress,
        star_backfill_available,
        star_backfill_in_progress,
    ) = ensure_repo_history(&state, provider, &query.owner, &query.repo)
        .await
        .map_err(ApiError::internal)?;

    let response = RepoHistoryResponse {
        provider: query.provider.clone(),
        owner: query.owner.clone(),
        repo: query.repo.clone(),
        current_stars,
        star_points: star_history
            .into_iter()
            .map(|(date, stars)| StarHistoryPoint { date: date.to_string(), stars })
            .collect(),
        sloc_points: sloc_history
            .into_iter()
            .map(|(date, total_lines)| SlocHistoryPoint { date: date.to_string(), total_lines })
            .collect(),
        sloc_backfill_in_progress,
        star_backfill_available,
        star_backfill_in_progress,
    };

    // Skip the cache while either backfill is still running so repeat polls
    // (the frontend refetches on an interval until both flip false) see fresh
    // progress instead of the same stale snapshot for up to an hour.
    if !response.sloc_backfill_in_progress && !response.star_backfill_in_progress {
        state.caches.seo_repo_history.insert(cache_key, response.clone()).await;
    }

    Ok((repo_history_cache_headers(), Json(response)))
}

fn repo_history_cache_headers() -> HeaderMap {
    cache_headers("public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400")
}

fn spawn_sloc_backfill(
    state: AppState,
    provider: RepositoryProvider,
    owner: String,
    repo: String,
    max_samples: u64,
) {
    tokio::spawn(async move {
        if let Err(error) = run_sloc_backfill(&state, provider, &owner, &repo, max_samples).await {
            tracing::warn!(%error, %owner, %repo, "sloc history backfill failed");
        }
        if let Err(error) = state
            .coordinator
            .store()
            .mark_sloc_backfill_completed(provider, &owner, &repo)
            .await
        {
            tracing::error!(%error, %owner, %repo, "failed to mark sloc backfill completed");
        }
    });
}

/// Samples a bounded number of historical commits across the repo's
/// lifetime, running the existing analysis pipeline against each one to
/// reconstruct a SLOC-over-time curve. Best-effort throughout: a single bad
/// sample (unresolvable commit, failed job, missing report) is skipped rather
/// than aborting the whole backfill.
async fn run_sloc_backfill(
    state: &AppState,
    provider: RepositoryProvider,
    owner: &str,
    repo: &str,
    max_samples: u64,
) -> anyhow::Result<()> {
    let github = state.coordinator.github();
    let store = state.coordinator.store();

    let Some(created_at) = github.repo_created_at(&provider, owner, repo).await else {
        return Ok(());
    };
    let now = Utc::now();
    let repo_url = format!("https://github.com/{owner}/{repo}");

    for sample_date in GitHubClient::sample_dates(created_at, now, max_samples) {
        let Some(commit_sha) = github.resolve_commit_before(owner, repo, sample_date).await else {
            continue;
        };

        let request = AnalyzeRequest {
            repo_url: repo_url.clone(),
            ref_name: Some(commit_sha.clone()),
            force_refresh: false,
            options: Default::default(),
            source: AnalysisSource::SlocBackfill,
        };

        let report = match state.coordinator.submit(request).await {
            Ok(AnalyzeResponse::Cached { report, .. }) => report,
            Ok(AnalyzeResponse::Job { job_id, .. }) => {
                let job = match state
                    .coordinator
                    .await_job(job_id, SLOC_BACKFILL_JOB_TIMEOUT, |job| job_is_finished(job.status))
                    .await
                {
                    Ok(Some(job)) if job.status == JobStatus::Completed => job,
                    _ => continue,
                };
                let Some(report_id) = job.report_id else { continue };
                match store.report(&report_id).await {
                    Ok(Some(report)) => report,
                    _ => continue,
                }
            }
            Err(_) => continue,
        };

        store
            .record_sloc_snapshot(
                provider,
                owner,
                repo,
                sample_date.date_naive(),
                report.total.code as i64,
                &report.commit_sha,
            )
            .await?;
    }

    Ok(())
}
