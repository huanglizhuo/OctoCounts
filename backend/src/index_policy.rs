//! Search-index boundaries for the machine-readable API host.
//!
//! `api.octocounts.com` serves JSON, SVG badges and PNG share images. None of
//! those URLs is a landing page: each has an HTML counterpart on
//! octocounts.com, or no search value at all. Search Console showed Google
//! spending report-page crawl budget on them (119 badge URLs and 176 SEO
//! report JSON URLs sat in "crawled - currently not indexed"), so the boundary
//! is now stated on every response.
//!
//! Crawling stays open. robots.txt cannot see a `noindex` on a URL it blocks,
//! and the list endpoints are what the Pages Function reads, so the directive
//! rides on the response and robots.txt only excludes resources that are
//! writes or per-request state.

use axum::{
    extract::Request,
    http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode},
    middleware::Next,
    response::Response,
};

/// `http::header` has no constant for this header name.
pub static X_ROBOTS_TAG: HeaderName = HeaderName::from_static("x-robots-tag");

pub const ROBOTS_TXT: &str = "User-agent: *\n\
Allow: /\n\
\n\
# Writes and per-request job state have no search value.\n\
Disallow: /api/analyze\n\
Disallow: /api/jobs/\n\
Disallow: /api/auth/\n\
Disallow: /internal/\n\
\n\
# Report JSON, badges and share images stay crawlable. Each response carries\n\
# X-Robots-Tag or a canonical Link header, because a blocked URL cannot be\n\
# seen to be noindex.\n\
Sitemap: https://octocounts.com/sitemap.xml\n";

const NOINDEX: &str = "noindex";

/// Axum middleware: adds the index directive to machine-readable responses.
/// A handler that already set `X-Robots-Tag` or a canonical `Link` keeps it.
pub async fn tag_indexing(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let mut response = next.run(request).await;
    if response.headers().contains_key(&X_ROBOTS_TAG) || has_canonical_link(response.headers()) {
        return response;
    }
    apply(&path, response.status(), response.headers_mut());
    response
}

/// Pure form of the policy, so it can be asserted without a router.
pub fn apply(path: &str, status: StatusCode, headers: &mut HeaderMap) {
    // Only a successful response is a resource worth keeping out of an index;
    // an outage's 503 must never read as "this URL should not be indexed".
    if status.is_success() {
        if robots_tag_for(path).is_some() {
            set_noindex(headers);
        }
    }
}

/// Which index directive a successful response at `path` carries.
///
/// `None` means the middleware leaves the response alone:
/// - the infrastructure routes (robots.txt, health, readiness);
/// - a saved report's JSON (`/api/reports/:id`), which Dataset markup names
///   as its download and which therefore stays index-neutral;
/// - the SEO report JSON, whose handler knows the repository and states the
///   HTML page as its canonical, or `noindex` for a thin or ref-scoped report.
pub fn robots_tag_for(path: &str) -> Option<&'static str> {
    if path == "/robots.txt" || path == "/healthz" || path == "/readyz" {
        return None;
    }
    let saved_report_json = path.starts_with("/api/reports/") && !path.ends_with(".svg");
    if saved_report_json || path == "/api/seo/report" {
        return None;
    }
    let machine_readable = path.starts_with("/api/")
        || path.starts_with("/badge/")
        || path.starts_with("/og/")
        || path.starts_with("/internal/");
    machine_readable.then_some(NOINDEX)
}

/// The canonical `Link` header for an SEO report whose HTML page is
/// indexable, or `None` when the JSON should carry `noindex` instead: a
/// report below the indexable file floor has no HTML page (it answers 404),
/// and a ref-scoped lookup cannot say which of the tree or root URL is
/// canonical. `public_path` is the report's own `/github/:owner/:repo` path,
/// built by the store, never from the request.
pub fn report_canonical_link(public_path: &str, indexable: bool) -> Option<HeaderValue> {
    if !indexable || !public_path.starts_with("/github/") {
        return None;
    }
    HeaderValue::from_str(&format!(
        "<https://octocounts.com{public_path}>; rel=\"canonical\""
    ))
    .ok()
}

/// Adds the directive to a response the policy itself produced (the report
/// handler, which knows the repository).
pub fn set_noindex(headers: &mut HeaderMap) {
    headers.insert(X_ROBOTS_TAG.clone(), HeaderValue::from_static(NOINDEX));
}

