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

/// The forward sampler's first pass runs this soon after startup, so a
/// deployment immediately refreshes stale charts instead of waiting a full
/// `sloc_forward_interval_seconds`.
const FORWARD_TASK_WARMUP_SECONDS: u64 = 120;

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
    /// Present (and true) only on interior points that failed the suspect
    /// check — a value less than half of BOTH neighbours, which a normal git
    /// history cannot produce between adjacent samples but a partial backfill
    /// (an analysis that saw only part of the tree) can. Absent on every
    /// other point, so consumers of healthy series see byte-identical
    /// payloads and a background re-sample quietly corrects the rest (see
    /// `spawn_sloc_resample`).
    #[serde(skip_serializing_if = "Option::is_none")]
    suspect: Option<bool>,
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
/// star_backfill_available, star_backfill_in_progress)`. The SLOC series
/// carries each point's commit SHA alongside its date and line count, so the
/// suspect-point re-sampler can re-analyze the exact commits behind
/// implausible dips.
pub(crate) async fn ensure_repo_history(
    state: &AppState,
    provider: RepositoryProvider,
    owner: &str,
    repo: &str,
) -> anyhow::Result<(
    Vec<(NaiveDate, i64)>,
    Option<u64>,
    Vec<(NaiveDate, i64, String)>,
    bool,
    bool,
    bool,
)> {
    let store = state.coordinator.store();
    let github = state.coordinator.github();
    let current_stars = github.repo_stars(&provider, owner, repo).await;

    let just_started_watching = store.watch_repo_for_stars(provider, owner, repo).await?;
    if just_started_watching {
        if let Some(current) = current_stars {
            store
                .record_star_snapshot(
                    provider,
                    owner,
                    repo,
                    Utc::now().date_naive(),
                    current as i64,
                )
                .await?;
        }
    }
    let star_history = store.star_history(provider, owner, repo).await?;

    // SLOC backfill has no access restriction, but is only implemented for
    // GitHub so far (commit-listing and archive download both go through
    // `GitHubClient`'s GitHub-specific paths).
    if matches!(provider, RepositoryProvider::GitHub)
        && store
            .start_sloc_backfill_if_needed(provider, owner, repo, state.sloc_backfill_reclaim_after)
            .await?
    {
        spawn_sloc_backfill(
            state.clone(),
            provider,
            owner.to_string(),
            repo.to_string(),
            state.sloc_history_max_points,
            state.sloc_backfill_wall_clock,
        );
    }

    let sloc_history = store.sloc_history(provider, owner, repo).await?;
    let sloc_backfill_in_progress = store
        .sloc_backfill_in_progress(provider, owner, repo)
        .await?;

    let star_backfilled = store
        .star_history_is_backfilled(provider, owner, repo)
        .await?;
    let star_backfill_in_progress = store
        .star_backfill_in_progress(provider, owner, repo)
        .await?;
    let star_backfill_available = matches!(provider, RepositoryProvider::GitHub)
        && !star_backfilled
        && !star_backfill_in_progress;

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
    let cache_key = format!(
        "repo-history:{}:{}:{}",
        query.provider, query.owner, query.repo
    );
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

    // Interior points that dip below half of BOTH neighbours are flagged (and
    // queued for repair); see `sloc_point_is_suspect` for why that shape is
    // diagnostic of a partial backfill rather than a real history rewrite.
    let suspect_indices = suspect_sloc_indices(
        &sloc_history
            .iter()
            .map(|(_, total_lines, _)| *total_lines)
            .collect::<Vec<_>>(),
    );

    let response = RepoHistoryResponse {
        provider: query.provider.clone(),
        owner: query.owner.clone(),
        repo: query.repo.clone(),
        current_stars,
        star_points: star_history
            .into_iter()
            .map(|(date, stars)| StarHistoryPoint {
                date: date.to_string(),
                stars,
            })
            .collect(),
        sloc_points: sloc_history
            .iter()
            .enumerate()
            .map(|(index, (date, total_lines, _))| SlocHistoryPoint {
                date: date.to_string(),
                total_lines: *total_lines,
                suspect: suspect_indices.contains(&index).then_some(true),
            })
            .collect(),
        sloc_backfill_in_progress,
        star_backfill_available,
        star_backfill_in_progress,
    };

    // Skip the cache while either backfill is still running so repeat polls
    // (the frontend refetches on an interval until both flip false) see fresh
    // progress instead of the same stale snapshot for up to an hour.
    if !response.sloc_backfill_in_progress && !response.star_backfill_in_progress {
        state
            .caches
            .seo_repo_history
            .insert(cache_key, response.clone())
            .await;
    }

    // A series with suspect points triggers a bounded, cooldown-guarded
    // re-sample of the offending commits. Not while the SLOC backfill is
    // still running — the backfill may still be about to overwrite those
    // rows, and the response above is deliberately uncached in that state.
    // The trigger itself only spawns; the request path never waits on the
    // re-analysis.
    if !sloc_backfill_in_progress && !suspect_indices.is_empty() {
        let samples: Vec<(NaiveDate, String)> = suspect_indices
            .iter()
            .filter_map(|&index| {
                sloc_history
                    .get(index)
                    .map(|(date, _, commit_sha)| (*date, commit_sha.clone()))
            })
            .take(SLOC_RESAMPLE_MAX_POINTS)
            .collect();
        spawn_sloc_resample(state.clone(), query.owner.clone(), query.repo.clone(), samples);
    }

    Ok((repo_history_cache_headers(), Json(response)))
}

