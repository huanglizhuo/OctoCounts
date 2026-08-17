use std::time::Duration;

use futures::TryStreamExt;
use moka::{future::Cache, policy::EvictionPolicy};
use reqwest::{header, Client, StatusCode};
use serde::Deserialize;
use thiserror::Error;
use tokio_util::io::{StreamReader, SyncIoBridge};
use url::Url;

use crate::models::{RepoRef, RepositoryProvider};

/// How long a resolved `ref -> commit sha` mapping stays trustworthy.
///
/// Branch refs move. Without an expiry the entry for `main` is pinned to the
/// first commit we ever saw, so every later request replays a stale report and
/// only `force_refresh` can break the loop. Tags and commit shas are immutable,
/// but they are keyed the same way and re-resolving them is one cheap API call,
/// so a single short TTL covers both. 60s keeps the burst-protection value of
/// the cache (a page that fires several requests still resolves once) while
/// bounding staleness to something a user would not notice.
const REF_CACHE_TTL: Duration = Duration::from_secs(60);
const REF_CACHE_CAPACITY: u64 = 10_000;

const GRAPHQL_ENDPOINT: &str = "https://api.github.com/graphql";

/// One request for everything REST needs two for: visibility, canonical URL, the
/// default branch, and the commit the requested ref points at.
///
/// `object(expression:)` resolves the same grammar as
/// `GET /repos/{o}/{r}/commits/{ref}` — branch, tag or raw sha — and GitHub
/// peels annotated tags to their commit before returning, so `torvalds/linux`
/// at `v6.6` yields the same sha through both paths. It is skipped entirely
/// when no ref was requested, because the default branch's target is already in
/// hand.
const REF_QUERY: &str = "\
query($owner:String!,$name:String!,$expression:String!,$hasRef:Boolean!){\
repository(owner:$owner,name:$name){\
isPrivate url stargazerCount \
defaultBranchRef{name target{oid}} \
object(expression:$expression)@include(if:$hasRef){__typename oid}}}";

