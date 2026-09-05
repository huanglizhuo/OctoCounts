use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

use axum::http::HeaderMap;

/// A refilling token bucket per key, kept in a bounded map so idle addresses
/// are forgotten instead of pinning memory forever.
///
/// In-house rather than tower-governor: the limits needed are two fixed
/// per-IP buckets, so a dependency would buy nothing but a crate to keep
/// current. The map is a plain `Mutex<HashMap>` swept lazily: each check
/// re-inserts/refreshes its key's `last_seen`, and the occasional sweep drops
/// keys idle past the window, which bounds the map at (roughly) the distinct
/// IPs seen recently.
#[derive(Clone)]
pub struct RateLimiter {
    capacity: f64,
    refill_per_sec: f64,
    /// Buckets plus the last sweep time, under one lock. Cheap: a check is a
    /// hash lookup and some float math. Shared behind an `Arc` so cloned
    /// limiters (one per `AppState` clone) still enforce one shared bucket.
    buckets: Arc<Mutex<(Instant, HashMap<IpAddr, Bucket>)>>,
}

struct Bucket {
    tokens: f64,
    updated: Instant,
}

/// How long a key may sit untouched before a sweep may drop it. Generous
/// relative to every window the limiters here enforce, so dropping a bucket
/// only ever happens for genuinely idle addresses.
const IDLE_RETENTION: Duration = Duration::from_secs(600);

/// Sweep at most this often; the sweep is O(map) under the lock, so it must
/// not run on every check.
const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

impl RateLimiter {
    /// `capacity` tokens burst, refilled at `per_minute / 60` per second.
    pub fn per_minute(capacity: u64, per_minute: u64) -> Self {
        Self {
            capacity: capacity as f64,
            refill_per_sec: per_minute as f64 / 60.0,
            buckets: Arc::new(Mutex::new((Instant::now(), HashMap::new()))),
        }
    }

    /// Spends one token for `key`. `Err(seconds)` is how long the caller
    /// should wait before trying again.
    pub fn check(&self, key: &IpAddr) -> Result<(), u64> {
        let mut state = self.buckets.lock().unwrap();
        if state.0.elapsed() >= SWEEP_INTERVAL {
            state.1.retain(|_, bucket| bucket.updated.elapsed() < IDLE_RETENTION);
            state.0 = Instant::now();
        }

        let capacity = self.capacity;
        let refill = self.refill_per_sec;
        let bucket = state
            .1
            .entry(*key)
            .or_insert_with(|| Bucket::full(capacity));
        let now = Instant::now();
        bucket.tokens =
            (bucket.tokens + now.duration_since(bucket.updated).as_secs_f64() * refill)
                .min(capacity);
        bucket.updated = now;

        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            Ok(())
        } else {
            let seconds = ((1.0 - bucket.tokens) / refill).ceil() as u64;
            Err(seconds.max(1))
        }
    }
}

impl Bucket {
    fn full(capacity: f64) -> Self {
        Self {
            tokens: capacity,
            updated: Instant::now(),
        }
    }
}

/// The two knobs `/api/analyze` is limited by.
#[derive(Clone)]
pub struct RateLimits {
    /// The everyday analyze limit: 10 requests/minute with a burst of 5.
    pub analyze: RateLimiter,
    /// `force_refresh` bypasses the report cache and re-downloads a whole
    /// archive, so it gets a quota of its own: 2 per minute.
    pub force_refresh: RateLimiter,
    /// Both the OAuth `start` redirect and the paste-a-token endpoint accept
    /// unauthenticated input and trigger outbound GitHub API calls, so they
    /// share one modest quota to bound how much abuse a single IP can push
    /// through them.
    pub github_auth: RateLimiter,
}

impl RateLimits {
    pub fn new() -> Self {
        Self {
            analyze: RateLimiter::per_minute(5, 10),
            force_refresh: RateLimiter::per_minute(2, 2),
            github_auth: RateLimiter::per_minute(3, 5),
        }
    }
}

impl Default for RateLimits {
    fn default() -> Self {
        Self::new()
    }
}

/// `TRUST_PROXY`: set to 1/true only when a trusted reverse proxy fronts the
/// service and overwrites (not appends to) `X-Forwarded-For`.
fn trust_proxy() -> bool {
    static TRUST_PROXY: OnceLock<bool> = OnceLock::new();
    *TRUST_PROXY.get_or_init(|| {
        std::env::var("TRUST_PROXY")
            .map(|value| {
                matches!(
                    value.to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                )
            })
            .unwrap_or(false)
    })
}

/// The client IP a rate-limit decision should be keyed on.
///
/// `X-Forwarded-For` is only consulted when `TRUST_PROXY` says the socket
/// address is a proxy we control; otherwise the header is attacker-supplied
/// and trusting it would make the limit trivially bypassable.
pub fn client_ip(headers: &HeaderMap, remote: Option<SocketAddr>) -> Option<IpAddr> {
    if trust_proxy() {
        if let Some(forwarded) = headers
            .get("x-forwarded-for")
            .and_then(|value| value.to_str().ok())
        {
            // The first entry is the client the proxy saw; the rest is
            // whatever the client claimed before that.
            if let Some(ip) = forwarded
                .split(',')
                .next()
                .map(str::trim)
                .and_then(|value| value.parse().ok())
            {
                return Some(ip);
            }
        }
    }
    remote.map(|addr| addr.ip())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn burst_capacity_is_granted_then_refills() {
        // 2 burst, 60/min refill — a full token every second.
        let limiter = RateLimiter::per_minute(2, 60);
        let ip: IpAddr = "127.0.0.1".parse().unwrap();

        assert!(limiter.check(&ip).is_ok());
        assert!(limiter.check(&ip).is_ok());
        let Err(wait) = limiter.check(&ip) else {
            panic!("third request within the burst must be refused");
        };
        assert_eq!(wait, 1);
    }

    #[test]
    fn independent_keys_do_not_share_a_bucket() {
        let limiter = RateLimiter::per_minute(1, 1);
        let first: IpAddr = "127.0.0.1".parse().unwrap();
        let second: IpAddr = "127.0.0.2".parse().unwrap();

        assert!(limiter.check(&first).is_ok());
        assert!(limiter.check(&second).is_ok());
        assert!(limiter.check(&first).is_err());
    }

    #[test]
    fn without_a_header_the_socket_address_decides() {
        let remote: SocketAddr = "10.0.0.1:5000".parse().unwrap();
        assert_eq!(client_ip(&HeaderMap::new(), Some(remote)), Some(remote.ip()));
        assert_eq!(client_ip(&HeaderMap::new(), None), None);
    }
}
