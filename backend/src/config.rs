use anyhow::Context;

use crate::store::CleanupConfig;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub bind_addr: String,
    pub analysis_concurrency: usize,
    pub cleanup_interval_seconds: u64,
    pub cleanup: CleanupConfig,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
        if !database_url.starts_with("postgres://") && !database_url.starts_with("postgresql://") {
            anyhow::bail!("DATABASE_URL must be a postgres:// or postgresql:// URL");
        }

        Ok(Self {
            database_url,
            bind_addr: std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".to_string()),
            analysis_concurrency: env_usize("ANALYSIS_CONCURRENCY", 2).max(1),
            cleanup_interval_seconds: env_u64("CLEANUP_INTERVAL_SECONDS", 3_600).max(1),
            cleanup: CleanupConfig {
                job_retention_completed_days: env_i64("JOB_RETENTION_COMPLETED_DAYS", 7).max(1),
                job_retention_stale_hours: env_i64("JOB_RETENTION_STALE_HOURS", 24).max(1),
                report_min_retention_days: env_i64("REPORT_MIN_RETENTION_DAYS", 30).max(0),
                report_max_rows: env_i64("REPORT_MAX_ROWS", 20_000).max(1),
                report_cleanup_batch_size: env_i64("REPORT_CLEANUP_BATCH_SIZE", 1_000).max(1),
            },
        })
    }
}

fn env_i64(name: &str, default: i64) -> i64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn env_usize(name: &str, default: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}