#[derive(Debug, Error)]
pub enum GitHubError {
    #[error("only public github.com and gitlab.com repository URLs are supported")]
    InvalidUrl,
    #[error("repository was not found or is not public")]
    NotFound,
    #[error("private repositories are not supported")]
    PrivateRepo,
    #[error("GitHub API rate limit was reached")]
    RateLimited,
    #[error("repository archive is too large")]
    TooLarge,
    #[error("requested ref was not found")]
    RefNotFound,
    /// GitHub/GitLab itself is failing (5xx or timeouts that survive retries).
    /// Distinct from [`GitHubError::Request`] so clients can tell an upstream
    /// outage apart from a bug in this service.
    #[error("the repository host is currently unavailable; please try again later")]
    UpstreamUnavailable,
    #[error("GitHub request failed")]
    Request(#[from] reqwest::Error),
}

/// Backoff schedule for upstream GETs. Short by design: this rides out
/// transient 5xx blips without stretching an analysis minutes past the
/// client's patience. Exhausting the schedule turns 5xx/timeout into
/// [`GitHubError::UpstreamUnavailable`] instead of a misleading not-found.
const UPSTREAM_RETRY_DELAYS: [Duration; 2] = [Duration::from_millis(500), Duration::from_millis(1500)];

#[derive(Clone)]
pub struct GitHubClient {
    client: Client,
    ref_cache: Cache<(String, Option<String>), RepoRef>,
    stars_cache: Cache<(RepositoryProvider, String, String), Option<u64>>,
    /// GitHub's GraphQL API rejects unauthenticated requests outright, and
    /// `GITHUB_TOKEN` is optional in this deployment, so the fast path is only
    /// attempted when there is a token to attempt it with.
    has_token: bool,
}

#[derive(Debug, Deserialize)]
struct RepoResponse {
    default_branch: String,
    html_url: String,
    private: bool,
    #[serde(default)]
    stargazers_count: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct CommitResponse {
    sha: String,
}

#[derive(Debug, Deserialize)]
struct GitLabProjectResponse {
    id: u64,
    path_with_namespace: String,
    default_branch: String,
    web_url: String,
    visibility: String,
    #[serde(default)]
    star_count: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct GitLabCommitResponse {
    id: String,
}

#[derive(Debug, Deserialize)]
struct GraphQlResponse {
    #[serde(default)]
    data: Option<GraphQlData>,
    #[serde(default)]
    errors: Vec<GraphQlError>,
}

#[derive(Debug, Deserialize)]
struct GraphQlData {
    #[serde(default)]
    repository: Option<GraphQlRepository>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphQlRepository {
    is_private: bool,
    url: String,
    #[serde(default)]
    stargazer_count: Option<u64>,
    #[serde(default)]
    default_branch_ref: Option<GraphQlRef>,
    /// Absent when `hasRef` was false, null when the expression resolved to
    /// nothing.
    #[serde(default)]
    object: Option<GraphQlObject>,
}

#[derive(Debug, Deserialize)]
struct GraphQlRef {
    name: String,
    #[serde(default)]
    target: Option<GraphQlOid>,
}

#[derive(Debug, Deserialize)]
struct GraphQlOid {
    oid: String,
}

#[derive(Debug, Deserialize)]
struct GraphQlObject {
    #[serde(rename = "__typename")]
    typename: String,
    oid: String,
}

#[derive(Debug, Deserialize)]
struct GraphQlError {
    #[serde(rename = "type", default)]
    error_type: Option<String>,
}

/// What a GraphQL response told us.
///
/// The third arm is the important one: GraphQL is an optimisation, not a
/// replacement. Anything this code does not positively recognise — an
/// unexpected object type, an error class it has no mapping for, a 500 — defers
/// to the REST path rather than guessing, so a change on GitHub's side degrades
/// to the old latency instead of to a wrong answer.
#[derive(Debug, PartialEq, Eq)]
enum GraphQlOutcome {
    Resolved {
        html_url: String,
        ref_name: String,
        stars: Option<u64>,
        commit_sha: String,
    },
    Failed(GraphQlFailure),
    Unusable,
}

/// The subset of [`GitHubError`] a GraphQL response can decide on its own.
/// Separate because `GitHubError` is not `PartialEq` (it wraps `reqwest::Error`)
/// and these outcomes need to be asserted on directly.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum GraphQlFailure {
    NotFound,
    PrivateRepo,
    RateLimited,
    RefNotFound,
}

impl From<GraphQlFailure> for GitHubError {
    fn from(failure: GraphQlFailure) -> Self {
        match failure {
            GraphQlFailure::NotFound => GitHubError::NotFound,
            GraphQlFailure::PrivateRepo => GitHubError::PrivateRepo,
            GraphQlFailure::RateLimited => GitHubError::RateLimited,
            GraphQlFailure::RefNotFound => GitHubError::RefNotFound,
        }
    }
}

/// Turns a GraphQL body into an outcome. Pure, so the mapping is testable
/// without a network.
fn interpret_graphql(response: GraphQlResponse, requested_ref: Option<&str>) -> GraphQlOutcome {
    let Some(repository) = response.data.and_then(|data| data.repository) else {
        return classify_graphql_errors(&response.errors);
    };

    if repository.is_private {
        return GraphQlOutcome::Failed(GraphQlFailure::PrivateRepo);
    }

    match requested_ref {
        Some(ref_name) => {
            let Some(object) = repository.object else {
                return GraphQlOutcome::Failed(GraphQlFailure::RefNotFound);
            };
            // GitHub resolves annotated tags to their commit, so anything else
            // is a shape this code has not seen; let REST answer it.
            if object.typename != "Commit" {
                return GraphQlOutcome::Unusable;
            }
            GraphQlOutcome::Resolved {
                html_url: repository.url,
                ref_name: ref_name.to_string(),
                stars: repository.stargazer_count,
                commit_sha: object.oid,
            }
        }
        None => {
            // An empty repository has no default branch; REST answers that with
            // a 404 from the commits endpoint, which maps to the same error.
            let Some(target) = repository
                .default_branch_ref
                .as_ref()
                .and_then(|branch| branch.target.as_ref())
            else {
                return GraphQlOutcome::Failed(GraphQlFailure::RefNotFound);
            };
            GraphQlOutcome::Resolved {
                html_url: repository.url.clone(),
                ref_name: repository
                    .default_branch_ref
                    .as_ref()
                    .map(|branch| branch.name.clone())
                    .unwrap_or_default(),
                stars: repository.stargazer_count,
                commit_sha: target.oid.clone(),
            }
        }
    }
}

fn classify_graphql_errors(errors: &[GraphQlError]) -> GraphQlOutcome {
    let has = |wanted: &str| {
        errors
            .iter()
            .any(|error| error.error_type.as_deref() == Some(wanted))
    };
    if has("RATE_LIMITED") {
        GraphQlOutcome::Failed(GraphQlFailure::RateLimited)
    } else if has("NOT_FOUND") {
        // Also what a private repository the token cannot see looks like —
        // exactly as REST reports it.
        GraphQlOutcome::Failed(GraphQlFailure::NotFound)
    } else {
        GraphQlOutcome::Unusable
    }
}

#[derive(Debug, Clone)]
struct RepoTarget {
    provider: RepositoryProvider,
    owner: String,
    repo: String,
    path: String,
}

fn build_ref_cache(ttl: Duration) -> Cache<(String, Option<String>), RepoRef> {
    Cache::builder()
        .max_capacity(REF_CACHE_CAPACITY)
        .time_to_live(ttl)
        .eviction_policy(EvictionPolicy::lru())
        .build()
}

/// Star counts drift continuously, so the refresh cache is short; failures
/// (None) are cached too, so an unreachable API does not become a request
/// amplifier.
fn build_stars_cache() -> Cache<(RepositoryProvider, String, String), Option<u64>> {
    Cache::builder()
        .max_capacity(REF_CACHE_CAPACITY)
        .time_to_live(Duration::from_secs(600))
        .eviction_policy(EvictionPolicy::lru())
        .build()
}

impl GitHubClient {
    pub fn new() -> anyhow::Result<Self> {
        Self::with_token(std::env::var("GITHUB_TOKEN").ok())
    }

