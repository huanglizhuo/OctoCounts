use sqlx::{Connection, Executor, PgConnection};

#[tokio::test]
async fn owner_migrates_and_runtime_can_write_reports_without_ddl() {
    let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
        return;
    };
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let schema = format!("runtime_{suffix}");
    let role = format!("app_{suffix}");
    let mut admin = PgConnection::connect(&url).await.unwrap();
    admin
        .execute(format!("CREATE SCHEMA {schema}").as_str())
        .await
        .unwrap();
    let mut migration_url = url::Url::parse(&url).unwrap();
    migration_url
        .query_pairs_mut()
        .append_pair("options", &format!("-c search_path={schema}"));
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_octocount-service"))
        .arg("--migrate-only")
        .env("DATABASE_URL", migration_url.as_str())
        .env("RUN_MIGRATIONS", "false")
        .output()
        .unwrap();
    assert!(output.status.success(), "migration command failed");
    admin
        .execute(format!("CREATE ROLE {role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; GRANT USAGE ON SCHEMA {schema} TO {role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA {schema} TO {role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA {schema} TO {role}; SET search_path={schema}; SET ROLE {role}").as_str())
        .await.unwrap();
    admin.execute("INSERT INTO reports(id,provider,owner,repo,commit_sha,tokei_version,body) VALUES ('role-test','github','test','repo','abc','test','{}')").await.unwrap();
    let queued: i64 = sqlx::query_scalar("SELECT count(*) FROM cache_purge_queue")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert_eq!(queued, 2);
    assert!(admin
        .execute("CREATE TABLE forbidden(id int)")
        .await
        .is_err());
    assert!(admin
        .execute("ALTER TABLE reports ADD COLUMN forbidden int")
        .await
        .is_err());
    admin
        .execute("DELETE FROM reports WHERE id='role-test'")
        .await
        .unwrap();
    admin
        .execute(format!("RESET ROLE; DROP SCHEMA {schema} CASCADE; DROP ROLE {role}").as_str())
        .await
        .unwrap();
}
