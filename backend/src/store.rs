use anyhow::Context;
use chrono::{DateTime, Utc};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::models::{ApiErrorBody, JobRecord, JobStatus, Report};

#[derive(Clone)]
pub struct Store {
    pool: SqlitePool,
}

impl Store {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn migrate(&self) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS reports (
                id TEXT PRIMARY KEY,
                owner TEXT NOT NULL,
                repo TEXT NOT NULL,
                commit_sha TEXT NOT NULL,
                tokei_version TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(owner, repo, commit_sha, tokei_version)
            );
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                report_id TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn cached_report(&self, owner: &str, repo: &str, commit_sha: &str, tokei_version: &str) -> anyhow::Result<Option<Report>> {
        let row = sqlx::query(
            "SELECT body FROM reports WHERE owner = ? AND repo = ? AND commit_sha = ? AND tokei_version = ?",
        )
        .bind(owner)
        .bind(repo)
        .bind(commit_sha)
        .bind(tokei_version)
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| {
            let body: String = row.try_get("body")?;
            let mut report: Report = serde_json::from_str(&body)?;
            report.cached = true;
            Ok(report)
        })
        .transpose()
    }

    pub async fn save_report(&self, report: &Report) -> anyhow::Result<()> {
        let body = serde_json::to_string(report)?;
        sqlx::query(
            r#"
            INSERT OR REPLACE INTO reports (id, owner, repo, commit_sha, tokei_version, body, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&report.id)
        .bind(&report.repository.owner)
        .bind(&report.repository.name)
        .bind(&report.commit_sha)
        .bind(&report.tokei_version)
        .bind(body)
        .bind(report.generated_at.to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn report(&self, id: &str) -> anyhow::Result<Option<Report>> {
        let row = sqlx::query("SELECT body FROM reports WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        row.map(|row| {
            let body: String = row.try_get("body")?;
            Ok(serde_json::from_str(&body)?)
        })
        .transpose()
    }

    pub async fn create_job(&self, id: Uuid) -> anyhow::Result<JobRecord> {
        let now = Utc::now();
        sqlx::query("INSERT INTO jobs (id, status, created_at, updated_at) VALUES (?, ?, ?, ?)")
            .bind(id.to_string())
            .bind(status_to_str(&JobStatus::Queued))
            .bind(now.to_rfc3339())
            .bind(now.to_rfc3339())
            .execute(&self.pool)
            .await?;

        Ok(JobRecord {
            id,
            status: JobStatus::Queued,
            report_id: None,
            error: None,
            created_at: now,
            updated_at: now,
        })
    }

    pub async fn set_job_running(&self, id: Uuid) -> anyhow::Result<()> {
        self.update_job(id, JobStatus::Running, None, None).await
    }

    pub async fn set_job_completed(&self, id: Uuid, report_id: String) -> anyhow::Result<()> {
        self.update_job(id, JobStatus::Completed, Some(report_id), None).await
    }

    pub async fn set_job_failed(&self, id: Uuid, error: ApiErrorBody) -> anyhow::Result<()> {
        self.update_job(id, JobStatus::Failed, None, Some(error)).await
    }

    async fn update_job(&self, id: Uuid, status: JobStatus, report_id: Option<String>, error: Option<ApiErrorBody>) -> anyhow::Result<()> {
        let error = error.map(|value| serde_json::to_string(&value)).transpose()?;
        sqlx::query("UPDATE jobs SET status = ?, report_id = ?, error = ?, updated_at = ? WHERE id = ?")
            .bind(status_to_str(&status))
            .bind(report_id)
            .bind(error)
            .bind(Utc::now().to_rfc3339())
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn job(&self, id: Uuid) -> anyhow::Result<Option<JobRecord>> {
        let row = sqlx::query("SELECT id, status, report_id, error, created_at, updated_at FROM jobs WHERE id = ?")
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;

        row.map(row_to_job).transpose()
    }
}

fn row_to_job(row: sqlx::sqlite::SqliteRow) -> anyhow::Result<JobRecord> {
    let id: String = row.try_get("id")?;
    let status: String = row.try_get("status")?;
    let error: Option<String> = row.try_get("error")?;
    let created_at: String = row.try_get("created_at")?;
    let updated_at: String = row.try_get("updated_at")?;

    Ok(JobRecord {
        id: Uuid::parse_str(&id).context("invalid job id in database")?,
        status: status_from_str(&status),
        report_id: row.try_get("report_id")?,
        error: error.map(|value| serde_json::from_str::<ApiErrorBody>(&value)).transpose()?,
        created_at: DateTime::parse_from_rfc3339(&created_at)?.with_timezone(&Utc),
        updated_at: DateTime::parse_from_rfc3339(&updated_at)?.with_timezone(&Utc),
    })
}

fn status_to_str(status: &JobStatus) -> &'static str {
    match status {
        JobStatus::Queued => "queued",
        JobStatus::Running => "running",
        JobStatus::Completed => "completed",
        JobStatus::Failed => "failed",
    }
}

fn status_from_str(status: &str) -> JobStatus {
    match status {
        "running" => JobStatus::Running,
        "completed" => JobStatus::Completed,
        "failed" => JobStatus::Failed,
        _ => JobStatus::Queued,
    }
}