    /// Explicit-token constructor so tests can build both a tokened and an
    /// untokened client without racing on the process environment.
    fn with_token(token: Option<String>) -> anyhow::Result<Self> {
        let mut headers = header::HeaderMap::new();
        headers.insert(
            header::USER_AGENT,
            header::HeaderValue::from_static("octocount-service/0.1"),
        );
        headers.insert(
            header::ACCEPT,
            header::HeaderValue::from_static("application/vnd.github+json"),
        );

        let token = token.filter(|token| !token.trim().is_empty());
        let has_token = token.is_some();
        if let Some(token) = token {
            let value = format!("Bearer {token}");
            headers.insert(
                header::AUTHORIZATION,
                header::HeaderValue::from_str(&value)?,
            );
        }

        Ok(Self {
            client: Client::builder().default_headers(headers).build()?,
            ref_cache: build_ref_cache(REF_CACHE_TTL),
            stars_cache: build_stars_cache(),
            has_token,
        })
    }

    /// GET with retries on transient upstream failures (5xx, connect and
    /// timeout errors). Non-retryable transport errors stay
    /// [`GitHubError::Request`]; everything retryable that survives the
    /// schedule becomes [`GitHubError::UpstreamUnavailable`].
    async fn get_with_retry(&self, url: &str) -> Result<reqwest::Response, GitHubError> {
        let mut delays = UPSTREAM_RETRY_DELAYS.iter();
        loop {
            let retry = match self.client.get(url).send().await {
                Ok(response) => {
                    if response.status().is_server_error() {
                        tracing::warn!(status = %response.status(), "upstream 5xx; retrying");
                        true
                    } else {
                        return Ok(response);
                    }
                }
                Err(error) => {
                    if error.is_timeout() || error.is_connect() {
                        tracing::warn!(%error, "upstream request failed; retrying");
                        true
                    } else {
                        return Err(GitHubError::Request(error));
                    }
                }
            };
            match delays.next() {
                Some(delay) => tokio::time::sleep(*delay).await,
                None if retry => return Err(GitHubError::UpstreamUnavailable),
                None => unreachable!("retry loop always returns when no delay remains"),
            }
        }
    }

    /// Current star count for a repository, cached briefly so share-card
    /// refreshes do not hammer the GitHub API. `None` means unknown (missing
    /// field, rate limit, or transport failure) — never zero.
    pub async fn repo_stars(
        &self,
        provider: &RepositoryProvider,
        owner: &str,
        repo: &str,
    ) -> Option<u64> {
        let cache_key = (provider.clone(), owner.to_string(), repo.to_string());
        if let Some(cached) = self.stars_cache.get(&cache_key).await {
            return cached;
        }

        let stars = match provider {
            RepositoryProvider::GitHub => {
                let url = format!("https://api.github.com/repos/{owner}/{repo}");
                let response = self.get_with_retry(&url).await.ok()?;
                if !matches!(response.status(), StatusCode::OK) {
                    return None;
                }
                response
                    .json::<RepoResponse>()
                    .await
                    .ok()?
                    .stargazers_count
            }
            RepositoryProvider::GitLab => {
                let full_path = format!("{owner}/{repo}");
                let path = urlencoding::encode(&full_path);
                let url = format!("https://gitlab.com/api/v4/projects/{path}");
                let response = self.get_with_retry(&url).await.ok()?;
                if !matches!(response.status(), StatusCode::OK) {
                    return None;
                }
                response
                    .json::<GitLabProjectResponse>()
                    .await
                    .ok()?
                    .star_count
            }
        };

        self.stars_cache.insert(cache_key, stars).await;
        stars
    }

    fn parse_repo_url(input: &str) -> Result<RepoTarget, GitHubError> {
        let mut normalized = input.trim().to_string();
        if normalized.starts_with("git@github.com:") {
            normalized = normalized.replacen("git@github.com:", "https://github.com/", 1);
        } else if normalized.starts_with("git@gitlab.com:") {
            normalized = normalized.replacen("git@gitlab.com:", "https://gitlab.com/", 1);
        }

        let url = Url::parse(&normalized).map_err(|_| GitHubError::InvalidUrl)?;
        let host = url.host_str().ok_or(GitHubError::InvalidUrl)?;

        let segments: Vec<String> = url
            .path_segments()
            .ok_or(GitHubError::InvalidUrl)?
            .filter(|part| !part.is_empty())
            .map(|part| part.trim_end_matches(".git").to_string())
            .collect();

        if segments.len() < 2 {
            return Err(GitHubError::InvalidUrl);
        }

        match host {
            "github.com" => {
                let owner = segments[0].clone();
                let repo = segments[1].clone();
                if owner.is_empty() || repo.is_empty() {
                    return Err(GitHubError::InvalidUrl);
                }
                Ok(RepoTarget {
                    provider: RepositoryProvider::GitHub,
                    path: format!("{owner}/{repo}"),
                    owner,
                    repo,
                })
            }
            "gitlab.com" => {
                let repo = segments.last().cloned().ok_or(GitHubError::InvalidUrl)?;
                let owner = segments[..segments.len() - 1].join("/");
                let path = segments.join("/");
                if owner.is_empty() || repo.is_empty() {
                    return Err(GitHubError::InvalidUrl);
                }
                Ok(RepoTarget {
                    provider: RepositoryProvider::GitLab,
                    owner,
                    repo,
                    path,
                })
            }
            _ => Err(GitHubError::InvalidUrl),
        }
    }