fn repo_history_cache_headers() -> HeaderMap {
    cache_headers("public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400")
}

/// An interior SLOC point is suspect when its value is less than half of BOTH
/// its neighbours. A repository's line count between two adjacent samples can
/// only fall that far through a genuine history rewrite (a squash, a filter
/// — vanishingly rare between sample-sized intervals), but a *partial*
/// backfill — an analysis that saw only part of the tree, a truncated archive
/// — records exactly this shape at the full neighbors' scale (live example:
/// facebook/react sampled 19,134 lines in 2019 and 17,952 in 2023 between
/// ~170K neighbours). The strict `<` keeps an exact 50% dip (a real big
/// rewrite) out of the suspect set.
pub(crate) fn sloc_point_is_suspect(prev: i64, value: i64, next: i64) -> bool {
    value * 2 < prev && value * 2 < next
}

/// Indices of the interior points of `values` (oldest first) that fail the
/// suspect check. The endpoints are never eligible: they have no neighbour on
/// one side, so there is no implausible-dip shape to test for.
pub(crate) fn suspect_sloc_indices(values: &[i64]) -> Vec<usize> {
    (1..values.len().saturating_sub(1))
        .filter(|&index| {
            sloc_point_is_suspect(values[index - 1], values[index], values[index + 1])
        })
        .collect()
}

/// At most this many suspect commits are re-analyzed per trigger; a series
/// with more suspects than that gets its oldest ones fixed first and the rest
/// on a later trigger once the cooldown has elapsed.
const SLOC_RESAMPLE_MAX_POINTS: usize = 3;

/// Minimum time between re-sample triggers for the same repo (the cooldown is
/// enforced by `Store::start_sloc_resample_if_needed`, so it holds across
/// replicas and restarts).
const SLOC_RESAMPLE_COOLDOWN: Duration = Duration::from_secs(24 * 60 * 60);

/// Bounded, best-effort repair of suspect SLOC points (see
/// `sloc_point_is_suspect`): re-analyzes the exact commits behind implausible
/// dips and upserts the corrected snapshots.
///
/// Cost is bounded three ways: the per-trigger sample cap
/// ([`SLOC_RESAMPLE_MAX_POINTS`]), the per-repo cooldown
/// ([`SLOC_RESAMPLE_COOLDOWN`], claimed in the database so a burst of views
/// spawns at most one repair), and idempotence — `record_sloc_snapshot`'s
/// upsert means a repeat run corrects rather than duplicates. Runs entirely
/// off the request path: the caller spawns and returns immediately.
fn spawn_sloc_resample(state: AppState, owner: String, repo: String, samples: Vec<(NaiveDate, String)>) {
    tokio::spawn(async move {
        let store = state.coordinator.store();
        match store
            .start_sloc_resample_if_needed(
                RepositoryProvider::GitHub,
                &owner,
                &repo,
                SLOC_RESAMPLE_COOLDOWN,
            )
            .await
        {
            Ok(true) => {}
            // Another trigger recently claimed the repair; the cooldown is
            // doing its job, not an error.
            Ok(false) => return,
            Err(error) => {
                tracing::warn!(%error, %owner, %repo, "failed to claim sloc suspect-point resample");
                return;
            }
        }

        let repo_url = format!("https://github.com/{owner}/{repo}");
        let mut corrected = 0usize;
        let mut failed = 0usize;
        for (date, commit_sha) in samples {
            match resample_sloc_point(&state, &repo_url, &owner, &repo, date, &commit_sha).await {
                Ok(()) => corrected += 1,
                Err(error) => {
                    tracing::warn!(%error, %owner, %repo, %commit_sha, "sloc suspect-point resample failed");
                    failed += 1;
                }
            }
        }
        tracing::info!(%owner, %repo, corrected, failed, "sloc suspect-point resample finished");
    });
}

