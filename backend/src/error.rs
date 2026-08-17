use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use crate::{github::GitHubError, models::ApiErrorBody};

pub struct ApiError {
    pub(crate) status: StatusCode,
    pub(crate) body: ApiErrorBody,
    /// Seconds the client should wait before retrying. Set for errors that
    /// are transient by nature (upstream outage, rate limit) so well-behaved
    /// clients back off instead of hammering a struggling dependency.
    pub(crate) retry_after: Option<u64>,
}

impl ApiError {
    pub(crate) fn new(status: StatusCode, code: &str, message: impl Into<String>) -> Self {
        Self {
            status,
            body: ApiErrorBody {
                code: code.to_string(),
                message: message.into(),
            },
            retry_after: None,
        }
    }

    fn with_retry_after(mut self, seconds: u64) -> Self {
        self.retry_after = Some(seconds);
        self
    }

    pub(crate) fn internal(error: anyhow::Error) -> Self {
        tracing::error!(%error, "internal error");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "internal server error",
        )
    }

    pub(crate) fn not_found(code: &str, message: &str) -> Self {
        Self::new(StatusCode::NOT_FOUND, code, message)
    }

    pub(crate) fn body(&self) -> &ApiErrorBody {
        &self.body
    }
}

impl From<GitHubError> for ApiError {
    fn from(error: GitHubError) -> Self {
        match error {
            GitHubError::InvalidUrl => {
                Self::new(StatusCode::BAD_REQUEST, "invalid_url", error.to_string())
            }
            GitHubError::NotFound => {
                Self::new(StatusCode::NOT_FOUND, "not_found", error.to_string())
            }
            GitHubError::PrivateRepo => {
                Self::new(StatusCode::FORBIDDEN, "private_repo", error.to_string())
            }
            GitHubError::RefNotFound => {
                Self::new(StatusCode::NOT_FOUND, "ref_not_found", error.to_string())
            }
            GitHubError::RateLimited => Self::new(
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
                error.to_string(),
            )
            // The anonymous quota resets hourly, the token quota every hour
            // too; a minute is enough for client backoff without pretending
            // we know GitHub's exact reset time.
            .with_retry_after(60),
            GitHubError::UpstreamUnavailable => Self::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "github_unavailable",
                error.to_string(),
            )
            // GitHub incidents typically resolve in minutes; retries sooner
            // only add load to a struggling upstream.
            .with_retry_after(120),
            GitHubError::TooLarge => Self::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "too_large",
                error.to_string(),
            ),
            GitHubError::Request(_) => Self::new(
                StatusCode::BAD_GATEWAY,
                "github_request_failed",
                error.to_string(),
            ),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut response = (self.status, Json(self.body)).into_response();
        if let Some(seconds) = self.retry_after {
            if let Ok(value) = axum::http::HeaderValue::from_str(&seconds.to_string()) {
                response.headers_mut().insert("retry-after", value);
            }
        }
        response
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn upstream_unavailable_maps_to_503_with_retry_after() {
        let response = ApiError::from(GitHubError::UpstreamUnavailable).into_response();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response
                .headers()
                .get("retry-after")
                .and_then(|value| value.to_str().ok()),
            Some("120")
        );
        let body: ApiErrorBody = serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), 4096).await.unwrap(),
        )
        .unwrap();
        assert_eq!(body.code, "github_unavailable");
    }

    #[tokio::test]
    async fn rate_limited_keeps_429_and_gains_retry_after() {
        let response = ApiError::from(GitHubError::RateLimited).into_response();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            response
                .headers()
                .get("retry-after")
                .and_then(|value| value.to_str().ok()),
            Some("60")
        );
    }
}