    /// Keeps the token (so rate limits stay generous) but disarms the GraphQL
    /// fast path, so a test can run the same resolution down both routes.
    #[cfg(test)]
    fn without_graphql(mut self) -> Self {
        self.has_token = false;
        self
    }

    #[cfg(test)]
    pub fn parse_repo_owner_name(input: &str) -> Result<(String, String), GitHubError> {
        let target = Self::parse_repo_url(input)?;
        Ok((target.owner, target.repo))
    }

    pub async fn resolve_ref(
        &self,
        repo_url: &str,
        requested_ref: Option<String>,
        bypass_cache: bool,
    ) -> Result<RepoRef, GitHubError> {
        let cache_key = (repo_url.to_owned(), requested_ref.clone());
        if !bypass_cache {
            if let Some(cached) = self.ref_cache.get(&cache_key).await {
                return Ok(cached);
            }
        }

        let target = Self::parse_repo_url(repo_url)?;
        match target.provider {
            RepositoryProvider::GitHub => {
                self.resolve_github_ref(target, requested_ref, cache_key)
                    .await
            }
            RepositoryProvider::GitLab => {
                self.resolve_gitlab_ref(target, requested_ref, cache_key)
                    .await
            }
        }
    }

    async fn resolve_github_ref(
        &self,
        target: RepoTarget,
        requested_ref: Option<String>,
        cache_key: (String, Option<String>),
    ) -> Result<RepoRef, GitHubError> {
        let owner = target.owner;
        let repo = target.repo;
        let requested_ref = requested_ref.filter(|value| !value.trim().is_empty());

        if self.has_token {
            match self
                .resolve_github_ref_graphql(&owner, &repo, requested_ref.as_deref())
                .await
            {
                GraphQlOutcome::Resolved {
                    html_url,
                    ref_name,
                    stars,
                    commit_sha,
                } => {
                    let repo_ref = RepoRef {
                        provider: RepositoryProvider::GitHub,
                        owner,
                        repo,
                        ref_name,
                        commit_sha,
                        html_url,
                        stars,
                    };
                    self.ref_cache.insert(cache_key, repo_ref.clone()).await;
                    return Ok(repo_ref);
                }
                GraphQlOutcome::Failed(failure) => return Err(failure.into()),
                GraphQlOutcome::Unusable => {}
            }
        }

        let repo_api = format!("https://api.github.com/repos/{owner}/{repo}");
        let repo_response = self.get_with_retry(&repo_api).await?;
        match repo_response.status() {
            StatusCode::OK => {}
            StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => {
                return Err(GitHubError::RateLimited)
            }
            StatusCode::NOT_FOUND => return Err(GitHubError::NotFound),
            status if status.is_server_error() => {
                return Err(GitHubError::UpstreamUnavailable)
            }
            _ => return Err(GitHubError::NotFound),
        }
        let repo_body: RepoResponse = repo_response.json().await?;
        if repo_body.private {
            return Err(GitHubError::PrivateRepo);
        }

        let ref_name = requested_ref.unwrap_or_else(|| repo_body.default_branch.clone());

        let commit_sha = self.resolve_commit(&owner, &repo, &ref_name).await?;

        let repo_ref = RepoRef {
            provider: RepositoryProvider::GitHub,
            owner,
            repo,
            ref_name,
            commit_sha,
            html_url: repo_body.html_url,
            stars: repo_body.stargazers_count,
        };
        self.ref_cache.insert(cache_key, repo_ref.clone()).await;
        Ok(repo_ref)
    }

    /// Single-request ref resolution. Never returns a transport error: a GraphQL
    /// request that does not produce a definitive answer resolves to
    /// [`GraphQlOutcome::Unusable`] and the caller retries over REST, which is
    /// the path that then reports the failure.
    async fn resolve_github_ref_graphql(
        &self,
        owner: &str,
        repo: &str,
        requested_ref: Option<&str>,
    ) -> GraphQlOutcome {
        let body = serde_json::json!({
            "query": REF_QUERY,
            "variables": {
                "owner": owner,
                "name": repo,
                // GraphQL requires a value for a non-null variable even when the
                // field using it is skipped by @include.
                "expression": requested_ref.unwrap_or("HEAD"),
                "hasRef": requested_ref.is_some(),
            },
        });

        let response = match self.client.post(GRAPHQL_ENDPOINT).json(&body).send().await {
            Ok(response) => response,
            Err(error) => {
                tracing::debug!(%error, "GraphQL ref resolution failed; falling back to REST");
                return GraphQlOutcome::Unusable;
            }
        };

        match response.status() {
            StatusCode::OK => {}
            StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => {
                return GraphQlOutcome::Failed(GraphQlFailure::RateLimited)
            }
            // 401 from a bad or expired token, 5xx from GitHub: REST decides.
            status => {
                tracing::debug!(%status, "unexpected GraphQL status; falling back to REST");
                return GraphQlOutcome::Unusable;
            }
        }

        match response.json::<GraphQlResponse>().await {
            Ok(body) => interpret_graphql(body, requested_ref),
            Err(error) => {
                tracing::debug!(%error, "unreadable GraphQL body; falling back to REST");
                GraphQlOutcome::Unusable
            }
        }
    }

