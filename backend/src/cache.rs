use std::time::Duration;

use moka::{future::Cache, policy::EvictionPolicy};

use crate::{
    models::GrowthStats,
    seo::{SeoList, SeoReport, SitemapEntry},
};

#[derive(Clone)]
pub struct AppCaches {
    pub stats: Cache<String, GrowthStats>,
    pub seo_report: Cache<String, SeoReport>,
    pub seo_recent: Cache<String, SeoList>,
    pub seo_popular: Cache<String, SeoList>,
    pub seo_monoliths: Cache<String, SeoList>,
    pub seo_sitemap: Cache<String, Vec<SitemapEntry>>,
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
