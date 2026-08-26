use std::time::Duration;

use bytes::Bytes;
use moka::{future::Cache, policy::EvictionPolicy};

use crate::{
    models::GrowthStats,
    seo::{RelatedList, SeoList, SeoReport, SitemapEntry},
};

#[derive(Clone)]
pub struct AppCaches {
    pub stats: Cache<String, GrowthStats>,
    pub seo_report: Cache<String, SeoReport>,
    pub seo_recent: Cache<String, SeoList>,
    pub seo_popular: Cache<String, SeoList>,
    pub seo_monoliths: Cache<String, SeoList>,
    pub seo_sitemap: Cache<String, Vec<SitemapEntry>>,
    pub seo_related: Cache<String, RelatedList>,
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
    pub fn new() -> Self {
        Self {
            stats: ttl_cache(1, Duration::from_secs(60)),
            seo_report: ttl_cache(5_000, Duration::from_secs(3_600)),
            seo_recent: ttl_cache(100, Duration::from_secs(60)),
            seo_popular: ttl_cache(100, Duration::from_secs(300)),
            seo_monoliths: ttl_cache(100, Duration::from_secs(900)),
            seo_sitemap: ttl_cache(1, Duration::from_secs(900)),
            seo_related: ttl_cache(5_000, Duration::from_secs(3_600)),
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