    async fn resolve_gitlab_ref(
        &self,
        target: RepoTarget,
        requested_ref: Option<String>,
        cache_key: (String, Option<String>),
    ) -> Result<RepoRef, GitHubError> {
        let encoded_path = urlencoding::encode(&target.path);
        let project_api = format!("https://gitlab.com/api/v4/projects/{encoded_path}");
        let project_response = self.get_with_retry(&project_api).await?;
        match project_response.status() {
            StatusCode::OK => {}
            StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => {
                return Err(GitHubError::RateLimited)
            }
            StatusCode::NOT_FOUND => return Err(GitHubError::NotFound),
            status if status.is_server_error() => {
                return Err(GitHubError::UpstreamUnavailable)
            }
            _ => return Err(GitHubError::NotFound),
        }
        let project_body: GitLabProjectResponse = project_response.json().await?;
        if project_body.visibility != "public" {
            return Err(GitHubError::PrivateRepo);
        }

        let ref_name = requested_ref
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| project_body.default_branch.clone());
        let commit_sha = self
            .resolve_gitlab_commit(project_body.id, &ref_name)
            .await?;
        let owner = project_body
            .path_with_namespace
            .rsplit_once('/')
            .map(|(owner, _)| owner.to_string())
            .unwrap_or_else(|| target.owner.clone());
        let repo_ref = RepoRef {
            provider: RepositoryProvider::GitLab,
            owner,
            repo: target.repo,
            ref_name,
            commit_sha,
            html_url: project_body.web_url,
            stars: project_body.star_count,
        };
        self.ref_cache.insert(cache_key, repo_ref.clone()).await;
        Ok(repo_ref)
    }

    async fn resolve_commit(
        &self,
        owner: &str,
        repo: &str,
        ref_name: &str,
    ) -> Result<String, GitHubError> {
        let url = format!("https://api.github.com/repos/{owner}/{repo}/commits/{ref_name}");
        let response = self.get_with_retry(&url).await?;
        match response.status() {
            StatusCode::OK => {
                let body: CommitResponse = response.json().await?;
                Ok(body.sha)
            }
            StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => Err(GitHubError::RateLimited),
            StatusCode::NOT_FOUND => Err(GitHubError::RefNotFound),
            status if status.is_server_error() => Err(GitHubError::UpstreamUnavailable),
            _ => Err(GitHubError::RefNotFound),
        }
    }

    async fn resolve_gitlab_commit(
        &self,
        project_id: u64,
        ref_name: &str,
    ) -> Result<String, GitHubError> {
        let encoded_ref = urlencoding::encode(ref_name);
        let url = format!(
            "https://gitlab.com/api/v4/projects/{project_id}/repository/commits/{encoded_ref}"
        );
        let response = self.get_with_retry(&url).await?;
        match response.status() {
            StatusCode::OK => {
                let body: GitLabCommitResponse = response.json().await?;
                Ok(body.id)
            }
            StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => Err(GitHubError::RateLimited),
            StatusCode::NOT_FOUND => Err(GitHubError::RefNotFound),
            status if status.is_server_error() => Err(GitHubError::UpstreamUnavailable),
            _ => Err(GitHubError::RefNotFound),
        }
    }

    /// Opens the repository archive as a blocking reader instead of buffering it.
    ///
    /// The returned reader must be consumed on a blocking thread
    /// (`spawn_blocking`), which is where the analyzer already does its work. It
    /// pulls from the live HTTP response, so extraction proceeds while the rest
    /// of the archive is still arriving and the process never holds more than a
    /// buffer's worth of the tarball.
    ///
    /// Only the response head is inspected here. The hard size limit is applied
    /// by the analyzer as it reads, because that is where the byte budget and
    /// the temp directory live; `max_bytes` is used solely for the free
    /// `Content-Length` early-out, which codeload usually does not offer.
    pub async fn archive_reader(
        &self,
        provider: &RepositoryProvider,
        owner: &str,
        repo: &str,
        sha: &str,
        max_bytes: u64,
    ) -> Result<Box<dyn std::io::Read + Send>, GitHubError> {
        let url = match provider {
            RepositoryProvider::GitHub => {
                format!("https://codeload.github.com/{owner}/{repo}/tar.gz/{sha}")
            }
            RepositoryProvider::GitLab => {
                let path = format!("{owner}/{repo}");
                let encoded_path = urlencoding::encode(&path);
                format!("https://gitlab.com/api/v4/projects/{encoded_path}/repository/archive.tar.gz?sha={sha}")
            }
        };
        self.stream_url(url, max_bytes).await
    }