/// Re-analyzes one pinned commit and upserts its snapshot for `date`. Same
/// submit → await-with-bounded-timeout → record pipeline the backfill and
/// forward samplers use, with one deliberate difference: `force_refresh` is
/// set, because the value being repaired may itself be sitting in the report
/// cache — a cache hit would replay the very partial analysis being fixed.
async fn resample_sloc_point(
    state: &AppState,
    repo_url: &str,
    owner: &str,
    repo: &str,
    date: NaiveDate,
    commit_sha: &str,
) -> anyhow::Result<()> {
    let request = AnalyzeRequest {
        repo_url: repo_url.to_string(),
        ref_name: Some(commit_sha.to_string()),
        force_refresh: true,
        options: Default::default(),
        source: AnalysisSource::SlocBackfill,
    };
    let total_lines = match state.coordinator.submit(request).await {
        Ok(AnalyzeResponse::Cached { report, .. }) => report.total.code as i64,
        Ok(AnalyzeResponse::Job { job_id, .. }) => {
            let job = state
                .coordinator
                .await_job(job_id, SLOC_BACKFILL_JOB_TIMEOUT, |job| {
                    job_is_finished(job.status)
                })
                .await
                .map_err(|error| anyhow::anyhow!("resample job failed: {error}"))?
                .ok_or_else(|| anyhow::anyhow!("resample job finished without a final state"))?;
            if job.status != JobStatus::Completed {
                anyhow::bail!("resample job did not complete: {:?}", job.status);
            }
            let Some(report_id) = job.report_id else {
                anyhow::bail!("completed resample job has no report");
            };
            let report = state
                .coordinator
                .store()
                .report(&report_id)
                .await?
                .ok_or_else(|| anyhow::anyhow!("resample report vanished"))?;
            report.total.code as i64
        }
        Err(error) => anyhow::bail!("resample submit failed: {}", error.body().message),
    };
    state
        .coordinator
        .store()
        .record_sloc_snapshot(
            RepositoryProvider::GitHub,
            owner,
            repo,
            date,
            total_lines,
            commit_sha,
            "resample",
        )
        .await?;
    Ok(())
}

fn spawn_sloc_backfill(
    state: AppState,
    provider: RepositoryProvider,
    owner: String,
    repo: String,
    max_points: u64,
    wall_clock: Duration,
) {
    tokio::spawn(async move {
        match run_sloc_backfill(&state, provider, &owner, &repo, max_points, wall_clock).await {
            Ok(true) => {
                if let Err(error) = state
                    .coordinator
                    .store()
                    .mark_sloc_backfill_completed(provider, &owner, &repo)
                    .await
                {
                    tracing::error!(%error, %owner, %repo, "failed to mark sloc backfill completed");
                }
            }
            // An exhausted budget or a failed sample deliberately does NOT
            // mark the backfill completed: the claim becomes re-claimable
            // after `sloc_backfill_reclaim_after`, and the re-run is cheap
            // because already-analyzed commits hit the report cache. This is
            // the resume path for interrupted backfills.
            Ok(false) => {
                tracing::info!(%owner, %repo, "sloc backfill hit its wall-clock budget; will resume after the reclaim cooldown")
            }
            Err(error) => {
                tracing::warn!(%error, %owner, %repo, "sloc history backfill failed; will retry after the reclaim cooldown")
            }
        }
    });
}

