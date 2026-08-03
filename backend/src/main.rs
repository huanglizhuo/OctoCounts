mod analyzer;
mod api;
mod badge;
mod cache;
mod config;
mod coordinator;
mod error;
mod github;
mod indexnow;
mod models;
mod og;
mod seo;
mod store;

use std::{net::SocketAddr, time::Duration};

use anyhow::Context;
use axum::{
    routing::{get, post},
    Router,
};
use sqlx::postgres::PgPoolOptions;
use tower_http::{compression::CompressionLayer, cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::{
    api::AppState,
    cache::AppCaches,
    config::Config,
    coordinator::AnalysisCoordinator,
    github::GitHubClient,
    indexnow::IndexNowService,
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
        .max_connections(5)
        .connect(&config.database_url)
        .await
        .with_context(|| format!("failed to connect to {}", config.database_url))?;

    let store = Store::new(pool);
    store.migrate().await?;
    spawn_cleanup_task(
        store.clone(),
        config.cleanup_interval_seconds,
        config.cleanup,
    );

    let state = AppState {
        coordinator: AnalysisCoordinator::new(
            store,
            GitHubClient::new()?,
            config.analysis_concurrency,
            IndexNowService::start(config.indexnow.clone()),
        ),
        caches: AppCaches::new(),
    };

    let app = build_router(state);

    let addr: SocketAddr = config.bind_addr.parse().context("invalid BIND_ADDR")?;

    tracing::info!(%addr, "listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;

    Ok(())
}

fn build_router(state: AppState) -> Router {
    let routes = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/api/analyze", post(api::analyze))
        .route("/api/jobs/{job_id}", get(api::job_status))
        .route("/api/reports/{report_id}", get(api::report))
        .route("/api/stats", get(api::stats))
        .route("/api/seo/report", get(seo::report))
        .route("/api/seo/recent", get(seo::recent))
        .route("/api/seo/popular", get(seo::popular))
        .route("/api/seo/monoliths", get(seo::monoliths))
        .route("/api/seo/sitemap", get(seo::sitemap))
        .route("/og/github/{owner}/{repo}", get(og::github))
        .route("/og/gitlab/{*path}", get(og::gitlab))
        .route("/badge/{owner}/{repo}", get(badge::badge_default))
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
        .layer(CorsLayer::permissive())
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

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{header, Request, StatusCode},
    };
    use sqlx::postgres::PgPoolOptions;
    use tower::ServiceExt;

    use super::*;

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
            .ok()?;
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

        let state = AppState {
            coordinator: AnalysisCoordinator::new(store, GitHubClient::new().unwrap(), 1, None),
            caches: AppCaches::new(),
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
