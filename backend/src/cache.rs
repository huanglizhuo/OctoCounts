use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use axum::http::HeaderValue;
use bytes::Bytes;
use moka::{future::Cache, policy::EvictionPolicy};

use crate::seo::{LanguageIndex, SitemapInventory};

/// Pre-serialized `/api/seo/report` response plus the two fields needed to
/// build response headers (`Link: canonical` vs `X-Robots-Tag: noindex`)
/// without keeping or re-serializing the full `SeoReport` tree on every hit.
#[derive(Clone)]
pub struct CachedSeoReport {
    pub body: Bytes,
    pub public_path: Arc<str>,
    pub total_files: usize,
}

/// Pre-serialized `/api/seo/related` response plus its precomputed `cache-tag`
/// header value (avoiding 6x SHA-256 hashing on every cache hit).
#[derive(Clone)]
pub struct CachedRelated {
    pub body: Bytes,
    pub cache_tag: HeaderValue,
}

/// Shared `/api/seo/languages` index: both the pre-serialized JSON bytes for
/// `/api/seo/languages` and the structured `LanguageIndex` so
/// `/api/seo/language/:slug` resolves slugs from memory instead of re-querying
/// Postgres on every language cache miss.
pub struct CachedLanguageIndex {
    pub index: LanguageIndex,
    pub body: Bytes,
}

#[derive(Clone)]
pub struct AppCaches {
    generation: Arc<AtomicU64>,
    pub stats: Cache<String, Bytes>,
    /// Byte-weighted cache for immutable `/api/reports/:id` JSON passthroughs.
    pub report_json: Cache<String, Bytes>,
    pub seo_report: Cache<String, CachedSeoReport>,
    pub seo_recent: Cache<String, Bytes>,
    pub seo_popular: Cache<String, Bytes>,
    pub seo_monoliths: Cache<String, Bytes>,
    pub seo_sitemap: Cache<String, Arc<SitemapInventory>>,
    pub seo_related: Cache<String, CachedRelated>,
    /// The per-language leaderboard index (one entry) and each language's
    /// leaderboard. Both read materialized columns only, so a miss is cheap;
    /// the TTL keeps a page from moving under a crawler mid-crawl.
    pub seo_languages: Cache<String, Arc<CachedLanguageIndex>>,
    pub seo_language: Cache<String, Bytes>,
    /// Combined star + SLOC history responses. The one-time watch/backfill
    /// trigger only runs on a cache miss (see `repo_history::repo_history`),
    /// so this TTL also bounds how often that check re-runs, not just how
    /// fresh the numbers look. Responses with a backfill still in progress are
    /// never inserted here — see `repo_history::repo_history`.
    pub seo_repo_history: Cache<String, Bytes>,
    /// Rendered OG PNGs, keyed by `provider:owner:repo:commit_sha` or
    /// `compare:...`. The key pins a specific commit, so entries can never go
    /// stale; the TTL only bounds memory and `invalidate_reports` leaves them
    /// intact.
    pub og_png: Cache<String, Bytes>,
    /// Short-lived repo/compare -> latest OG PNG shortcut so repeat OG image
    /// requests avoid hitting Postgres for the report summary on every hit.
    /// Invalidated when reports change.
    pub og_latest: Cache<String, Bytes>,
    /// Rendered badge SVGs for mutable refs (default branch / branch), keyed by
    /// `owner:repo:ref:badge_type:lang`. Short TTL because the underlying report
    /// can change under the same key.
    pub badge_svg: Cache<String, String>,
    /// Rendered badge SVGs for immutable refs (tag / commit / report ID). The
    /// content behind the key cannot change, so this gets a much longer TTL.
    pub badge_svg_immutable: Cache<String, String>,
}

impl AppCaches {
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    pub fn invalidate_reports(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.report_json.invalidate_all();
        self.seo_report.invalidate_all();
        self.seo_related.invalidate_all();
        self.seo_recent.invalidate_all();
        self.seo_popular.invalidate_all();
        self.seo_monoliths.invalidate_all();
        self.seo_sitemap.invalidate_all();
        self.seo_languages.invalidate_all();
        self.seo_language.invalidate_all();
        self.seo_repo_history.invalidate_all();
        self.og_latest.invalidate_all();
        self.badge_svg.invalidate_all();
        self.badge_svg_immutable.invalidate_all();
    }

    pub fn new() -> Self {
        Self {
            generation: Arc::new(AtomicU64::new(0)),
            // Refreshed every 5 minutes by main::spawn_stats_refresh_task.
            stats: ttl_cache(1, Duration::from_secs(900)),
            // Bounded by total payload bytes (64 MiB) so large monorepo bodies
            // cannot balloon process RSS while hot saved reports serve from RAM.
            report_json: Cache::builder()
                .max_capacity(64 * 1024 * 1024)
                .weigher(|_key: &String, value: &Bytes| value.len().min(u32::MAX as usize) as u32)
                .time_to_live(Duration::from_secs(900))
                .eviction_policy(EvictionPolicy::lru())
                .build(),
            seo_report: ttl_cache(5_000, Duration::from_secs(3_600)),
            seo_recent: ttl_cache(100, Duration::from_secs(60)),
            seo_popular: ttl_cache(100, Duration::from_secs(300)),
            seo_monoliths: ttl_cache(100, Duration::from_secs(900)),
            seo_sitemap: ttl_cache(1, Duration::from_secs(900)),
            seo_languages: ttl_cache(1, Duration::from_secs(900)),
            seo_language: ttl_cache(200, Duration::from_secs(900)),
            // Sized for the whole report inventory: a miss is a multi-second
            // scan, and peers only change when new reports land.
            seo_related: ttl_cache(10_000, Duration::from_secs(21_600)),
            seo_repo_history: ttl_cache(5_000, Duration::from_secs(3_600)),
            og_png: ttl_cache(500, Duration::from_secs(86_400)),
            og_latest: ttl_cache(500, Duration::from_secs(300)),
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
