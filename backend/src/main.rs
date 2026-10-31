mod analyzer;
mod api;
mod attributes;
mod badge;
mod cache;
mod config;
mod coordinator;
mod error;
mod github;
#[cfg(test)]
mod golden;
mod indexnow;
mod metrics;
mod models;
mod oauth;
mod og;
mod ratelimit;
mod repo_history;
mod seo;
mod store;

use std::{net::SocketAddr, sync::Arc, time::Duration};

use anyhow::Context;
use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Router,
};
use sqlx::postgres::PgPoolOptions;
use tower_http::{
    compression::CompressionLayer, cors::CorsLayer, set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::{
    api::AppState,
    cache::AppCaches,
    config::Config,
    coordinator::AnalysisCoordinator,
    github::GitHubClient,
    indexnow::IndexNowService,
    metrics::Metrics,
    ratelimit::RateLimits,
    store::{CleanupConfig, Store},
};

/// mimalloc replaces the system allocator process-wide. The hot paths here are
/// allocation-heavy (tarball unpacking, tokei's per-file buffers, serde_json
/// trees, resvg pixmaps) and mimalloc's thread-local free lists handle that
/// churn better than glibc malloc, which is what the deployed Debian image uses.
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "octocount_service=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env()?;
    let pool = PgPoolOptions::new()
        .max_connections(config.database_max_connections)
        .acquire_timeout(config.database_acquire_timeout)
        .connect(&config.database_url)
        .await
        .with_context(|| {
            format!(
                "failed to connect to {}",
                without_password(&config.database_url)
            )
        })?;

    let store = Store::new(pool);
    store.migrate().await?;
    spawn_rename_task(store.clone());
    spawn_cleanup_task(
        store.clone(),
        config.cleanup_interval_seconds,
        config.cleanup,
    );

    let github = GitHubClient::new()?;
    spawn_star_snapshot_task(
        store.clone(),
        github.clone(),
        config.star_snapshot_interval_seconds,
    );

    let metrics = Arc::new(Metrics::new());
    let state = AppState {
        coordinator: AnalysisCoordinator::new(
            store,
            github,
            config.analysis_concurrency,
            IndexNowService::start(config.indexnow.clone()),
            metrics.clone(),
        ),
        caches: AppCaches::new(),
        metrics,
        rate_limits: RateLimits::new(),
        sloc_history_max_points: config.sloc_history_max_points as u64,
        sloc_backfill_wall_clock: Duration::from_secs(config.sloc_backfill_wall_clock_seconds),
        sloc_backfill_reclaim_after: Duration::from_secs(
            config.sloc_backfill_reclaim_after_seconds,
        ),
        github_extension_oauth_client_id: config.github_extension_oauth_client_id.clone(),
        github_extension_oauth_client_secret: config.github_extension_oauth_client_secret.clone(),
    };

    // The SLOC counterparts of the star snapshot task above: the forward
    // sampler keeps completed repos' curves current (SHA-gated, so an
    // unchanged repo costs one cheap ref resolution and no analysis), and
    // the compaction task keeps the stored point count bounded as histories
    // age. Separate tasks rather than one loop so a failure in one does not
    // stall the other.
    repo_history::spawn_sloc_forward_task(state.clone(), config.sloc_forward_interval_seconds);
    repo_history::spawn_sloc_compaction_task(
        state.clone(),
        config.sloc_compaction_interval_seconds,
    );
    spawn_stats_refresh_task(state.clone());

    let app = build_router(state);

    let addr: SocketAddr = config.bind_addr.parse().context("invalid BIND_ADDR")?;

    tracing::info!(%addr, "listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    // Connect info is what the per-IP rate limiter keys on; without it the
    // analyze limiter would have nothing to key a bucket by.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    Ok(())
}

/// `DATABASE_URL` fit for an error message: startup errors land in container
/// logs, which must not carry the database password.
fn without_password(database_url: &str) -> String {
    match url::Url::parse(database_url) {
        Ok(mut url) => {
            if url.password().is_some() {
                let _ = url.set_password(Some("***"));
            }
            url.to_string()
        }
        Err(_) => "the configured DATABASE_URL".to_string(),
    }
}

/// Resolves on Ctrl-C or SIGTERM. `docker stop` sends SIGTERM, and as PID 1
/// with no handler for it this process used to ignore it until the SIGKILL at
/// the end of the grace period, cutting off every in-flight request.
async fn shutdown_signal() {
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::warn!(%error, "cannot listen for SIGTERM");
                std::future::pending::<()>().await;
            }
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        () = terminate => {}
    }
    tracing::info!("shutdown signal received; draining in-flight requests");
}

