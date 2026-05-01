use reqwest::{header, Client, StatusCode};
use serde::Deserialize;
use thiserror::Error;
use url::Url;

use crate::models::RepoRef;

#[derive(Debug, Error)]
pub enum GitHubError {
    #[error("only public github.com repository URLs are supported")]
    InvalidUrl,
    #[error("repository was not found or is not public")]
    NotFound,
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
}

#[derive(Debug, Deserialize)]
struct RepoResponse {
    default_branch: String,
    html_url: String,
}

#[derive(Debug, Deserialize)]
struct CommitResponse {
    sha: String,
}

impl GitHubClient {
    pub fn new() -> anyhow::Result<Self> {
        let mut headers = header::HeaderMap::new();
        headers.insert(header::USER_AGENT, header::HeaderValue::from_static("sloc-service/0.1"));
        headers.insert(header::ACCEPT, header::HeaderValue::from_static("application/vnd.github+json"));

        if let Ok(token) = std::env::var("GITHUB_TOKEN") {
            let value = format!("Bearer {token}");
            headers.insert(header::AUTHORIZATION, header::HeaderValue::from_str(&value)?);
        }

        Ok(Self {
            client: Client::builder().default_headers(headers).build()?,
        })
    }

    pub fn parse_repo_url(input: &str) -> Result<(String, String), GitHubError> {
        let mut normalized = input.trim().to_string();
        if normalized.starts_with("git@github.com:") {
            normalized = normalized.replacen("git@github.com:", "https://github.com/", 1);
        }

        let url = Url::parse(&normalized).map_err(|_| GitHubError::InvalidUrl)?;
        if url.host_str() != Some("github.com") {
            return Err(GitHubError::InvalidUrl);
        }

        let mut segments = url
            .path_segments()
            .ok_or(GitHubError::InvalidUrl)?
            .filter(|part| !part.is_empty());

        let owner = segments.next().ok_or(GitHubError::InvalidUrl)?.to_string();
        let repo = segments
            .next()
            .ok_or(GitHubError::InvalidUrl)?
            .trim_end_matches(".git")
            .to_string();

        if owner.is_empty() || repo.is_empty() {
            return Err(GitHubError::InvalidUrl);
        }

        Ok((owner, repo))
    }

    pub async fn resolve_ref(&self, repo_url: &str, requested_ref: Option<String>) -> Result<RepoRef, GitHubError> {
        let (owner, repo) = Self::parse_repo_url(repo_url)?;
        let repo_api = format!("https://api.github.com/repos/{owner}/{repo}");
        let repo_response = self.client.get(repo_api).send().await?;
        match repo_response.status() {
            StatusCode::OK => {}
            StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => return Err(GitHubError::RateLimited),
            StatusCode::NOT_FOUND => return Err(GitHubError::NotFound),
            _ => return Err(GitHubError::NotFound),
        }
        let repo_body: RepoResponse = repo_response.json().await?;
        let ref_name = requested_ref
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| repo_body.default_branch.clone());

        let commit_sha = self.resolve_commit(&owner, &repo, &ref_name).await?;

        Ok(RepoRef {
            owner,
            repo,
            ref_name,
            commit_sha,
            html_url: repo_body.html_url,
        })
    }

    async fn resolve_commit(&self, owner: &str, repo: &str, ref_name: &str) -> Result<String, GitHubError> {
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

    pub async fn download_archive(&self, owner: &str, repo: &str, sha: &str, max_bytes: u64) -> Result<bytes::Bytes, GitHubError> {
        let url = format!("https://codeload.github.com/{owner}/{repo}/tar.gz/{sha}");
        let response = self.client.get(url).send().await?;
        match response.status() {
            StatusCode::OK => {}
            StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => return Err(GitHubError::RateLimited),
            StatusCode::NOT_FOUND => return Err(GitHubError::NotFound),
            _ => return Err(GitHubError::Request(response.error_for_status().unwrap_err())),
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
        let (owner, repo) = GitHubClient::parse_repo_url("https://github.com/rust-lang/rust").unwrap();
        assert_eq!(owner, "rust-lang");
        assert_eq!(repo, "rust");
    }

    #[test]
    fn parses_git_urls() {
        let (owner, repo) = GitHubClient::parse_repo_url("git@github.com:tokio-rs/axum.git").unwrap();
        assert_eq!(owner, "tokio-rs");
        assert_eq!(repo, "axum");
    }

    #[test]
    fn rejects_non_github_urls() {
        assert!(GitHubClient::parse_repo_url("https://gitlab.com/a/b").is_err());
    }
}