    /// Test access to [`Self::stream_url`], so the streaming path can be
    /// exercised against a local server rather than codeload.
    #[cfg(test)]
    pub async fn stream_url_for_test(
        &self,
        url: String,
        max_bytes: u64,
    ) -> Result<Box<dyn std::io::Read + Send>, GitHubError> {
        self.stream_url(url, max_bytes).await
    }

    /// The transport half of [`Self::archive_reader`], split out so tests can
    /// point it at a local server without going through codeload.
    async fn stream_url(
        &self,
        url: String,
        max_bytes: u64,
    ) -> Result<Box<dyn std::io::Read + Send>, GitHubError> {
        let response = self.client.get(url).send().await?;
        match response.status() {
            StatusCode::OK => {}
            StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => {
                return Err(GitHubError::RateLimited)
            }
            StatusCode::NOT_FOUND => return Err(GitHubError::NotFound),
            _ => {
                return Err(GitHubError::Request(
                    response.error_for_status().unwrap_err(),
                ))
            }
        }

        if let Some(length) = response.content_length() {
            if length > max_bytes {
                return Err(GitHubError::TooLarge);
            }
        }

        let stream = response.bytes_stream().map_err(std::io::Error::other);
        Ok(Box::new(SyncIoBridge::new(StreamReader::new(stream))))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_ref_cache, interpret_graphql, GitHubClient, GraphQlFailure, GraphQlOutcome, RepoRef,
        RepositoryProvider, REF_CACHE_TTL,
    };
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    use axum::response::IntoResponse;

    /// Local axum server counting requests, answering 503 until `ok_after`
    /// requests have arrived, then 200. Lets `get_with_retry` be exercised
    /// end to end without GitHub or codeload.
    async fn flaky_server(ok_after: u32) -> (String, Arc<AtomicU32>) {
        use axum::routing::get;
        let hits = Arc::new(AtomicU32::new(0));
        let state = hits.clone();
        let app = axum::Router::new().route(
            "/repos/x",
            get(move || {
                let seen = state.fetch_add(1, Ordering::SeqCst) + 1;
                async move {
                    if seen >= ok_after {
                        axum::Json(serde_json::json!({"stargazers_count": 42})).into_response()
                    } else {
                        (axum::http::StatusCode::SERVICE_UNAVAILABLE, "down").into_response()
                    }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://{addr}/repos/x"), hits)
    }

    #[tokio::test]
    async fn get_with_retry_rides_out_transient_5xx() {
        let (url, hits) = flaky_server(3).await; // 503, 503, then 200
        let client = GitHubClient::with_token(None).unwrap();
        let response = client.get_with_retry(&url).await.unwrap();
        assert_eq!(response.status().as_u16(), 200);
        assert_eq!(hits.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn get_with_retry_reports_upstream_unavailable_after_backoff() {
        let (url, hits) = flaky_server(u32::MAX).await; // always 503
        let client = GitHubClient::with_token(None).unwrap();
        let error = client.get_with_retry(&url).await.unwrap_err();
        assert!(matches!(error, super::GitHubError::UpstreamUnavailable));
        // initial attempt + both backoff retries
        assert_eq!(hits.load(Ordering::SeqCst), 3);
    }

    fn sample_ref(sha: &str) -> RepoRef {
        RepoRef {
            provider: RepositoryProvider::GitHub,
            owner: "tokio-rs".to_string(),
            repo: "axum".to_string(),
            ref_name: "main".to_string(),
            commit_sha: sha.to_string(),
            html_url: "https://github.com/tokio-rs/axum".to_string(),
            stars: None,
        }
    }

    /// A moving branch must eventually be re-resolved without `force_refresh`,
    /// which is only true if the cache carries an expiry at all.
    #[test]
    fn ref_cache_has_a_bounded_lifetime() {
        assert!(REF_CACHE_TTL > Duration::ZERO);
        assert!(REF_CACHE_TTL <= Duration::from_secs(300));
    }

    #[tokio::test]
    async fn ref_cache_entries_expire_so_moved_branches_are_re_resolved() {
        let cache = build_ref_cache(Duration::from_millis(50));
        let key = ("https://github.com/tokio-rs/axum".to_string(), None);

        cache.insert(key.clone(), sample_ref("old")).await;
        assert_eq!(
            cache.get(&key).await.map(|value| value.commit_sha),
            Some("old".to_string())
        );

        tokio::time::sleep(Duration::from_millis(120)).await;
        cache.run_pending_tasks().await;

        assert!(
            cache.get(&key).await.is_none(),
            "expired entry was still served; the branch would stay pinned to a stale sha"
        );
    }

    // ---------------------------------------------------------------------
    // GraphQL ref resolution
    //
    // The bodies below are the shapes the live API returned while this was
    // built, trimmed to the fields the query selects. The commit shas were
    // cross-checked against `GET /repos/{o}/{r}/commits/{ref}` for a moving
    // branch, a lightweight tag, an annotated tag (torvalds/linux v6.6, where a
    // naive `object(expression:)` reading could have produced the tag object's
    // own sha instead of the commit's), a raw sha, and a renamed repository.
    // ---------------------------------------------------------------------

    fn interpret(body: &str, requested_ref: Option<&str>) -> GraphQlOutcome {
        interpret_graphql(serde_json::from_str(body).unwrap(), requested_ref)
    }

    #[test]
    fn graphql_resolves_the_default_branch_when_no_ref_is_requested() {
        let outcome = interpret(
            r#"{"data":{"repository":{
                "isPrivate":false,
                "url":"https://github.com/tokio-rs/axum",
                "defaultBranchRef":{"name":"main","target":{"oid":"a5116d6b1bcabdfd7039279e4957b4a9c0b50587"}}
            }}}"#,
            None,
        );
        assert_eq!(
            outcome,
            GraphQlOutcome::Resolved {
                html_url: "https://github.com/tokio-rs/axum".to_string(),
                ref_name: "main".to_string(),
                stars: None,
                commit_sha: "a5116d6b1bcabdfd7039279e4957b4a9c0b50587".to_string(),
            }
        );
    }

    /// `v6.6` is an annotated tag. GitHub peels it to the commit, which is the
    /// same sha REST reports; anything else would silently fork the report cache
    /// and point the archive download at a tag object.
    #[test]
    fn graphql_resolves_an_annotated_tag_to_its_commit() {
        let outcome = interpret(
            r#"{"data":{"repository":{
                "isPrivate":false,
                "url":"https://github.com/torvalds/linux",
                "defaultBranchRef":{"name":"master","target":{"oid":"cd78d08026c75c6681c2e5e418aad800e729d54d"}},
                "object":{"__typename":"Commit","oid":"ffc253263a1375a65fa6c9f62a893e9767fbebfa"}
            }}}"#,
            Some("v6.6"),
        );
        assert_eq!(
            outcome,
            GraphQlOutcome::Resolved {
                html_url: "https://github.com/torvalds/linux".to_string(),
                ref_name: "v6.6".to_string(),
                stars: None,
                commit_sha: "ffc253263a1375a65fa6c9f62a893e9767fbebfa".to_string(),
            }
        );
    }

