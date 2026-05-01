mod analyzer;
mod api;
mod github;
mod models;
mod store;

use std::{net::SocketAddr, sync::Arc};

use anyhow::Context;
use axum::{
    routing::{get, post},
    Router,
};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;
use tokio::sync::Semaphore;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::{api::AppState, github::GitHubClient, store::Store};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "octocount_service=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://sloc.db".to_string());
    let connect_options = SqliteConnectOptions::from_str(&database_url)?.create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connect_options)
        .await
        .with_context(|| format!("failed to connect to {database_url}"))?;

    let store = Store::new(pool);
    store.migrate().await?;

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
