//! Golden fixtures for the read-only JSON endpoints.
//!
//! Batch B rewrites how `/api/seo/*`, `/api/reports/{id}` and `/api/stats` build
//! their payloads (SQL-side projection instead of "pull the whole report body and
//! re-serialize it"). These tests pin the exact response bytes of the pre-batch-B
//! implementation so any drift shows up as a diff instead of as a silent API change.
//!
//! The fixtures under `src/testdata/` were captured from the implementation that
//! existed before batch B. Regenerate deliberately, never casually:
//!
//! ```sh
//! OCTOCOUNTS_UPDATE_GOLDEN=1 \
//! TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/octocounts_test \
//! cargo test golden
//! ```

use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use chrono::{DateTime, TimeZone, Utc};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

use crate::{
    api::AppState,
    cache::AppCaches,
    coordinator::AnalysisCoordinator,
    github::GitHubClient,
    models::{
        AnalysisOptions, AnalysisSource, LanguageReport, LanguageStats, Report, Repository,
        RepositoryProvider,
    },
    store::Store,
};

/// The report id used by the `/api/reports/{id}` fixture. This row is inserted as
/// raw JSON that predates `analysisKey` / `analysisOptions` / `repository.provider`,
/// because those three fields carry `#[serde(default)]` and are therefore *added* by
/// the parse-then-re-serialize path. Any raw-passthrough replacement has to keep
/// filling them in.
const LEGACY_REPORT_ID: &str = "report-legacy-shape";

/// A report saved through the normal `save_report` path.
const MODERN_REPORT_ID: &str = "report-rust-lang-rust-new";

struct Harness {
    router: Router,
    store: Store,
    pool: sqlx::PgPool,
    schema: String,
}

impl Harness {
    async fn get(&self, uri: &str) -> (StatusCode, String) {
        let response = self
            .router
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        (status, String::from_utf8(bytes.to_vec()).unwrap())
    }

    async fn drop_schema(self) {
        sqlx::query(&format!("DROP SCHEMA IF EXISTS {} CASCADE", self.schema))
            .execute(&self.pool)
            .await
            .unwrap();
    }
}

