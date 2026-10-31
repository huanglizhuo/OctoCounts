use std::{collections::HashMap, time::Duration};

use axum::{extract::Request, http::HeaderValue, middleware::Next, response::Response};
use reqwest::Client;
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgListener, PgPool, Row};

use crate::cache::AppCaches;

pub fn repo_tag(provider: &str, owner: &str, repo: &str) -> String {
    hashed_tag("repo", &format!("{provider}:{owner}/{repo}").to_lowercase())
}

fn report_tag(id: &str) -> String {
    hashed_tag("report", id)
}

fn hashed_tag(kind: &str, value: &str) -> String {
    let hash: String = Sha256::digest(value)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("octo-{kind}-{hash}")
}

fn request_tag(uri: &axum::http::Uri) -> Option<String> {
    let url = url::Url::parse(&format!("http://localhost{uri}")).ok()?;
    let parts: Vec<String> = url
        .path()
        .split('/')
        .skip(1)
        .map(|part| urlencoding::decode(part).map(|s| s.into_owned()))
        .collect::<Result<_, _>>()
        .ok()?;
    let p: Vec<&str> = parts.iter().map(String::as_str).collect();
    match p.as_slice() {
        ["api", "reports", id, ..] => Some(report_tag(id)),
        ["badge", owner, repo, ..] => Some(repo_tag("github", owner, repo)),
        ["og", "github", owner, repo] => Some(repo_tag("github", owner, repo)),
        ["og", "gitlab", rest @ ..] if rest.len() >= 2 => Some(repo_tag(
            "gitlab",
            &rest[..rest.len() - 1].join("/"),
            rest[rest.len() - 1],
        )),
        ["api", "seo", "report" | "related" | "redirect" | "repo-history"] => {
            let query: HashMap<_, _> = url.query_pairs().collect();
            Some(repo_tag(
                query
                    .get("provider")
                    .map(|s| s.as_ref())
                    .unwrap_or("github"),
                query.get("owner")?,
                query.get("repo")?,
            ))
        }
        _ => None,
    }
}

pub async fn tag_response(request: Request, next: Next) -> Response {
    let tag = request_tag(request.uri());
    let mut response = next.run(request).await;
    if let Some(tag) = tag {
        let dependencies = response
            .headers()
            .get("cache-tag")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");
        let value =
            HeaderValue::from_str(format!("octo-api,{tag},{dependencies}").trim_end_matches(','))
                .expect("hex cache tag");
        response.headers_mut().insert("cache-tag", value);
    }
    response
}

pub async fn migrate(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::raw_sql(include_str!("cache_purge.sql"))
        .execute(pool)
        .await?;
    Ok(())
}

