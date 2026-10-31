use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use bytes::Bytes;
use moka::{future::Cache, policy::EvictionPolicy};

use crate::{
    models::GrowthStats,
    repo_history::RepoHistoryResponse,
    seo::{RelatedList, SeoList, SeoReport, SitemapEntry},
};

#[derive(Clone)]
pub struct AppCaches {
    generation: Arc<AtomicU64>,
    pub stats: Cache<String, GrowthStats>,
    pub seo_report: Cache<String, SeoReport>,
    pub seo_recent: Cache<String, SeoList>,
    pub seo_popular: Cache<String, SeoList>,
    pub seo_monoliths: Cache<String, SeoList>,
    pub seo_sitemap: Cache<String, Vec<SitemapEntry>>,
    pub seo_related: Cache<String, RelatedList>,
    /// Combined star + SLOC history responses. The one-time watch/backfill
    /// trigger only runs on a cache miss (see `repo_history::repo_history`),
    /// so this TTL also bounds how often that check re-runs, not just how
    /// fresh the numbers look. Responses with a backfill still in progress are
    /// never inserted here — see `repo_history::repo_history`.
    pub seo_repo_history: Cache<String, RepoHistoryResponse>,
    /// Rendered OG PNGs, keyed by `provider:owner:repo:commit_sha`.
    /// The key pins a specific commit, so entries can never go stale; the TTL
    /// only bounds memory.
    pub og_png: Cache<String, Bytes>,
    /// Rendered badge SVGs for mutable refs (default branch / branch), keyed by
    /// `owner:repo:ref:badge_type:lang`. Short TTL because the underlying report
    /// can change under the same key.
    pub badge_svg: Cache<String, String>,
    /// Rendered badge SVGs for immutable refs (tag / commit). The content behind
    /// the key cannot change, so this gets a much longer TTL.
    pub badge_svg_immutable: Cache<String, String>,
}

impl AppCaches {
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    pub fn invalidate_reports(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.seo_report.invalidate_all();
        self.seo_related.invalidate_all();
        self.seo_recent.invalidate_all();
        self.seo_popular.invalidate_all();
        self.seo_monoliths.invalidate_all();
        self.seo_sitemap.invalidate_all();
        self.seo_repo_history.invalidate_all();
        self.og_png.invalidate_all();
        self.badge_svg.invalidate_all();
        self.badge_svg_immutable.invalidate_all();
    }

    pub fn new() -> Self {
        Self {
            generation: Arc::new(AtomicU64::new(0)),
            // Refreshed every 5 minutes by main::spawn_stats_refresh_task.
            stats: ttl_cache(1, Duration::from_secs(900)),
            seo_report: ttl_cache(5_000, Duration::from_secs(3_600)),
            seo_recent: ttl_cache(100, Duration::from_secs(60)),
            seo_popular: ttl_cache(100, Duration::from_secs(300)),
            seo_monoliths: ttl_cache(100, Duration::from_secs(900)),
            seo_sitemap: ttl_cache(1, Duration::from_secs(900)),
            // Sized for the whole report inventory: a miss is a multi-second
            // scan, and peers only change when new reports land.
            seo_related: ttl_cache(10_000, Duration::from_secs(21_600)),
            seo_repo_history: ttl_cache(5_000, Duration::from_secs(3_600)),
            og_png: ttl_cache(500, Duration::from_secs(86_400)),
            badge_svg: ttl_cache(2_000, Duration::from_secs(300)),
            badge_svg_immutable: ttl_cache(2_000, Duration::from_secs(86_400)),
        }
    }
}

fn ttl_cache<T>(max_capacity: u64, ttl: Duration) -> Cache<String, T>
where
    T: Clone + Send + Sync + 'static,
{
    Cache::builder()
        .max_capacity(max_capacity)
        .time_to_live(ttl)
        .eviction_policy(EvictionPolicy::lru())
        .build()
}