async fn harness() -> Option<Harness> {
    let database_url = std::env::var("TEST_DATABASE_URL").ok()?;
    if !database_url.starts_with("postgres://") && !database_url.starts_with("postgresql://") {
        return None;
    }
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .ok()?;
    let schema = format!("golden_{}", uuid::Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE SCHEMA {schema}"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(&format!("SET search_path TO {schema}"))
        .execute(&pool)
        .await
        .unwrap();

    let store = Store::new(pool.clone());
    store.migrate().await.unwrap();
    seed(&store).await;

    let state = AppState {
        coordinator: AnalysisCoordinator::new(store.clone(), GitHubClient::new().unwrap(), 1, None),
        caches: AppCaches::new(),
    };
    Some(Harness {
        router: crate::build_router(state),
        store,
        pool,
        schema,
    })
}

fn at(year: i32, month: u32, day: u32, hour: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(year, month, day, hour, 30, 15).unwrap()
}

fn stats(files: usize, code: usize, comments: usize, blanks: usize) -> LanguageStats {
    LanguageStats {
        files,
        lines: code + comments + blanks,
        code,
        comments,
        blanks,
    }
}

fn language(name: &str, files: usize, code: usize) -> LanguageReport {
    LanguageReport {
        name: name.to_string(),
        stats: stats(files, code, code / 7, code / 11),
        children: Vec::new(),
    }
}

/// Seeds a deterministic, deliberately awkward corpus:
///
/// * a repository with more than 12 languages (the SEO card truncates at 12 but
///   still reports the *full* language count in its prose),
/// * two rows for that same repository so `DISTINCT ON (provider, owner, repo)`
///   actually has something to dedupe,
/// * a GitLab repository whose owner is a nested group path,
/// * a repository with no languages at all (percent/top-language edge case),
/// * a nested-`children` language, and
/// * a legacy raw row missing the three `#[serde(default)]` fields.
async fn seed(store: &Store) {
    let mut big = report(
        MODERN_REPORT_ID,
        RepositoryProvider::GitHub,
        "rust-lang",
        "rust",
        "9f8e7d6c5b4a39281706",
        at(2024, 3, 14, 9),
    );
    big.languages = vec![
        language("Rust", 12_345, 1_234_567),
        language("C", 890, 456_789),
        language("C++", 611, 234_567),
        language("Python", 512, 123_456),
        language("JavaScript", 431, 98_765),
        language("Shell", 322, 45_678),
        language("Markdown", 289, 34_567),
        language("YAML", 233, 23_456),
        language("TOML", 187, 12_345),
        language("HTML", 145, 9_876),
        language("CSS", 121, 8_765),
        language("Makefile", 98, 7_654),
        language("Dockerfile", 76, 6_543),
        language("Nix", 54, 5_432),
        language("Assembly", 32, 4_321),
    ];
    big.languages[0].children = vec![language("Markdown", 40, 4_000)];
    big.total = stats(16_346, 2_306_821, 329_546, 209_710);
    big.duration_ms = 91_234;
    store.save_report(&big, AnalysisSource::Web).await.unwrap();

    // Older row for the same repository: must lose to `big` in every list.
    let mut older = report(
        "report-rust-lang-rust-old",
        RepositoryProvider::GitHub,
        "rust-lang",
        "rust",
        "00001111222233334444",
        at(2024, 1, 2, 3),
    );
    older.languages = vec![language("Rust", 11_000, 1_000_000)];
    older.total = stats(11_000, 1_000_000, 142_857, 90_909);
    store
        .save_report(&older, AnalysisSource::Cli)
        .await
        .unwrap();

    let mut gitlab = report(
        "report-gitlab-runner",
        RepositoryProvider::GitLab,
        "gitlab-org/ci-cd",
        "gitlab-runner",
        "aabbccddeeff00112233",
        at(2024, 5, 20, 17),
    );
    gitlab.repository.html_url = "https://gitlab.com/gitlab-org/ci-cd/gitlab-runner".to_string();
    gitlab.languages = vec![language("Go", 2_101, 345_678), language("Shell", 88, 4_321)];
    gitlab.total = stats(2_189, 350_000, 50_000, 31_818);
    gitlab.duration_ms = 4_567;
    store
        .save_report(&gitlab, AnalysisSource::Mcp)
        .await
        .unwrap();

    let mut empty = report(
        "report-empty",
        RepositoryProvider::GitHub,
        "octocounts",
        "empty",
        "ffffffffffffffffffff",
        at(2024, 6, 1, 0),
    );
    empty.languages = Vec::new();
    empty.total = LanguageStats::default();
    empty.duration_ms = 7;
    store
        .save_report(&empty, AnalysisSource::GitHubTrending)
        .await
        .unwrap();

    // A body shaped like the rows written before `analysisKey`, `analysisOptions`
    // and `repository.provider` existed.
    store
        .insert_raw_report(
            LEGACY_REPORT_ID,
            "github",
            "octocounts",
            "legacy",
            "1111222233334444aaaa",
            "tokei-14.0.0:default",
            r#"{
                "id": "report-legacy-shape",
                "repository": {
                    "owner": "octocounts",
                    "name": "legacy",
                    "htmlUrl": "https://github.com/octocounts/legacy"
                },
                "refName": "master",
                "commitSha": "1111222233334444aaaa",
                "generatedAt": "2024-02-29T11:30:15.123456789Z",
                "durationMs": 1234,
                "cached": false,
                "tokeiVersion": "tokei-14.0.0",
                "languages": [
                    {
                        "name": "Perl",
                        "stats": {"files": 9, "lines": 900, "code": 700, "comments": 120, "blanks": 80},
                        "children": []
                    }
                ],
                "total": {"files": 9, "lines": 900, "code": 700, "comments": 120, "blanks": 80}
            }"#,
            at(2024, 2, 29, 11),
        )
        .await
        .unwrap();

    // Deterministic popularity ordering.
    for (id, last_accessed_hours, count) in [
        (MODERN_REPORT_ID, 100, 9_001_i64),
        ("report-rust-lang-rust-old", 400, 12),
        ("report-gitlab-runner", 200, 4_242),
        ("report-empty", 300, 7),
        (LEGACY_REPORT_ID, 500, 512),
    ] {
        store
            .force_report_access_metadata(
                id,
                at(2024, 6, 1, 0) - chrono::Duration::hours(last_accessed_hours),
                count,
            )
            .await
            .unwrap();
    }
}

fn report(
    id: &str,
    provider: RepositoryProvider,
    owner: &str,
    name: &str,
    commit_sha: &str,
    generated_at: DateTime<Utc>,
) -> Report {
    Report {
        id: id.to_string(),
        repository: Repository {
            provider,
            owner: owner.to_string(),
            name: name.to_string(),
            html_url: format!("https://github.com/{owner}/{name}"),
        },
        ref_name: "main".to_string(),
        commit_sha: commit_sha.to_string(),
        generated_at,
        duration_ms: 1_000,
        cached: false,
        tokei_version: "tokei-14.0.0".to_string(),
        analysis_key: "tokei-14.0.0:default".to_string(),
        analysis_options: AnalysisOptions::default(),
        languages: vec![language("Rust", 1, 100)],
        total: stats(1, 100, 14, 9),
    }
}

fn golden_path(name: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("testdata")
        .join(name)
}

