use std::{collections::HashSet, sync::Arc, time::Duration};

use reqwest::{Client, StatusCode};
use serde::Serialize;
use tokio::sync::mpsc;

use crate::{
    models::{AnalysisOptions, Report, RepositoryProvider},
    seo,
};

pub const DEFAULT_HOST: &str = "octocounts.com";
pub const DEFAULT_ENDPOINT: &str = "https://api.indexnow.org/indexnow";

#[derive(Debug, Clone)]
pub struct IndexNowConfig {
    pub enabled: bool,
    pub key: Option<String>,
    pub host: String,
    pub key_location: Option<String>,
    pub endpoint: String,
    pub batch_size: usize,
    pub max_retries: usize,
    pub timeout: Duration,
    pub flush_interval: Duration,
    pub retry_base_delay: Duration,
    pub dry_run: bool,
}

impl Default for IndexNowConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            key: None,
            host: DEFAULT_HOST.to_string(),
            key_location: None,
            endpoint: DEFAULT_ENDPOINT.to_string(),
            batch_size: 100,
            max_retries: 3,
            timeout: Duration::from_secs(10),
            flush_interval: Duration::from_secs(2),
            retry_base_delay: Duration::from_millis(500),
            dry_run: false,
        }
    }
}

impl IndexNowConfig {
    pub fn resolved_key_location(&self) -> Option<String> {
        if let Some(location) = self.key_location.as_deref() {
            return Some(location.to_string());
        }
        let key = self.key.as_deref()?;
        Some(format!("https://{}/{key}.txt", self.host))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Submission<'a> {
    host: &'a str,
    key: &'a str,
    key_location: String,
    url_list: &'a [String],
}

/// Fire-and-forget IndexNow submitter. All work happens on a background
/// worker; failures are logged and never propagated to callers.
#[derive(Clone)]
pub struct IndexNowService {
    config: Arc<IndexNowConfig>,
    sender: mpsc::UnboundedSender<String>,
}

impl IndexNowService {
    pub fn start(config: IndexNowConfig) -> Option<Self> {
        if !config.enabled {
            return None;
        }
        if config.resolved_key_location().is_none() {
            tracing::warn!(
                "INDEXNOW_ENABLED is true but INDEXNOW_KEY is not set; submissions disabled"
            );
            return None;
        }
        let client = match Client::builder().timeout(config.timeout).build() {
            Ok(client) => client,
            Err(error) => {
                tracing::warn!(%error, "failed to build IndexNow HTTP client; submissions disabled");
                return None;
            }
        };

        let config = Arc::new(config);
        let (sender, receiver) = mpsc::unbounded_channel();
        tokio::spawn(run_worker(config.clone(), client, receiver));
        tracing::info!(
            host = %config.host,
            endpoint = %config.endpoint,
            batch_size = config.batch_size,
            max_retries = config.max_retries,
            dry_run = config.dry_run,
            "IndexNow submission service started"
        );
        Some(Self { config, sender })
    }

    /// Queue a report already confirmed as the store's latest public row.
    pub fn submit_report(&self, report: &Report) {
        if report.repository.provider != RepositoryProvider::GitHub
            || report.analysis_options != AnalysisOptions::canonical()
            || report.total.files < seo::MIN_INDEXABLE_REPORT_FILES
        {
            return;
        }
        let url = format!("https://{}{}", self.config.host, seo::public_path(report));
        self.submit(url);
    }

    fn submit(&self, url: String) {
        if !is_eligible_url(&self.config, &url) {
            tracing::warn!(%url, "skipping non-canonical IndexNow URL");
            return;
        }
        if self.sender.send(url).is_err() {
            tracing::warn!("IndexNow worker is unavailable; dropping URL submission");
        }
    }

    /// The site whose pages the backend announces, derived from the same
    /// host the submissions name.
    pub fn site_base(&self) -> String {
        format!("https://{}", self.config.host)
    }

    /// Queues every URL of the site's core sitemaps: the static pages, the
    /// curated comparisons and the language leaderboards.
    ///
    /// A finished report already announces itself through `submit_report`,
    /// but these three groups change only with a deploy, and nothing told
    /// IndexNow about a deploy: the runbook asked for a manual `--core` run
    /// after each release. The list is read from the site's own sitemaps so
    /// the edge remains the single place that decides what is indexable. A
    /// sitemap that cannot be read fails the pass, which is then retried on
    /// the next loop instead of being recorded as done.
    pub async fn submit_core_urls(&self) -> anyhow::Result<usize> {
        let client = Client::builder().timeout(self.config.timeout).build()?;
        let base = self.site_base();
        self.submit_sitemaps(&client, &base).await
    }