// LISTEN is per process; both serving and standby nodes must forget origin caches.
pub async fn listen(
    pool: &PgPool,
    caches: AppCaches,
) -> anyhow::Result<tokio::task::JoinHandle<()>> {
    let mut listener = PgListener::connect_with(pool).await?;
    listener.listen("octocounts_cache_changed").await?;
    Ok(tokio::spawn(async move {
        loop {
            let result = listener.try_recv().await;
            caches.invalidate_reports();
            if let Err(error) = result {
                tracing::warn!(%error, "cache notification interrupted; origin caches cleared");
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
            // None means SQLx reconnected: notifications in the gap may have been lost.
        }
    }))
}

pub fn start_purger(pool: PgPool, token: String, zone: String) -> anyhow::Result<()> {
    anyhow::ensure!(
        zone.len() == 32 && zone.bytes().all(|c| c.is_ascii_hexdigit()),
        "invalid CLOUDFLARE_ZONE_ID"
    );
    anyhow::ensure!(
        !token.trim().is_empty(),
        "CLOUDFLARE_CACHE_PURGE_TOKEN is empty"
    );
    let client = Client::builder().timeout(Duration::from_secs(15)).build()?;
    let endpoint = format!("https://api.cloudflare.com/client/v4/zones/{zone}/purge_cache");
    tokio::spawn(async move {
        loop {
            if let Err(error) = purge_pending(&pool, &client, &endpoint, &token).await {
                tracing::warn!(%error, "cache purge failed; durable queue retained for retry");
            }
            // Two batches/minute stays below the Free plan's purge-by-tag limit.
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
    Ok(())
}

async fn purge_pending(
    pool: &PgPool,
    client: &Client,
    endpoint: &str,
    token: &str,
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    let locked: bool = sqlx::query_scalar(
        "SELECT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':cache-purge', 0))",
    )
    .fetch_one(&mut *tx)
    .await?;
    if !locked {
        return Ok(());
    }
    let rows = sqlx::query("SELECT tag, version FROM cache_purge_queue WHERE ready_at <= NOW() ORDER BY ready_at LIMIT 100")
        .fetch_all(&mut *tx).await?;
    if rows.is_empty() {
        return Ok(());
    }
    let tags: Vec<String> = rows.iter().map(|r| r.get("tag")).collect();
    let versions: Vec<i64> = rows.iter().map(|r| r.get("version")).collect();
    let result = async {
        let response = client
            .post(endpoint)
            .bearer_auth(token)
            .json(&serde_json::json!({"tags": tags}))
            .send()
            .await?;
        let status = response.status();
        let payload: serde_json::Value = response.json().await?;
        anyhow::ensure!(
            status.is_success() && payload["success"] == true,
            "Cloudflare purge returned {status} (success={})",
            payload["success"]
        );
        anyhow::Ok(())
    }
    .await;
    if result.is_ok() {
        // A newer write racing the HTTP request must keep its own pending purge.
        sqlx::query("DELETE FROM cache_purge_queue q USING unnest($1::text[], $2::bigint[]) AS sent(tag, version) WHERE q.tag = sent.tag AND q.version = sent.version")
            .bind(&tags).bind(&versions).execute(&mut *tx).await?;
        tracing::info!(tags = tags.len(), "Cloudflare cache purged");
    } else {
        sqlx::query("UPDATE cache_purge_queue q SET attempts = LEAST(attempts + 1, 10), ready_at = NOW() + make_interval(secs => LEAST(300, 30 * (attempts + 1))) FROM unnest($1::text[], $2::bigint[]) AS sent(tag, version) WHERE q.tag = sent.tag AND q.version = sent.version")
            .bind(&tags).bind(&versions).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::State, http::StatusCode, routing::post, Json, Router};
    use sqlx::postgres::PgPoolOptions;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    async fn database() -> Option<(PgPool, String)> {
        let url = std::env::var("TEST_DATABASE_URL").ok()?;
        let schema = format!("edge_cache_{}", uuid::Uuid::new_v4().simple());
        let admin = PgPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .unwrap();
        sqlx::query(&format!("CREATE SCHEMA {schema}"))
            .execute(&admin)
            .await
            .unwrap();
        admin.close().await;
        let search_path = schema.clone();
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .after_connect(move |connection, _| {
                let schema = search_path.clone();
                Box::pin(async move {
                    sqlx::query(&format!("SET search_path TO {schema}"))
                        .execute(connection)
                        .await?;
                    Ok(())
                })
            })
            .connect(&url)
            .await
            .unwrap();
        crate::store::Store::new(pool.clone())
            .migrate()
            .await
            .unwrap();
        Some((pool, schema))
    }

    async fn cleanup(pool: PgPool, schema: String) {
        sqlx::query(&format!("DROP SCHEMA {schema} CASCADE"))
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
    }

    async fn tags(pool: &PgPool) -> Vec<String> {
        sqlx::query_scalar("SELECT tag FROM cache_purge_queue ORDER BY tag")
            .fetch_all(pool)
            .await
            .unwrap()
    }

    async fn insert_report(pool: &PgPool) {
        sqlx::query("INSERT INTO reports (id, provider, owner, repo, commit_sha, tokei_version, body) VALUES ('one', 'github', 'Octo', 'Count', 'abc', 'test', '{}'::jsonb)")
            .execute(pool).await.unwrap();
    }

    #[test]
    fn tags_cover_query_order_casing_encoded_names_and_snapshot_badges() {
        let expected = repo_tag("github", "Octo", "Count");
        for path in [
            "/api/seo/report?repo=Count&owner=Octo&provider=github&refName=main",
            "/api/seo/report?owner=octo&provider=github&repo=count",
            "/badge/Octo/Count/branch/a%2Fb?lang=Rust",
            "/og/github/Octo/Count",
        ] {
            assert_eq!(request_tag(&path.parse().unwrap()), Some(expected.clone()));
        }
        assert_eq!(
            request_tag(&"/api/reports/one/badge.svg?lang=Rust".parse().unwrap()),
            Some(report_tag("one"))
        );
        assert_eq!(
            request_tag(&"/og/gitlab/group%2Fsub/project".parse().unwrap()),
            Some(repo_tag("gitlab", "group/sub", "project"))
        );
        assert_eq!(request_tag(&"/api/jobs/one".parse().unwrap()), None);
    }

    #[tokio::test]
    async fn outbox_is_transactional_and_covers_replacement_rename_ref_and_delete() {
        let Some((pool, schema)) = database().await else {
            return;
        };
        insert_report(&pool).await;
        let original = tags(&pool).await;
        assert!(original.contains(&repo_tag("github", "Octo", "Count")));
        assert!(original.contains(&report_tag("one")));
        let version: i64 = sqlx::query_scalar("SELECT max(version) FROM cache_purge_queue")
            .fetch_one(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE reports SET access_count = 42, last_accessed_at = NOW()")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            version,
            sqlx::query_scalar::<_, i64>("SELECT max(version) FROM cache_purge_queue")
                .fetch_one(&pool)
                .await
                .unwrap()
        );
        sqlx::query("DELETE FROM cache_purge_queue")
            .execute(&pool)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("DELETE FROM reports")
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.rollback().await.unwrap();
        assert!(tags(&pool).await.is_empty());
        sqlx::query("UPDATE reports SET id = 'two', owner = 'Next'")
            .execute(&pool)
            .await
            .unwrap();
        let changed = tags(&pool).await;
        for tag in [
            report_tag("one"),
            report_tag("two"),
            repo_tag("github", "Octo", "Count"),
            repo_tag("github", "Next", "Count"),
        ] {
            assert!(changed.contains(&tag));
        }
        sqlx::query("INSERT INTO repo_redirects (provider, old_owner, old_repo, new_owner, new_repo) VALUES ('github', 'Octo', 'Count', 'Next', 'Count')").execute(&pool).await.unwrap();
        sqlx::query("DELETE FROM cache_purge_queue")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO repository_refs (provider, owner, repo, ref_name, commit_sha) VALUES ('github', 'next', 'count', 'main', 'abc')").execute(&pool).await.unwrap();
        assert!(tags(&pool)
            .await
            .contains(&repo_tag("github", "octo", "count")));
        sqlx::query("DELETE FROM cache_purge_queue")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE repository_refs SET resolved_at = NOW()")
            .execute(&pool)
            .await
            .unwrap();
        assert!(tags(&pool).await.is_empty());
        sqlx::query("UPDATE repository_refs SET commit_sha = 'def'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(!tags(&pool).await.is_empty());
        sqlx::query("DELETE FROM cache_purge_queue")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM reports")
            .execute(&pool)
            .await
            .unwrap();
        assert!(tags(&pool).await.contains(&report_tag("two")));
        cleanup(pool, schema).await;
    }

    #[tokio::test]
    async fn purge_retries_failures_and_does_not_ack_a_concurrent_write() {
        let Some((pool, schema)) = database().await else {
            return;
        };
        insert_report(&pool).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route(
                "/purge",
                post(
                    |State((pool, calls)): State<(PgPool, Arc<AtomicUsize>)>,
                     Json(payload): Json<serde_json::Value>| async move {
                        assert!(payload["tags"].as_array().unwrap().len() <= 100);
                        let call = calls.fetch_add(1, Ordering::SeqCst);
                        if call == 0 {
                            return (
                                StatusCode::TOO_MANY_REQUESTS,
                                Json(serde_json::json!({"success": false})),
                            );
                        }
                        if call == 1 {
                            sqlx::query("SELECT queue_cache_tag($1)")
                                .bind(repo_tag("github", "Octo", "Count"))
                                .execute(&pool)
                                .await
                                .unwrap();
                        }
                        (StatusCode::OK, Json(serde_json::json!({"success": true})))
                    },
                ),
            )
            .with_state((pool.clone(), calls.clone()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/purge", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = Client::new();
        for attempt in 0..3 {
            sqlx::query("UPDATE cache_purge_queue SET ready_at = NOW()")
                .execute(&pool)
                .await
                .unwrap();
            let result = purge_pending(&pool, &client, &endpoint, "test-token").await;
            if attempt == 0 {
                assert!(result.is_err());
                assert_eq!(tags(&pool).await.len(), 2);
            } else {
                result.unwrap();
            }
            if attempt == 1 {
                assert_eq!(tags(&pool).await, vec![repo_tag("github", "Octo", "Count")]);
            }
        }
        assert!(tags(&pool).await.is_empty());
        server.abort();
        cleanup(pool, schema).await;
    }

    #[tokio::test]
    async fn committed_changes_invalidate_each_process_cache() {
        let Some((pool, schema)) = database().await else {
            return;
        };
        let a = AppCaches::new();
        let b = AppCaches::new();
        a.badge_svg.insert("repo".into(), "old".into()).await;
        b.badge_svg.insert("repo".into(), "old".into()).await;
        let listener_a = listen(&pool, a.clone()).await.unwrap();
        let listener_b = listen(&pool, b.clone()).await.unwrap();
        insert_report(&pool).await;
        tokio::time::timeout(Duration::from_secs(3), async {
            while a.badge_svg.get("repo").await.is_some() || b.badge_svg.get("repo").await.is_some()
            {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        listener_a.abort();
        listener_b.abort();
        cleanup(pool, schema).await;
    }
}