/// Samples historical commits across the repo's lifetime, running the
/// existing analysis pipeline against each one to reconstruct a
/// SLOC-over-time curve. Best-effort throughout: a single bad sample
/// (unresolvable commit, failed job, missing report) is skipped rather than
/// aborting the whole backfill.
///
/// Returns `Ok(true)` when the whole schedule was walked, `Ok(false)` when
/// the wall-clock budget ran out first (the caller must not mark the
/// backfill completed in that case). Cost is bounded three ways: the point
/// budget (`max_points`, enforced by the tiered schedule), the wall-clock
/// budget, and per-sample dedup — a sample that resolves to the same commit
/// as the previous one skips the analysis entirely, since SLOC only changes
/// at commits.
async fn run_sloc_backfill(
    state: &AppState,
    provider: RepositoryProvider,
    owner: &str,
    repo: &str,
    max_points: u64,
    wall_clock: Duration,
) -> anyhow::Result<bool> {
    let github = state.coordinator.github();
    let store = state.coordinator.store();

    let Some(created_at) = github.repo_created_at(&provider, owner, repo).await else {
        return Ok(true);
    };
    let now = Utc::now();
    let repo_url = format!("https://github.com/{owner}/{repo}");
    let schedule = GitHubClient::sample_dates_tiered(created_at, now, max_points);

    // One batched request resolves every sample's commit up front (one
    // GraphQL call with a token, one REST call per date without) instead of
    // interleaving resolution with the much slower analysis jobs.
    let resolved = github.resolve_commits_before(owner, repo, &schedule).await;
    let resolvable = resolved.iter().filter(|sha| sha.is_some()).count();

    let started = std::time::Instant::now();
    // The last analyzed commit and its line count: consecutive samples that
    // resolve to the same commit share content, so only the boundary samples
    // of a plateau need to touch the analysis pipeline at all.
    let mut last: Option<(String, i64)> = None;
    let mut recorded = 0usize;
    let mut failed_samples = 0usize;

    for (index, sample_at) in schedule.iter().enumerate() {
        if started.elapsed() >= wall_clock {
            tracing::info!(%owner, %repo, scheduled = schedule.len(), resolvable, recorded, "sloc backfill hit its wall-clock budget; will resume after the reclaim cooldown");
            return Ok(false);
        }
        let Some(commit_sha) = resolved.get(index).cloned().flatten() else {
            continue;
        };
        // The schedule's last sample is always `now`, so this is the
        // right-edge anchor: even on a plateau it records today's value so
        // the chart's final point is the repo's current state, not the day
        // the last change happened.
        let is_final_sample = index == schedule.len() - 1;

        if last.as_ref().is_some_and(|(sha, _)| *sha == commit_sha) {
            if is_final_sample {
                if let Some((_, total_lines)) = &last {
                    store
                        .record_sloc_snapshot(
                            provider,
                            owner,
                            repo,
                            sample_at.date_naive(),
                            *total_lines,
                            &commit_sha,
                            "backfill",
                        )
                        .await?;
                    recorded += 1;
                }
            }
            continue;
        }

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
                    .await_job(job_id, SLOC_BACKFILL_JOB_TIMEOUT, |job| {
                        job_is_finished(job.status)
                    })
                    .await
                {
                    Ok(Some(job)) if job.status == JobStatus::Completed => job,
                    Ok(Some(job)) => {
                        tracing::warn!(%owner, %repo, %commit_sha, ?job.status, "sloc backfill sample job did not complete");
                        failed_samples += 1;
                        continue;
                    }
                    outcome => {
                        tracing::warn!(%owner, %repo, %commit_sha, ?outcome, "sloc backfill sample job was not observed to finish");
                        failed_samples += 1;
                        continue;
                    }
                };
                let Some(report_id) = job.report_id else {
                    tracing::warn!(%owner, %repo, %commit_sha, "sloc backfill sample job completed without a report");
                    failed_samples += 1;
                    continue;
                };
                match store.report(&report_id).await {
                    Ok(Some(report)) => report,
                    store_outcome => {
                        tracing::warn!(%owner, %repo, %commit_sha, ?store_outcome, "sloc backfill sample report could not be loaded");
                        failed_samples += 1;
                        continue;
                    }
                }
            }
            Err(error) => {
                tracing::warn!(%owner, %repo, %commit_sha, "sloc backfill sample submit failed: {}", error.body().message);
                failed_samples += 1;
                continue;
            }
        };

        let total_lines = report.total.code as i64;
        store
            .record_sloc_snapshot(
                provider,
                owner,
                repo,
                sample_at.date_naive(),
                total_lines,
                &commit_sha,
                "backfill",
            )
            .await?;
        recorded += 1;
        last = Some((commit_sha, total_lines));
    }

    tracing::info!(%owner, %repo, scheduled = schedule.len(), resolvable, recorded, failed_samples, "sloc backfill run finished");

    // Completion semantics, in order:
    // - No sample resolved a commit at all → genuinely empty repo (created,
    //   never pushed): complete.
    // - Every resolvable sample failed (recorded == 0) → almost always a
    //   systematic failure (archive over the size limit, upstream refusing);
    //   retrying forever would re-pay those failures every cooldown. Complete
    //   anyway — for the rare transient case, the forward sampler retries
    //   HEAD once a day at bounded cost.
    // - Some but not all recorded → transient failures mixed with progress:
    //   leave un-completed so the reclaim cooldown resumes the backfill
    //   (already-analyzed commits hit the report cache, so the retry is
    //   cheap) and the gaps actually close.
    Ok(resolvable == 0 || recorded > 0)
}

