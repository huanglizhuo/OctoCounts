use moka::{future::Cache, policy::EvictionPolicy};
use reqwest::{header, Client, StatusCode};
use serde::Deserialize;
use thiserror::Error;
use url::Url;

use crate::models::{RepoRef, RepositoryProvider};

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
    #[error("GitHub request failed")]
    Request(#[from] reqwest::Error),
}

#[derive(Clone)]
pub struct GitHubClient {
    client: Client,
    ref_cache: Cache<(String, Option<String>), RepoRef>,
}

#[derive(Debug, Deserialize)]
struct RepoResponse {
    default_branch: String,
    html_url: String,
    private: bool,
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
}

#[derive(Debug, Deserialize)]
struct GitLabCommitResponse {
    id: String,
}

#[derive(Debug, Clone)]
struct RepoTarget {
    provider: RepositoryProvider,
    owner: String,
    repo: String,
    path: String,
}

impl GitHubClient {
    pub fn new() -> anyhow::Result<Self> {
        let mut headers = header::HeaderMap::new();
        headers.insert(
            header::USER_AGENT,
            header::HeaderValue::from_static("octocount-service/0.1"),
        );
        headers.insert(
            header::ACCEPT,
            header::HeaderValue::from_static("application/vnd.github+json"),
        );

        if let Ok(token) = std::env::var("GITHUB_TOKEN") {
            let value = format!("Bearer {token}");
            headers.insert(
                header::AUTHORIZATION,
                header::HeaderValue::from_str(&value)?,
            );
        }

        let ref_cache = Cache::builder()
            .max_capacity(10_000)
            .eviction_policy(EvictionPolicy::lru())
            .build();

        Ok(Self {
            client: Client::builder().default_headers(headers).build()?,
            ref_cache,
        })
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
        let repo_api = format!("https://api.github.com/repos/{owner}/{repo}");
        let repo_response = self.client.get(repo_api).send().await?;
        match repo_response.status() {
            StatusCode::OK => {}
            StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => {
                return Err(GitHubError::RateLimited)
            }
            StatusCode::NOT_FOUND => return Err(GitHubError::NotFound),
            _ => return Err(GitHubError::NotFound),
        }
        let repo_body: RepoResponse = repo_response.json().await?;
        if repo_body.private {
            return Err(GitHubError::PrivateRepo);
        }

        let ref_name = requested_ref
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| repo_body.default_branch.clone());

        let commit_sha = self.resolve_commit(&owner, &repo, &ref_name).await?;

        let repo_ref = RepoRef {
            provider: RepositoryProvider::GitHub,
            owner,
            repo,
            ref_name,
            commit_sha,
            html_url: repo_body.html_url,
        };
        self.ref_cache.insert(cache_key, repo_ref.clone()).await;
        Ok(repo_ref)
    }

    async fn resolve_gitlab_ref(
        &self,
        target: RepoTarget,
        requested_ref: Option<String>,
        cache_key: (String, Option<String>),
    ) -> Result<RepoRef, GitHubError> {
        let encoded_path = urlencoding::encode(&target.path);
        let project_api = format!("https://gitlab.com/api/v4/projects/{encoded_path}");
        let project_response = self.client.get(project_api).send().await?;
        match project_response.status() {
            StatusCode::OK => {}
            StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => {
                return Err(GitHubError::RateLimited)
            }
            StatusCode::NOT_FOUND => return Err(GitHubError::NotFound),
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
        let response = self.client.get(url).send().await?;
        match response.status() {
            StatusCode::OK => {
                let body: CommitResponse = response.json().await?;
                Ok(body.sha)
            }
            StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => Err(GitHubError::RateLimited),
            StatusCode::NOT_FOUND => Err(GitHubError::RefNotFound),
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
        let response = self.client.get(url).send().await?;
        match response.status() {
            StatusCode::OK => {
                let body: GitLabCommitResponse = response.json().await?;
                Ok(body.id)
            }
            StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => Err(GitHubError::RateLimited),
            StatusCode::NOT_FOUND => Err(GitHubError::RefNotFound),
            _ => Err(GitHubError::RefNotFound),
        }
    }

    pub async fn download_archive(
        &self,
        provider: &RepositoryProvider,
        owner: &str,
        repo: &str,
        sha: &str,
        max_bytes: u64,
    ) -> Result<bytes::Bytes, GitHubError> {
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

        let bytes = response.bytes().await?;
        if bytes.len() as u64 > max_bytes {
            return Err(GitHubError::TooLarge);
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::GitHubClient;

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
