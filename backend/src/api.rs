use std::{sync::Arc, time::Duration};

use axum::{
    extract::{ConnectInfo, Extension, Path, Query, RawQuery, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use uuid::Uuid;

use crate::{
    cache::AppCaches,
    coordinator::{job_is_finished, AnalysisCoordinator},
    error::ApiError,
    metrics::Metrics,
    models::{AnalyzeRequest, AnalyzeResponse, GrowthStats, JobRecord, JobStatus, RepositoryProvider},
    ratelimit::{client_ip, RateLimits},
};

#[derive(Clone)]
pub struct AppState {
    pub coordinator: AnalysisCoordinator,
    pub caches: AppCaches,
    pub metrics: Arc<Metrics>,
    pub rate_limits: RateLimits,
    /// How many historical commits `repo_history::ensure_repo_history` samples
    /// per repo for the SLOC backfill. See `Config::sloc_history_max_samples`.
    pub sloc_history_max_samples: u64,
}

pub async fn analyze(
    State(state): State<AppState>,
    connect_info: Option<Extension<ConnectInfo<std::net::SocketAddr>>>,
    headers: HeaderMap,
    Json(request): Json<AnalyzeRequest>,
) -> Result<Json<AnalyzeResponse>, ApiError> {
    // Per-IP token buckets. `connect_info` is absent only in tests driving the
    // handler without the connect-info make service; those skip limiting.
    if let Some(ip) = client_ip(&headers, connect_info.map(|Extension(ConnectInfo(addr))| addr)) {
        if let Err(seconds) = state.rate_limits.analyze.check(&ip) {
            return Err(ApiError::rate_limited(seconds));
        }
        // `force_refresh` pays for a full archive download and bypasses the
        // report cache, so it draws from a much smaller quota of its own.
        if request.force_refresh {
            if let Err(seconds) = state.rate_limits.force_refresh.check(&ip) {
                return Err(ApiError::rate_limited(seconds));
            }
        }
    }
    state.coordinator.submit(request).await.map(Json)
}

/// The longest `?wait=` this endpoint honours. Comfortably under the idle
/// timeouts of the proxies in front of it, and short enough that a client that
/// disappears mid-poll frees the request soon after.
const MAX_JOB_WAIT_SECONDS: u64 = 25;

/// Reports a job's state, optionally waiting for it to change first.
///
/// Without `?wait=` this is the same single read it has always been, down to the
/// error mapping and the `no-store` header — the web app, the browser extension,
/// the CLI and the MCP server all poll this endpoint and none of them know about
/// `wait`.
///
/// With `?wait=<seconds>` it returns as soon as the job's status differs from
/// what the first read saw (or immediately, if that read already found the job
/// finished), and otherwise when the wait runs out. Either way the body is the
/// current record, so a caller that ignores the difference still behaves
/// correctly — `wait` only changes *when* the answer comes back, never what it
/// says. The wait itself is event-driven, so it costs one query plus one more
/// per status change rather than one per polling tick.
pub async fn job_status(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
    RawQuery(query): RawQuery,
) -> Result<(HeaderMap, Json<JobRecord>), ApiError> {
    let job = match requested_wait(query.as_deref()) {
        None => state
            .coordinator
            .store()
            .job(job_id)
            .await
            .map_err(ApiError::internal)?,
        Some(wait) => {
            let mut first_seen: Option<JobStatus> = None;
            state
                .coordinator
                .await_job(job_id, wait, |job| match first_seen {
                    None => {
                        first_seen = Some(job.status);
                        job_is_finished(job.status)
                    }
                    Some(previous) => job.status != previous,
                })
                .await
                .map_err(ApiError::internal)?
        }
    };

    let Some(job) = job else {
        return Err(ApiError::not_found("job_not_found", "job was not found"));
    };
    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok((headers, Json(job)))
}

/// Reads `wait` out of a raw query string, clamped to [`MAX_JOB_WAIT_SECONDS`].
///
/// Deliberately lenient, and deliberately not a `Query<T>` extractor: every
/// existing caller of this endpoint sends either no query string or one this
/// code has never seen, and none of them should be able to start receiving a 400
/// because a long-poll parameter was added. A malformed value, an unknown
/// parameter or an unparseable query all mean "no wait", which is exactly the
/// behaviour those callers have today.
fn requested_wait(query: Option<&str>) -> Option<Duration> {
    let seconds: u64 = query?
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(key, _)| *key == "wait")?
        .1
        .parse()
        .ok()?;
    if seconds == 0 {
        return None;
    }
    Some(Duration::from_secs(seconds.min(MAX_JOB_WAIT_SECONDS)))
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

/// Live star count for a repository, for share-card refreshes. The report body
/// carries the snapshot taken at analysis time; cached reports can be months
/// old, and a share PNG propagates whatever number it was drawn with, so the
/// client refreshes through this endpoint (server-side token, short cache)
/// before rendering. `stars: null` means unknown — the client falls back to the
/// snapshot or hides the badge.
pub async fn repo_info(
    State(state): State<AppState>,
    Query(params): Query<RepoInfoQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let provider = match params.provider.as_deref() {
        Some("gitlab") | Some("gitLab") | Some("GitLab") => RepositoryProvider::GitLab,
        _ => RepositoryProvider::GitHub,
    };

    if !is_repo_part(&params.owner) || !is_repo_part(&params.repo) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_repository",
            "owner and repo query parameters are required",
        ));
    }

    let stars = state
        .coordinator
        .github()
        .repo_stars(&provider, &params.owner, &params.repo)
        .await;

    Ok(Json(serde_json::json!({ "stars": stars })))
}