    /// `submit_core_urls` with the HTTP client and site base supplied, so it
    /// can be exercised against a local server.
    pub async fn submit_sitemaps(&self, client: &Client, site_base: &str) -> anyhow::Result<usize> {
        let mut submitted = 0usize;
        for path in CORE_SITEMAPS {
            let response = client.get(format!("{site_base}{path}")).send().await?;
            let status = response.status();
            if !status.is_success() {
                anyhow::bail!("sitemap {path} answered {status}");
            }
            let body = response.text().await?;
            if body.len() > MAX_CORE_SITEMAP_BYTES {
                anyhow::bail!("sitemap {path} is larger than {MAX_CORE_SITEMAP_BYTES} bytes");
            }
            for loc in sitemap_locs(&body) {
                // `submit` drops anything that is not a canonical URL on the
                // configured host, so a foreign or variant URL in a sitemap
                // never reaches IndexNow.
                self.submit(loc);
                submitted += 1;
            }
        }
        Ok(submitted)
    }
}

/// The sitemaps whose URLs change only with a deploy.
const CORE_SITEMAPS: [&str; 3] = [
    "/sitemap-static.xml",
    "/sitemap-compare.xml",
    "/sitemap-languages.xml",
];

/// The three core sitemaps hold a few hundred short URLs. Anything larger is
/// not one of them.
const MAX_CORE_SITEMAP_BYTES: usize = 2_000_000;

/// `<loc>` values of a sitemap body, XML-unescaped and whitespace-trimmed.
/// Sitemap XML escapes only the few characters below, so a small unescape is
/// enough; there is no entity handling to get wrong.
fn sitemap_locs(body: &str) -> impl Iterator<Item = String> + '_ {
    body.match_indices("<loc>").map(|(start, _)| {
        let rest = &body[start + "<loc>".len()..];
        let end = rest.find("</loc>").unwrap_or(rest.len());
        rest[..end]
            .trim()
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
    })
}

/// Only canonical https URLs on the configured host are submitted; query
/// variants and fragments are never eligible. The homepage is eligible: the
/// core sitemap pass announces it like every other page.
fn is_eligible_url(config: &IndexNowConfig, raw: &str) -> bool {
    let Ok(url) = url::Url::parse(raw) else {
        return false;
    };
    url.scheme() == "https"
        && url
            .host_str()
            .map(|host| host.eq_ignore_ascii_case(&config.host))
            == Some(true)
        && url.query().is_none()
        && url.fragment().is_none()
        && !url.path().is_empty()
}

async fn run_worker(
    config: Arc<IndexNowConfig>,
    client: Client,
    mut receiver: mpsc::UnboundedReceiver<String>,
) {
    while let Some(first) = receiver.recv().await {
        let deadline = tokio::time::Instant::now() + config.flush_interval;
        let mut pending = vec![first.clone()];
        let mut seen = HashSet::from([first]);
        while pending.len() < config.batch_size && tokio::time::Instant::now() < deadline {
            match tokio::time::timeout_at(deadline, receiver.recv()).await {
                Ok(Some(url)) => {
                    if seen.insert(url.clone()) {
                        pending.push(url);
                    }
                }
                Ok(None) | Err(_) => break,
            }
        }
        flush(&config, &client, &pending).await;
    }
}

async fn flush(config: &IndexNowConfig, client: &Client, urls: &[String]) {
    if config.dry_run {
        tracing::info!(?urls, "IndexNow dry-run: would submit batch");
        return;
    }

    if let Err(error) = post_batch(client, config, urls).await {
        tracing::warn!(%error, urls = urls.len(), "IndexNow batch submission failed; dropping batch");
    }
}