/// Keeps a completed repo's SLOC curve fresh: resolves the default branch's
/// current HEAD and, only when it differs from the newest recorded snapshot's
/// commit, runs one analysis and records today's point. The SHA gate bounds
/// the task's cost to repos that actually received commits — an unchanged
/// repo costs one cheap ref resolution, no archive, no tokei run.
pub(crate) async fn run_sloc_forward_sample(
    state: &AppState,
    provider: RepositoryProvider,
    owner: &str,
    repo: &str,
) -> anyhow::Result<()> {
    if !matches!(provider, RepositoryProvider::GitHub) {
        return Ok(());
    }
    let github = state.coordinator.github();
    let store = state.coordinator.store();

    let repo_url = format!("https://github.com/{owner}/{repo}");
    let repo_ref = github
        .resolve_ref(&repo_url, None, false)
        .await
        .map_err(|error| anyhow::anyhow!("failed to resolve HEAD: {error}"))?;

    // No snapshot on record means the repo has never been successfully
    // sampled (e.g. a backfill whose every analysis failed) — that is a
    // reason to sample now, not to skip, so only a known-unchanged HEAD
    // short-circuits.
    let last_sha = store
        .latest_sloc_snapshot(provider, owner, repo)
        .await?
        .map(|(_, _, sha)| sha);
    if last_sha.as_deref() == Some(repo_ref.commit_sha.as_str()) {
        return Ok(());
    }

    let request = AnalyzeRequest {
        repo_url: repo_url.clone(),
        ref_name: None,
        force_refresh: false,
        options: Default::default(),
        source: AnalysisSource::SlocBackfill,
    };
    let total_lines = match state.coordinator.submit(request).await.map_err(|error| {
        anyhow::anyhow!("forward sample submit failed: {}", error.body().message)
    })? {
        AnalyzeResponse::Cached { report, .. } => report.total.code as i64,
        AnalyzeResponse::Job { job_id, .. } => {
            let job = state
                .coordinator
                .await_job(job_id, SLOC_BACKFILL_JOB_TIMEOUT, |job| {
                    job_is_finished(job.status)
                })
                .await
                .map_err(|error| anyhow::anyhow!("forward sample job failed: {error}"))?;
            let Some(job) = job else {
                anyhow::bail!("forward sample job finished without a final state");
            };
            if job.status != JobStatus::Completed {
                anyhow::bail!("forward sample job did not complete: {:?}", job.status);
            }
            let Some(report_id) = job.report_id else {
                anyhow::bail!("completed forward sample job has no report");
            };
            let report = store
                .report(&report_id)
                .await?
                .ok_or_else(|| anyhow::anyhow!("forward sample report vanished"))?;
            report.total.code as i64
        }
    };

    store
        .record_sloc_snapshot(
            provider,
            owner,
            repo,
            Utc::now().date_naive(),
            total_lines,
            &repo_ref.commit_sha,
            "forward",
        )
        .await?;
    Ok(())
}