/// Compares `actual` against the committed fixture, or rewrites the fixture when
/// `OCTOCOUNTS_UPDATE_GOLDEN` is set.
fn assert_golden(name: &str, actual: &str) {
    let path = golden_path(name);
    let normalized = normalize(actual);
    if std::env::var("OCTOCOUNTS_UPDATE_GOLDEN").is_ok() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &normalized).unwrap();
        return;
    }
    let expected = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("missing golden fixture {}: {error}", path.display()));
    assert_eq!(
        normalized,
        expected,
        "response drifted from {}",
        path.display()
    );
}

/// Pretty-prints so diffs are readable. Key order and whitespace of the raw
/// response are checked separately by `raw_report_bytes_are_serde_shaped`.
fn normalize(actual: &str) -> String {
    let value: serde_json::Value = serde_json::from_str(actual).unwrap();
    format!("{}\n", serde_json::to_string_pretty(&value).unwrap())
}

#[tokio::test]
async fn seo_recent_matches_golden() {
    let Some(harness) = harness().await else {
        return;
    };
    let (status, body) = harness.get("/api/seo/recent?page=1&limit=24").await;
    assert_eq!(status, StatusCode::OK);
    assert_golden("seo_recent.json", &body);
    harness.drop_schema().await;
}

#[tokio::test]
async fn seo_popular_matches_golden() {
    let Some(harness) = harness().await else {
        return;
    };
    let (status, body) = harness.get("/api/seo/popular?page=1&limit=24").await;
    assert_eq!(status, StatusCode::OK);
    assert_golden("seo_popular.json", &body);
    harness.drop_schema().await;
}

#[tokio::test]
async fn seo_monoliths_matches_golden() {
    let Some(harness) = harness().await else {
        return;
    };
    let (status, body) = harness.get("/api/seo/monoliths?page=1&limit=24").await;
    assert_eq!(status, StatusCode::OK);
    assert_golden("seo_monoliths.json", &body);
    harness.drop_schema().await;
}

#[tokio::test]
async fn seo_sitemap_matches_golden() {
    let Some(harness) = harness().await else {
        return;
    };
    let (status, body) = harness.get("/api/seo/sitemap").await;
    assert_eq!(status, StatusCode::OK);
    assert_golden("seo_sitemap.json", &body);
    harness.drop_schema().await;
}

#[tokio::test]
async fn seo_report_matches_golden() {
    let Some(harness) = harness().await else {
        return;
    };
    let (status, body) = harness
        .get("/api/seo/report?provider=github&owner=rust-lang&repo=rust")
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_golden("seo_report.json", &body);
    harness.drop_schema().await;
}

#[tokio::test]
async fn stats_matches_golden() {
    let Some(harness) = harness().await else {
        return;
    };
    let (status, body) = harness.get("/api/stats").await;
    assert_eq!(status, StatusCode::OK);
    assert_golden("stats.json", &body);
    harness.drop_schema().await;
}

#[tokio::test]
async fn modern_report_by_id_matches_golden() {
    let Some(harness) = harness().await else {
        return;
    };
    let (status, body) = harness
        .get(&format!("/api/reports/{MODERN_REPORT_ID}"))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_golden("report_modern.json", &body);
    harness.drop_schema().await;
}

/// The row that predates `analysisKey` / `analysisOptions` / `repository.provider`.
/// The old handler materialised those defaults on the way out; the fixture records
/// that, so a raw-passthrough implementation cannot quietly drop them.
#[tokio::test]
async fn legacy_report_by_id_matches_golden() {
    let Some(harness) = harness().await else {
        return;
    };
    let (status, body) = harness
        .get(&format!("/api/reports/{LEGACY_REPORT_ID}"))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_golden("report_legacy.json", &body);
    harness.drop_schema().await;
}

/// `/api/reports/{id}` must keep reporting whatever `cached` the stored body has;
/// it is *not* forced to `true` the way the analyze-cache-hit path does.
#[tokio::test]
async fn report_by_id_preserves_stored_cached_flag() {
    let Some(harness) = harness().await else {
        return;
    };
    for id in [MODERN_REPORT_ID, LEGACY_REPORT_ID] {
        let (_, body) = harness.get(&format!("/api/reports/{id}")).await;
        let value: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(
            value["cached"],
            serde_json::Value::Bool(false),
            "{id} must round-trip cached=false"
        );
    }

    let mut cached = report(
        "report-cached-true",
        RepositoryProvider::GitHub,
        "octocounts",
        "cached",
        "cccc111122223333dddd",
        at(2024, 7, 7, 7),
    );
    cached.cached = true;
    harness
        .store
        .save_report(&cached, AnalysisSource::Api)
        .await
        .unwrap();

    let (_, body) = harness.get("/api/reports/report-cached-true").await;
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["cached"], serde_json::Value::Bool(true));

    harness.drop_schema().await;
}