fn has_canonical_link(headers: &HeaderMap) -> bool {
    headers.get_all(header::LINK).iter().any(|value| {
        value
            .to_str()
            .map(|text| text.to_ascii_lowercase().contains("rel=\"canonical\""))
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{header, Request},
        routing::get,
        Router,
    };
    use tower::ServiceExt;

    use super::*;

    #[test]
    fn machine_readable_paths_are_noindex_and_infrastructure_is_left_alone() {
        for path in [
            "/api/stats",
            "/api/repo-info",
            "/api/seo/sitemap",
            "/api/seo/popular",
            "/api/seo/related",
            "/api/jobs/abc",
            "/badge/o/r",
            "/badge/o/r/branch/main?lang=rust",
            "/og/github/o/r",
            "/api/reports/abc/badge.svg",
            "/internal/stats",
        ] {
            assert_eq!(robots_tag_for(path), Some(NOINDEX), "{path}");
        }
        for path in [
            "/robots.txt",
            "/healthz",
            "/readyz",
            "/api/reports/abc",
            "/api/seo/report",
            "/",
            "/docs/api",
        ] {
            assert_eq!(robots_tag_for(path), None, "{path}");
        }
    }

    #[test]
    fn failures_never_carry_noindex() {
        let mut headers = HeaderMap::new();
        apply("/api/stats", StatusCode::SERVICE_UNAVAILABLE, &mut headers);
        apply("/api/stats", StatusCode::NOT_FOUND, &mut headers);
        apply("/api/stats", StatusCode::TOO_MANY_REQUESTS, &mut headers);
        assert!(headers.is_empty());

        apply("/api/stats", StatusCode::OK, &mut headers);
        assert_eq!(headers[&X_ROBOTS_TAG], NOINDEX);

        let mut html = HeaderMap::new();
        apply("/healthz", StatusCode::OK, &mut html);
        assert!(html.is_empty());
    }

    #[test]
    fn report_link_states_the_html_page_or_nothing() {
        assert_eq!(
            report_canonical_link("/github/react/react", true).unwrap(),
            "<https://octocounts.com/github/react/react>; rel=\"canonical\""
        );
        assert!(report_canonical_link("/github/react/react", false).is_none());
        assert!(report_canonical_link("/gitlab/a/b", true).is_none());
        assert!(report_canonical_link("/github/a/b\n", true).is_none());
    }

    /// The middleware, end to end: what a handler produces is augmented, a
    /// directive the handler set itself is kept, and other routes are not
    /// touched.
    #[tokio::test]
    async fn middleware_tags_machine_readable_responses() {
        let app = Router::new()
            .route("/api/stats", get(|| async { " {} " }))
            .route("/badge/o/r", get(|| async { "<svg/>" }))
            .route(
                "/api/seo/report",
                get(|| async {
                    (
                        [(
                            header::LINK,
                            "<https://octocounts.com/github/o/r>; rel=\"canonical\"",
                        )],
                        "{}",
                    )
                }),
            )
            .route("/healthz", get(|| async { "ok" }))
            .layer(axum::middleware::from_fn(tag_indexing));
        for (uri, expected) in [
            ("/api/stats", Some(NOINDEX)),
            ("/badge/o/r", Some(NOINDEX)),
            ("/api/seo/report", None),
            ("/healthz", None),
            ("/missing", None),
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(
                response
                    .headers()
                    .get(&X_ROBOTS_TAG)
                    .and_then(|value| value.to_str().ok()),
                expected,
                "{uri}"
            );
        }
        let kept = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/seo/report")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            kept.headers()[header::LINK],
            "<https://octocounts.com/github/o/r>; rel=\"canonical\""
        );
    }

    #[test]
    fn robots_file_allows_crawling_and_excludes_only_state_routes() {
        assert!(ROBOTS_TXT.starts_with("User-agent: *\nAllow: /\n"));
        for line in ROBOTS_TXT
            .lines()
            .filter(|line| line.starts_with("Disallow: "))
        {
            assert!(
                ["/api/analyze", "/api/jobs/", "/api/auth/", "/internal/"].contains(&&line[10..]),
                "{line}"
            );
        }
        assert!(ROBOTS_TXT.contains("Sitemap: https://octocounts.com/sitemap.xml"));
        for crawlable in ["/api/seo/", "/api/reports/", "/badge/", "/og/"] {
            assert!(!ROBOTS_TXT.contains(&format!("Disallow: {crawlable}")));
        }
    }
}
