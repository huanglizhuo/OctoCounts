use std::net::SocketAddr;

use axum::{
    extract::{ConnectInfo, Extension, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    api::AppState,
    error::ApiError,
    github::{GitHubClient, GitHubError},
    models::RepositoryProvider,
    ratelimit::client_ip,
    seo::parse_provider,
};

#[derive(Debug, Deserialize)]
struct AccessTokenResponse {
    #[serde(default)]
    access_token: Option<String>,
}

async fn exchange_oauth_code(client_id: &str, client_secret: &str, code: &str, redirect_uri: &str) -> Option<String> {
    let client = reqwest::Client::new();
    // Built by hand rather than via `RequestBuilder::form` so this doesn't
    // need reqwest's form-encoding feature enabled just for one call —
    // `urlencoding` is already a dependency used throughout `github.rs`.
    let body = format!(
        "client_id={}&client_secret={}&code={}&redirect_uri={}",
        urlencoding::encode(client_id),
        urlencoding::encode(client_secret),
        urlencoding::encode(code),
        urlencoding::encode(redirect_uri),
    );
    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .ok()?;
    let body: AccessTokenResponse = response.json().await.ok()?;
    body.access_token.filter(|token| !token.is_empty())
}

#[derive(Debug, Deserialize)]
struct GitHubUserResponse {
    login: String,
}

/// Who a token belongs to, per GitHub itself. Used only to tell the extension
/// which GitHub account just logged in — never stored server-side.
async fn fetch_github_login(token: &str) -> Option<String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.github.com/user")
        .header(reqwest::header::USER_AGENT, "octocount-service/0.1")
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<GitHubUserResponse>().await.ok().map(|body| body.login)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionCodeExchangeRequest {
    code: String,
    redirect_uri: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionCodeExchangeResponse {
    login: String,
    token: String,
}

/// `POST /api/auth/github/extension-token` — the browser extension's login
/// step. The extension itself runs `chrome.identity.launchWebAuthFlow`
/// against a dedicated extension-only GitHub OAuth App and gets back an
/// authorization `code`; that flow never touches this server as a redirect
/// target; the code only ever arrives here, once, as this plain JSON call.
///
/// The code exchange has to happen server-side because it needs the OAuth
/// App's client secret, which can never live in extension JS. The resulting
/// token is handed straight back to the extension to keep locally (per the
/// product decision that the extension, not this server, holds onto it for
/// silently triggering backfill on future repo visits) — this server never
/// persists it, same as `github_auth_token` below never persists the tokens
/// it receives.
pub async fn github_extension_token_exchange(
    State(state): State<AppState>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(request): Json<ExtensionCodeExchangeRequest>,
) -> Result<Json<ExtensionCodeExchangeResponse>, ApiError> {
    if let Some(ip) = client_ip(&headers, connect_info.map(|Extension(ConnectInfo(addr))| addr)) {
        if let Err(seconds) = state.rate_limits.github_auth.check(&ip) {
            return Err(ApiError::rate_limited(seconds));
        }
    }

    let (Some(client_id), Some(client_secret)) =
        (state.github_extension_oauth_client_id.clone(), state.github_extension_oauth_client_secret.clone())
    else {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "oauth_not_configured",
            "extension GitHub login is not configured on this deployment",
        ));
    };

    let Some(token) = exchange_oauth_code(&client_id, &client_secret, &request.code, &request.redirect_uri).await
    else {
        return Err(ApiError::new(StatusCode::BAD_GATEWAY, "oauth_failed", "failed to exchange GitHub code"));
    };
    let Some(login) = fetch_github_login(&token).await else {
        return Err(ApiError::new(StatusCode::BAD_GATEWAY, "oauth_failed", "failed to look up the GitHub account"));
    };

    Ok(Json(ExtensionCodeExchangeResponse { login, token }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitTokenRequest {
    provider: String,
    owner: String,
    repo: String,
    token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitTokenResponse {
    success: bool,
    error: Option<String>,
}

/// `POST /api/auth/github/token` — given a token the caller already has
/// (today: only the browser extension, after its own login above), verify it
/// and trigger a real star-history backfill for one repo. The token is read
/// once from the request body and never persisted or echoed back.
pub async fn github_auth_token(
    State(state): State<AppState>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(request): Json<SubmitTokenRequest>,
) -> Result<Json<SubmitTokenResponse>, ApiError> {
    if let Some(ip) = client_ip(&headers, connect_info.map(|Extension(ConnectInfo(addr))| addr)) {
        if let Err(seconds) = state.rate_limits.github_auth.check(&ip) {
            return Err(ApiError::rate_limited(seconds));
        }
    }

    let provider = parse_provider(&request.provider)?;
    if provider != RepositoryProvider::GitHub {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "unsupported_provider",
            "GitHub token connect is only available for GitHub repositories",
        ));
    }
    if request.token.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "missing_token", "token is required"));
    }

    let response = match authorize_and_backfill(&state, provider, &request.owner, &request.repo, request.token).await
    {
        Ok(()) => SubmitTokenResponse { success: true, error: None },
        Err(GitHubError::NotCollaborator) => {
            SubmitTokenResponse { success: false, error: Some("not_collaborator".to_string()) }
        }
        Err(GitHubError::RateLimited) => {
            SubmitTokenResponse { success: false, error: Some("rate_limited".to_string()) }
        }
        Err(_) => SubmitTokenResponse { success: false, error: Some("github_unavailable".to_string()) },
    };

    Ok(Json(response))
}

/// The core behind `github_auth_token`: verify the token can actually read
/// this repo's real star history (a fast, synchronous check — see
/// `GitHubClient::verify_star_history_access`), then hand the slower page
/// walk off to a background task so the response doesn't have to wait for
/// it. Mirrors the SLOC backfill's claim-then-spawn shape in
/// `repo_history::ensure_repo_history`.
async fn authorize_and_backfill(
    state: &AppState,
    provider: RepositoryProvider,
    owner: &str,
    repo: &str,
    token: String,
) -> Result<(), GitHubError> {
    let store = state.coordinator.store();
    let github = state.coordinator.github();

    // Guarantees a star_watch row exists to claim below, even for a repo
    // nobody has viewed a report for yet.
    let _ = store.watch_repo_for_stars(provider, owner, repo).await;

    let first_page = GitHubClient::verify_star_history_access(&token, owner, repo).await?;
    let current_stars = github.repo_stars(&provider, owner, repo).await.unwrap_or(0);

    if store.start_star_backfill_if_needed(provider, owner, repo).await.unwrap_or(false) {
        let store = store.clone();
        let owner = owner.to_string();
        let repo = repo.to_string();
        tokio::spawn(async move {
            let points =
                GitHubClient::backfill_star_history(&token, &owner, &repo, current_stars, first_page).await;
            for (timestamp, stars_at_point) in points {
                if let Err(error) = store
                    .record_star_snapshot(provider, &owner, &repo, timestamp.date_naive(), stars_at_point as i64)
                    .await
                {
                    tracing::warn!(%error, %owner, %repo, "failed to record backfilled star snapshot");
                }
            }
            if let Err(error) = store.mark_star_backfill_completed(provider, &owner, &repo).await {
                tracing::error!(%error, %owner, %repo, "failed to mark star backfill completed");
            }
        });
    }

    Ok(())
}