fn build_router(state: AppState) -> Router {
    let routes = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/readyz", get(readyz))
        .route("/internal/stats", get(api::internal_stats))
        .route("/api/analyze", post(api::analyze))
        .route("/api/jobs/{job_id}", get(api::job_status))
        .route("/api/reports/{report_id}", get(api::report))
        .route(
            "/api/reports/{report_id}/badge.svg",
            get(badge::badge_report),
        )
        .route("/api/stats", get(api::stats))
        .route("/api/repo-info", get(api::repo_info))
        .route("/api/seo/report", get(seo::report))
        .route("/api/seo/redirect", get(seo::redirect))
        .route("/api/seo/recent", get(seo::recent))
        .route("/api/seo/popular", get(seo::popular))
        .route("/api/seo/monoliths", get(seo::monoliths))
        .route("/api/seo/sitemap", get(seo::sitemap))
        .route("/api/seo/repos-indexable", post(seo::repos_indexable))
        .route("/api/seo/related", get(seo::related))
        .route("/api/seo/repo-history", get(repo_history::repo_history))
        .route(
            "/api/auth/github/extension-token",
            post(oauth::github_extension_token_exchange),
        )
        .route("/api/auth/github/token", post(oauth::github_auth_token))
        .route("/og/github/{owner}/{repo}", get(og::github))
        .route("/og/gitlab/{*path}", get(og::gitlab))
        .route("/badge/{owner}/{repo}", get(badge::badge_default))
        .route(
            "/badge/{owner}/{repo}/star-history.svg",
            get(badge::star_history_badge),
        )
        .route(
            "/badge/{owner}/{repo}/branch/{*branch}",
            get(badge::badge_branch),
        )
        .route("/badge/{owner}/{repo}/tag/{*tag}", get(badge::badge_tag))
        .route(
            "/badge/{owner}/{repo}/commit/{sha}",
            get(badge::badge_commit),
        );

    apply_middleware(routes).with_state(state)
}

/// Readiness for the tunnel watchdog (sloc-infra): `/healthz` only proves the
/// process answers, so a node that cannot reach the database (ghost talks to
/// VPS-B's Postgres across providers) would keep taking tunnel traffic and
/// fail every request. Bounded so a stalled pool reads as not ready.
async fn readyz(State(state): State<AppState>) -> (StatusCode, &'static str) {
    match tokio::time::timeout(Duration::from_secs(2), state.coordinator.store().ping()).await {
        Ok(Ok(())) => (StatusCode::OK, "ok"),
        _ => (StatusCode::SERVICE_UNAVAILABLE, "database unavailable"),
    }
}

/// The release this binary was built from: the image tag CI passes as the
/// `OCTOCOUNTS_BUILD` build arg, "dev" for local builds. Every response carries
/// it as `x-octocounts-build`, so `make drift` (sloc-infra) can confirm which
/// build answers behind the load-balanced tunnel.
const BUILD: &str = match option_env!("OCTOCOUNTS_BUILD") {
    Some(build) => build,
    None => "dev",
};

/// Wraps the routes in the shared middleware stack.
///
/// `Router::layer` applies layers outermost-last, so a request travels
/// `TraceLayer` -> `CompressionLayer` -> `CorsLayer` -> handler. Compression sits
/// inside tracing (so spans cover the compressed response) and outside CORS (so
/// preflight/CORS headers are never touched by the encoder).
///
/// `CompressionLayer::new()` uses tower-http's `DefaultPredicate`, which skips
/// `image/*` (with an explicit carve-out for `image/svg+xml`). That means the
/// already-compressed PNGs from `/og/...` are passed through untouched while the
/// badge SVGs still get compressed.
fn apply_middleware<S>(router: Router<S>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    router
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::HeaderName::from_static("x-octocounts-build"),
            axum::http::HeaderValue::from_str(BUILD)
                .unwrap_or(axum::http::HeaderValue::from_static("unknown")),
        ))
        .layer(CorsLayer::permissive().expose_headers([axum::http::header::RETRY_AFTER]))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
}