/// The SLOC counterpart of `main.rs`'s star snapshot task: periodically walks
/// every repo whose backfill completed and refreshes today's point when the
/// repo has moved. Without it the recorded series freezes on the day of the
/// first view — the exact bug that motivated the adaptive-sampling redesign.
///
/// Unlike the star task, the first pass runs after a short warmup rather than
/// a full interval: a deployment of this feature is typically followed by
/// stale-everywhere charts, and a two-minute catch-up beats waiting a day.
pub(crate) fn spawn_sloc_forward_task(state: AppState, interval_seconds: u64) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(FORWARD_TASK_WARMUP_SECONDS)).await;
        loop {
            let repos = match state.coordinator.store().watched_sloc_repos().await {
                Ok(repos) => repos,
                Err(error) => {
                    tracing::warn!(%error, "failed to list watched repos for sloc forward sampling");
                    continue;
                }
            };

            let mut updated = 0u64;
            for (provider, owner, repo) in repos {
                match run_sloc_forward_sample(&state, provider, &owner, &repo).await {
                    Ok(()) => updated += 1,
                    Err(error) => {
                        tracing::warn!(%error, %owner, %repo, "sloc forward sample failed")
                    }
                }
            }
            tracing::info!(updated, "sloc forward sampling pass completed");
            tokio::time::sleep(Duration::from_secs(interval_seconds)).await;
        }
    });
}

/// Points younger than this are never compacted: they are the region the
/// chart's users actually hover over, and the forward sampler's daily cadence
/// lives here.
const SLOC_COMPACTION_RECENT_DAYS: i64 = 30;

/// Histories at or below this many live points are left alone entirely —
/// compacting an already-thin series is churn without visible benefit.
const SLOC_COMPACTION_MIN_POINTS: usize = 8;

/// Soft-deletes aged SLOC points that no longer earn their place in the
/// rendered curve: snapshots older than a month collapse to first/last/min/max
/// per week, older than a year to first/last/min/max per calendar month.
/// The most recent point is always kept (it is the chart's "current" value),
/// and nothing is destroyed — see `supersede_sloc_snapshots`.
pub(crate) fn spawn_sloc_compaction_task(state: AppState, interval_seconds: u64) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(interval_seconds)).await;

            let repos = match state.coordinator.store().repos_with_sloc_snapshots().await {
                Ok(repos) => repos,
                Err(error) => {
                    tracing::warn!(%error, "failed to list repos for sloc compaction");
                    continue;
                }
            };

            let mut superseded = 0u64;
            for (provider, owner, repo) in repos {
                match compact_repo_sloc_history(&state, provider, &owner, &repo).await {
                    Ok(dropped) => superseded += dropped,
                    Err(error) => {
                        tracing::warn!(%error, %owner, %repo, "sloc history compaction failed")
                    }
                }
            }
            tracing::info!(superseded, "sloc compaction pass completed");
        }
    });
}

async fn compact_repo_sloc_history(
    state: &AppState,
    provider: RepositoryProvider,
    owner: &str,
    repo: &str,
) -> anyhow::Result<u64> {
    let store = state.coordinator.store();
    let points = store.sloc_history(provider, owner, repo).await?;
    if points.len() <= SLOC_COMPACTION_MIN_POINTS {
        return Ok(0);
    }

    let keep = compaction_keep_dates(
        &points
            .iter()
            .map(|(date, total_lines, _)| (*date, *total_lines))
            .collect::<Vec<_>>(),
        Utc::now().date_naive(),
    );
    let drop: Vec<chrono::NaiveDate> = points
        .iter()
        .map(|(date, _, _)| *date)
        .filter(|date| !keep.contains(date))
        .collect();
    store
        .supersede_sloc_snapshots(provider, owner, repo, &drop)
        .await
}

