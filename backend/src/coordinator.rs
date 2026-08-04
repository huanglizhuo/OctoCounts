use std::{
    collections::{hash_map::Entry, HashMap},
    sync::{Arc, Mutex},
    time::Duration,
};

use tokio::{
    sync::{watch, Semaphore},
    time::Instant,
};
use uuid::Uuid;

use crate::{
    analyzer::{self, AnalysisError, AnalysisInput},
    error::ApiError,
    github::{GitHubClient, GitHubError},
    indexnow::IndexNowService,
    models::{
        AnalysisSource, AnalyzeRequest, AnalyzeResponse, ApiErrorBody, JobRecord, JobStatus,
        RepoRef,
    },
    store::{JobKey, Store},
};

/// How long a waiter goes without re-reading the job from the database.
///
/// This is a fallback, not the primary mechanism: jobs finished by this process
/// wake their waiters through [`JobEvents`] immediately. It only has to bound
/// how long a waiter can miss a completion that happened in *another* replica,
/// which no in-memory channel can observe.
const JOB_POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Whether a job has reached a state it will never leave.
pub fn job_is_finished(status: JobStatus) -> bool {
    matches!(status, JobStatus::Completed | JobStatus::Failed)
}

/// Wakes in-process waiters the moment a job changes state.
///
/// The worker that finishes a job and the request waiting on it are almost
/// always in the same process, so the completion is already in memory when it
/// happens; rediscovering it by polling the database was buying nothing but
/// latency. This is strictly a fast path — another replica can finish a job this
/// process has never heard of — so every waiter keeps a database poll behind it.
#[derive(Default)]
pub struct JobEvents {
    registrations: Mutex<HashMap<Uuid, Registration>>,
}

struct Registration {
    /// The payload is deliberately meaningless. `watch::Sender::send` marks
    /// every receiver as changed whether or not the value differs, so the send
    /// *is* the signal — and, crucially, it latches: a signal that arrives
    /// before the waiter parks is still there when it parks.
    sender: watch::Sender<()>,
    /// Live [`JobWatch`] guards. The entry is removed when this hits zero, which
    /// is the only thing keeping the map from growing without bound.
    waiters: usize,
}

impl JobEvents {
    /// Starts listening for changes to `job_id`.
    ///
    /// Register **before** reading the job's current state. Doing it in that
    /// order means a change landing between the two is either already visible to
    /// the read or latched on this channel — it cannot fall between them.
    pub fn watch(self: &Arc<Self>, job_id: Uuid) -> JobWatch {
        let receiver = {
            let mut registrations = self.registrations.lock().unwrap();
            let registration = registrations.entry(job_id).or_insert_with(|| Registration {
                sender: watch::channel(()).0,
                waiters: 0,
            });
            registration.waiters += 1;
            registration.sender.subscribe()
        };
        JobWatch {
            events: Arc::clone(self),
            job_id,
            receiver,
        }
    }

    /// Wakes every waiter on `job_id`. A no-op when nobody is waiting, which is
    /// the common case — most jobs are never awaited by this process.
    pub fn publish(&self, job_id: Uuid) {
        let registrations = self.registrations.lock().unwrap();
        if let Some(registration) = registrations.get(&job_id) {
            let _ = registration.sender.send(());
        }
    }

    fn release(&self, job_id: Uuid) {
        let mut registrations = self.registrations.lock().unwrap();
        if let Entry::Occupied(mut entry) = registrations.entry(job_id) {
            entry.get_mut().waiters -= 1;
            if entry.get().waiters == 0 {
                entry.remove();
            }
        }
    }

    #[cfg(test)]
    fn tracked_jobs(&self) -> usize {
        self.registrations.lock().unwrap().len()
    }
}

/// A registered interest in one job. Dropping it deregisters.
pub struct JobWatch {
    events: Arc<JobEvents>,
    job_id: Uuid,
    receiver: watch::Receiver<()>,
}