fn spawn_cleanup_task(store: Store, interval_seconds: u64, config: CleanupConfig) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            match store.cleanup(config).await {
                Ok(stats) if stats.skipped_locked => {
                    tracing::debug!("skipped cleanup because another process holds the lock");
                }
                Ok(stats) => {
                    tracing::info!(
                        completed_jobs_deleted = stats.completed_jobs_deleted,
                        stale_jobs_deleted = stats.stale_jobs_deleted,
                        expired_reports_deleted = stats.expired_reports_deleted,
                        cold_reports_deleted = stats.cold_reports_deleted,
                        "storage cleanup completed"
                    );
                }
                Err(error) => {
                    tracing::warn!(%error, "storage cleanup failed");
                }
            }
            tokio::time::sleep(Duration::from_secs(interval_seconds)).await;
        }
    });
}

/// The growth-stats aggregate scans every report, longer than the edge's
/// eight-second upstream budget allows inline, and it grows with the table.
/// One process recomputes it every five minutes (`Store::run_if_due`) and
/// stores it; every process loads that shared copy each minute, starting at
/// boot, so `/api/stats` answers from memory and the scan runs once per
/// interval for the whole cluster rather than once per node.
fn spawn_stats_refresh_task(state: AppState) {
    tokio::spawn(async move {
        let store = state.coordinator.store().clone();
        loop {
            let computed = store
                .run_if_due("growth-stats", Duration::from_secs(300), || async {
                    let stats = store.growth_stats().await?;
                    store.save_growth_stats(&stats).await
                })
                .await;
            if let Err(error) = computed {
                tracing::warn!(%error, "growth stats refresh failed");
            }
            match store.stored_growth_stats().await {
                Ok(Some(stats)) => state.caches.stats.insert("stats".to_string(), stats).await,
                Ok(None) => {}
                Err(error) => tracing::warn!(%error, "could not load the shared growth stats"),
            }
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });
}

/// Folds the known renamed slugs (plus replaying any recorded redirects, which
/// catches rows an old binary re-filed under a predecessor slug mid-deploy),
/// once an hour for the cluster and first at boot. Not before serving: it is
/// ~2,000 sequential statements, seconds next to the database but about six
/// minutes from ghost, which kept that node out of the rotation that long after
/// every deploy. Until it finishes a repository may have two keys, latest row
/// wins, the state a failed pass always left; resolutions follow renames anyway.
fn spawn_rename_task(store: Store) {
    tokio::spawn(async move {
        loop {
            let ran = store
                .run_if_due("repo-renames", Duration::from_secs(3_600), || async {
                    let moved = store.migrate_repo_renames().await?;
                    if moved > 0 {
                        tracing::info!(moved, "rename pass folded stored rows");
                    }
                    Ok(())
                })
                .await;
            if let Err(error) = ran {
                tracing::warn!(%error, "rename pass failed");
            }
            tokio::time::sleep(store::BACKGROUND_CHECK_EVERY).await;
        }
    });
}

/// Once per `interval_seconds` (default daily) for the whole cluster, re-reads
/// the current GitHub star count for every repo on the watch list and records
/// one snapshot per repo. `record_star_snapshot` upserts on (provider, owner,
/// repo, date), so a pass that spills past midnight settles on one row, and
/// repos already snapshotted today (by a view, say) are skipped.
fn spawn_star_snapshot_task(store: Store, github: GitHubClient, interval_seconds: u64) {
    tokio::spawn(async move {
        let every = Duration::from_secs(interval_seconds);
        loop {
            tokio::time::sleep(store::BACKGROUND_CHECK_EVERY).await;
            let ran = store
                .run_if_due("star-snapshots", every, || async {
                    let today = chrono::Utc::now().date_naive();
                    let repos = store.watched_star_repos(today).await?;
                    let mut updated = 0u64;
                    for (provider, owner, repo) in repos {
                        let Some(stars) = github.repo_stars(&provider, &owner, &repo).await else {
                            continue;
                        };
                        match store
                            .record_star_snapshot(provider, &owner, &repo, today, stars as i64)
                            .await
                        {
                            Ok(()) => updated += 1,
                            Err(error) => {
                                tracing::warn!(%error, owner, repo, "failed to record star snapshot")
                            }
                        }
                    }
                    tracing::info!(updated, "star snapshot task completed");
                    Ok(())
                })
                .await;
            if let Err(error) = ran {
                tracing::warn!(%error, "star snapshot pass failed");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{header, Request, StatusCode},
    };
    use sqlx::postgres::PgPoolOptions;
    use tower::ServiceExt;

    use super::*;

    #[test]
    fn connection_errors_never_print_the_database_password() {
        let shown = without_password(
            "postgres://octo:s3cret@db.example:5432/octocounts?sslmode=verify-full",
        );
        assert!(!shown.contains("s3cret"), "{shown}");
        assert!(shown.contains("db.example:5432/octocounts"), "{shown}");
        assert!(!without_password("not a url s3cret").contains("s3cret"));
    }

    /// Builds a router backed by a throwaway schema on `TEST_DATABASE_URL`.
    /// Returns `None` (and the test is skipped) when no test database is configured.
    async fn test_app() -> Option<(Router, sqlx::PgPool, String)> {
        let database_url = std::env::var("TEST_DATABASE_URL").ok()?;
        if !database_url.starts_with("postgres://") && !database_url.starts_with("postgresql://") {
            return None;
        }
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(&database_url)
            .await
            .expect("TEST_DATABASE_URL is configured but PostgreSQL connection failed");
        let schema = format!("test_schema_{}", uuid::Uuid::new_v4().simple());
        sqlx::query(&format!("CREATE SCHEMA {schema}"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(&format!("SET search_path TO {schema}"))
            .execute(&pool)
            .await
            .unwrap();

        let store = Store::new(pool.clone());
        store.migrate().await.unwrap();

        let metrics = Arc::new(Metrics::new());
        let state = AppState {
            coordinator: AnalysisCoordinator::new(
                store,
                GitHubClient::new().unwrap(),
                1,
                None,
                metrics.clone(),
            ),
            caches: AppCaches::new(),
            metrics,
            rate_limits: RateLimits::new(),
            sloc_history_max_points: 12,
            sloc_backfill_wall_clock: Duration::from_secs(600),
            sloc_backfill_reclaim_after: Duration::from_secs(900),
            github_extension_oauth_client_id: None,
            github_extension_oauth_client_secret: None,
        };
        Some((build_router(state), pool, schema))
    }

    async fn drop_schema(pool: &sqlx::PgPool, schema: &str) {
        sqlx::query(&format!("DROP SCHEMA IF EXISTS {schema} CASCADE"))
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn every_response_names_its_build() {
        let app = apply_middleware(Router::new().route("/healthz", get(|| async { "ok" })));
        for uri in ["/healthz", "/missing"] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.headers()["x-octocounts-build"], BUILD, "{uri}");
        }
    }

    #[tokio::test]
    async fn readyz_checks_the_database() {
        let Some((app, pool, schema)) = test_app().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/readyz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        pool.close().await;
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/readyz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let pool = PgPoolOptions::new()
            .connect(&std::env::var("TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        drop_schema(&pool, &schema).await;
    }

    #[tokio::test]
    async fn json_responses_are_gzipped_when_requested() {
        let Some((app, pool, schema)) = test_app().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/stats")
                    .header(header::ACCEPT_ENCODING, "gzip")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_ENCODING)
                .and_then(|value| value.to_str().ok()),
            Some("gzip"),
        );

        drop_schema(&pool, &schema).await;
    }

    #[tokio::test]
    async fn json_responses_are_untouched_without_accept_encoding() {
        let Some((app, pool, schema)) = test_app().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/stats")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert!(
            response.headers().get(header::CONTENT_ENCODING).is_none(),
            "response must not be encoded when the client did not ask for it",
        );

        drop_schema(&pool, &schema).await;
    }

    /// PNGs are already compressed; re-compressing them burns CPU for nothing.
    #[tokio::test]
    async fn og_png_is_never_compressed() {
        let Some((app, pool, schema)) = test_app().await else {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return;
        };

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/og/github/octocounts/example")
                    .header(header::ACCEPT_ENCODING, "gzip, br")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("image/png"),
        );
        assert!(
            response.headers().get(header::CONTENT_ENCODING).is_none(),
            "png responses must not be re-compressed",
        );

        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        assert_eq!(&body[..8], b"\x89PNG\r\n\x1a\n");

        drop_schema(&pool, &schema).await;
    }
}
