use std::sync::OnceLock;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::models::{
    AnalysisOptions, AnalysisSource, ApiErrorBody, GrowthLanguageStat, GrowthRepositoryStat, GrowthSourceStat,
    GrowthStats, GrowthTotals, GrowthWindows, JobRecord, JobStatus, LanguageReport, LanguageStats,
    Report, RepositoryProvider,
};

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
                source TEXT NOT NULL DEFAULT 'unknown',
                CONSTRAINT reports_provider_valid CHECK (provider IN ('github', 'gitlab')),
                CONSTRAINT reports_source_valid CHECK (source IN ('web', 'extension', 'github_action', 'cli', 'mcp', 'api', 'seed', 'github_trending', 'unknown')),
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
                source TEXT NOT NULL DEFAULT 'unknown',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT jobs_provider_valid CHECK (provider IS NULL OR provider IN ('github', 'gitlab')),
                CONSTRAINT jobs_source_valid CHECK (source IN ('web', 'extension', 'github_action', 'cli', 'mcp', 'api', 'seed', 'github_trending', 'unknown')),
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
        sqlx::query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS source TEXT")
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
        sqlx::query("UPDATE reports SET source = 'unknown' WHERE source IS NULL")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE reports ALTER COLUMN source SET DEFAULT 'unknown'")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE reports ALTER COLUMN source SET NOT NULL")
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
        sqlx::query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source TEXT")
            .execute(&self.pool)
            .await?;
        sqlx::query("UPDATE jobs SET source = 'unknown' WHERE source IS NULL")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE jobs ALTER COLUMN source SET DEFAULT 'unknown'")
            .execute(&self.pool)
            .await?;
        sqlx::query("ALTER TABLE jobs ALTER COLUMN source SET NOT NULL")
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

                IF EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'reports_source_valid'
                    AND connamespace = current_schema()::regnamespace
                    AND pg_get_constraintdef(oid) NOT LIKE '%github_trending%'
                ) THEN
                    ALTER TABLE reports DROP CONSTRAINT reports_source_valid;
                    ALTER TABLE reports
                    ADD CONSTRAINT reports_source_valid CHECK (source IN ('web', 'extension', 'github_action', 'cli', 'mcp', 'api', 'seed', 'github_trending', 'unknown'));
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'jobs_source_valid'
                    AND connamespace = current_schema()::regnamespace
                    AND pg_get_constraintdef(oid) NOT LIKE '%github_trending%'
                ) THEN
                    ALTER TABLE jobs DROP CONSTRAINT jobs_source_valid;
                    ALTER TABLE jobs
                    ADD CONSTRAINT jobs_source_valid CHECK (source IN ('web', 'extension', 'github_action', 'cli', 'mcp', 'api', 'seed', 'github_trending', 'unknown'));
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

        self.migrate_report_stat_columns().await?;
        self.migrate_report_languages().await?;

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
            "CREATE INDEX IF NOT EXISTS idx_reports_source_created ON reports (source, created_at DESC)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_reports_lru_cleanup ON reports (last_accessed_at, created_at)",
        )
        .execute(&self.pool)
        .await?;
        // Plain, not CONCURRENTLY: `migrate()` runs statement-by-statement outside an
        // explicit transaction so CONCURRENTLY would be legal, but a failed
        // CONCURRENTLY build leaves an INVALID index behind that `IF NOT EXISTS`
        // then refuses to retry. `reports` is capped at REPORT_MAX_ROWS (20k by
        // default), so a blocking build is milliseconds.
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_reports_total_lines ON reports (total_lines DESC)",
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

    /// Adds the materialized statistics columns, the trigger that keeps them in
    /// sync with `body`, and backfills historical rows in bounded batches.
    ///
    /// Why a trigger instead of computing the values in `save_report`: deploys are
    /// not instantaneous, so for a while an old binary keeps writing rows with an
    /// `INSERT ... ON CONFLICT DO UPDATE` that knows nothing about these columns.
    /// Deriving them in the database makes the columns a pure function of `body`
    /// for *every* writer, which is what lets `ORDER BY total_lines DESC` stay
    /// exactly equivalent to the `(body->'total'->>'lines')::bigint` expression it
    /// replaces. A `STORED GENERATED` column would give the same guarantee, but
    /// adding one rewrites the whole table under an ACCESS EXCLUSIVE lock, and the
    /// production table's bodies are large enough that that is a real stall.
    ///
    /// The trigger is `UPDATE OF body`, not plain `UPDATE`, so the hourly
    /// access-count touch on the hot read path does not detoast the body.
    async fn migrate_report_stat_columns(&self) -> anyhow::Result<()> {
        // Nullable, no default: a metadata-only change, no table rewrite.
        sqlx::query(
            r#"
            ALTER TABLE reports
                ADD COLUMN IF NOT EXISTS total_lines BIGINT,
                ADD COLUMN IF NOT EXISTS total_code BIGINT,
                ADD COLUMN IF NOT EXISTS total_files BIGINT,
                ADD COLUMN IF NOT EXISTS language_count INT,
                ADD COLUMN IF NOT EXISTS top_language TEXT
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE OR REPLACE FUNCTION reports_materialize_stats() RETURNS trigger AS $$
            BEGIN
                NEW.total_lines := COALESCE((NEW.body->'total'->>'lines')::bigint, 0);
                NEW.total_code := COALESCE((NEW.body->'total'->>'code')::bigint, 0);
                NEW.total_files := COALESCE((NEW.body->'total'->>'files')::bigint, 0);
                NEW.language_count := COALESCE(jsonb_array_length(NEW.body->'languages'), 0);
                NEW.top_language := NEW.body->'languages'->0->>'name';
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query("DROP TRIGGER IF EXISTS reports_materialize_stats ON reports")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            r#"
            CREATE TRIGGER reports_materialize_stats
            BEFORE INSERT OR UPDATE OF body ON reports
            FOR EACH ROW EXECUTE FUNCTION reports_materialize_stats()
            "#,
        )
        .execute(&self.pool)
        .await?;

        self.backfill_report_stats().await?;
        Ok(())
    }

    /// Fills the materialized columns for rows that predate them, one bounded
    /// batch per statement. A single table-wide UPDATE would hold row locks over
    /// the entire table for the duration, which on the production database is a
    /// stall; this keeps each statement short and lets other writers interleave.
    async fn backfill_report_stats(&self) -> anyhow::Result<u64> {
        const BATCH: i64 = 1_000;
        // 10k batches * 1k rows caps a runaway loop far above any plausible table
        // size (the cleanup task holds `reports` to REPORT_MAX_ROWS).
        const MAX_BATCHES: usize = 10_000;

        let mut total = 0_u64;
        for _ in 0..MAX_BATCHES {
            let affected = sqlx::query(
                r#"
                UPDATE reports
                SET total_lines = COALESCE((body->'total'->>'lines')::bigint, 0),
                    total_code = COALESCE((body->'total'->>'code')::bigint, 0),
                    total_files = COALESCE((body->'total'->>'files')::bigint, 0),
                    language_count = COALESCE(jsonb_array_length(body->'languages'), 0),
                    top_language = body->'languages'->0->>'name'
                WHERE id IN (
                    SELECT id FROM reports WHERE total_lines IS NULL LIMIT $1
                )
                "#,
            )
            .bind(BATCH)
            .execute(&self.pool)
            .await?
            .rows_affected();

            total += affected;
            if affected == 0 {
                return Ok(total);
            }
        }

        tracing::warn!(
            backfilled = total,
            "report stat backfill hit its batch cap; the next migrate() will resume it"
        );
        Ok(total)
    }

    /// Creates the per-report language rollup, the trigger that keeps it in sync,
    /// and backfills it in bounded batches.
    ///
    /// `growth_languages` and `growth_totals` used to `jsonb_array_elements` the
    /// whole `reports` table -- roughly 30 rows of expansion per report, twice per
    /// stats refresh -- to answer questions a narrow summary table answers with an
    /// index scan.
    ///
    /// Sync lives in a trigger rather than in `save_report` for two reasons.
    /// `save_report` is a single `INSERT ... ON CONFLICT DO UPDATE`, and moving it
    /// into a transaction to keep a second table in step is exactly the kind of
    /// write-path complexity worth avoiding. More importantly, `save_report`'s
    /// upsert sets `id = EXCLUDED.id`, so re-analysing a repository can *change the
    /// primary key of an existing row*; the trigger deletes by both the old and the
    /// new id, which keeps stale rows from surviving that rename no matter how the
    /// FK's ON UPDATE CASCADE and this trigger are ordered.
    async fn migrate_report_languages(&self) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS report_languages (
                report_id TEXT NOT NULL REFERENCES reports(id) ON UPDATE CASCADE ON DELETE CASCADE,
                language TEXT NOT NULL,
                code BIGINT NOT NULL DEFAULT 0,
                lines BIGINT NOT NULL DEFAULT 0,
                PRIMARY KEY (report_id, language)
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_report_languages_language ON report_languages (language)",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE OR REPLACE FUNCTION reports_sync_languages() RETURNS trigger AS $$
            BEGIN
                IF TG_OP = 'UPDATE' THEN
                    DELETE FROM report_languages WHERE report_id IN (OLD.id, NEW.id);
                ELSE
                    DELETE FROM report_languages WHERE report_id = NEW.id;
                END IF;

                INSERT INTO report_languages (report_id, language, code, lines)
                SELECT
                    NEW.id,
                    entry->>'name',
                    COALESCE(SUM((entry->'stats'->>'code')::bigint), 0),
                    COALESCE(SUM((entry->'stats'->>'lines')::bigint), 0)
                FROM jsonb_array_elements(COALESCE(NEW.body->'languages', '[]'::jsonb)) AS t(entry)
                WHERE entry->>'name' IS NOT NULL
                GROUP BY entry->>'name';

                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query("DROP TRIGGER IF EXISTS reports_sync_languages ON reports")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            r#"
            CREATE TRIGGER reports_sync_languages
            AFTER INSERT OR UPDATE OF body ON reports
            FOR EACH ROW EXECUTE FUNCTION reports_sync_languages()
            "#,
        )
        .execute(&self.pool)
        .await?;

        self.backfill_report_languages().await?;
        Ok(())
    }

    /// Populates `report_languages` for reports that predate it.
    ///
    /// Batching is driven by a monotonically advancing id cursor, so the loop is
    /// guaranteed to terminate even if some row can never satisfy the pending
    /// predicate. The predicate itself (`language_count > 0` and no rows yet)
    /// makes repeat runs cheap: on an already-migrated database the very first
    /// query comes back empty. Reports with zero languages correctly have no rows
    /// and are skipped rather than being retried forever.
    async fn backfill_report_languages(&self) -> anyhow::Result<u64> {
        const BATCH: i64 = 1_000;

        let mut cursor = String::new();
        let mut total = 0_u64;
        loop {
            let ids: Vec<String> = sqlx::query_scalar(
                r#"
                SELECT r.id
                FROM reports r
                WHERE r.id > $1
                AND COALESCE(r.language_count, 0) > 0
                AND NOT EXISTS (SELECT 1 FROM report_languages rl WHERE rl.report_id = r.id)
                ORDER BY r.id
                LIMIT $2
                "#,
            )
            .bind(&cursor)
            .bind(BATCH)
            .fetch_all(&self.pool)
            .await?;

            let Some(last) = ids.last().cloned() else {
                return Ok(total);
            };
            cursor = last;

            total += sqlx::query(
                r#"
                INSERT INTO report_languages (report_id, language, code, lines)
                SELECT
                    r.id,
                    entry->>'name',
                    COALESCE(SUM((entry->'stats'->>'code')::bigint), 0),
                    COALESCE(SUM((entry->'stats'->>'lines')::bigint), 0)
                FROM reports r,
                     LATERAL jsonb_array_elements(COALESCE(r.body->'languages', '[]'::jsonb)) AS t(entry)
                WHERE r.id = ANY($1)
                AND entry->>'name' IS NOT NULL
                GROUP BY r.id, entry->>'name'
                ON CONFLICT (report_id, language) DO NOTHING
                "#,
            )
            .bind(&ids)
            .execute(&self.pool)
            .await?
            .rows_affected();
        }
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

    pub async fn save_report(&self, report: &Report, source: AnalysisSource) -> anyhow::Result<()> {
        let body = serde_json::to_string(report)?;
        let body_bytes = body.len() as i64;
        let provider = provider_to_str(&report.repository.provider);
        sqlx::query(
            r#"
            INSERT INTO reports (
                id, provider, owner, repo, commit_sha, tokei_version, body, created_at,
                last_accessed_at, access_count, body_bytes, source
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8, 0, $9, $10)
            ON CONFLICT (provider, owner, repo, commit_sha, tokei_version)
            DO UPDATE SET
                id = EXCLUDED.id,
                body = EXCLUDED.body,
                created_at = EXCLUDED.created_at,
                last_accessed_at = EXCLUDED.last_accessed_at,
                access_count = 0,
                body_bytes = EXCLUDED.body_bytes,
                source = EXCLUDED.source
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
        .bind(source_to_str(&source))
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

    /// The stored report as JSON text, ready to hand straight to the client.
    ///
    /// `/api/reports/{id}` is an immutable, verbatim echo of what was stored, so
    /// deserializing into `Report` only to serialize it straight back is pure
    /// overhead on bodies that routinely run into hundreds of kilobytes.
    ///
    /// The catch is that three fields carry `#[serde(default)]`, so the round trip
    /// was *adding* them for rows written before they existed. The projection
    /// re-adds them in SQL, using `||` so a value already present in the body
    /// always wins. `Report::cached` has no default and is therefore echoed
    /// unchanged -- this path never forces it to `true` the way the analyze
    /// cache-hit path does.
    pub async fn report_json(&self, id: &str) -> anyhow::Result<Option<String>> {
        static SQL: OnceLock<String> = OnceLock::new();
        let sql = SQL.get_or_init(|| {
            throttled_fetch_sql(normalized_report_body_expr(), "id = $1", "id = $1")
        });
        self.fetch_throttled_report_body(sql, id).await
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

    pub async fn recent_reports(&self, limit: i64, offset: i64) -> anyhow::Result<Vec<ReportCard>> {
        self.report_cards(ReportOrder::Recent, limit, offset).await
    }

    pub async fn popular_reports(
        &self,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<ReportCard>> {
        self.report_cards(ReportOrder::Popular, limit, offset).await
    }

    pub async fn monolith_reports(
        &self,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<ReportCard>> {
        self.report_cards(ReportOrder::Monolith, limit, offset)
            .await
    }

    /// Repository identity plus last-modified date for every distinct repository,
    /// newest first.
    ///
    /// The sitemap only ever needed four scalars per row, but it used to go
    /// through `distinct_reports`, which pulls up to 45k complete report bodies
    /// out of Postgres and runs every one of them through `serde_json`. This
    /// touches neither `body` nor the TOAST table.
    ///
    /// `created_at` is written from `Report::generated_at` by `save_report`, so
    /// `(created_at AT TIME ZONE 'UTC')::date` is the same day as
    /// `generated_at.date_naive()`. The explicit `AT TIME ZONE` matters: a bare
    /// `::date` cast would resolve against the session's TimeZone setting.
    pub async fn sitemap_entries(&self, limit: i64) -> anyhow::Result<Vec<SitemapRow>> {
        let rows = sqlx::query(
            r#"
            SELECT provider, owner, repo, (created_at AT TIME ZONE 'UTC')::date AS lastmod
            FROM (
                SELECT DISTINCT ON (provider, owner, repo)
                    provider, owner, repo, created_at
                FROM reports
                ORDER BY provider, owner, repo, created_at DESC
            ) latest
            ORDER BY created_at DESC
            LIMIT $1
            "#,
        )
        .bind(limit.clamp(0, 100_000))
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let provider: String = row.try_get("provider")?;
                Ok(SitemapRow {
                    provider: provider_from_str(&provider)
                        .ok_or_else(|| anyhow::anyhow!("unknown provider in database: {provider}"))?,
                    owner: row.try_get("owner")?,
                    repo: row.try_get("repo")?,
                    lastmod: row.try_get("lastmod")?,
                })
            })
            .collect()
    }

    pub async fn growth_stats(&self) -> anyhow::Result<GrowthStats> {
        let totals = self.growth_totals().await?;
        let windows = self.growth_windows().await?;
        let sources = self.growth_sources().await?;
        let languages = self.growth_languages().await?;
        let top_repositories = self.growth_repository_list(ReportOrder::Monolith, 12).await?;
        let recent_repositories = self.growth_repository_list(ReportOrder::Recent, 12).await?;

        Ok(GrowthStats {
            totals,
            windows,
            sources,
            languages,
            top_repositories,
            recent_repositories,
        })
    }

    /// # A preserved bug
    ///
    /// The query this replaces read `FROM reports LEFT JOIN LATERAL
    /// jsonb_array_elements(body->'languages') ON TRUE`, which fans each report
    /// out into one row per language. `COUNT(*)` and the two `SUM`s therefore
    /// counted every report once *per language it contains*: with ~30 languages
    /// per report, `/api/stats` has been reporting `reportsGenerated` and
    /// `linesCounted` roughly 30x too high.
    ///
    /// This rewrite reproduces that inflation exactly -- `GREATEST(language_count,
    /// 1)` is the fan-out factor, and 1 rather than 0 because a LEFT JOIN still
    /// emits one row for a report with no languages. Removing the join without
    /// reproducing it would have silently changed two public numbers by an order
    /// of magnitude, which is a product decision, not a performance one. Fixing it
    /// is a separate, deliberate change.
    async fn growth_totals(&self) -> anyhow::Result<GrowthTotals> {
        let row = sqlx::query(
            r#"
            SELECT
                COALESCE(SUM(GREATEST(COALESCE(language_count, 0), 1)), 0)::bigint AS reports_generated,
                COUNT(DISTINCT (provider, owner, repo))::bigint AS repositories_analyzed,
                COALESCE(SUM(COALESCE(total_lines, 0) * GREATEST(COALESCE(language_count, 0), 1)), 0)::bigint AS lines_counted,
                COALESCE(SUM(COALESCE(total_code, 0) * GREATEST(COALESCE(language_count, 0), 1)), 0)::bigint AS code_lines_counted,
                (SELECT COUNT(DISTINCT language) FROM report_languages)::bigint AS languages_detected
            FROM reports
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(GrowthTotals {
            reports_generated: row.try_get("reports_generated")?,
            repositories_analyzed: row.try_get("repositories_analyzed")?,
            lines_counted: row.try_get("lines_counted")?,
            code_lines_counted: row.try_get("code_lines_counted")?,
            languages_detected: row.try_get("languages_detected")?,
        })
    }

    async fn growth_windows(&self) -> anyhow::Result<GrowthWindows> {
        let row = sqlx::query(
            r#"
            SELECT
                COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW()))::bigint AS reports_today,
                COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::bigint AS reports_7d,
                COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::bigint AS reports_30d,
                COUNT(DISTINCT (provider, owner, repo)) FILTER (WHERE created_at >= date_trunc('day', NOW()))::bigint AS repositories_today,
                COUNT(DISTINCT (provider, owner, repo)) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::bigint AS repositories_7d,
                COUNT(DISTINCT (provider, owner, repo)) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::bigint AS repositories_30d
            FROM reports
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(GrowthWindows {
            reports_today: row.try_get("reports_today")?,
            reports_7d: row.try_get("reports_7d")?,
            reports_30d: row.try_get("reports_30d")?,
            repositories_today: row.try_get("repositories_today")?,
            repositories_7d: row.try_get("repositories_7d")?,
            repositories_30d: row.try_get("repositories_30d")?,
        })
    }

    async fn growth_sources(&self) -> anyhow::Result<Vec<GrowthSourceStat>> {
        let rows = sqlx::query(
            r#"
            SELECT source, COUNT(*)::bigint AS reports
            FROM reports
            GROUP BY source
            ORDER BY reports DESC, source ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let source: String = row.try_get("source")?;
                Ok(GrowthSourceStat {
                    source: source_from_str(&source),
                    reports: row.try_get("reports")?,
                })
            })
            .collect()
    }

    async fn growth_languages(&self) -> anyhow::Result<Vec<GrowthLanguageStat>> {
        let rows = sqlx::query(
            r#"
            SELECT
                language,
                COALESCE(SUM(code), 0)::bigint AS code,
                COALESCE(SUM(lines), 0)::bigint AS lines,
                COUNT(*)::bigint AS reports
            FROM report_languages
            GROUP BY language
            ORDER BY SUM(code) DESC, language ASC
            LIMIT 16
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(GrowthLanguageStat {
                    language: row.try_get("language")?,
                    code: row.try_get("code")?,
                    lines: row.try_get("lines")?,
                    reports: row.try_get("reports")?,
                })
            })
            .collect()
    }

    async fn growth_repository_list(
        &self,
        order: ReportOrder,
        limit: i64,
    ) -> anyhow::Result<Vec<GrowthRepositoryStat>> {
        let cards = self.report_cards(order, limit.clamp(1, 50), 0).await?;
        Ok(cards.iter().map(growth_repository_stat).collect())
    }

    /// One SEO card per distinct repository, in `order`.
    ///
    /// The shape matters as much as the projection. Deduplication, sorting and
    /// pagination all happen over narrow scalar columns in a subquery; only the
    /// rows that survive `LIMIT` are joined back to `reports` for their body
    /// fields. The old query carried a whole `body` through the `DISTINCT ON` and
    /// the sort, which made the sort spill to disk and detoasted every row in the
    /// table to return 24 of them.
    ///
    /// Everything except `provider` / `owner` / `repo` (which `save_report` writes
    /// from the report itself) is still read out of `body`, so the values are the
    /// same ones the previous deserialize-the-whole-report path produced. What is
    /// gone is shipping ~50 KB per row over the socket and parsing it.
    async fn report_cards(
        &self,
        order: ReportOrder,
        limit: i64,
        offset: i64,
    ) -> anyhow::Result<Vec<ReportCard>> {
        let rows = sqlx::query(order.card_sql())
            .bind(limit.clamp(0, 500))
            .bind(offset.max(0))
            .bind(SEO_CARD_LANGUAGES as i64)
            .fetch_all(&self.pool)
            .await?;

        rows.into_iter().map(row_to_report_card).collect()
    }

    async fn fetch_cached_report_by_key(
        &self,
        key: ReportCacheKey<'_>,
    ) -> anyhow::Result<Option<String>> {
        static SQL: OnceLock<String> = OnceLock::new();
        let sql = SQL.get_or_init(|| {
            throttled_fetch_sql(
                "body::text",
                "id = (
                    SELECT id
                    FROM reports
                    WHERE provider = $1 AND owner = $2 AND repo = $3 AND commit_sha = $4 AND tokei_version = $5
                )",
                "provider = $1 AND owner = $2 AND repo = $3 AND commit_sha = $4 AND tokei_version = $5",
            )
        });

        let row = sqlx::query(sql)
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
        static SQL: OnceLock<String> = OnceLock::new();
        let sql = SQL.get_or_init(|| throttled_fetch_sql("body::text", "id = $1", "id = $1"));
        self.fetch_throttled_report_body(sql, id).await
    }

    async fn fetch_throttled_report_body(
        &self,
        sql: &str,
        id: &str,
    ) -> anyhow::Result<Option<String>> {
        let row = sqlx::query(sql)
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

    /// Inserts a report body verbatim, bypassing `save_report`'s serialization.
    /// Used by the golden fixtures to reproduce rows written by older binaries.
    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn insert_raw_report(
        &self,
        id: &str,
        provider: &str,
        owner: &str,
        repo: &str,
        commit_sha: &str,
        tokei_version: &str,
        body: &str,
        created_at: DateTime<Utc>,
    ) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            INSERT INTO reports (
                id, provider, owner, repo, commit_sha, tokei_version, body, created_at,
                last_accessed_at, access_count, body_bytes, source
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8, 0, $9, 'unknown')
            "#,
        )
        .bind(id)
        .bind(provider)
        .bind(owner)
        .bind(repo)
        .bind(commit_sha)
        .bind(tokei_version)
        .bind(body)
        .bind(created_at)
        .bind(body.len() as i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) async fn force_report_access_metadata(
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
    async fn report_stat_columns(&self, id: &str) -> anyhow::Result<ReportStatColumns> {
        let row = sqlx::query(
            "SELECT total_lines, total_code, total_files, language_count, top_language FROM reports WHERE id = $1",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        Ok(ReportStatColumns {
            total_lines: row.try_get("total_lines")?,
            total_code: row.try_get("total_code")?,
            total_files: row.try_get("total_files")?,
            language_count: row.try_get("language_count")?,
            top_language: row.try_get("top_language")?,
        })
    }

    /// Blanks the materialized columns without touching `body`, reproducing a row
    /// as it looked before this migration existed.
    #[cfg(test)]
    async fn clear_report_stat_columns(&self, id: &str) -> anyhow::Result<()> {
        sqlx::query(
            "UPDATE reports SET total_lines = NULL, total_code = NULL, total_files = NULL, language_count = NULL, top_language = NULL WHERE id = $1",
        )
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Writes only `body`, the way a binary that predates the materialized
    /// columns would during a rolling deploy.
    #[cfg(test)]
    async fn force_report_body(&self, id: &str, body: &str) -> anyhow::Result<()> {
        sqlx::query("UPDATE reports SET body = $1::jsonb WHERE id = $2")
            .bind(body)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    #[cfg(test)]
    async fn report_language_names(&self, id: &str) -> anyhow::Result<Vec<String>> {
        sqlx::query_scalar(
            "SELECT language FROM report_languages WHERE report_id = $1 ORDER BY language",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    #[cfg(test)]
    async fn total_language_rows(&self) -> anyhow::Result<i64> {
        sqlx::query_scalar("SELECT COUNT(*) FROM report_languages")
            .fetch_one(&self.pool)
            .await
            .map_err(Into::into)
    }

    #[cfg(test)]
    async fn orphaned_language_rows(&self) -> anyhow::Result<i64> {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM report_languages rl WHERE NOT EXISTS (SELECT 1 FROM reports r WHERE r.id = rl.report_id)",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(Into::into)
    }

    #[cfg(test)]
    async fn truncate_report_languages(&self) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM report_languages")
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// The `growth_languages` query as it stood before B6, for differential
    /// testing against the `report_languages` rollup.
    #[cfg(test)]
    async fn legacy_growth_languages(&self) -> anyhow::Result<Vec<(String, i64, i64, i64)>> {
        let rows = sqlx::query(
            r#"
            SELECT
                language.value->>'name' AS language,
                COALESCE(SUM((language.value->'stats'->>'code')::bigint), 0)::bigint AS code,
                COALESCE(SUM((language.value->'stats'->>'lines')::bigint), 0)::bigint AS lines,
                COUNT(*)::bigint AS reports
            FROM reports
            CROSS JOIN LATERAL jsonb_array_elements(body->'languages') AS language(value)
            GROUP BY language.value->>'name'
            ORDER BY code DESC, language ASC
            LIMIT 16
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok((
                    row.try_get("language")?,
                    row.try_get("code")?,
                    row.try_get("lines")?,
                    row.try_get("reports")?,
                ))
            })
            .collect()
    }

    /// The `growth_totals` query as it stood before B6, fan-out and all.
    #[cfg(test)]
    async fn legacy_growth_totals(&self) -> anyhow::Result<(i64, i64, i64, i64, i64)> {
        let row = sqlx::query(
            r#"
            SELECT
                COUNT(*)::bigint AS reports_generated,
                COUNT(DISTINCT (provider, owner, repo))::bigint AS repositories_analyzed,
                COALESCE(SUM((body->'total'->>'lines')::bigint), 0)::bigint AS lines_counted,
                COALESCE(SUM((body->'total'->>'code')::bigint), 0)::bigint AS code_lines_counted,
                COALESCE(COUNT(DISTINCT language.value->>'name'), 0)::bigint AS languages_detected
            FROM reports
            LEFT JOIN LATERAL jsonb_array_elements(body->'languages') AS language(value) ON TRUE
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok((
            row.try_get("reports_generated")?,
            row.try_get("repositories_analyzed")?,
            row.try_get("lines_counted")?,
            row.try_get("code_lines_counted")?,
            row.try_get("languages_detected")?,
        ))
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
                id, status, provider, owner, repo, commit_sha, tokei_version, source, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
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
        .bind(source_to_str(&key.source))
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

/// How many languages an SEO card carries. The card also reports the *full*
/// language count in its prose, which is why `ReportCard` keeps both.
pub const SEO_CARD_LANGUAGES: usize = 12;

/// Everything the SEO cards and the growth-stats repository lists need from a
/// report, and nothing else. Deliberately not a `Report`: the point is to never
/// materialize the full language list or re-serialize a body we already had.
#[derive(Clone, Debug)]
pub struct ReportCard {
    pub provider: RepositoryProvider,
    pub owner: String,
    pub repo: String,
    pub html_url: String,
    pub ref_name: String,
    pub commit_sha: String,
    pub generated_at: DateTime<Utc>,
    pub duration_ms: u128,
    pub tokei_version: String,
    pub total: LanguageStats,
    /// The number of languages in the report, *not* `languages.len()`.
    pub language_count: usize,
    /// The first [`SEO_CARD_LANGUAGES`] languages, in report order.
    pub languages: Vec<LanguageReport>,
}

impl From<&Report> for ReportCard {
    fn from(report: &Report) -> Self {
        Self {
            provider: report.repository.provider,
            owner: report.repository.owner.clone(),
            repo: report.repository.name.clone(),
            html_url: report.repository.html_url.clone(),
            ref_name: report.ref_name.clone(),
            commit_sha: report.commit_sha.clone(),
            generated_at: report.generated_at,
            duration_ms: report.duration_ms,
            tokei_version: report.tokei_version.clone(),
            total: report.total.clone(),
            language_count: report.languages.len(),
            languages: report
                .languages
                .iter()
                .take(SEO_CARD_LANGUAGES)
                .cloned()
                .collect(),
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum ReportOrder {
    Recent,
    Popular,
    Monolith,
}

/// The per-row projection shared by every card query. A macro rather than a
/// `const` so `concat!` can splice it into each order's `&'static str`.
/// `$3` is the language cap; see [`SEO_CARD_LANGUAGES`].
macro_rules! card_projection {
    () => {
        r#"
        SELECT
            r.provider AS provider,
            r.owner AS owner,
            r.repo AS repo,
            r.language_count AS language_count,
            r.body->'repository'->>'htmlUrl' AS html_url,
            r.body->>'refName' AS ref_name,
            r.body->>'commitSha' AS commit_sha,
            r.body->>'generatedAt' AS generated_at,
            r.body->>'durationMs' AS duration_ms,
            r.body->>'tokeiVersion' AS tokei_version,
            (r.body->'total')::text AS total,
            COALESCE((
                SELECT jsonb_agg(entry ORDER BY idx)
                FROM jsonb_array_elements(r.body->'languages')
                     WITH ORDINALITY AS elements(entry, idx)
                WHERE idx <= $3
            ), '[]'::jsonb)::text AS languages
        "#
    };
}

impl ReportOrder {
    fn card_sql(self) -> &'static str {
        match self {
            Self::Recent => {
                concat!(
                    card_projection!(),
                    r#"
                    FROM (
                        SELECT id, created_at
                        FROM (
                            SELECT DISTINCT ON (provider, owner, repo) id, created_at
                            FROM reports
                            ORDER BY provider, owner, repo, created_at DESC
                        ) latest
                        ORDER BY created_at DESC
                        LIMIT $1 OFFSET $2
                    ) page
                    JOIN reports r ON r.id = page.id
                    ORDER BY page.created_at DESC
                    "#
                )
            }
            Self::Popular => {
                concat!(
                    card_projection!(),
                    r#"
                    FROM (
                        SELECT id, access_count, last_accessed_at, created_at
                        FROM (
                            SELECT DISTINCT ON (provider, owner, repo)
                                id, access_count, last_accessed_at, created_at
                            FROM reports
                            ORDER BY provider, owner, repo, access_count DESC, last_accessed_at DESC, created_at DESC
                        ) popular
                        ORDER BY access_count DESC, last_accessed_at DESC, created_at DESC
                        LIMIT $1 OFFSET $2
                    ) page
                    JOIN reports r ON r.id = page.id
                    ORDER BY page.access_count DESC, page.last_accessed_at DESC, page.created_at DESC
                    "#
                )
            }
            Self::Monolith => {
                concat!(
                    card_projection!(),
                    r#"
                    FROM (
                        SELECT id, total_lines, created_at
                        FROM (
                            SELECT DISTINCT ON (provider, owner, repo) id, total_lines, created_at
                            FROM reports
                            ORDER BY provider, owner, repo, created_at DESC
                        ) monoliths
                        ORDER BY total_lines DESC, created_at DESC
                        LIMIT $1 OFFSET $2
                    ) page
                    JOIN reports r ON r.id = page.id
                    ORDER BY page.total_lines DESC, page.created_at DESC
                    "#
                )
            }
        }
    }
}

/// Builds the "read a report and maybe bump its access counter" statement.
///
/// Access counting is throttled to once an hour per report, so on any popular
/// report the `UPDATE ... RETURNING` matches zero rows almost every time and the
/// old code then had to issue a second `SELECT`: two round trips on the hottest
/// read path in the service, for one row.
///
/// A data-modifying CTE collapses that into one. Postgres runs the CTE exactly
/// once and to completion whether or not the outer query reads from it, and every
/// sub-statement sees the same snapshot, so the fallback arm reads the same body
/// the update would have returned. `NOT EXISTS (SELECT 1 FROM touched)` makes the
/// two arms mutually exclusive, so the result is still zero or one row.
///
/// `update_predicate` and `select_predicate` differ only because the cache-key
/// lookup has to resolve the primary key before it can update by it.
fn throttled_fetch_sql(
    body_expr: &str,
    update_predicate: &str,
    select_predicate: &str,
) -> String {
    format!(
        r#"
        WITH touched AS (
            UPDATE reports
            SET last_accessed_at = NOW(), access_count = access_count + 1
            WHERE {update_predicate}
            AND last_accessed_at < NOW() - INTERVAL '1 hour'
            RETURNING {body_expr} AS body
        )
        SELECT body FROM touched
        UNION ALL
        SELECT {body_expr} AS body
        FROM reports
        WHERE {select_predicate}
        AND NOT EXISTS (SELECT 1 FROM touched)
        "#
    )
}

/// A SQL expression rendering `body` as the JSON `/api/reports/{id}` has always
/// returned: the stored document plus the defaults that `serde` used to
/// materialize for the three fields that carry `#[serde(default)]`.
///
/// The defaults are serialized from the Rust types rather than hand-written, so
/// they cannot drift away from what deserialization would have produced.
fn normalized_report_body_expr() -> &'static str {
    static EXPR: OnceLock<String> = OnceLock::new();
    EXPR.get_or_init(|| {
        // Note this is `AnalysisOptions::default()`, i.e. every bool false --
        // *not* the `default_true` per-field defaults, which only apply when the
        // object itself is present. That is what the old round trip produced.
        let options =
            serde_json::to_string(&AnalysisOptions::default()).expect("options serialize");
        format!(
            r#"(
                jsonb_build_object('analysisKey', '', 'analysisOptions', '{options}'::jsonb)
                || body
                || jsonb_build_object(
                       'repository',
                       jsonb_build_object('provider', 'github')
                       || COALESCE(body->'repository', '{{}}'::jsonb)
                   )
            )::text"#
        )
    })
    .as_str()
}

fn row_to_report_card(row: sqlx::postgres::PgRow) -> anyhow::Result<ReportCard> {
    let provider: String = row.try_get("provider")?;
    let generated_at: String = row.try_get("generated_at")?;
    let duration_ms: String = row.try_get("duration_ms")?;
    let total: String = row.try_get("total")?;
    let languages: String = row.try_get("languages")?;
    let language_count: Option<i32> = row.try_get("language_count")?;
    let languages: Vec<LanguageReport> = serde_json::from_str(&languages)?;

    Ok(ReportCard {
        provider: provider_from_str(&provider)
            .ok_or_else(|| anyhow::anyhow!("unknown provider in database: {provider}"))?,
        owner: row.try_get("owner")?,
        repo: row.try_get("repo")?,
        html_url: row.try_get("html_url")?,
        ref_name: row.try_get("ref_name")?,
        commit_sha: row.try_get("commit_sha")?,
        generated_at: DateTime::parse_from_rfc3339(&generated_at)?.with_timezone(&Utc),
        duration_ms: duration_ms.parse()?,
        tokei_version: row.try_get("tokei_version")?,
        total: serde_json::from_str(&total)?,
        // Maintained by the reports_materialize_stats trigger, so it is only NULL
        // if a row escaped both the trigger and the backfill. The projected slice
        // is the best available fallback and is exact whenever the report has at
        // most SEO_CARD_LANGUAGES languages.
        language_count: language_count
            .map(|count| count as usize)
            .unwrap_or(languages.len()),
        languages,
    })
}

/// One sitemap row: everything `/api/seo/sitemap` needs, and nothing else.
#[derive(Clone, Debug)]
pub struct SitemapRow {
    pub provider: RepositoryProvider,
    pub owner: String,
    pub repo: String,
    pub lastmod: NaiveDate,
}

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
    pub source: AnalysisSource,
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

#[cfg(test)]
#[derive(Debug, PartialEq, Eq)]
struct ReportStatColumns {
    total_lines: Option<i64>,
    total_code: Option<i64>,
    total_files: Option<i64>,
    language_count: Option<i32>,
    top_language: Option<String>,
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

pub fn source_to_str(source: &AnalysisSource) -> &'static str {
    match source {
        AnalysisSource::Web => "web",
        AnalysisSource::Extension => "extension",
        AnalysisSource::GitHubAction => "github_action",
        AnalysisSource::Cli => "cli",
        AnalysisSource::Mcp => "mcp",
        AnalysisSource::Api => "api",
        AnalysisSource::Seed => "seed",
        AnalysisSource::GitHubTrending => "github_trending",
        AnalysisSource::Unknown => "unknown",
    }
}

fn source_from_str(source: &str) -> AnalysisSource {
    match source {
        "web" => AnalysisSource::Web,
        "extension" => AnalysisSource::Extension,
        "github_action" => AnalysisSource::GitHubAction,
        "cli" => AnalysisSource::Cli,
        "mcp" => AnalysisSource::Mcp,
        "api" => AnalysisSource::Api,
        "seed" => AnalysisSource::Seed,
        "github_trending" => AnalysisSource::GitHubTrending,
        _ => AnalysisSource::Unknown,
    }
}

fn growth_repository_stat(card: &ReportCard) -> GrowthRepositoryStat {
    GrowthRepositoryStat {
        provider: card.provider,
        owner: card.owner.clone(),
        repo: card.repo.clone(),
        public_path: crate::seo::repository_public_path(card.provider, &card.owner, &card.repo),
        html_url: card.html_url.clone(),
        ref_name: card.ref_name.clone(),
        generated_at: card.generated_at,
        total: card.total.clone(),
        top_language: card.languages.first().map(|language| language.name.clone()),
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
    use super::{CleanupConfig, JobKey, ReportCard, Store};
    use crate::models::{
        AnalysisOptions, AnalysisSource, JobStatus, LanguageReport, LanguageStats, Report,
        Repository, RepositoryProvider,
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
        store
            .save_report(&report, AnalysisSource::Unknown)
            .await
            .unwrap();

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
            .save_report(
                &test_report("report-upsert-1", &owner, 100),
                AnalysisSource::Unknown,
            )
            .await
            .unwrap();
        store
            .save_report(
                &test_report("report-upsert-2", &owner, 250),
                AnalysisSource::Unknown,
            )
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
        store
            .save_report(&report, AnalysisSource::Unknown)
            .await
            .unwrap();
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

    /// The CTE that merged the two round trips must not change the throttle:
    /// a read inside the hour returns the body but leaves the counter alone.
    #[tokio::test]
    async fn report_read_within_the_hour_does_not_bump_the_access_count() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        let report = test_report("report-throttle-inside", &owner, 100);
        store
            .save_report(&report, AnalysisSource::Unknown)
            .await
            .unwrap();
        let touched_at = Utc::now() - Duration::minutes(30);
        store
            .force_report_access_metadata(&report.id, touched_at, 5)
            .await
            .unwrap();

        let loaded = store.report(&report.id).await.unwrap().unwrap();
        let json = store.report_json(&report.id).await.unwrap().unwrap();
        let (last_accessed_at, access_count) =
            store.report_access_metadata(&report.id).await.unwrap();

        assert_eq!(loaded.id, report.id);
        assert!(json.contains("report-throttle-inside"));
        assert_eq!(access_count, 5, "still inside the throttle window");
        assert_eq!(
            last_accessed_at.timestamp_millis(),
            touched_at.timestamp_millis(),
            "last_accessed_at must not move either"
        );
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn report_read_after_the_hour_bumps_the_access_count_once() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        let report = test_report("report-throttle-outside", &owner, 100);
        store
            .save_report(&report, AnalysisSource::Unknown)
            .await
            .unwrap();
        store
            .force_report_access_metadata(&report.id, Utc::now() - Duration::hours(2), 5)
            .await
            .unwrap();

        assert!(store.report(&report.id).await.unwrap().is_some());
        let (_, after_first) = store.report_access_metadata(&report.id).await.unwrap();
        // The first read reset the clock, so the immediate second read is throttled.
        assert!(store.report_json(&report.id).await.unwrap().is_some());
        let (_, after_second) = store.report_access_metadata(&report.id).await.unwrap();

        assert_eq!(after_first, 6);
        assert_eq!(after_second, 6);
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn cached_report_lookup_throttles_the_same_way() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        let report = test_report("report-throttle-key", &owner, 100);
        store
            .save_report(&report, AnalysisSource::Unknown)
            .await
            .unwrap();
        store
            .force_report_access_metadata(&report.id, Utc::now() - Duration::minutes(30), 2)
            .await
            .unwrap();

        assert!(store
            .cached_report(&owner, "count", "abc123", "tokei-test:default")
            .await
            .unwrap()
            .is_some());
        let (_, inside) = store.report_access_metadata(&report.id).await.unwrap();

        store
            .force_report_access_metadata(&report.id, Utc::now() - Duration::hours(2), 2)
            .await
            .unwrap();
        assert!(store
            .cached_report(&owner, "count", "abc123", "tokei-test:default")
            .await
            .unwrap()
            .is_some());
        let (_, outside) = store.report_access_metadata(&report.id).await.unwrap();

        assert_eq!(inside, 2, "within the hour: no increment");
        assert_eq!(outside, 3, "after the hour: exactly one increment");
        store.drop_schema().await;
    }

    /// A miss must stay a miss: the CTE's fallback arm cannot invent a row.
    #[tokio::test]
    async fn missing_report_returns_none_from_both_read_paths() {
        let Some(store) = test_store().await else {
            return;
        };

        assert!(store.report("no-such-report").await.unwrap().is_none());
        assert!(store.report_json("no-such-report").await.unwrap().is_none());
        assert!(store
            .cached_report("nobody", "nothing", "deadbeef", "tokei-test:default")
            .await
            .unwrap()
            .is_none());
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn growth_stats_aggregate_public_reports() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        let first = test_report("report-growth-1", &owner, 100);
        let mut second = test_report("report-growth-2", &owner, 250);
        second.commit_sha = "def456".to_string();
        store
            .save_report(&first, AnalysisSource::Web)
            .await
            .unwrap();
        store
            .save_report(&second, AnalysisSource::Extension)
            .await
            .unwrap();

        let stats = store.growth_stats().await.unwrap();

        assert_eq!(stats.totals.reports_generated, 2);
        assert_eq!(stats.totals.repositories_analyzed, 1);
        assert_eq!(stats.totals.code_lines_counted, 350);
        assert_eq!(stats.windows.reports_30d, 2);
        assert_eq!(stats.sources.iter().map(|row| row.reports).sum::<i64>(), 2);
        assert!(stats.languages.iter().any(|row| row.language == "Rust"));
        assert_eq!(stats.top_repositories.len(), 1);
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn saved_report_materializes_stat_columns_from_body() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        let mut report = test_report("report-stats", &owner, 100);
        report.languages.push(LanguageReport {
            name: "TOML".to_string(),
            stats: LanguageStats {
                files: 2,
                lines: 20,
                code: 15,
                comments: 3,
                blanks: 2,
            },
            children: Vec::new(),
        });
        store
            .save_report(&report, AnalysisSource::Unknown)
            .await
            .unwrap();

        let columns = store.report_stat_columns(&report.id).await.unwrap();

        assert_eq!(columns.total_lines, Some(report.total.lines as i64));
        assert_eq!(columns.total_code, Some(report.total.code as i64));
        assert_eq!(columns.total_files, Some(report.total.files as i64));
        assert_eq!(columns.language_count, Some(2));
        assert_eq!(columns.top_language.as_deref(), Some("Rust"));
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn upsert_refreshes_stat_columns() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        store
            .save_report(
                &test_report("report-stats-v1", &owner, 100),
                AnalysisSource::Unknown,
            )
            .await
            .unwrap();
        store
            .save_report(
                &test_report("report-stats-v2", &owner, 999),
                AnalysisSource::Unknown,
            )
            .await
            .unwrap();

        let columns = store.report_stat_columns("report-stats-v2").await.unwrap();

        assert_eq!(columns.total_code, Some(999));
        assert_eq!(columns.total_lines, Some(1009));
        store.drop_schema().await;
    }

    /// The rolling-deploy case: a binary that predates these columns writes only
    /// `body`. The trigger has to keep the projection honest anyway, otherwise
    /// `ORDER BY total_lines DESC` silently ranks that row with a stale value.
    #[tokio::test]
    async fn body_only_write_still_refreshes_stat_columns() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        let report = test_report("report-stats-legacy-writer", &owner, 100);
        store
            .save_report(&report, AnalysisSource::Unknown)
            .await
            .unwrap();

        let mut rewritten = test_report("report-stats-legacy-writer", &owner, 4_242);
        rewritten.languages[0].name = "Zig".to_string();
        store
            .force_report_body(&report.id, &serde_json::to_string(&rewritten).unwrap())
            .await
            .unwrap();

        let columns = store.report_stat_columns(&report.id).await.unwrap();

        assert_eq!(columns.total_code, Some(4_242));
        assert_eq!(columns.top_language.as_deref(), Some("Zig"));
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn backfill_fills_rows_whose_stat_columns_are_null() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        let report = test_report("report-stats-backfill", &owner, 777);
        store
            .save_report(&report, AnalysisSource::Unknown)
            .await
            .unwrap();
        store
            .clear_report_stat_columns(&report.id)
            .await
            .unwrap();
        assert_eq!(
            store
                .report_stat_columns(&report.id)
                .await
                .unwrap()
                .total_lines,
            None
        );

        let backfilled = store.backfill_report_stats().await.unwrap();

        assert_eq!(backfilled, 1);
        let columns = store.report_stat_columns(&report.id).await.unwrap();
        assert_eq!(columns.total_code, Some(777));
        assert_eq!(columns.language_count, Some(1));
        // Idempotent: a second pass has nothing left to do.
        assert_eq!(store.backfill_report_stats().await.unwrap(), 0);
        store.drop_schema().await;
    }

    /// The access-count touch must not fire the trigger, otherwise every cached
    /// read pays to detoast the report body.
    #[tokio::test]
    async fn access_touch_does_not_fire_the_stat_trigger() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        let report = test_report("report-stats-untouched", &owner, 100);
        store
            .save_report(&report, AnalysisSource::Unknown)
            .await
            .unwrap();
        store.clear_report_stat_columns(&report.id).await.unwrap();

        store
            .force_report_access_metadata(&report.id, Utc::now() - Duration::hours(2), 1)
            .await
            .unwrap();
        assert!(store.report(&report.id).await.unwrap().is_some());

        assert_eq!(
            store
                .report_stat_columns(&report.id)
                .await
                .unwrap()
                .total_lines,
            None,
            "an UPDATE that does not set body must not re-derive the columns"
        );
        store.drop_schema().await;
    }

    /// The SQL-side projection has to agree with what deserializing the whole
    /// report and slicing it in Rust used to produce -- including keeping the
    /// *full* language count next to the truncated language list.
    #[tokio::test]
    async fn projected_card_matches_the_in_memory_projection() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        let mut report = test_report("report-card", &owner, 100);
        report.languages = (0..20)
            .map(|index| LanguageReport {
                name: format!("Lang{index:02}"),
                stats: LanguageStats {
                    files: index + 1,
                    lines: (index + 1) * 100,
                    code: (index + 1) * 70,
                    comments: (index + 1) * 20,
                    blanks: (index + 1) * 10,
                },
                children: vec![LanguageReport {
                    name: format!("Child{index:02}"),
                    stats: LanguageStats::default(),
                    children: Vec::new(),
                }],
            })
            .collect();
        store
            .save_report(&report, AnalysisSource::Unknown)
            .await
            .unwrap();

        let expected = ReportCard::from(&report);
        let cards = store.recent_reports(10, 0).await.unwrap();
        let actual = cards.first().expect("one card");

        assert_eq!(actual.provider, expected.provider);
        assert_eq!(actual.owner, expected.owner);
        assert_eq!(actual.repo, expected.repo);
        assert_eq!(actual.html_url, expected.html_url);
        assert_eq!(actual.ref_name, expected.ref_name);
        assert_eq!(actual.commit_sha, expected.commit_sha);
        assert_eq!(actual.generated_at, expected.generated_at);
        assert_eq!(actual.duration_ms, expected.duration_ms);
        assert_eq!(actual.tokei_version, expected.tokei_version);
        assert_eq!(
            serde_json::to_value(&actual.total).unwrap(),
            serde_json::to_value(&expected.total).unwrap()
        );
        assert_eq!(actual.language_count, 20, "full count, not the slice length");
        assert_eq!(actual.languages.len(), super::SEO_CARD_LANGUAGES);
        assert_eq!(
            serde_json::to_value(&actual.languages).unwrap(),
            serde_json::to_value(&expected.languages).unwrap(),
            "SQL-side slice must match iter().take(SEO_CARD_LANGUAGES), children included"
        );
        store.drop_schema().await;
    }

    /// A report with no languages at all must not blow up the `jsonb_agg`
    /// projection, and must come back with an empty list rather than SQL NULL.
    #[tokio::test]
    async fn projected_card_handles_a_report_with_no_languages() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        let mut report = test_report("report-card-empty", &owner, 0);
        report.languages = Vec::new();
        report.total = LanguageStats::default();
        store
            .save_report(&report, AnalysisSource::Unknown)
            .await
            .unwrap();

        let cards = store.recent_reports(10, 0).await.unwrap();

        assert_eq!(cards.len(), 1);
        assert!(cards[0].languages.is_empty());
        assert_eq!(cards[0].language_count, 0);
        store.drop_schema().await;
    }

    /// The golden fixtures pin the endpoint's bytes; this pins the query itself:
    /// one row per repository, newest first, and the limit is honoured.
    #[tokio::test]
    async fn sitemap_entries_dedupe_by_repository_and_order_by_recency() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        for (index, repo) in ["alpha", "beta", "gamma"].iter().enumerate() {
            for revision in 0..2 {
                let mut report =
                    test_report(&format!("report-sitemap-{repo}-{revision}"), &owner, 100);
                report.repository.name = (*repo).to_string();
                report.commit_sha = format!("sha-{repo}-{revision}");
                report.generated_at =
                    Utc::now() - Duration::days(index as i64) - Duration::hours(revision * 5);
                store
                    .save_report(&report, AnalysisSource::Unknown)
                    .await
                    .unwrap();
            }
        }

        let all = store.sitemap_entries(45_000).await.unwrap();
        let limited = store.sitemap_entries(2).await.unwrap();

        assert_eq!(all.len(), 3, "one entry per repository, not per report");
        assert_eq!(
            all.iter().map(|row| row.repo.as_str()).collect::<Vec<_>>(),
            ["alpha", "beta", "gamma"],
        );
        assert_eq!(limited.len(), 2);
        assert_eq!(limited[0].repo, "alpha");
        assert_eq!(all[0].provider, RepositoryProvider::GitHub);
        assert_eq!(all[0].lastmod, all[0].lastmod.min(Utc::now().date_naive()));
        store.drop_schema().await;
    }

    /// A live differential test against the JSON-expansion queries B6 replaced.
    /// The golden fixture pins one corpus; this re-runs the original SQL on
    /// whatever is in the table and demands the same answer.
    #[tokio::test]
    async fn language_rollup_agrees_with_the_json_expansion_it_replaced() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        for (index, languages) in [
            vec![("Rust", 1_000), ("TOML", 30)],
            vec![("Rust", 250), ("Go", 900), ("Shell", 12)],
            vec![],
            vec![("Go", 5), ("Rust", 5), ("Zig", 5)],
        ]
        .into_iter()
        .enumerate()
        {
            let mut report = test_report(&format!("report-rollup-{index}"), &owner, 100);
            report.repository.name = format!("repo{index}");
            report.languages = languages
                .into_iter()
                .map(|(name, code)| LanguageReport {
                    name: name.to_string(),
                    stats: LanguageStats {
                        files: 1,
                        lines: code + 10,
                        code,
                        comments: 7,
                        blanks: 3,
                    },
                    children: Vec::new(),
                })
                .collect();
            store
                .save_report(&report, AnalysisSource::Unknown)
                .await
                .unwrap();
        }

        let languages = store.growth_languages().await.unwrap();
        let legacy_languages = store.legacy_growth_languages().await.unwrap();
        let totals = store.growth_stats().await.unwrap().totals;
        let legacy_totals = store.legacy_growth_totals().await.unwrap();

        assert_eq!(
            languages
                .iter()
                .map(|row| (row.language.clone(), row.code, row.lines, row.reports))
                .collect::<Vec<_>>(),
            legacy_languages,
        );
        assert_eq!(
            (
                totals.reports_generated,
                totals.repositories_analyzed,
                totals.lines_counted,
                totals.code_lines_counted,
                totals.languages_detected
            ),
            legacy_totals,
        );
        store.drop_schema().await;
    }

    /// `save_report`'s upsert can change the primary key of an existing row, so
    /// the rollup has to survive both the rename and the language list changing
    /// underneath it.
    #[tokio::test]
    async fn upsert_replaces_stale_language_rows() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        let mut first = test_report("report-langs-v1", &owner, 100);
        first.languages = vec![
            LanguageReport {
                name: "Rust".to_string(),
                stats: LanguageStats {
                    files: 1,
                    lines: 110,
                    code: 100,
                    comments: 7,
                    blanks: 3,
                },
                children: Vec::new(),
            },
            LanguageReport {
                name: "Perl".to_string(),
                stats: LanguageStats::default(),
                children: Vec::new(),
            },
        ];
        store
            .save_report(&first, AnalysisSource::Unknown)
            .await
            .unwrap();
        assert_eq!(
            store.report_language_names("report-langs-v1").await.unwrap(),
            ["Perl", "Rust"]
        );

        // Same cache key, different id and a language dropped.
        let mut second = test_report("report-langs-v2", &owner, 250);
        second.languages = vec![LanguageReport {
            name: "Rust".to_string(),
            stats: LanguageStats {
                files: 1,
                lines: 260,
                code: 250,
                comments: 7,
                blanks: 3,
            },
            children: Vec::new(),
        }];
        store
            .save_report(&second, AnalysisSource::Unknown)
            .await
            .unwrap();

        assert_eq!(
            store.report_language_names("report-langs-v2").await.unwrap(),
            ["Rust"],
            "Perl must not survive the upsert"
        );
        assert!(
            store
                .report_language_names("report-langs-v1")
                .await
                .unwrap()
                .is_empty(),
            "no rows may be left behind under the previous id"
        );
        assert_eq!(store.orphaned_language_rows().await.unwrap(), 0);
        store.drop_schema().await;
    }

    /// cleanup() deletes reports directly; ON DELETE CASCADE has to take the
    /// rollup rows with them.
    #[tokio::test]
    async fn deleting_a_report_cascades_to_its_language_rows() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        for index in 0..3 {
            let id = format!("report-cascade-{index}");
            let mut report = test_report(&id, &owner, 100 + index);
            report.commit_sha = format!("abc123-{index}");
            store
                .save_report(&report, AnalysisSource::Unknown)
                .await
                .unwrap();
            store
                .force_report_timestamps(
                    &id,
                    Utc::now() - Duration::days(31),
                    Utc::now() - Duration::days(31 + i64::from(2 - index as i32)),
                )
                .await
                .unwrap();
        }
        assert_eq!(store.total_language_rows().await.unwrap(), 3);

        cleanup(
            &store,
            CleanupConfig {
                report_min_retention_days: 30,
                report_max_rows: 1,
                report_cleanup_batch_size: 10,
                ..CleanupConfig::default()
            },
        )
        .await;

        assert!(!store.report_exists("report-cascade-0").await.unwrap());
        assert_eq!(store.orphaned_language_rows().await.unwrap(), 0);
        assert_eq!(
            store.total_language_rows().await.unwrap(),
            1,
            "one row per surviving report"
        );
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn language_backfill_is_batched_and_idempotent() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        for index in 0..3 {
            let mut report = test_report(&format!("report-lang-backfill-{index}"), &owner, 100);
            report.repository.name = format!("repo{index}");
            store
                .save_report(&report, AnalysisSource::Unknown)
                .await
                .unwrap();
        }
        // A report with no languages at all must not keep the backfill looping.
        let mut empty = test_report("report-lang-backfill-empty", &owner, 0);
        empty.repository.name = "empty".to_string();
        empty.languages = Vec::new();
        store
            .save_report(&empty, AnalysisSource::Unknown)
            .await
            .unwrap();

        store.truncate_report_languages().await.unwrap();
        assert_eq!(store.total_language_rows().await.unwrap(), 0);

        assert_eq!(store.backfill_report_languages().await.unwrap(), 3);
        assert_eq!(store.total_language_rows().await.unwrap(), 3);
        assert_eq!(
            store.backfill_report_languages().await.unwrap(),
            0,
            "a second pass must find nothing to do"
        );
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
        store
            .save_report(&report, AnalysisSource::Unknown)
            .await
            .unwrap();

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
            store
                .save_report(&report, AnalysisSource::Unknown)
                .await
                .unwrap();
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
            source: AnalysisSource::Unknown,
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