impl JobWatch {
    /// Resolves when the job is signalled.
    ///
    /// The sender cannot outlive this guard's registration, so the channel is
    /// never actually closed here; if it somehow were, this parks forever rather
    /// than resolving in a tight loop, leaving the caller's poll in charge.
    async fn changed(&mut self) {
        if self.receiver.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}

impl Drop for JobWatch {
    fn drop(&mut self) {
        self.events.release(self.job_id);
    }
}

#[derive(Clone)]
pub struct AnalysisCoordinator {
    store: Store,
    github: GitHubClient,
    semaphore: Arc<Semaphore>,
    indexnow: Option<IndexNowService>,
    events: Arc<JobEvents>,
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
            events: Arc::new(JobEvents::default()),
        }
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    /// Waits until `settled` accepts the job, `timeout` elapses, or the job is
    /// gone.
    ///
    /// Returns `Ok(None)` only when no such job row exists. On timeout it
    /// returns the last record it read, so callers always get the freshest
    /// answer available rather than a bare "gave up".
    ///
    /// The registration happens before the first read and outlives every read,
    /// which is what makes the wakeup impossible to lose.
    pub async fn await_job<F>(
        &self,
        job_id: Uuid,
        timeout: Duration,
        mut settled: F,
    ) -> anyhow::Result<Option<JobRecord>>
    where
        F: FnMut(&JobRecord) -> bool,
    {
        let mut watch = self.events.watch(job_id);
        let deadline = Instant::now() + timeout;
        loop {
            let Some(job) = self.store.job(job_id).await? else {
                return Ok(None);
            };
            if settled(&job) {
                return Ok(Some(job));
            }
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                return Ok(Some(job));
            };
            let _ = tokio::time::timeout(remaining.min(JOB_POLL_INTERVAL), watch.changed()).await;
        }
    }

    /// Records a job transition and wakes its waiters.
    ///
    /// Every status write goes through one of these three so the database write
    /// and the wakeup can never drift apart. The wakeup is always published
    /// after the write returns, so a woken waiter re-reads a committed row.
    async fn set_job_running(&self, job_id: Uuid) {
        if let Err(error) = self.store.set_job_running(job_id).await {
            tracing::error!(%error, "failed to mark job running");
        }
        self.events.publish(job_id);
    }

    async fn set_job_completed(&self, job_id: Uuid, report_id: String) {
        if let Err(error) = self.store.set_job_completed(job_id, report_id).await {
            tracing::error!(%error, "failed to mark job completed");
        }
        self.events.publish(job_id);
    }

    async fn set_job_failed(&self, job_id: Uuid, code: &str, message: &str) {
        if let Err(error) = self
            .store
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
        self.events.publish(job_id);
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
                coordinator
                    .set_job_failed(job_id, "internal", "analysis worker is unavailable")
                    .await;
                return;
            };

            coordinator.set_job_running(job_id).await;

            let archive = match coordinator
                .github
                .archive_reader(
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
                    coordinator
                        .set_job_failed(
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
                // The size limit now trips mid-stream rather than after the
                // download, but it is the same user-facing failure, so it keeps
                // reporting through the same error code.
                Err(AnalysisError::ArchiveTooLarge) => {
                    tracing::warn!("archive exceeded the size limit while streaming");
                    let api_error = ApiError::from(GitHubError::TooLarge);
                    coordinator
                        .set_job_failed(
                            job_id,
                            &api_error.body().code,
                            &api_error.body().message,
                        )
                        .await;
                }
                Err(error) => {
                    tracing::warn!(%error, "analysis failed");
                    coordinator
                        .set_job_failed(job_id, "analysis_failed", &error.to_string())
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
    let report_id = report.id.clone();
    if let Err(error) = coordinator.store.save_report(&report, source).await {
        tracing::error!(%error, "failed to save report");
        coordinator
            .set_job_failed(job_id, "internal", "failed to save report")
            .await;
        return;
    }
    // The report page was newly created or materially updated (save_report
    // upserts the body); cache hits never reach this path. Submitting is
    // fire-and-forget and must not affect job completion.
    if let Some(indexnow) = &coordinator.indexnow {
        indexnow.submit_report(&report);
    }
    coordinator.set_job_completed(job_id, report_id).await;
}

#[cfg(test)]
mod tests {
    use std::time::Instant as StdInstant;

    use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

    use super::*;
    use crate::models::JobStatus;

    /// Comfortably under the old 500ms polling floor, and an order of magnitude
    /// under [`JOB_POLL_INTERVAL`]: a waiter that returns this fast can only have
    /// been woken by an event or by its own immediate first read.
    const WOKEN_PROMPTLY: Duration = Duration::from_millis(300);

    struct Harness {
        coordinator: AnalysisCoordinator,
        admin: sqlx::PgPool,
        schema: String,
    }

    impl Harness {
        async fn queued_job(&self) -> Uuid {
            self.coordinator.store.create_job().await.unwrap().id
        }

        async fn drop_schema(self) {
            sqlx::query(&format!("DROP SCHEMA IF EXISTS {} CASCADE", self.schema))
                .execute(&self.admin)
                .await
                .unwrap();
        }
    }

    /// A coordinator on a throwaway schema. Unlike the single-connection harnesses
    /// elsewhere, the search path is pinned through the connect options rather than
    /// a one-off `SET`, so the pool can hand out several connections and concurrent
    /// waiters are not serialized behind each other.
    async fn harness() -> Option<Harness> {
        let database_url = std::env::var("TEST_DATABASE_URL").ok()?;
        if !database_url.starts_with("postgres://") && !database_url.starts_with("postgresql://") {
            return None;
        }
        let admin = PgPoolOptions::new()
            .max_connections(1)
            .connect(&database_url)
            .await
            .ok()?;
        let schema = format!("test_schema_{}", Uuid::new_v4().simple());
        sqlx::query(&format!("CREATE SCHEMA {schema}"))
            .execute(&admin)
            .await
            .unwrap();

        let options: PgConnectOptions = database_url.parse().unwrap();
        let pool = PgPoolOptions::new()
            .max_connections(8)
            // Pre-opened: a connection handshake to the test container costs
            // ~30ms, which would otherwise show up as fake wakeup latency the
            // first time two tasks want a connection at once.
            .min_connections(8)
            .connect_with(options.options([("search_path", schema.as_str())]))
            .await
            .unwrap();
        let store = Store::new(pool);
        store.migrate().await.unwrap();

        Some(Harness {
            coordinator: AnalysisCoordinator::new(store, GitHubClient::new().unwrap(), 1, None),
            admin,
            schema,
        })
    }

    /// The lost-wakeup race, isolated from the database.
    ///
    /// `await_job` registers, then reads. A completion landing in between must
    /// still wake the waiter -- and it does, because the channel latches the
    /// signal rather than firing it into the void. If `publish` were edge
    /// triggered (a bare `Notify::notify_waiters`, say) this would hang until the
    /// timeout and the assertion would fail.
    #[tokio::test]
    async fn a_signal_that_arrives_before_the_waiter_parks_is_not_lost() {
        let events = Arc::new(JobEvents::default());
        let job_id = Uuid::new_v4();

        let mut watch = events.watch(job_id);
        events.publish(job_id);

        tokio::time::timeout(Duration::from_millis(50), watch.changed())
            .await
            .expect("a signal published before the waiter parked must still wake it");
    }

    #[tokio::test]
    async fn every_registered_waiter_sees_one_signal() {
        let events = Arc::new(JobEvents::default());
        let job_id = Uuid::new_v4();
        let watches: Vec<_> = (0..4).map(|_| events.watch(job_id)).collect();

        events.publish(job_id);

        for mut watch in watches {
            tokio::time::timeout(Duration::from_millis(50), watch.changed())
                .await
                .expect("every waiter on the job must be woken");
        }
    }

    /// The map is the one piece of unbounded state here, so it has to shrink back
    /// to nothing no matter how the waiters leave.
    #[tokio::test]
    async fn the_registry_forgets_a_job_once_its_last_waiter_leaves() {
        let events = Arc::new(JobEvents::default());
        let job_id = Uuid::new_v4();

        let first = events.watch(job_id);
        let second = events.watch(job_id);
        assert_eq!(events.tracked_jobs(), 1);

        drop(first);
        assert_eq!(events.tracked_jobs(), 1, "one waiter is still registered");

        drop(second);
        assert_eq!(events.tracked_jobs(), 0);

        // Signalling a job nobody waits on is a no-op, not a new entry.
        events.publish(job_id);
        assert_eq!(events.tracked_jobs(), 0);
    }

    /// The headline fix: the old loop slept 500ms before its first query, so a
    /// job that was already finished still cost half a second.
    #[tokio::test]
    async fn an_already_finished_job_returns_without_waiting() {
        let Some(harness) = harness().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };
        let job_id = harness.queued_job().await;
        harness
            .coordinator
            .set_job_completed(job_id, "report-done".to_string())
            .await;

        let started = StdInstant::now();
        let job = harness
            .coordinator
            .await_job(job_id, Duration::from_secs(30), |job| {
                job_is_finished(job.status)
            })
            .await
            .unwrap()
            .unwrap();
        let elapsed = started.elapsed();

        assert_eq!(job.status, JobStatus::Completed);
        assert!(
            elapsed < WOKEN_PROMPTLY,
            "a finished job must not cost a polling interval, took {elapsed:?}",
        );
        harness.drop_schema().await;
    }

    #[tokio::test]
    async fn a_waiter_is_woken_when_the_job_completes() {
        let Some(harness) = harness().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };
        let job_id = harness.queued_job().await;

        let worker = harness.coordinator.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            worker.set_job_running(job_id).await;
            worker
                .set_job_completed(job_id, "report-done".to_string())
                .await;
        });

        let started = StdInstant::now();
        let job = harness
            .coordinator
            .await_job(job_id, Duration::from_secs(30), |job| {
                job_is_finished(job.status)
            })
            .await
            .unwrap()
            .unwrap();
        let elapsed = started.elapsed();

        assert_eq!(job.status, JobStatus::Completed);
        assert!(
            elapsed < WOKEN_PROMPTLY,
            "the waiter should be woken by the event, not by a poll, took {elapsed:?}",
        );
        harness.drop_schema().await;
    }

    #[tokio::test]
    async fn a_waiter_is_woken_when_the_job_fails() {
        let Some(harness) = harness().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };
        let job_id = harness.queued_job().await;

        let worker = harness.coordinator.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            worker.set_job_failed(job_id, "bad_repo", "nope").await;
        });

        let started = StdInstant::now();
        let job = harness
            .coordinator
            .await_job(job_id, Duration::from_secs(30), |job| {
                job_is_finished(job.status)
            })
            .await
            .unwrap()
            .unwrap();
        let elapsed = started.elapsed();

        assert_eq!(job.status, JobStatus::Failed);
        assert_eq!(job.error.unwrap().code, "bad_repo");
        assert!(elapsed < WOKEN_PROMPTLY, "took {elapsed:?}");
        harness.drop_schema().await;
    }

    /// Walks the completion across the whole registration/first-read window. At
    /// 0ms the job is often already finished before `await_job` reads; a few
    /// milliseconds later the completion lands while the read is in flight. Both
    /// sides of the window, and everything between, must resolve promptly.
    #[tokio::test]
    async fn a_completion_racing_the_first_read_is_never_missed() {
        let Some(harness) = harness().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };

        for delay_ms in [0, 1, 2, 3, 5, 8, 13] {
            let job_id = harness.queued_job().await;
            let worker = harness.coordinator.clone();
            tokio::spawn(async move {
                if delay_ms > 0 {
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                }
                worker
                    .set_job_completed(job_id, "report-done".to_string())
                    .await;
            });

            let started = StdInstant::now();
            let job = harness
                .coordinator
                .await_job(job_id, Duration::from_secs(30), |job| {
                    job_is_finished(job.status)
                })
                .await
                .unwrap()
                .unwrap();
            let elapsed = started.elapsed();

            assert_eq!(job.status, JobStatus::Completed);
            assert!(
                elapsed < WOKEN_PROMPTLY,
                "completion after {delay_ms}ms was missed and fell back to polling, took {elapsed:?}",
            );
        }
        harness.drop_schema().await;
    }

    /// The lost-wakeup window, reconstructed deterministically.
    ///
    /// `settled` runs immediately after `await_job`'s read and before it parks,
    /// so publishing from inside it *is* the race: "the job finished between the
    /// check and the wait". The waiter must still be woken at once. Move the
    /// registration in `await_job` to after the first read and this test stops
    /// being woken at all -- it falls through to [`JOB_POLL_INTERVAL`] and fails
    /// on elapsed time.
    #[tokio::test]
    async fn a_signal_published_between_the_read_and_the_wait_still_wakes_the_waiter() {
        let Some(harness) = harness().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };
        let job_id = harness.queued_job().await;
        harness
            .coordinator
            .set_job_completed(job_id, "report-done".to_string())
            .await;

        let events = Arc::clone(&harness.coordinator.events);
        let mut reads = 0;
        let started = StdInstant::now();
        let job = harness
            .coordinator
            .await_job(job_id, Duration::from_secs(30), |job| {
                reads += 1;
                if reads == 1 {
                    // Stand in for a completion that lands in the window: the
                    // read has happened, the wait has not started yet.
                    events.publish(job_id);
                    return false;
                }
                job_is_finished(job.status)
            })
            .await
            .unwrap()
            .unwrap();
        let elapsed = started.elapsed();

        assert_eq!(job.status, JobStatus::Completed);
        assert_eq!(reads, 2, "the waiter must be woken for a second read");
        assert!(
            elapsed < WOKEN_PROMPTLY,
            "the wakeup was lost between the read and the wait, took {elapsed:?}",
        );
        harness.drop_schema().await;
    }

    #[tokio::test]
    async fn concurrent_waiters_on_one_job_all_wake() {
        let Some(harness) = harness().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };
        let job_id = harness.queued_job().await;

        let waiters: Vec<_> = (0..4)
            .map(|_| {
                let coordinator = harness.coordinator.clone();
                tokio::spawn(async move {
                    let started = StdInstant::now();
                    let job = coordinator
                        .await_job(job_id, Duration::from_secs(30), |job| {
                            job_is_finished(job.status)
                        })
                        .await
                        .unwrap()
                        .unwrap();
                    (job.status, started.elapsed())
                })
            })
            .collect();

        tokio::time::sleep(Duration::from_millis(20)).await;
        harness
            .coordinator
            .set_job_completed(job_id, "report-done".to_string())
            .await;

        for waiter in waiters {
            let (status, elapsed) = waiter.await.unwrap();
            assert_eq!(status, JobStatus::Completed);
            assert!(elapsed < WOKEN_PROMPTLY, "took {elapsed:?}");
        }
        assert_eq!(
            harness.coordinator.events.tracked_jobs(),
            0,
            "every waiter must deregister when it returns",
        );
        harness.drop_schema().await;
    }

    /// A waiter that gives up is the easiest way to leak a registration, so it is
    /// checked explicitly: it must hand back the freshest record it saw *and*
    /// leave the map empty.
    #[tokio::test]
    async fn a_waiter_that_times_out_returns_the_latest_record_and_deregisters() {
        let Some(harness) = harness().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };
        let job_id = harness.queued_job().await;
        harness.coordinator.set_job_running(job_id).await;

        let job = harness
            .coordinator
            .await_job(job_id, Duration::from_millis(50), |job| {
                job_is_finished(job.status)
            })
            .await
            .unwrap()
            .unwrap();

        assert_eq!(job.status, JobStatus::Running);
        assert_eq!(harness.coordinator.events.tracked_jobs(), 0);
        harness.drop_schema().await;
    }

    #[tokio::test]
    async fn awaiting_an_unknown_job_reports_it_missing_and_deregisters() {
        let Some(harness) = harness().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };

        let job = harness
            .coordinator
            .await_job(Uuid::new_v4(), Duration::from_secs(30), |job| {
                job_is_finished(job.status)
            })
            .await
            .unwrap();

        assert!(job.is_none());
        assert_eq!(harness.coordinator.events.tracked_jobs(), 0);
        harness.drop_schema().await;
    }
}