    /// A renamed repository resolves under its old name and reports the new
    /// canonical URL, matching REST's redirect behaviour.
    #[test]
    fn graphql_reports_the_canonical_url_for_a_renamed_repository() {
        let outcome = interpret(
            r#"{"data":{"repository":{
                "isPrivate":false,
                "url":"https://github.com/vuejs/core",
                "defaultBranchRef":{"name":"main","target":{"oid":"b5f8518379b77c3b62a7a9d2b52f6c76cda09bd5"}}
            }}}"#,
            None,
        );
        let GraphQlOutcome::Resolved { html_url, .. } = outcome else {
            panic!("expected a resolution");
        };
        assert_eq!(html_url, "https://github.com/vuejs/core");
    }

    #[test]
    fn graphql_rejects_private_repositories() {
        let outcome = interpret(
            r#"{"data":{"repository":{
                "isPrivate":true,
                "url":"https://github.com/acme/secret",
                "defaultBranchRef":{"name":"main","target":{"oid":"aaaa"}}
            }}}"#,
            None,
        );
        assert_eq!(
            outcome,
            GraphQlOutcome::Failed(GraphQlFailure::PrivateRepo)
        );
    }

    #[test]
    fn graphql_maps_a_missing_repository_to_not_found() {
        let outcome = interpret(
            r#"{"data":{"repository":null},"errors":[{"type":"NOT_FOUND","message":"Could not resolve to a Repository"}]}"#,
            None,
        );
        assert_eq!(outcome, GraphQlOutcome::Failed(GraphQlFailure::NotFound));
    }

    #[test]
    fn graphql_maps_rate_limiting_to_rate_limited() {
        let outcome = interpret(
            r#"{"data":null,"errors":[{"type":"RATE_LIMITED","message":"API rate limit exceeded"}]}"#,
            None,
        );
        assert_eq!(outcome, GraphQlOutcome::Failed(GraphQlFailure::RateLimited));
    }

    /// A ref that resolves to nothing comes back as a present repository with a
    /// null object.
    #[test]
    fn graphql_maps_an_unresolvable_ref_to_ref_not_found() {
        let outcome = interpret(
            r#"{"data":{"repository":{
                "isPrivate":false,
                "url":"https://github.com/tokio-rs/axum",
                "defaultBranchRef":{"name":"main","target":{"oid":"a511"}},
                "object":null
            }}}"#,
            Some("does-not-exist-ref"),
        );
        assert_eq!(outcome, GraphQlOutcome::Failed(GraphQlFailure::RefNotFound));
    }

    /// An empty repository has no default branch to resolve.
    #[test]
    fn graphql_maps_an_empty_repository_to_ref_not_found() {
        let outcome = interpret(
            r#"{"data":{"repository":{
                "isPrivate":false,
                "url":"https://github.com/acme/empty",
                "defaultBranchRef":null
            }}}"#,
            None,
        );
        assert_eq!(outcome, GraphQlOutcome::Failed(GraphQlFailure::RefNotFound));
    }

    /// The safety valve. An object type this code does not understand, or an
    /// error class it has no mapping for, must fall through to REST rather than
    /// be guessed at.
    #[test]
    fn graphql_defers_to_rest_for_shapes_it_does_not_recognise() {
        assert_eq!(
            interpret(
                r#"{"data":{"repository":{
                    "isPrivate":false,
                    "url":"https://github.com/acme/blobref",
                    "defaultBranchRef":{"name":"main","target":{"oid":"aaaa"}},
                    "object":{"__typename":"Blob","oid":"bbbb"}
                }}}"#,
                Some("some/file.txt"),
            ),
            GraphQlOutcome::Unusable
        );

        assert_eq!(
            interpret(
                r#"{"data":{"repository":null},"errors":[{"type":"SOMETHING_NEW"}]}"#,
                None,
            ),
            GraphQlOutcome::Unusable
        );

        assert_eq!(
            interpret(r#"{"data":null,"errors":[{"message":"no type field"}]}"#, None),
            GraphQlOutcome::Unusable
        );
    }

    /// GraphQL requires authentication, so a deployment without `GITHUB_TOKEN`
    /// must never attempt it — and must keep working.
    #[test]
    fn the_graphql_fast_path_is_only_armed_when_a_token_exists() {
        assert!(!GitHubClient::with_token(None).unwrap().has_token);
        assert!(
            !GitHubClient::with_token(Some("   ".to_string()))
                .unwrap()
                .has_token,
            "a blank token is not a token"
        );
        assert!(GitHubClient::with_token(Some("ghp_example".to_string()))
            .unwrap()
            .has_token);
    }

    /// The live differential. Resolves the same refs through GraphQL and
    /// through REST against api.github.com and asserts they agree on the
    /// canonical URL, the ref name and — above all — the commit sha, which is
    /// both the report cache key and the archive download path.
    ///
    /// Ignored by default: it needs a token and the network.
    ///
    /// ```text
    /// GITHUB_TOKEN=$(gh auth token) cargo test github::tests::graphql_and_rest -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "hits api.github.com; needs GITHUB_TOKEN"]
    async fn graphql_and_rest_resolve_refs_identically() {
        let token = std::env::var("GITHUB_TOKEN").expect("GITHUB_TOKEN must be set");
        let graphql = GitHubClient::with_token(Some(token.clone())).unwrap();
        let rest = GitHubClient::with_token(Some(token)).unwrap().without_graphql();

        let cases: &[(&str, Option<&str>)] = &[
            // default branch
            ("https://github.com/tokio-rs/axum", None),
            // lightweight tag
            ("https://github.com/vuejs/core", Some("v3.4.0")),
            // annotated tag: the case where a naive reading returns the tag
            // object's sha rather than the commit's
            ("https://github.com/torvalds/linux", Some("v6.6")),
            ("https://github.com/git/git", Some("v2.43.0")),
            // raw commit sha
            (
                "https://github.com/tokio-rs/axum",
                Some("a5116d6b1bcabdfd7039279e4957b4a9c0b50587"),
            ),
            // renamed repository, resolved under its old name
            ("https://github.com/vuejs/vue-next", None),
        ];

        for (url, ref_name) in cases {
            let from_graphql = graphql
                .resolve_ref(url, ref_name.map(str::to_string), true)
                .await
                .unwrap_or_else(|error| panic!("graphql failed for {url}@{ref_name:?}: {error}"));
            let from_rest = rest
                .resolve_ref(url, ref_name.map(str::to_string), true)
                .await
                .unwrap_or_else(|error| panic!("rest failed for {url}@{ref_name:?}: {error}"));

            println!(
                "{url}@{ref_name:?} -> {} ({})",
                from_graphql.commit_sha, from_graphql.ref_name
            );
            assert_eq!(
                from_graphql.commit_sha, from_rest.commit_sha,
                "commit sha diverged for {url}@{ref_name:?}"
            );
            assert_eq!(from_graphql.ref_name, from_rest.ref_name);
            assert_eq!(from_graphql.html_url, from_rest.html_url);
            assert_eq!(from_graphql.owner, from_rest.owner);
            assert_eq!(from_graphql.repo, from_rest.repo);
        }
    }

    #[test]
    fn parses_https_urls() {
        let (owner, repo) =
            GitHubClient::parse_repo_owner_name("https://github.com/rust-lang/rust").unwrap();
        assert_eq!(owner, "rust-lang");
        assert_eq!(repo, "rust");
    }

    #[test]
    fn parses_git_urls() {
        let (owner, repo) =
            GitHubClient::parse_repo_owner_name("git@github.com:tokio-rs/axum.git").unwrap();
        assert_eq!(owner, "tokio-rs");
        assert_eq!(repo, "axum");
    }

    #[test]
    fn parses_gitlab_urls() {
        let (owner, repo) =
            GitHubClient::parse_repo_owner_name("https://gitlab.com/group/sub/project.git")
                .unwrap();
        assert_eq!(owner, "group/sub");
        assert_eq!(repo, "project");
    }

    #[test]
    fn rejects_unsupported_hosts() {
        assert!(GitHubClient::parse_repo_owner_name("https://example.com/a/b").is_err());
    }
}