async fn post_batch(
    client: &Client,
    config: &IndexNowConfig,
    urls: &[String],
) -> anyhow::Result<()> {
    let payload = Submission {
        host: &config.host,
        key: config.key.as_deref().unwrap_or_default(),
        key_location: config.resolved_key_location().unwrap_or_default(),
        url_list: urls,
    };

    let mut attempt = 0usize;
    loop {
        let result = client.post(&config.endpoint).json(&payload).send().await;
        let (retryable, failure) = match &result {
            Ok(response) => {
                let status = response.status();
                if status.is_success() {
                    return Ok(());
                }
                (
                    status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS,
                    format!("endpoint returned {status}"),
                )
            }
            Err(error) => (true, format!("request failed: {error}")),
        };

        if !retryable || attempt >= config.max_retries {
            anyhow::bail!("IndexNow submission failed: {failure}");
        }

        attempt += 1;
        let delay = config.retry_base_delay * 2u32.pow((attempt - 1) as u32);
        tracing::debug!(%failure, attempt, "retrying IndexNow submission");
        tokio::time::sleep(delay).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        AnalysisOptions, LanguageReport, LanguageStats, Report, Repository, RepositoryProvider,
    };
    use axum::{extract::State, response::IntoResponse, routing::post, Json, Router};
    use chrono::Utc;
    use std::sync::Mutex;

    fn test_config(endpoint: String) -> IndexNowConfig {
        IndexNowConfig {
            enabled: true,
            key: Some("test-key".to_string()),
            endpoint,
            flush_interval: Duration::from_millis(50),
            retry_base_delay: Duration::from_millis(5),
            ..IndexNowConfig::default()
        }
    }

    #[derive(Clone)]
    struct MockState {
        requests: Arc<Mutex<Vec<serde_json::Value>>>,
        respond: Arc<dyn Fn(usize) -> StatusCode + Send + Sync>,
    }

    async fn mock_handler(
        State(state): State<MockState>,
        Json(payload): Json<serde_json::Value>,
    ) -> StatusCode {
        let mut requests = state.requests.lock().unwrap();
        let call = requests.len();
        requests.push(payload);
        (state.respond)(call)
    }

    async fn start_mock(
        respond: impl Fn(usize) -> StatusCode + Send + Sync + 'static,
    ) -> (String, Arc<Mutex<Vec<serde_json::Value>>>) {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let state = MockState {
            requests: requests.clone(),
            respond: Arc::new(respond),
        };
        let app = Router::new()
            .route("/indexnow", post(mock_handler))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{addr}/indexnow"), requests)
    }

    async fn wait_for_requests(requests: &Arc<Mutex<Vec<serde_json::Value>>>, count: usize) {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            if requests.lock().unwrap().len() >= count {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "timed out waiting for {count} IndexNow requests"
            );
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    fn request_count(requests: &Arc<Mutex<Vec<serde_json::Value>>>) -> usize {
        requests.lock().unwrap().len()
    }

    fn test_report() -> Report {
        Report {
            id: "report-indexnow".to_string(),
            repository: Repository {
                provider: RepositoryProvider::GitHub,
                owner: "octo".to_string(),
                name: "count".to_string(),
                html_url: "https://github.com/octo/count".to_string(),
                stars: None,
            },
            ref_name: "main".to_string(),
            commit_sha: "abc123".to_string(),
            generated_at: Utc::now(),
            duration_ms: 42,
            cached: false,
            tokei_version: "tokei-test".to_string(),
            analysis_key: "tokei-test:default".to_string(),
            analysis_options: AnalysisOptions::canonical(),
            counting_policy: None,
            languages: vec![LanguageReport {
                name: "Rust".to_string(),
                stats: LanguageStats {
                    files: 1,
                    lines: 110,
                    code: 100,
                    comments: 7,
                    blanks: 3,
                },
                children: Vec::new(),
            }],
            total: LanguageStats {
                files: 5,
                lines: 110,
                code: 100,
                comments: 7,
                blanks: 3,
            },
        }
    }

    #[test]
    fn eligible_url_filter_accepts_only_canonical_urls() {
        let config = IndexNowConfig::default();

        assert!(is_eligible_url(
            &config,
            "https://octocounts.com/github/octo/count"
        ));
        assert!(!is_eligible_url(
            &config,
            "https://octocounts.com/github/octo/count?utm_source=newsletter"
        ));
        assert!(!is_eligible_url(
            &config,
            "https://octocounts.com/github/octo/count#lines"
        ));
        assert!(!is_eligible_url(
            &config,
            "https://api.octocounts.com/github/octo/count"
        ));
        assert!(!is_eligible_url(
            &config,
            "http://octocounts.com/github/octo/count"
        ));
        assert!(is_eligible_url(&config, "https://octocounts.com/"));
        assert!(is_eligible_url(&config, "https://octocounts.com"));
        assert!(!is_eligible_url(&config, "not a url"));
    }

    #[test]
    fn key_location_defaults_to_key_file_on_host() {
        let config = IndexNowConfig {
            key: Some("abc123".to_string()),
            ..IndexNowConfig::default()
        };
        assert_eq!(
            config.resolved_key_location().as_deref(),
            Some("https://octocounts.com/abc123.txt")
        );

        let explicit = IndexNowConfig {
            key_location: Some("https://octocounts.com/custom.txt".to_string()),
            ..config
        };
        assert_eq!(
            explicit.resolved_key_location().as_deref(),
            Some("https://octocounts.com/custom.txt")
        );

        assert!(IndexNowConfig::default().resolved_key_location().is_none());
    }

    #[test]
    fn start_returns_none_when_disabled_or_key_missing() {
        assert!(IndexNowService::start(IndexNowConfig::default()).is_none());
        let keyless = IndexNowConfig {
            enabled: true,
            ..IndexNowConfig::default()
        };
        assert!(IndexNowService::start(keyless).is_none());
    }

    #[tokio::test]
    async fn batches_and_deduplicates_urls() {
        let (endpoint, requests) = start_mock(|_| StatusCode::OK).await;
        let service = IndexNowService::start(test_config(endpoint)).unwrap();

        service.submit("https://octocounts.com/github/octo/count".to_string());
        service.submit("https://octocounts.com/github/octo/count".to_string());
        service.submit("https://octocounts.com/github/rust-lang/rust".to_string());

        wait_for_requests(&requests, 1).await;
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert_eq!(request_count(&requests), 1);

        let payload = requests.lock().unwrap()[0].clone();
        assert_eq!(payload["host"], "octocounts.com");
        assert_eq!(payload["key"], "test-key");
        assert_eq!(
            payload["keyLocation"],
            "https://octocounts.com/test-key.txt"
        );
        assert_eq!(
            payload["urlList"],
            serde_json::json!([
                "https://octocounts.com/github/octo/count",
                "https://octocounts.com/github/rust-lang/rust"
            ])
        );
    }

    #[tokio::test]
    async fn duplicate_arrivals_do_not_postpone_the_first_flush() {
        let (endpoint, requests) = start_mock(|_| StatusCode::OK).await;
        let service = IndexNowService::start(test_config(endpoint)).unwrap();
        let producer = tokio::spawn(async move {
            loop {
                service.submit("https://octocounts.com/github/octo/count".into());
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        });
        wait_for_requests(&requests, 1).await;
        producer.abort();
        assert_eq!(
            requests.lock().unwrap()[0]["urlList"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn flushes_immediately_when_batch_size_is_reached() {
        let (endpoint, requests) = start_mock(|_| StatusCode::OK).await;
        let config = IndexNowConfig {
            batch_size: 2,
            flush_interval: Duration::from_secs(60),
            ..test_config(endpoint)
        };
        let service = IndexNowService::start(config).unwrap();

        service.submit("https://octocounts.com/github/octo/a".to_string());
        service.submit("https://octocounts.com/github/octo/b".to_string());

        wait_for_requests(&requests, 1).await;
        let payload = requests.lock().unwrap()[0].clone();
        assert_eq!(payload["urlList"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn submit_report_builds_canonical_url() {
        let (endpoint, requests) = start_mock(|_| StatusCode::OK).await;
        let service = IndexNowService::start(test_config(endpoint)).unwrap();

        service.submit_report(&test_report());

        wait_for_requests(&requests, 1).await;
        let payload = requests.lock().unwrap()[0].clone();
        assert_eq!(
            payload["urlList"],
            serde_json::json!(["https://octocounts.com/github/octo/count"])
        );
    }

    #[tokio::test]
    async fn submit_report_skips_nonindexable_reports() {
        let (endpoint, requests) = start_mock(|_| StatusCode::OK).await;
        let service = IndexNowService::start(test_config(endpoint)).unwrap();
        let mut report = test_report();
        report.total.files = 4;
        service.submit_report(&report);
        report.total.files = 5;
        report.analysis_options.include_tests = true;
        service.submit_report(&report);
        report.analysis_options = AnalysisOptions::canonical();
        report.repository.provider = RepositoryProvider::GitLab;
        service.submit_report(&report);
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(request_count(&requests), 0);
    }

    #[tokio::test]
    async fn submit_skips_query_variants() {
        let (endpoint, requests) = start_mock(|_| StatusCode::OK).await;
        let service = IndexNowService::start(test_config(endpoint)).unwrap();

        service.submit("https://octocounts.com/github/octo/count?ref=main".to_string());

        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(request_count(&requests), 0);
    }

    /// One server answers both the sitemaps and IndexNow.
    async fn start_site_mock(
        sitemaps: std::collections::HashMap<&'static str, (&'static str, StatusCode)>,
    ) -> (String, Arc<Mutex<Vec<serde_json::Value>>>) {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let state = MockState {
            requests: requests.clone(),
            respond: Arc::new(|_| StatusCode::OK),
        };
        let sitemaps = std::sync::Arc::new(sitemaps);
        let app = Router::new()
            .route("/indexnow", post(mock_handler))
            .fallback(move |uri: axum::http::Uri| {
                let sitemaps = sitemaps.clone();
                async move {
                    match sitemaps.get(uri.path()) {
                        Some((body, status)) => {
                            (*status, [("content-type", "application/xml")], *body).into_response()
                        }
                        None => StatusCode::NOT_FOUND.into_response(),
                    }
                }
            })
            .with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{addr}"), requests)
    }

    fn submitted_urls(requests: &Arc<Mutex<Vec<serde_json::Value>>>) -> Vec<String> {
        let mut urls = Vec::new();
        for request in requests.lock().unwrap().iter() {
            urls.extend(
                request["urlList"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|value| value.as_str().unwrap().to_string()),
            );
        }
        urls.sort();
        urls
    }

    /// The pass submits every URL of the three core sitemaps, once each, and
    /// nothing that is not a canonical URL on the site.
    #[tokio::test]
    async fn core_pass_submits_every_core_sitemap_url() {
        // One mock answers IndexNow; another serves the sitemaps. The URLs in
        // those sitemaps name the service's configured host, which no server
        // has to answer for: IndexNow receives the names, nothing fetches them.
        let (endpoint, requests) = start_mock(|_| StatusCode::OK).await;
        let mut sitemaps = std::collections::HashMap::new();
        for (path, body) in [
            ("/sitemap-static.xml", "<urlset><url><loc>https://octocounts.com/</loc></url><url><loc>  https://octocounts.com/docs/a&amp;b </loc></url></urlset>"),
            ("/sitemap-compare.xml", "<urlset><url><loc>https://octocounts.com/compare/react-vs-vue</loc></url><url><loc>https://example.com/github/o/r</loc></url><url><loc>https://octocounts.com/github/o/r?ref=main</loc></url></urlset>"),
            ("/sitemap-languages.xml", "<urlset><url><loc>https://octocounts.com/languages</loc></url><url><loc>https://octocounts.com/languages/rust</loc></url></urlset>"),
        ] {
            sitemaps.insert(path, (body, StatusCode::OK));
        }
        let (site, site_requests) = start_site_mock(sitemaps).await;
        let service = IndexNowService::start(test_config(endpoint)).unwrap();
        assert_eq!(service.site_base(), "https://octocounts.com");

        let client = Client::new();
        let count = service.submit_sitemaps(&client, &site).await.unwrap();

        // Seven URLs were read; IndexNow receives the five canonical ones.
        assert_eq!(count, 7);
        wait_for_requests(&requests, 1).await;
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(
            submitted_urls(&requests),
            [
                "https://octocounts.com/".to_string(),
                "https://octocounts.com/compare/react-vs-vue".to_string(),
                "https://octocounts.com/docs/a&b".to_string(),
                "https://octocounts.com/languages".to_string(),
                "https://octocounts.com/languages/rust".to_string(),
            ]
        );
        let reads = site_requests.lock().unwrap().len();
        assert_eq!(reads, 0, "sitemap reads are not IndexNow posts");
    }

    /// A sitemap that is missing or unreadable fails the pass, so the caller
    /// does not record a day's work as done.
    #[tokio::test]
    async fn core_pass_fails_when_a_sitemap_is_unreadable() {
        let empty = std::collections::HashMap::new();
        let (site, requests) = start_site_mock(empty).await;
        let mut config = test_config(format!("{site}/indexnow"));
        config.host = site.trim_start_matches("http://").to_string();
        let service = IndexNowService::start(config).unwrap();
        let client = Client::new();
        let error = service
            .submit_sitemaps(&client, &site)
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("/sitemap-static.xml"), "{error}");
        assert!(error.contains("404"), "{error}");
        assert_eq!(request_count(&requests), 0);

        let mut sitemaps = std::collections::HashMap::new();
        sitemaps.insert(
            "/sitemap-static.xml",
            ("<urlset>", StatusCode::SERVICE_UNAVAILABLE),
        );
        let (site, requests) = start_site_mock(sitemaps).await;
        let mut config = test_config(format!("{site}/indexnow"));
        config.host = site.trim_start_matches("http://").to_string();
        let service = IndexNowService::start(config).unwrap();
        let error = service
            .submit_sitemaps(&client, &site)
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("503"), "{error}");
        assert_eq!(request_count(&requests), 0);

        // A body over the size cap is refused before it is parsed.
        let mut sitemaps = std::collections::HashMap::new();
        sitemaps.insert("/sitemap-static.xml", ("<urlset>", StatusCode::OK));
        sitemaps.insert("/sitemap-compare.xml", ("<loc>x</loc>", StatusCode::OK));
        sitemaps.insert(
            "/sitemap-languages.xml",
            (
                ("<urlset>".to_string() + &"x".repeat(MAX_CORE_SITEMAP_BYTES)).leak()
                    as &'static str,
                StatusCode::OK,
            ),
        );
        let (site, requests) = start_site_mock(sitemaps).await;
        let mut config = test_config(format!("{site}/indexnow"));
        config.host = site.trim_start_matches("http://").to_string();
        let service = IndexNowService::start(config).unwrap();
        let error = service
            .submit_sitemaps(&client, &site)
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("larger than"), "{error}");
        assert_eq!(request_count(&requests), 0);
    }

    #[test]
    fn sitemap_locs_are_unescaped_and_trimmed() {
        let body = "<urlset><url><loc> https://octocounts.com/a&amp;b </loc><lastmod>x</lastmod></url><url><loc>https://octocounts.com/&lt;c&gt;&quot;d&quot;</loc></url></urlset>";
        let locs: Vec<String> = sitemap_locs(body).collect();
        assert_eq!(
            locs,
            [
                "https://octocounts.com/a&b",
                "https://octocounts.com/<c>\"d\""
            ]
        );
        assert_eq!(sitemap_locs("<urlset></urlset>").count(), 0);
    }

    #[tokio::test]
    async fn retries_with_backoff_until_success() {
        let (endpoint, requests) = start_mock(|call| {
            if call < 2 {
                StatusCode::INTERNAL_SERVER_ERROR
            } else {
                StatusCode::OK
            }
        })
        .await;
        let service = IndexNowService::start(test_config(endpoint)).unwrap();

        service.submit("https://octocounts.com/github/octo/count".to_string());

        wait_for_requests(&requests, 3).await;
        assert_eq!(request_count(&requests), 3);
    }

    #[tokio::test]
    async fn gives_up_after_bounded_retries() {
        let (endpoint, requests) = start_mock(|_| StatusCode::INTERNAL_SERVER_ERROR).await;
        let config = IndexNowConfig {
            max_retries: 2,
            ..test_config(endpoint)
        };
        let service = IndexNowService::start(config).unwrap();

        service.submit("https://octocounts.com/github/octo/count".to_string());

        wait_for_requests(&requests, 3).await;
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(request_count(&requests), 3);
    }

    #[tokio::test]
    async fn does_not_retry_client_errors() {
        let (endpoint, requests) = start_mock(|_| StatusCode::BAD_REQUEST).await;
        let service = IndexNowService::start(test_config(endpoint)).unwrap();

        service.submit("https://octocounts.com/github/octo/count".to_string());

        wait_for_requests(&requests, 1).await;
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(request_count(&requests), 1);
    }

    #[tokio::test]
    async fn dry_run_sends_no_http_requests() {
        let (endpoint, requests) = start_mock(|_| StatusCode::OK).await;
        let config = IndexNowConfig {
            dry_run: true,
            ..test_config(endpoint)
        };
        let service = IndexNowService::start(config).unwrap();

        service.submit("https://octocounts.com/github/octo/count".to_string());

        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(request_count(&requests), 0);
    }
}