/// The pure core of compaction: which of `points` (oldest first) survive.
/// Buckets are keyed by ISO week inside the first year of age and by calendar
/// month beyond it; each bucket keeps its first and last points (the visible
/// plateau edges) plus its min and max by line count (spikes survive
/// compaction). The overall last point is kept unconditionally.
pub(crate) fn compaction_keep_dates(
    points: &[(chrono::NaiveDate, i64)],
    today: chrono::NaiveDate,
) -> std::collections::HashSet<chrono::NaiveDate> {
    use chrono::Datelike;
    use std::collections::HashMap;

    #[derive(Default)]
    struct Bucket {
        first: Option<chrono::NaiveDate>,
        last: Option<chrono::NaiveDate>,
        min: Option<(i64, chrono::NaiveDate)>,
        max: Option<(i64, chrono::NaiveDate)>,
    }

    impl Bucket {
        fn add(&mut self, date: chrono::NaiveDate, lines: i64) {
            if self.first.is_none() {
                self.first = Some(date);
            }
            self.last = Some(date);
            if self.min.is_none_or(|(best, _)| lines < best) {
                self.min = Some((lines, date));
            }
            if self.max.is_none_or(|(best, _)| lines > best) {
                self.max = Some((lines, date));
            }
        }
    }

    let mut keep = std::collections::HashSet::new();
    if points.is_empty() {
        return keep;
    }

    // Keyed by (monthly?, bucket anchor): the bool keeps a week-start that
    // happens to be a month-start (a Monday the 1st) from merging a weekly
    // bucket with a monthly one across the one-year age boundary.
    let mut buckets: HashMap<(bool, chrono::NaiveDate), Bucket> = HashMap::new();
    for &(date, lines) in points {
        let age_days = (today - date).num_days();
        if age_days <= SLOC_COMPACTION_RECENT_DAYS {
            keep.insert(date);
            continue;
        }
        let bucket_key = if age_days <= 365 {
            // ISO week start (Monday), stable within the year.
            (
                false,
                date - chrono::Duration::days(date.weekday().num_days_from_monday() as i64),
            )
        } else {
            (
                true,
                chrono::NaiveDate::from_ymd_opt(date.year(), date.month(), 1)
                    .expect("year and month come from an existing date"),
            )
        };
        buckets.entry(bucket_key).or_default().add(date, lines);
    }

    for bucket in buckets.values() {
        for date in [
            bucket.first,
            bucket.last,
            bucket.min.map(|(_, d)| d),
            bucket.max.map(|(_, d)| d),
        ]
        .into_iter()
        .flatten()
        {
            keep.insert(date);
        }
    }
    // The live head is the chart's right edge; never compact it.
    if let Some(&(last_date, _)) = points.last() {
        keep.insert(last_date);
    }
    keep
}

#[cfg(test)]
mod tests {
    use chrono::{Datelike, Duration as ChronoDuration, NaiveDate};

    use super::{compaction_keep_dates, sloc_point_is_suspect, suspect_sloc_indices};

