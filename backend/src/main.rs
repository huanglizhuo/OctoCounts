mod analyzer;
mod api;
mod badge;
mod config;
mod coordinator;
mod error;
mod github;
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
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::{
    api::AppState,
    config::Config,
    coordinator::AnalysisCoordinator,
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
        ),
    };

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/api/analyze", post(api::analyze))
        .route("/api/jobs/{job_id}", get(api::job_status))
        .route("/api/reports/{report_id}", get(api::report))
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
        )
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

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
