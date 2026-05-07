use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use crate::{github::GitHubError, models::ApiErrorBody};

pub struct ApiError {
    pub(crate) status: StatusCode,
    pub(crate) body: ApiErrorBody,
}

impl ApiError {
    pub(crate) fn new(status: StatusCode, code: &str, message: impl Into<String>) -> Self {
        Self {
            status,
            body: ApiErrorBody {
                code: code.to_string(),
                message: message.into(),
            },
        }
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
            ),
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
        (self.status, Json(self.body)).into_response()
    }
}
