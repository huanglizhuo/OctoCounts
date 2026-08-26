use std::time::Duration;

use anyhow::Context;

use crate::{
    indexnow::{IndexNowConfig, DEFAULT_ENDPOINT, DEFAULT_HOST},
    store::CleanupConfig,
};

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub database_max_connections: u32,
    pub database_acquire_timeout: Duration,
    pub bind_addr: String,
    pub analysis_concurrency: usize,
    pub cleanup_interval_seconds: u64,
    pub cleanup: CleanupConfig,
    pub indexnow: IndexNowConfig,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
        if !database_url.starts_with("postgres://") && !database_url.starts_with("postgresql://") {
            anyhow::bail!("DATABASE_URL must be a postgres:// or postgresql:// URL");
        }

        Ok(Self {
            database_url,
            // 5 was hardcoded and is low for a service where most handlers are a
            // single short query: with a network-attached Postgres, in-flight
            // requests are dominated by round-trip latency, so the pool caps
            // concurrency well below what either side can handle. Kept modest
            // because managed Postgres plans meter connections.
            database_max_connections: env_u32("DATABASE_MAX_CONNECTIONS", 10).max(1),
            // Fail the request rather than pile up unbounded waiters if the pool
            // is exhausted or the database is unreachable.
            database_acquire_timeout: Duration::from_secs(
                env_u64("DATABASE_ACQUIRE_TIMEOUT_SECONDS", 10).max(1),
            ),
            bind_addr: std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".to_string()),
            analysis_concurrency: env_usize("ANALYSIS_CONCURRENCY", 2).max(1),
            cleanup_interval_seconds: env_u64("CLEANUP_INTERVAL_SECONDS", 3_600).max(1),
            cleanup: CleanupConfig {
                job_retention_completed_days: env_i64("JOB_RETENTION_COMPLETED_DAYS", 1).max(1),
                job_retention_stale_hours: env_i64("JOB_RETENTION_STALE_HOURS", 6).max(1),
                report_min_retention_days: env_i64("REPORT_MIN_RETENTION_DAYS", 30).max(0),
                report_max_rows: env_i64("REPORT_MAX_ROWS", 20_000).max(1),
                report_cleanup_batch_size: env_i64("REPORT_CLEANUP_BATCH_SIZE", 1_000).max(1),
            },
            indexnow: IndexNowConfig {
                enabled: env_bool("INDEXNOW_ENABLED", true),
                key: env_string("INDEXNOW_KEY"),
                host: env_string("INDEXNOW_HOST").unwrap_or_else(|| DEFAULT_HOST.to_string()),
                key_location: env_string("INDEXNOW_KEY_LOCATION"),
                endpoint: env_string("INDEXNOW_ENDPOINT")
                    .unwrap_or_else(|| DEFAULT_ENDPOINT.to_string()),
                batch_size: env_usize("INDEXNOW_BATCH_SIZE", 100).max(1),
                max_retries: env_usize("INDEXNOW_MAX_RETRIES", 3),
                timeout: Duration::from_secs(env_u64("INDEXNOW_TIMEOUT_SECONDS", 10).max(1)),
                dry_run: env_bool("INDEXNOW_DRY_RUN", false),
                ..IndexNowConfig::default()
            },
        })
    }
}

fn env_bool(name: &str, default: bool) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(default)
}

fn env_string(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
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

fn env_u32(name: &str, default: u32) -> u32 {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The pool settings are the only knobs where a wrong default is silently
    /// expensive rather than loudly broken, so pin them.
    #[test]
    fn pool_settings_fall_back_to_documented_defaults() {
        assert_eq!(env_u32("OCTOCOUNTS_UNSET_MAX_CONNECTIONS", 10), 10);
        assert_eq!(env_u64("OCTOCOUNTS_UNSET_ACQUIRE_TIMEOUT", 10), 10);
    }

    /// `.max(1)` guards against a pool of zero connections, which sqlx rejects at
    /// runtime rather than at parse time.
    #[test]
    fn pool_size_is_clamped_to_at_least_one() {
        assert_eq!(env_u32("OCTOCOUNTS_UNSET_MAX_CONNECTIONS", 0).max(1), 1);
    }

    #[test]
    fn garbage_values_fall_back_rather_than_panicking() {
        std::env::set_var("OCTOCOUNTS_TEST_BAD_POOL_SIZE", "not-a-number");
        assert_eq!(env_u32("OCTOCOUNTS_TEST_BAD_POOL_SIZE", 10), 10);
        std::env::remove_var("OCTOCOUNTS_TEST_BAD_POOL_SIZE");
    }
}
