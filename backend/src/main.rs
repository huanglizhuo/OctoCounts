mod analyzer;
mod api;
mod github;
mod models;
mod store;

use std::{net::SocketAddr, sync::Arc, time::Duration};

use anyhow::Context;
use axum::{
    routing::{get, post},
    Router,
};
use sqlx::postgres::PgPoolOptions;
use tokio::sync::Semaphore;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::{
    api::AppState,
    github::GitHubClient,
    store::{CleanupConfig, Store},
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "octocount_service=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    if !database_url.starts_with("postgres://") && !database_url.starts_with("postgresql://") {
        anyhow::bail!("DATABASE_URL must be a postgres:// or postgresql:// URL");
    }
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .with_context(|| format!("failed to connect to {database_url}"))?;

    let store = Store::new(pool);
    store.migrate().await?;
    spawn_cleanup_task(store.clone());

    let concurrency = std::env::var("ANALYSIS_CONCURRENCY")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(2);

    let state = AppState {
        store,
        github: GitHubClient::new()?,
        semaphore: Arc::new(Semaphore::new(concurrency)),
    };

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/api/analyze", post(api::analyze))
        .route("/api/jobs/:job_id", get(api::job_status))
        .route("/api/reports/:report_id", get(api::report))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr: SocketAddr = std::env::var("BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8080".to_string())
        .parse()
        .context("invalid BIND_ADDR")?;

    tracing::info!(%addr, "listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;

    Ok(())
}

fn spawn_cleanup_task(store: Store) {
    let interval_seconds = env_i64("CLEANUP_INTERVAL_SECONDS", 3_600).max(1) as u64;
    let config = CleanupConfig {
        job_retention_completed_days: env_i64("JOB_RETENTION_COMPLETED_DAYS", 7).max(1),
        job_retention_stale_hours: env_i64("JOB_RETENTION_STALE_HOURS", 24).max(1),
        report_min_retention_days: env_i64("REPORT_MIN_RETENTION_DAYS", 30).max(0),
        report_max_rows: env_i64("REPORT_MAX_ROWS", 20_000).max(1),
        report_cleanup_batch_size: env_i64("REPORT_CLEANUP_BATCH_SIZE", 1_000).max(1),
    };

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

fn env_i64(name: &str, default: i64) -> i64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}