#[derive(Debug, serde::Deserialize)]
pub struct RepoInfoQuery {
    pub owner: String,
    pub repo: String,
    pub provider: Option<String>,
}

fn is_repo_part(value: &str) -> bool {
    !value.is_empty() && value.len() <= 100 && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
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

/// Lightweight ops view: live job counts, stored reports, report-cache hit
/// ratio, upstream 429s and uptime, all per process.
///
/// Protected by `INTERNAL_STATS_TOKEN` when that env var is set (send it in
/// the `x-stats-token` header); without it the endpoint is open, since every
/// field it exposes is non-sensitive. Not cached: it is an on-demand read for
/// a human or a scraper, not something fronted by a CDN.
pub async fn internal_stats(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    if let Ok(token) = std::env::var("INTERNAL_STATS_TOKEN") {
        let token = token.trim().to_string();
        if !token.is_empty() {
            let provided = headers
                .get("x-stats-token")
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default();
            if provided != token {
                return Err(ApiError::new(
                    StatusCode::UNAUTHORIZED,
                    "unauthorized",
                    "a valid x-stats-token header is required",
                ));
            }
        }
    }

    let job_counts = state
        .coordinator
        .store()
        .job_status_counts()
        .await
        .map_err(ApiError::internal)?;
    let mut jobs = serde_json::Map::new();
    for (status, count) in job_counts {
        jobs.insert(status, count.into());
    }

    let reports = state
        .coordinator
        .store()
        .reports_count()
        .await
        .map_err(ApiError::internal)?;

    Ok(Json(serde_json::json!({
        "uptime_seconds": state.metrics.uptime().as_secs(),
        "jobs": jobs,
        "reports": reports,
        "report_cache": {
            "hits": state.metrics.report_cache_hits(),
            "misses": state.metrics.report_cache_misses(),
        },
        "github_429": state.coordinator.github().rate_limited_429_count(),
    })))
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use axum::{
        body::Body,
        http::{Request, StatusCode},
        routing::get,
        Router,
    };
    use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
    use tower::ServiceExt;

    use super::*;
    use crate::{github::GitHubClient, store::Store};

    struct Harness {
        router: Router,
        coordinator: AnalysisCoordinator,
        admin: sqlx::PgPool,
        schema: String,
    }

    impl Harness {
        async fn get(&self, uri: &str) -> (StatusCode, HeaderMap, String) {
            let response = self
                .router
                .clone()
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            let status = response.status();
            let headers = response.headers().clone();
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            (status, headers, String::from_utf8(body.to_vec()).unwrap())
        }

        async fn queued_job(&self) -> Uuid {
            self.coordinator.store().create_job().await.unwrap().id
        }

        async fn drop_schema(self) {
            drop(self.router);
            sqlx::query(&format!("DROP SCHEMA IF EXISTS {} CASCADE", self.schema))
                .execute(&self.admin)
                .await
                .unwrap();
        }
    }

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
            // See the note in `coordinator::tests`: the per-harness minimum is
            // summed across every test running in parallel, so it stays well
            // under the server's `max_connections`.
            .min_connections(4)
            .connect_with(options.options([("search_path", schema.as_str())]))
            .await
            .unwrap();
        let store = Store::new(pool);
        store.migrate().await.unwrap();

        let metrics = Arc::new(Metrics::new());
        let coordinator =
            AnalysisCoordinator::new(store, GitHubClient::new().unwrap(), 1, None, metrics.clone());
        let state = AppState {
            coordinator: coordinator.clone(),
            caches: AppCaches::new(),
            metrics,
            rate_limits: RateLimits::new(),
            sloc_history_max_samples: 12,
        };
        Some(Harness {
            router: Router::new()
                .route("/api/jobs/{job_id}", get(job_status))
                .with_state(state),
            coordinator,
            admin,
            schema,
        })
    }

    #[test]
    fn wait_is_read_from_the_query_and_clamped() {
        assert_eq!(requested_wait(Some("wait=5")), Some(Duration::from_secs(5)));
        assert_eq!(
            requested_wait(Some("other=1&wait=3")),
            Some(Duration::from_secs(3)),
        );
        assert_eq!(
            requested_wait(Some("wait=99999")),
            Some(Duration::from_secs(MAX_JOB_WAIT_SECONDS)),
        );
    }

    /// Four independent clients poll this endpoint and none of them send `wait`.
    /// Anything unrecognized has to mean "no wait", never a rejection.
    #[test]
    fn anything_that_is_not_a_wait_is_ignored() {
        assert_eq!(requested_wait(None), None);
        assert_eq!(requested_wait(Some("")), None);
        assert_eq!(requested_wait(Some("foo=bar")), None);
        assert_eq!(requested_wait(Some("wait")), None);
        assert_eq!(requested_wait(Some("wait=")), None);
        assert_eq!(requested_wait(Some("wait=abc")), None);
        assert_eq!(requested_wait(Some("wait=-1")), None);
        assert_eq!(requested_wait(Some("wait=0")), None);
        assert_eq!(requested_wait(Some("waiting=5")), None);
    }

    /// The backward compatibility bar: with no `wait`, and with a query string
    /// this endpoint does not understand, the response is byte for byte what a
    /// `wait`-aware client gets back for the same job.
    #[tokio::test]
    async fn responses_are_identical_with_and_without_wait() {
        let Some(harness) = harness().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };
        let job_id = harness.queued_job().await;
        harness
            .coordinator
            .set_job_completed(job_id, "report-done".to_string())
            .await;

        let plain = harness.get(&format!("/api/jobs/{job_id}")).await;
        let unknown_param = harness.get(&format!("/api/jobs/{job_id}?foo=bar")).await;
        let malformed = harness.get(&format!("/api/jobs/{job_id}?wait=abc")).await;
        let waited = harness.get(&format!("/api/jobs/{job_id}?wait=25")).await;

        assert_eq!(plain.0, StatusCode::OK);
        assert!(plain.2.contains(r#""status":"completed""#), "{}", plain.2);
        assert_eq!(
            plain.1.get(header::CACHE_CONTROL).unwrap(),
            HeaderValue::from_static("no-store"),
        );
        for other in [&unknown_param, &malformed, &waited] {
            assert_eq!(other.0, plain.0);
            assert_eq!(other.1, plain.1);
            assert_eq!(other.2, plain.2);
        }
        harness.drop_schema().await;
    }

    #[tokio::test]
    async fn a_long_poll_returns_as_soon_as_the_job_finishes() {
        let Some(harness) = harness().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };
        let job_id = harness.queued_job().await;

        let worker = harness.coordinator.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            worker
                .set_job_completed(job_id, "report-done".to_string())
                .await;
        });

        let started = Instant::now();
        let (status, _, body) = harness.get(&format!("/api/jobs/{job_id}?wait=25")).await;
        let elapsed = started.elapsed();

        assert_eq!(status, StatusCode::OK);
        assert!(body.contains(r#""status":"completed""#), "{body}");
        assert!(
            elapsed < Duration::from_millis(300),
            "the long poll should return on the event, not on the wait, took {elapsed:?}",
        );
        harness.drop_schema().await;
    }

    /// A status change that is not the end of the job still ends the wait: the
    /// caller gets the truth and decides whether to ask again.
    #[tokio::test]
    async fn a_long_poll_returns_on_any_status_change() {
        let Some(harness) = harness().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };
        let job_id = harness.queued_job().await;

        let worker = harness.coordinator.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            worker.set_job_running(job_id).await;
        });

        let started = Instant::now();
        let (status, _, body) = harness.get(&format!("/api/jobs/{job_id}?wait=25")).await;
        let elapsed = started.elapsed();

        assert_eq!(status, StatusCode::OK);
        assert!(body.contains(r#""status":"running""#), "{body}");
        assert!(elapsed < Duration::from_millis(300), "took {elapsed:?}");
        harness.drop_schema().await;
    }

    #[tokio::test]
    async fn a_long_poll_that_times_out_answers_with_the_current_state() {
        let Some(harness) = harness().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };
        let job_id = harness.queued_job().await;

        let started = Instant::now();
        let (status, headers, body) = harness.get(&format!("/api/jobs/{job_id}?wait=1")).await;
        let elapsed = started.elapsed();

        assert_eq!(status, StatusCode::OK);
        assert!(body.contains(r#""status":"queued""#), "{body}");
        assert_eq!(
            headers.get(header::CACHE_CONTROL).unwrap(),
            HeaderValue::from_static("no-store"),
        );
        assert!(
            elapsed >= Duration::from_secs(1),
            "the wait must actually be honoured, took {elapsed:?}",
        );
        assert!(elapsed < Duration::from_secs(3), "took {elapsed:?}");
        harness.drop_schema().await;
    }

    #[tokio::test]
    async fn an_unknown_job_is_not_found_whether_or_not_it_is_waited_on() {
        let Some(harness) = harness().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };
        let missing = Uuid::new_v4();

        let plain = harness.get(&format!("/api/jobs/{missing}")).await;
        let started = Instant::now();
        let waited = harness.get(&format!("/api/jobs/{missing}?wait=25")).await;
        let elapsed = started.elapsed();

        assert_eq!(plain.0, StatusCode::NOT_FOUND);
        assert_eq!(waited.0, StatusCode::NOT_FOUND);
        assert_eq!(waited.2, plain.2);
        assert!(
            elapsed < Duration::from_millis(300),
            "waiting on a job that does not exist must not block, took {elapsed:?}",
        );
        harness.drop_schema().await;
    }
}