    fn date(days_ago: i64) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, 25).unwrap() - ChronoDuration::days(days_ago)
    }

    #[test]
    fn a_dip_below_half_of_both_neighbours_is_suspect() {
        // The live partial-backfill shape: ~170K neighbours around a ~19K dip.
        assert!(sloc_point_is_suspect(170_000, 19_134, 171_500));
        assert!(sloc_point_is_suspect(100, 49, 100), "49 < 50% of both");
    }

    #[test]
    fn a_dip_below_only_one_neighbour_is_not_suspect() {
        // A real decline (or growth spurt) on one side must not be flagged.
        assert!(!sloc_point_is_suspect(100, 40, 60), "40 >= 50% of next");
        assert!(!sloc_point_is_suspect(60, 40, 100), "40 >= 50% of prev");
        assert!(!sloc_point_is_suspect(100, 100, 100), "flat is fine");
    }

    #[test]
    fn an_exactly_half_dip_is_not_suspect() {
        // 50 is exactly 50% of both neighbours: a genuine big rewrite, kept
        // out of the suspect set by the strict comparison.
        assert!(!sloc_point_is_suspect(100, 50, 100));
    }

    #[test]
    fn suspect_indices_flag_only_interior_points() {
        // The endpoints have no neighbour on one side and are never flagged,
        // even at extreme values.
        assert!(suspect_sloc_indices(&[1, 100, 100]).is_empty());
        assert!(suspect_sloc_indices(&[100, 100, 1]).is_empty());
        assert!(suspect_sloc_indices(&[]).is_empty());
        assert!(suspect_sloc_indices(&[42]).is_empty());

        // Two independent interior dips in one series.
        let values = [100_000, 10_000, 110_000, 5_000, 120_000];
        assert_eq!(suspect_sloc_indices(&values), vec![1, 3]);
    }

    #[test]
    fn suspect_indices_skip_plausible_series() {
        // Ordinary growth, plateaus and modest dips produce no flags.
        let values = [1_000, 2_000, 2_050, 4_000, 3_900, 8_000];
        assert!(suspect_sloc_indices(&values).is_empty());
    }

    #[test]
    fn compaction_keeps_the_recent_window_untouched() {
        let today = date(0);
        let points: Vec<(NaiveDate, i64)> = (0..30).map(|ago| (date(ago), 100 + ago)).collect();
        let keep = compaction_keep_dates(&points, today);
        for (point_date, _) in &points {
            assert!(
                keep.contains(point_date),
                "{point_date} is recent and must be kept"
            );
        }
    }

    #[test]
    fn compaction_collapses_aged_daily_points_to_weekly_first_last_min_max() {
        let today = date(0);
        // Five weeks of daily points (aged 31..65 days), a clear spike at
        // day 40, and one recent point.
        let mut points: Vec<(NaiveDate, i64)> = (31..=65)
            .map(|ago| (date(ago), 1_000 + (65 - ago) * 10))
            .collect();
        // Overwrite the spike: one bad rewrite day deep in the plateau.
        let spike_index = 40 - 31;
        points[spike_index].1 = 5;
        points.push((date(0), 2_000));

        let keep = compaction_keep_dates(&points, today);

        // Weekly buckets: 5 weeks of aged points reduce to at most 4 kept
        // dates each (first/last/min/max can coincide).
        let kept_aged = points
            .iter()
            .filter(|(d, _)| (*d - today).num_days() < -30 && keep.contains(d))
            .count();
        assert!(
            kept_aged <= 5 * 4,
            "kept {kept_aged} aged points across 5 weekly buckets"
        );
        assert!(
            kept_aged >= 5,
            "each week keeps at least its first/last pair, got {kept_aged}"
        );

        // The spike must survive: min of its bucket is kept.
        assert!(
            keep.contains(&points[spike_index].0),
            "the minimum spike survives compaction"
        );
        // The newest point always survives.
        assert!(keep.contains(&date(0)));
    }

    #[test]
    fn compaction_buckets_beyond_a_year_by_calendar_month() {
        let today = date(0);
        // Aged 400 days: monthly buckets. Two points in the same month, ten
        // days apart — only bucket-representatives survive.
        let month_anchor = date(400);
        let second_in_month = month_anchor - ChronoDuration::days(10);
        let points = vec![
            (month_anchor, 100),
            (second_in_month, 900),
            (date(0), 5_000),
        ];
        let keep = compaction_keep_dates(&points, today);
        // Both aged points are bucket min/max (100 and 900), so both stay;
        // the assertion documents that month-mates are not auto-dropped when
        // they carry the extremes.
        assert!(keep.contains(&month_anchor));
        assert!(keep.contains(&second_in_month));
        assert!(keep.contains(&date(0)));

        // But a mid-value month-mate between two extremes is dropped.
        let points = vec![
            (month_anchor, 100),
            (second_in_month, 500),
            (date(390), 900),
            (date(0), 5_000),
        ];
        let keep = compaction_keep_dates(&points, today);
        assert!(
            !keep.contains(&second_in_month),
            "a mid-extreme point in an already-covered month is compacted away"
        );
    }

    #[test]
    fn compaction_keeps_the_overall_last_point_even_when_aged() {
        let today = date(0);
        // Degenerate case: everything is old (a repo viewed once, long ago,
        // before forward sampling existed). The newest point is still the
        // chart's right edge and must survive.
        let points: Vec<(NaiveDate, i64)> = (100..=130).map(|ago| (date(ago), ago)).collect();
        let keep = compaction_keep_dates(&points, today);
        assert!(keep.contains(&date(100)));
    }

    #[test]
    fn week_and_month_bucket_keys_align_to_monday_and_month_start() {
        let anchor = NaiveDate::from_ymd_opt(2026, 9, 25).unwrap();
        assert_eq!(anchor.weekday().to_string(), "Fri");
        let monday = anchor - ChronoDuration::days(4);
        let points = vec![
            (anchor - ChronoDuration::days(400), 1),
            (monday, 2),
            (anchor - ChronoDuration::days(45), 3),
        ];
        // Just asserting the helpers behave as the bucketing expects; the
        // aged points (45 and 400 days) land in different buckets keyed by
        // Monday/month-start, so both are kept as singletons.
        let keep = compaction_keep_dates(&points, anchor);
        assert!(keep.contains(&(anchor - ChronoDuration::days(45))));
        assert!(keep.contains(&(anchor - ChronoDuration::days(400))));
    }
}
