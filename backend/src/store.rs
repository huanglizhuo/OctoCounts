use chrono::{DateTime, Duration, Utc};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::models::{ApiErrorBody, JobRecord, JobStatus, Report, RepositoryProvider};

#[derive(Clone)]
pub struct Store {
    pool: PgPool,
}

impl Store {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn migrate(&self) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS reports (
                id TEXT PRIMARY KEY,
                provider TEXT NOT NULL DEFAULT 'github',
                owner TEXT NOT NULL,
                repo TEXT NOT NULL,
                commit_sha TEXT NOT NULL,
                tokei_version TEXT NOT NULL,
                body JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                access_count BIGINT NOT NULL DEFAULT 0,
                body_bytes BIGINT NOT NULL DEFAULT 0,
                CONSTRAINT reports_provider_valid CHECK (provider IN ('github', 'gitlab')),
                CONSTRAINT reports_access_count_nonnegative CHECK (access_count >= 0),
                CONSTRAINT reports_body_bytes_nonnegative CHECK (body_bytes >= 0),
                UNIQUE(provider, owner, repo, commit_sha, tokei_version)
            );
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS jobs (
                id UUID PRIMARY KEY,
                status TEXT NOT NULL,
                provider TEXT,
                report_id TEXT,
                error JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT jobs_provider_valid CHECK (provider IS NULL OR provider IN ('github', 'gitlab')),
                CONSTRAINT jobs_status_valid CHECK (status IN ('queued', 'running', 'completed', 'failed'))
            );
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                    AND table_name = 'jobs'
                    AND column_name = 'id'
                    AND data_type <> 'uuid'
                ) THEN
                    ALTER TABLE jobs ALTER COLUMN id TYPE UUID USING id::uuid;
                END IF;
            END $$;
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                    AND table_name = 'reports'
                    AND column_name = 'body'
                    AND data_type <> 'jsonb'
                ) THEN
                    ALTER TABLE reports ALTER COLUMN body TYPE JSONB USING body::jsonb;
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                    AND table_name = 'jobs'
                    AND column_name = 'error'
                    AND data_type <> 'jsonb'
                ) THEN
                    ALTER TABLE jobs ALTER COLUMN error TYPE JSONB USING error::jsonb;
                END IF;
            END $$;
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query("ALTER TABLE reports ALTER COLUMN created_at SET DEFAULT NOW()")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE reports ALTER COLUMN last_accessed_at SET DEFAULT NOW()")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE reports ALTER COLUMN access_count SET DEFAULT 0")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE reports ALTER COLUMN body_bytes SET DEFAULT 0")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS provider TEXT")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            r#"
            UPDATE reports
            SET provider = LOWER(COALESCE(NULLIF(body->'repository'->>'provider', ''), 'github'))
            WHERE provider IS NULL
            "#,
        )
        .execute(&self.pool)
        .await?;
        sqlx::query("ALTER TABLE reports ALTER COLUMN provider SET DEFAULT 'github'")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE reports ALTER COLUMN provider SET NOT NULL")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE jobs ALTER COLUMN created_at SET DEFAULT NOW()")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE jobs ALTER COLUMN updated_at SET DEFAULT NOW()")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS provider TEXT")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS owner TEXT")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS repo TEXT")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS commit_sha TEXT")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tokei_version TEXT")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "UPDATE jobs SET provider = 'github' WHERE provider IS NULL AND owner IS NOT NULL",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'reports_owner_repo_commit_sha_tokei_version_key'
                    AND connamespace = current_schema()::regnamespace
                ) THEN
                    ALTER TABLE reports DROP CONSTRAINT reports_owner_repo_commit_sha_tokei_version_key;
                END IF;

                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'reports_provider_valid'
                    AND connamespace = current_schema()::regnamespace
                ) THEN
                    ALTER TABLE reports
                    ADD CONSTRAINT reports_provider_valid CHECK (provider IN ('github', 'gitlab'));
                END IF;

                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'jobs_provider_valid'
                    AND connamespace = current_schema()::regnamespace
                ) THEN
                    ALTER TABLE jobs
                    ADD CONSTRAINT jobs_provider_valid CHECK (provider IS NULL OR provider IN ('github', 'gitlab'));
                END IF;

                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'reports_access_count_nonnegative'
                    AND connamespace = current_schema()::regnamespace
                ) THEN
                    ALTER TABLE reports
                    ADD CONSTRAINT reports_access_count_nonnegative CHECK (access_count >= 0);
                END IF;

                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'reports_body_bytes_nonnegative'
                    AND connamespace = current_schema()::regnamespace
                ) THEN
                    ALTER TABLE reports
                    ADD CONSTRAINT reports_body_bytes_nonnegative CHECK (body_bytes >= 0);
                END IF;

                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'jobs_status_valid'
                    AND connamespace = current_schema()::regnamespace
                ) THEN
                    ALTER TABLE jobs
                    ADD CONSTRAINT jobs_status_valid
                    CHECK (status IN ('queued', 'running', 'completed', 'failed'));
                END IF;
            END $$;
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query("DROP INDEX IF EXISTS idx_reports_cache_lookup")
            .execute(&self.pool)
            .await?;
        sqlx::query("DROP INDEX IF EXISTS idx_reports_repo_ref_unique")
            .execute(&self.pool)
            .await?;
        sqlx::query("DROP INDEX IF EXISTS idx_reports_cleanup")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_provider_cache_unique ON reports (provider, owner, repo, commit_sha, tokei_version)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_reports_provider_latest ON reports (provider, owner, repo, created_at DESC)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_reports_recent ON reports (created_at DESC)")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_reports_popular ON reports (access_count DESC, last_accessed_at DESC)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_reports_lru_cleanup ON reports (last_accessed_at, created_at)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query("DROP INDEX IF EXISTS idx_jobs_cleanup")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_jobs_finished_cleanup ON jobs (updated_at) WHERE status IN ('completed', 'failed')",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_jobs_stale_cleanup ON jobs (updated_at) WHERE status IN ('queued', 'running')",
        )
            .execute(&self.pool)
            .await?;
        sqlx::query("DROP INDEX IF EXISTS idx_jobs_active_key_unique")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_active_key_unique
            ON jobs (provider, owner, repo, commit_sha, tokei_version)
            WHERE status IN ('queued', 'running')
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[cfg(test)]
    pub async fn cached_report(
        &self,
        owner: &str,
        repo: &str,
        commit_sha: &str,
        tokei_version: &str,
    ) -> anyhow::Result<Option<Report>> {
        self.cached_report_for_provider(
            RepositoryProvider::GitHub,
            owner,
            repo,
            commit_sha,
            tokei_version,
        )
        .await
    }

    pub async fn cached_report_for_provider(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
        commit_sha: &str,
        tokei_version: &str,
    ) -> anyhow::Result<Option<Report>> {
        let key = ReportCacheKey {
            provider,
            owner,
            repo,
            commit_sha,
            tokei_version,
        };

        self.fetch_cached_report_by_key(key)
            .await?
            .map(|body| {
                let mut report: Report = serde_json::from_str(&body)?;
                report.cached = true;
                Ok(report)
            })
            .transpose()
    }

    pub async fn save_report(&self, report: &Report) -> anyhow::Result<()> {
        let body = serde_json::to_string(report)?;
        let body_bytes = body.len() as i64;
        let provider = provider_to_str(&report.repository.provider);
        sqlx::query(
            r#"
            INSERT INTO reports (
                id, provider, owner, repo, commit_sha, tokei_version, body, created_at,
                last_accessed_at, access_count, body_bytes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8, 0, $9)
            ON CONFLICT (provider, owner, repo, commit_sha, tokei_version)
            DO UPDATE SET
                id = EXCLUDED.id,
                body = EXCLUDED.body,
                created_at = EXCLUDED.created_at,
                last_accessed_at = EXCLUDED.last_accessed_at,
                access_count = 0,
                body_bytes = EXCLUDED.body_bytes
            "#,
        )
        .bind(&report.id)
        .bind(provider)
        .bind(&report.repository.owner)
        .bind(&report.repository.name)
        .bind(&report.commit_sha)
        .bind(&report.analysis_key)
        .bind(body)
        .bind(report.generated_at)
        .bind(body_bytes)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn report(&self, id: &str) -> anyhow::Result<Option<Report>> {
        self.fetch_report_body_by_id(id)
            .await?
            .map(|body| Ok(serde_json::from_str(&body)?))
            .transpose()
    }

    pub async fn latest_report(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
    ) -> anyhow::Result<Option<Report>> {
        let row = sqlx::query(
            r#"
            SELECT body::text AS body
            FROM reports
            WHERE provider = $1 AND owner = $2 AND repo = $3
            ORDER BY created_at DESC
            LIMIT 1
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| row.try_get::<String, _>("body"))
            .transpose()?
            .map(|body| Ok(serde_json::from_str(&body)?))
            .transpose()
    }

    pub async fn recent_reports(&self, limit: i64, offset: i64) -> anyhow::Result<Vec<Report>> {
        self.distinct_reports("created_at DESC", limit, offset)
            .await
    }

    pub async fn popular_reports(&self, limit: i64, offset: i64) -> anyhow::Result<Vec<Report>> {
        self.distinct_reports("access_count DESC, last_accessed_at DESC", limit, offset)
            .await
    }

    pub async fn monolith_reports(&self, limit: i64, offset: i64) -> anyhow::Result<Vec<Report>> {
        self.distinct_reports("total_lines DESC", limit, offset)
            .await
    }

    pub async fn sitemap_reports(&self, limit: i64) -> anyhow::Result<Vec<Report>> {
        self.distinct_reports("created_at DESC", limit, 0).await
    }

    async fn distinct_reports(
        &self,
        order: &'static str,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<Report>> {
        let sql = match order {
            "created_at DESC" => {
                r#"
                SELECT body::text AS body
                FROM (
                    SELECT DISTINCT ON (provider, owner, repo)
                        body, created_at
                    FROM reports
                    ORDER BY provider, owner, repo, created_at DESC
                ) latest
                ORDER BY created_at DESC
                LIMIT $1 OFFSET $2
                "#
            }
            "access_count DESC, last_accessed_at DESC" => {
                r#"
                SELECT body::text AS body
                FROM (
                    SELECT DISTINCT ON (provider, owner, repo)
                        body, access_count, last_accessed_at, created_at
                    FROM reports
                    ORDER BY provider, owner, repo, access_count DESC, last_accessed_at DESC, created_at DESC
                ) popular
                ORDER BY access_count DESC, last_accessed_at DESC, created_at DESC
                LIMIT $1 OFFSET $2
                "#
            }
            "total_lines DESC" => {
                r#"
                SELECT body::text AS body
                FROM (
                    SELECT DISTINCT ON (provider, owner, repo)
                        body,
                        ((body->'total'->>'lines')::bigint) AS total_lines,
                        created_at
                    FROM reports
                    ORDER BY provider, owner, repo, created_at DESC
                ) monoliths
                ORDER BY total_lines DESC, created_at DESC
                LIMIT $1 OFFSET $2
                "#
            }
            _ => unreachable!("unsupported report order"),
        };

        let rows = sqlx::query(sql)
            .bind(limit.clamp(0, 500))
            .bind(offset.max(0))
            .fetch_all(&self.pool)
            .await?;

        rows.into_iter()
            .map(|row| {
                let body: String = row.try_get("body")?;
                let report: Report = serde_json::from_str(&body)?;
                Ok(report)
            })
            .collect()
    }

    async fn fetch_cached_report_by_key(
        &self,
        key: ReportCacheKey<'_>,
    ) -> anyhow::Result<Option<String>> {
        let touched = sqlx::query(
            r#"
            UPDATE reports
            SET last_accessed_at = NOW(), access_count = access_count + 1
            WHERE id = (
                SELECT id
                FROM reports
                WHERE provider = $1 AND owner = $2 AND repo = $3 AND commit_sha = $4 AND tokei_version = $5
            )
            AND last_accessed_at < NOW() - INTERVAL '1 hour'
            RETURNING body::text AS body
            "#,
        )
        .bind(provider_to_str(&key.provider))
        .bind(key.owner)
        .bind(key.repo)
        .bind(key.commit_sha)
        .bind(key.tokei_version)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(row) = touched {
            return Ok(Some(row.try_get("body")?));
        }

        let row = sqlx::query(
            "SELECT body::text AS body FROM reports WHERE provider = $1 AND owner = $2 AND repo = $3 AND commit_sha = $4 AND tokei_version = $5",
        )
        .bind(provider_to_str(&key.provider))
        .bind(key.owner)
        .bind(key.repo)
        .bind(key.commit_sha)
        .bind(key.tokei_version)
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| row.try_get("body"))
            .transpose()
            .map_err(Into::into)
    }

    async fn fetch_report_body_by_id(&self, id: &str) -> anyhow::Result<Option<String>> {
        self.fetch_throttled_report_body(
            "UPDATE reports SET last_accessed_at = NOW(), access_count = access_count + 1 WHERE id = $1 AND last_accessed_at < NOW() - INTERVAL '1 hour' RETURNING body::text AS body",
            "SELECT body::text AS body FROM reports WHERE id = $1",
            id,
        )
        .await
    }

    async fn fetch_throttled_report_body(
        &self,
        update_sql: &str,
        select_sql: &str,
        id: &str,
    ) -> anyhow::Result<Option<String>> {
        let touched = sqlx::query(update_sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        if let Some(row) = touched {
            return Ok(Some(row.try_get("body")?));
        }

        let row = sqlx::query(select_sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        row.map(|row| row.try_get("body"))
            .transpose()
            .map_err(Into::into)
    }

    pub async fn cleanup(&self, config: CleanupConfig) -> anyhow::Result<CleanupStats> {
        let mut tx = self.pool.begin().await?;
        let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
            .bind(CLEANUP_ADVISORY_LOCK_ID)
            .fetch_one(&mut *tx)
            .await?;
        if !locked {
            return Ok(CleanupStats {
                skipped_locked: true,
                ..CleanupStats::default()
            });
        }

        let stats = self.cleanup_locked(config, &mut tx).await?;
        tx.commit().await?;
        Ok(stats)
    }

    async fn cleanup_locked(
        &self,
        config: CleanupConfig,
        tx: &mut Transaction<'_, Postgres>,
    ) -> anyhow::Result<CleanupStats> {
        let completed_cutoff = Utc::now() - Duration::days(config.job_retention_completed_days);
        let stale_cutoff = Utc::now() - Duration::hours(config.job_retention_stale_hours);
        let report_cutoff = Utc::now() - Duration::days(config.report_min_retention_days);

        let completed_jobs_deleted = sqlx::query(
            "DELETE FROM jobs WHERE status IN ('completed', 'failed') AND updated_at < $1",
        )
        .bind(completed_cutoff)
        .execute(&mut **tx)
        .await?
        .rows_affected();

        let stale_jobs_deleted = sqlx::query(
            "DELETE FROM jobs WHERE status IN ('queued', 'running') AND updated_at < $1",
        )
        .bind(stale_cutoff)
        .execute(&mut **tx)
        .await?
        .rows_affected();

        let mut cold_reports_deleted = 0;
        let report_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM reports")
            .fetch_one(&mut **tx)
            .await?;
        let mut over_limit = report_count.saturating_sub(config.report_max_rows);
        while over_limit > 0 {
            let batch_size = over_limit.min(config.report_cleanup_batch_size) as i64;
            let deleted = sqlx::query(
                r#"
                DELETE FROM reports
                WHERE id IN (
                    SELECT id
                    FROM reports
                    WHERE created_at < $1
                    ORDER BY last_accessed_at ASC, created_at ASC
                    LIMIT $2
                )
                "#,
            )
            .bind(report_cutoff)
            .bind(batch_size)
            .execute(&mut **tx)
            .await?
            .rows_affected();
            if deleted == 0 {
                break;
            }
            cold_reports_deleted += deleted;
            over_limit = over_limit.saturating_sub(deleted as i64);
        }

        Ok(CleanupStats {
            skipped_locked: false,
            completed_jobs_deleted,
            stale_jobs_deleted,
            expired_reports_deleted: 0,
            cold_reports_deleted,
        })
    }

    #[cfg(test)]
    async fn force_report_access_metadata(
        &self,
        id: &str,
        last_accessed_at: DateTime<Utc>,
        access_count: i64,
    ) -> anyhow::Result<()> {
        sqlx::query("UPDATE reports SET last_accessed_at = $1, access_count = $2 WHERE id = $3")
            .bind(last_accessed_at)
            .bind(access_count)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    #[cfg(test)]
    async fn force_report_timestamps(
        &self,
        id: &str,
        created_at: DateTime<Utc>,
        last_accessed_at: DateTime<Utc>,
    ) -> anyhow::Result<()> {
        sqlx::query("UPDATE reports SET created_at = $1, last_accessed_at = $2 WHERE id = $3")
            .bind(created_at)
            .bind(last_accessed_at)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    #[cfg(test)]
    async fn report_access_metadata(&self, id: &str) -> anyhow::Result<(DateTime<Utc>, i64)> {
        let row = sqlx::query("SELECT last_accessed_at, access_count FROM reports WHERE id = $1")
            .bind(id)
            .fetch_one(&self.pool)
            .await?;
        Ok((
            row.try_get("last_accessed_at")?,
            row.try_get("access_count")?,
        ))
    }

    #[cfg(test)]
    async fn force_job(
        &self,
        id: Uuid,
        status: JobStatus,
        updated_at: DateTime<Utc>,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO jobs (id, status, created_at, updated_at) VALUES ($1, $2, $3, $3)",
        )
        .bind(id)
        .bind(status_to_str(&status))
        .bind(updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[cfg(test)]
    async fn report_exists(&self, id: &str) -> anyhow::Result<bool> {
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM reports WHERE id = $1)")
            .bind(id)
            .fetch_one(&self.pool)
            .await
            .map_err(Into::into)
    }

    #[cfg(test)]
    pub async fn create_job(&self) -> anyhow::Result<JobRecord> {
        let id = Uuid::new_v4();
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO jobs (id, status, created_at, updated_at) VALUES ($1, $2, $3, $4)",
        )
        .bind(id)
        .bind(status_to_str(&JobStatus::Queued))
        .bind(now)
        .bind(now)
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

    pub async fn create_or_get_active_job(
        &self,
        key: JobKey<'_>,
    ) -> anyhow::Result<(JobRecord, bool)> {
        if let Some(job) = self.active_job(key).await? {
            return Ok((job, false));
        }

        match self.create_keyed_job(key).await {
            Ok(job) => Ok((job, true)),
            Err(error) if is_active_job_key_conflict(&error) => {
                let Some(job) = self.active_job(key).await? else {
                    return Err(error);
                };
                Ok((job, false))
            }
            Err(error) => Err(error),
        }
    }

    async fn create_keyed_job(&self, key: JobKey<'_>) -> anyhow::Result<JobRecord> {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let row = sqlx::query(
            r#"
            INSERT INTO jobs (
                id, status, provider, owner, repo, commit_sha, tokei_version, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
            RETURNING id, status, report_id, error::text AS error, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(status_to_str(&JobStatus::Queued))
        .bind(provider_to_str(&key.provider))
        .bind(key.owner)
        .bind(key.repo)
        .bind(key.commit_sha)
        .bind(key.tokei_version)
        .bind(now)
        .fetch_one(&self.pool)
        .await?;

        row_to_job(row)
    }

    async fn active_job(&self, key: JobKey<'_>) -> anyhow::Result<Option<JobRecord>> {
        let row = sqlx::query(
            r#"
            SELECT id, status, report_id, error::text AS error, created_at, updated_at
            FROM jobs
            WHERE provider = $1
            AND owner = $2
            AND repo = $3
            AND commit_sha = $4
            AND tokei_version = $5
            AND status IN ('queued', 'running')
            ORDER BY created_at ASC
            LIMIT 1
            "#,
        )
        .bind(provider_to_str(&key.provider))
        .bind(key.owner)
        .bind(key.repo)
        .bind(key.commit_sha)
        .bind(key.tokei_version)
        .fetch_optional(&self.pool)
        .await?;

        row.map(row_to_job).transpose()
    }

    pub async fn set_job_running(&self, id: Uuid) -> anyhow::Result<()> {
        self.update_job(id, JobStatus::Running, None, None).await
    }

    pub async fn set_job_completed(&self, id: Uuid, report_id: String) -> anyhow::Result<()> {
        self.update_job(id, JobStatus::Completed, Some(report_id), None)
            .await
    }

    pub async fn set_job_failed(&self, id: Uuid, error: ApiErrorBody) -> anyhow::Result<()> {
        self.update_job(id, JobStatus::Failed, None, Some(error))
            .await
    }

    async fn update_job(
        &self,
        id: Uuid,
        status: JobStatus,
        report_id: Option<String>,
        error: Option<ApiErrorBody>,
    ) -> anyhow::Result<()> {
        let error = error
            .map(|value| serde_json::to_string(&value))
            .transpose()?;
        sqlx::query(
            "UPDATE jobs SET status = $1, report_id = $2, error = $3::jsonb, updated_at = $4 WHERE id = $5",
        )
        .bind(status_to_str(&status))
        .bind(report_id)
        .bind(error)
        .bind(Utc::now())
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn job(&self, id: Uuid) -> anyhow::Result<Option<JobRecord>> {
        let row = sqlx::query(
            "SELECT id, status, report_id, error::text AS error, created_at, updated_at FROM jobs WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(row_to_job).transpose()
    }
}

const CLEANUP_ADVISORY_LOCK_ID: i64 = 0x0c70_c0a7;

#[derive(Clone, Copy, Debug)]
struct ReportCacheKey<'a> {
    provider: RepositoryProvider,
    owner: &'a str,
    repo: &'a str,
    commit_sha: &'a str,
    tokei_version: &'a str,
}

#[derive(Clone, Copy, Debug)]
pub struct JobKey<'a> {
    pub provider: RepositoryProvider,
    pub owner: &'a str,
    pub repo: &'a str,
    pub commit_sha: &'a str,
    pub tokei_version: &'a str,
}

#[derive(Clone, Copy, Debug)]
pub struct CleanupConfig {
    pub job_retention_completed_days: i64,
    pub job_retention_stale_hours: i64,
    pub report_min_retention_days: i64,
    pub report_max_rows: i64,
    pub report_cleanup_batch_size: i64,
}

impl Default for CleanupConfig {
    fn default() -> Self {
        Self {
            job_retention_completed_days: 1,
            job_retention_stale_hours: 6,
            report_min_retention_days: 30,
            report_max_rows: 20_000,
            report_cleanup_batch_size: 1_000,
        }
    }
}

#[derive(Default, Debug)]
pub struct CleanupStats {
    pub skipped_locked: bool,
    pub completed_jobs_deleted: u64,
    pub stale_jobs_deleted: u64,
    pub expired_reports_deleted: u64,
    pub cold_reports_deleted: u64,
}

fn row_to_job(row: sqlx::postgres::PgRow) -> anyhow::Result<JobRecord> {
    let id: Uuid = row.try_get("id")?;
    let status: String = row.try_get("status")?;
    let error: Option<String> = row.try_get("error")?;
    let created_at: DateTime<Utc> = row.try_get("created_at")?;
    let updated_at: DateTime<Utc> = row.try_get("updated_at")?;

    Ok(JobRecord {
        id,
        status: status_from_str(&status)?,
        report_id: row.try_get("report_id")?,
        error: error
            .map(|value| serde_json::from_str::<ApiErrorBody>(&value))
            .transpose()?,
        created_at,
        updated_at,
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

fn status_from_str(status: &str) -> anyhow::Result<JobStatus> {
    match status {
        "queued" => Ok(JobStatus::Queued),
        "running" => Ok(JobStatus::Running),
        "completed" => Ok(JobStatus::Completed),
        "failed" => Ok(JobStatus::Failed),
        _ => anyhow::bail!("invalid job status in database: {status}"),
    }
}

pub fn provider_to_str(provider: &RepositoryProvider) -> &'static str {
    match provider {
        RepositoryProvider::GitHub => "github",
        RepositoryProvider::GitLab => "gitlab",
    }
}

pub fn provider_from_str(provider: &str) -> Option<RepositoryProvider> {
    match provider {
        "github" => Some(RepositoryProvider::GitHub),
        "gitlab" => Some(RepositoryProvider::GitLab),
        _ => None,
    }
}

fn is_active_job_key_conflict(error: &anyhow::Error) -> bool {
    let Some(sqlx::Error::Database(database_error)) = error.downcast_ref::<sqlx::Error>() else {
        return false;
    };

    database_error.code().as_deref() == Some("23505")
        && database_error.constraint() == Some("idx_jobs_active_key_unique")
}

#[cfg(test)]
mod tests {
    use super::{CleanupConfig, JobKey, Store};
    use crate::models::{
        AnalysisOptions, JobStatus, LanguageReport, LanguageStats, Report, Repository,
        RepositoryProvider,
    };
    use chrono::{Duration, Utc};
    use sqlx::postgres::PgPoolOptions;
    use std::ops::Deref;
    use uuid::Uuid;

    #[tokio::test]
    async fn cached_report_marks_report_as_cached() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        let mut report = test_report("report-cached", &owner, 100);
        report.cached = false;
        store.save_report(&report).await.unwrap();

        let cached = store
            .cached_report(&owner, "count", "abc123", "tokei-test:default")
            .await
            .unwrap()
            .unwrap();

        assert!(cached.cached);
        assert_eq!(cached.total.code, 100);
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn save_report_replaces_existing_cache_record() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        store
            .save_report(&test_report("report-upsert-1", &owner, 100))
            .await
            .unwrap();
        store
            .save_report(&test_report("report-upsert-2", &owner, 250))
            .await
            .unwrap();

        let cached = store
            .cached_report(&owner, "count", "abc123", "tokei-test:default")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(cached.total.code, 250);
        assert_eq!(cached.id, "report-upsert-2");
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn report_returns_by_id_and_tracks_access() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        let report = test_report("report-by-id", &owner, 100);
        store.save_report(&report).await.unwrap();
        store
            .force_report_access_metadata(&report.id, Utc::now() - Duration::hours(2), 3)
            .await
            .unwrap();

        let loaded = store.report(&report.id).await.unwrap().unwrap();
        let (_, access_count) = store.report_access_metadata(&report.id).await.unwrap();

        assert_eq!(loaded.id, report.id);
        assert_eq!(access_count, 4);
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn cleanup_removes_old_jobs() {
        let Some(store) = test_store().await else {
            return;
        };
        let old_completed = Uuid::new_v4();
        let old_running = Uuid::new_v4();
        let recent_completed = Uuid::new_v4();
        store
            .force_job(
                old_completed,
                JobStatus::Completed,
                Utc::now() - Duration::days(8),
            )
            .await
            .unwrap();
        store
            .force_job(
                old_running,
                JobStatus::Running,
                Utc::now() - Duration::hours(25),
            )
            .await
            .unwrap();
        store
            .force_job(recent_completed, JobStatus::Completed, Utc::now())
            .await
            .unwrap();

        let stats = cleanup(&store, CleanupConfig::default()).await;

        assert_eq!(stats.completed_jobs_deleted, 1);
        assert_eq!(stats.stale_jobs_deleted, 1);
        assert!(store.job(old_completed).await.unwrap().is_none());
        assert!(store.job(old_running).await.unwrap().is_none());
        assert!(store.job(recent_completed).await.unwrap().is_some());
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn keyed_job_create_returns_queued_job() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");

        let (job, created) = store
            .create_or_get_active_job(test_job_key(&owner))
            .await
            .unwrap();

        assert!(created);
        assert_eq!(job.status, JobStatus::Queued);
        assert!(store.job(job.id).await.unwrap().is_some());
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn duplicate_active_key_returns_existing_job() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");

        let (first, first_created) = store
            .create_or_get_active_job(test_job_key(&owner))
            .await
            .unwrap();
        let (second, second_created) = store
            .create_or_get_active_job(test_job_key(&owner))
            .await
            .unwrap();

        assert!(first_created);
        assert!(!second_created);
        assert_eq!(second.id, first.id);
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn active_duplicate_race_resolves_to_one_job() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");

        let first = store.create_or_get_active_job(test_job_key(&owner));
        let second = store.create_or_get_active_job(test_job_key(&owner));
        let (first_result, second_result) = tokio::join!(first, second);
        let (first_job, first_created) = first_result.unwrap();
        let (second_job, second_created) = second_result.unwrap();

        assert_eq!(first_job.id, second_job.id);
        assert_ne!(first_created, second_created);
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn completed_keyed_job_does_not_block_new_job() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");

        let (completed, _) = store
            .create_or_get_active_job(test_job_key(&owner))
            .await
            .unwrap();
        store
            .set_job_completed(completed.id, "report-completed".to_string())
            .await
            .unwrap();
        let (next, created) = store
            .create_or_get_active_job(test_job_key(&owner))
            .await
            .unwrap();

        assert!(created);
        assert_ne!(next.id, completed.id);
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn cleanup_preserves_reports_younger_than_retention() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        let report = test_report("report-young", &owner, 100);
        store.save_report(&report).await.unwrap();

        let stats = cleanup(&store, CleanupConfig::default()).await;

        assert_eq!(stats.expired_reports_deleted, 0);
        assert!(store.report_exists(&report.id).await.unwrap());
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn cleanup_evicts_cold_reports_beyond_cap() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        for index in 0..3 {
            let id = format!("report-cold-{index}");
            let mut report = test_report(&id, &owner, 100 + index);
            report.commit_sha = format!("abc123-{index}");
            store.save_report(&report).await.unwrap();
            store
                .force_report_timestamps(
                    &id,
                    Utc::now() - Duration::days(31),
                    Utc::now() - Duration::days(31 + i64::from(2 - index as i32)),
                )
                .await
                .unwrap();
        }

        let stats = cleanup(
            &store,
            CleanupConfig {
                report_min_retention_days: 30,
                report_max_rows: 2,
                report_cleanup_batch_size: 1,
                ..CleanupConfig::default()
            },
        )
        .await;

        assert_eq!(stats.cold_reports_deleted, 1);
        assert!(!store.report_exists("report-cold-0").await.unwrap());
        assert!(store.report_exists("report-cold-1").await.unwrap());
        assert!(store.report_exists("report-cold-2").await.unwrap());
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn migration_uses_jsonb_for_structured_payloads() {
        let Some(store) = test_store().await else {
            return;
        };

        assert_eq!(store.column_type("reports", "body").await.unwrap(), "jsonb");
        assert_eq!(store.column_type("jobs", "error").await.unwrap(), "jsonb");
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn migration_adds_nullable_job_key_columns() {
        let Some(store) = test_store().await else {
            return;
        };

        assert_eq!(
            store.column_type("reports", "provider").await.unwrap(),
            "text"
        );
        assert_eq!(store.column_type("jobs", "provider").await.unwrap(), "text");
        assert_eq!(store.column_type("jobs", "owner").await.unwrap(), "text");
        assert_eq!(store.column_type("jobs", "repo").await.unwrap(), "text");
        assert_eq!(
            store.column_type("jobs", "commit_sha").await.unwrap(),
            "text"
        );
        assert_eq!(
            store.column_type("jobs", "tokei_version").await.unwrap(),
            "text"
        );
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn failed_job_roundtrips_jsonb_error() {
        let Some(store) = test_store().await else {
            return;
        };
        let job = store.create_job().await.unwrap();

        store
            .set_job_failed(
                job.id,
                crate::models::ApiErrorBody {
                    code: "bad_repo".to_string(),
                    message: "repository is invalid".to_string(),
                },
            )
            .await
            .unwrap();

        let loaded = store.job(job.id).await.unwrap().unwrap();
        let error = loaded.error.unwrap();
        assert_eq!(loaded.status, JobStatus::Failed);
        assert_eq!(error.code, "bad_repo");
        assert_eq!(error.message, "repository is invalid");
        store.drop_schema().await;
    }

    async fn test_store() -> Option<TestStore> {
        let database_url = std::env::var("TEST_DATABASE_URL")
            .or_else(|_| std::env::var("DATABASE_URL"))
            .ok()?;
        if !database_url.starts_with("postgres://") && !database_url.starts_with("postgresql://") {
            eprintln!("skipping postgres store test because DATABASE_URL is not postgres");
            return None;
        }
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(&database_url)
            .await
            .unwrap();
        let schema = unique_name("test_schema");
        sqlx::query(&format!("CREATE SCHEMA {schema}"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(&format!("SET search_path TO {schema}"))
            .execute(&pool)
            .await
            .unwrap();
        let store = Store::new(pool);
        store.migrate().await.unwrap();
        Some(TestStore { store, schema })
    }

    async fn cleanup(store: &Store, config: CleanupConfig) -> super::CleanupStats {
        for _ in 0..10 {
            let stats = store.cleanup(config).await.unwrap();
            if !stats.skipped_locked {
                return stats;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        panic!("cleanup advisory lock stayed busy");
    }

    fn unique_name(prefix: &str) -> String {
        format!("{prefix}_{}", Uuid::new_v4().simple())
    }

    fn test_job_key(owner: &str) -> JobKey<'_> {
        JobKey {
            provider: RepositoryProvider::GitHub,
            owner,
            repo: "count",
            commit_sha: "abc123",
            tokei_version: "tokei-test:default",
        }
    }

    struct TestStore {
        store: Store,
        schema: String,
    }

    impl TestStore {
        async fn drop_schema(self) {
            sqlx::query(&format!("DROP SCHEMA IF EXISTS {} CASCADE", self.schema))
                .execute(&self.store.pool)
                .await
                .unwrap();
        }

        async fn column_type(&self, table: &str, column: &str) -> anyhow::Result<String> {
            sqlx::query_scalar(
                r#"
                SELECT data_type
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                AND table_name = $1
                AND column_name = $2
                "#,
            )
            .bind(table)
            .bind(column)
            .fetch_one(&self.store.pool)
            .await
            .map_err(Into::into)
        }
    }

    impl Deref for TestStore {
        type Target = Store;

        fn deref(&self) -> &Self::Target {
            &self.store
        }
    }

    fn test_report(id: &str, owner: &str, code: usize) -> Report {
        Report {
            id: id.to_string(),
            repository: Repository {
                provider: RepositoryProvider::GitHub,
                owner: owner.to_string(),
                name: "count".to_string(),
                html_url: "https://github.com/octo/count".to_string(),
            },
            ref_name: "main".to_string(),
            commit_sha: "abc123".to_string(),
            generated_at: Utc::now(),
            duration_ms: 42,
            cached: false,
            tokei_version: "tokei-test".to_string(),
            analysis_key: "tokei-test:default".to_string(),
            analysis_options: AnalysisOptions::default(),
            languages: vec![LanguageReport {
                name: "Rust".to_string(),
                stats: LanguageStats {
                    files: 1,
                    lines: code + 10,
                    code,
                    comments: 7,
                    blanks: 3,
                },
                children: Vec::new(),
            }],
            total: LanguageStats {
                files: 1,
                lines: code + 10,
                code,
                comments: 7,
                blanks: 3,
            },
        }
    }
}
