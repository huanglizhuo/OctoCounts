use std::{collections::HashSet, sync::Arc, time::Duration};

use reqwest::{Client, StatusCode};
use serde::Serialize;
use tokio::sync::mpsc;

use crate::{models::Report, seo};

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

    /// Queue the canonical report URL for submission. Never blocks the caller.
    pub fn submit_report(&self, report: &Report) {
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
}

/// Only canonical https URLs on the configured host are submitted; query
/// variants and fragments are never eligible.
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
        && url.path().len() > 1
}

async fn run_worker(
    config: Arc<IndexNowConfig>,
    client: Client,
    mut receiver: mpsc::UnboundedReceiver<String>,
) {
    let mut pending: Vec<String> = Vec::new();
    let mut pending_set: HashSet<String> = HashSet::new();

    loop {
        match tokio::time::timeout(config.flush_interval, receiver.recv()).await {
            Ok(Some(url)) => {
                if pending_set.insert(url.clone()) {
                    pending.push(url);
                }
                if pending.len() >= config.batch_size {
                    flush(&config, &client, &mut pending, &mut pending_set).await;
                }
            }
            Ok(None) => {
                flush(&config, &client, &mut pending, &mut pending_set).await;
                break;
            }
            Err(_) => flush(&config, &client, &mut pending, &mut pending_set).await,
        }
    }
}

async fn flush(
    config: &IndexNowConfig,
    client: &Client,
    pending: &mut Vec<String>,
    pending_set: &mut HashSet<String>,
) {
    if pending.is_empty() {
        return;
    }
    let urls = std::mem::take(pending);
    pending_set.clear();

    if config.dry_run {
        tracing::info!(?urls, "IndexNow dry-run: would submit batch");
        return;
    }

    if let Err(error) = post_batch(client, config, &urls).await {
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
    use axum::{extract::State, routing::post, Json, Router};
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
            },
            ref_name: "main".to_string(),
            commit_sha: "abc123".to_string(),
            generated_at: Utc::now(),
            duration_ms: 42,
            cached: false,
            tokei_version: "tokei-test".to_string(),
            analysis_key: "tokei-test:default".to_string(),
            analysis_options: AnalysisOptions::default(),
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
                files: 1,
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
        assert!(!is_eligible_url(&config, "https://octocounts.com/"));
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
    async fn submit_skips_query_variants() {
        let (endpoint, requests) = start_mock(|_| StatusCode::OK).await;
        let service = IndexNowService::start(test_config(endpoint)).unwrap();

        service.submit("https://octocounts.com/github/octo/count?ref=main".to_string());

        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(request_count(&requests), 0);
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
