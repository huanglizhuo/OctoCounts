use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

/// In-process counters for `/internal/stats`.
///
/// Deliberately bare: atomics and a start time, nothing that needs a
/// background task, its own lock discipline, or a new dependency. Counts are
/// per-process and reset on restart, which is all a lightweight ops endpoint
/// needs; durable aggregates live in the database.
#[derive(Debug)]
pub struct Metrics {
    started_at: Instant,
    report_cache_hits: AtomicU64,
    report_cache_misses: AtomicU64,
}

impl Metrics {
    pub fn new() -> Self {
        Self {
            started_at: Instant::now(),
            report_cache_hits: AtomicU64::new(0),
            report_cache_misses: AtomicU64::new(0),
        }
    }

    pub fn record_cache_hit(&self) {
        self.report_cache_hits.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_cache_miss(&self) {
        self.report_cache_misses.fetch_add(1, Ordering::Relaxed);
    }

    pub fn report_cache_hits(&self) -> u64 {
        self.report_cache_hits.load(Ordering::Relaxed)
    }

    pub fn report_cache_misses(&self) -> u64 {
        self.report_cache_misses.load(Ordering::Relaxed)
    }

    pub fn uptime(&self) -> Duration {
        self.started_at.elapsed()
    }
}

impl Default for Metrics {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_counters_accumulate() {
        let metrics = Metrics::new();
        metrics.record_cache_hit();
        metrics.record_cache_hit();
        metrics.record_cache_miss();
        assert_eq!(metrics.report_cache_hits(), 2);
        assert_eq!(metrics.report_cache_misses(), 1);
    }

    #[test]
    fn uptime_is_positive_once_started() {
        let metrics = Metrics::new();
        assert!(metrics.uptime() > Duration::ZERO);
    }
}
