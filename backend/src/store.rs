use std::sync::OnceLock;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::models::{
    AnalysisOptions, AnalysisSource, ApiErrorBody, GrowthLanguageStat, GrowthRepositoryStat,
    GrowthSourceStat, GrowthStats, GrowthTotals, GrowthWindows, JobRecord, JobStatus,
    LanguageReport, LanguageStats, Report, RepositoryProvider,
};

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
            r.body->>'refName' AS ref_name,
            r.body->>'commitSha' AS commit_sha,
            r.body->>'generatedAt' AS generated_at,
            r.body->>'durationMs' AS duration_ms,
            r.body->>'tokeiVersion' AS tokei_version,
            r.body->>'analysisKey' AS analysis_key,
            (r.body->'analysisOptions')::text AS analysis_options,
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

/// Whether a `reports` row may stand as its repository's *latest* report.
///
/// SLOC-history sampling (`AnalysisSource::SlocBackfill`) writes one report
/// per sampled commit into the same table, and `created_at` records when a
/// row was written, not how recent its commit is: a suspect-point resample
/// re-analyzes a years-old commit today, and a first-view backfill can end on
/// a cache hit for HEAD so its newest *row* is a historical sample. Picking
/// the newest row per repository would then publish history as the current
/// report. A sampler row is only eligible when its commit is the repo's
/// newest live SLOC snapshot -- i.e. it is the forward sampler's (or
/// backfill's final) analysis of HEAD. Every other source is always eligible.
///
/// The argument is the `reports` table alias (or name) in the host query.
macro_rules! latest_eligible {
    ($t:literal) => {
        concat!(
            "(",
            $t,
            ".source <> 'sloc_backfill' OR ",
            $t,
            ".commit_sha = (",
            "SELECT s.commit_sha FROM sloc_snapshots s ",
            "WHERE s.provider = ",
            $t,
            ".provider AND s.owner = ",
            $t,
            ".owner ",
            "AND s.repo = ",
            $t,
            ".repo AND s.superseded_at IS NULL ",
            "ORDER BY s.snapshot_date DESC LIMIT 1))"
        )
    };
}

/// Whether a `reports` row was counted under [`AnalysisOptions::canonical`] —
/// the public-surface profile the indexed corpus was produced with.
///
/// The SEO surfaces (report card, related, sitemap, every list order) answer
/// "how big is this repository", and the number they published for years is
/// the canonical-options one. `analysisOptions` is a whole family of
/// *different measurements* of the same repository: the web app's default
/// toggles docs/tests/generated all in, so a single visitor analysis writes a
/// numerically much larger row (live incident: `facebook/react` flipped from
/// the indexed ~365K-code row to a 698K include-all one, and
/// `save_report`'s upsert preserves `created_at`, so re-analyzing did not
/// restore it). Rows counted under any other option set — including the
/// legacy NULL shape, which predates option tracking and was produced by an
/// analyzer with no doc/test/generated filtering at all — stay stored and
/// stay served by the interactive paths (`latest_report`), but can no longer
/// stand as the canonical public report.
///
/// Backed by the `options_canonical` column, maintained by the same
/// `reports_materialize_stats` trigger that keeps the stat columns a pure
/// function of `body`, so every writer (including an old binary mid-deploy)
/// maintains it. The argument is the `reports` table alias in the host query.
macro_rules! canonical_options_sql {
    ($t:literal) => {
        concat!($t, ".options_canonical")
    };
}

/// The canonical options as serialized JSON, for SQL that must compare against
/// `body->'analysisOptions'` (the `options_canonical` trigger and backfill).
/// Serialized from the Rust type so it cannot drift from
/// [`AnalysisOptions::canonical`].
fn canonical_options_json() -> &'static str {
    static JSON: OnceLock<String> = OnceLock::new();
    JSON.get_or_init(|| serde_json::to_string(&AnalysisOptions::canonical()).expect("options serialize"))
        .as_str()
}

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
                CONSTRAINT reports_source_valid CHECK (source IN ('web', 'extension', 'github_action', 'cli', 'mcp', 'api', 'seed', 'github_trending', 'sloc_backfill', 'unknown')),
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
                CONSTRAINT jobs_source_valid CHECK (source IN ('web', 'extension', 'github_action', 'cli', 'mcp', 'api', 'seed', 'github_trending', 'sloc_backfill', 'unknown')),
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
                    AND pg_get_constraintdef(oid) NOT LIKE '%sloc_backfill%'
                ) THEN
                    ALTER TABLE reports DROP CONSTRAINT reports_source_valid;
                    ALTER TABLE reports
                    ADD CONSTRAINT reports_source_valid CHECK (source IN ('web', 'extension', 'github_action', 'cli', 'mcp', 'api', 'seed', 'github_trending', 'sloc_backfill', 'unknown'));
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'jobs_source_valid'
                    AND connamespace = current_schema()::regnamespace
                    AND pg_get_constraintdef(oid) NOT LIKE '%sloc_backfill%'
                ) THEN
                    ALTER TABLE jobs DROP CONSTRAINT jobs_source_valid;
                    ALTER TABLE jobs
                    ADD CONSTRAINT jobs_source_valid CHECK (source IN ('web', 'extension', 'github_action', 'cli', 'mcp', 'api', 'seed', 'github_trending', 'sloc_backfill', 'unknown'));
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
        self.migrate_star_history().await?;
        self.migrate_sloc_history().await?;
        self.migrate_repo_redirects().await?;

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
    ///
    /// `options_canonical` rides the same trigger for the same reasons (pure
    /// function of `body` for every writer): it is the boolean behind
    /// [`canonical_options_sql!`], computed as strict jsonb equality of
    /// `body->'analysisOptions'` against the canonical options JSON. Strict
    /// equality is the right comparison because a *partial* options object
    /// deserializes with serde's field-level `default_true` toggles — anything
    /// the writer omitted counts as included, which is a different measurement —
    /// and the legacy NULL shape (rows predating option tracking, written by an
    /// analyzer with no doc/test/generated filtering) is the all-inclusive set
    /// in everything but spelling. Both therefore land on `false`, which is the
    /// `COALESCE`'s doing: `NULL = jsonb` is SQL NULL, and a NULL guard would
    /// behave identically in a `WHERE` clause, but an explicit `false` keeps the
    /// column honest for ad-hoc inspection.
    async fn migrate_report_stat_columns(&self) -> anyhow::Result<()> {
        // Nullable, no default: a metadata-only change, no table rewrite.
        sqlx::query(
            r#"
            ALTER TABLE reports
                ADD COLUMN IF NOT EXISTS total_lines BIGINT,
                ADD COLUMN IF NOT EXISTS total_code BIGINT,
                ADD COLUMN IF NOT EXISTS total_files BIGINT,
                ADD COLUMN IF NOT EXISTS language_count INT,
                ADD COLUMN IF NOT EXISTS top_language TEXT,
                ADD COLUMN IF NOT EXISTS options_canonical BOOLEAN
            "#,
        )
        .execute(&self.pool)
        .await?;

        // The `{}` placeholder splices in the canonical JSON serialized from
        // the Rust type (see `canonical_options_json`) rather than a
        // hand-written literal, so the trigger can never drift from
        // `AnalysisOptions::canonical`. The rest of the body contains no
        // braces of its own (plain plpgsql), so the placeholder is the only
        // one format! sees.
        let trigger_body = format!(
            r#"
            CREATE OR REPLACE FUNCTION reports_materialize_stats() RETURNS trigger AS $$
            BEGIN
                NEW.total_lines := COALESCE((NEW.body->'total'->>'lines')::bigint, 0);
                NEW.total_code := COALESCE((NEW.body->'total'->>'code')::bigint, 0);
                NEW.total_files := COALESCE((NEW.body->'total'->>'files')::bigint, 0);
                NEW.language_count := COALESCE(jsonb_array_length(NEW.body->'languages'), 0);
                NEW.top_language := NEW.body->'languages'->0->>'name';
                NEW.options_canonical := COALESCE(
                    (NEW.body->'analysisOptions') = '{}'::jsonb,
                    false
                );
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
            "#,
            canonical_options_json()
        );
        sqlx::query(&trigger_body).execute(&self.pool).await?;

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
        self.backfill_options_canonical().await?;

        // The SEO-latest lookup matches the key case-insensitively (GitHub
        // treats slug casing as the same repository) and only over canonical
        // rows, so this partial expression index is exactly its access path:
        // one candidate row per case-variant slug, no body detoast, no filter
        // left to apply afterwards. Plain, not CONCURRENTLY, for the same
        // reasons as `idx_reports_total_lines` above.
        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_reports_canonical_ci_latest
            ON reports (provider, lower(owner), lower(repo), created_at DESC)
            WHERE options_canonical
            "#,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fills `options_canonical` for rows that predate the column, one bounded
    /// batch per statement, same shape (and same locking rationale) as
    /// [`Store::backfill_report_stats`].
    async fn backfill_options_canonical(&self) -> anyhow::Result<u64> {
        const BATCH: i64 = 1_000;
        const MAX_BATCHES: usize = 10_000;

        let mut total = 0_u64;
        for _ in 0..MAX_BATCHES {
            let affected = sqlx::query(
                r#"
                UPDATE reports
                SET options_canonical = COALESCE(
                    (body->'analysisOptions') = $1::jsonb,
                    false
                )
                WHERE id IN (
                    SELECT id FROM reports WHERE options_canonical IS NULL LIMIT $2
                )
                "#,
            )
            .bind(canonical_options_json())
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
            "options_canonical backfill hit its batch cap; the next migrate() will resume it"
        );
        Ok(total)
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

    /// Star history is GitHub-only (GitLab has no public per-star timestamp
    /// API), tracked only for repositories someone has actually asked to see a
    /// chart for — `star_watch` is that opt-in list, populated the first time
    /// `star_history()` is called for a given repo. `star_snapshots` then
    /// accumulates one row per watched repo per day via a background task
    /// (see `spawn_star_snapshot_task` in main.rs); a UNIQUE(provider, owner,
    /// repo, date) lets that task upsert idempotently no matter how many times
    /// it runs in a day.
    async fn migrate_star_history(&self) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS star_watch (
                provider TEXT NOT NULL,
                owner TEXT NOT NULL,
                repo TEXT NOT NULL,
                first_watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (provider, owner, repo)
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS star_snapshots (
                provider TEXT NOT NULL,
                owner TEXT NOT NULL,
                repo TEXT NOT NULL,
                snapshot_date DATE NOT NULL,
                star_count BIGINT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT star_snapshots_count_nonnegative CHECK (star_count >= 0),
                UNIQUE(provider, owner, repo, snapshot_date)
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_star_snapshots_lookup ON star_snapshots (provider, owner, repo, snapshot_date)",
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Adds a repo to the watch list if it isn't already on it. Returns
    /// whether this call was the one that started watching it, so the caller
    /// can decide whether a one-time historical backfill is needed.
    pub async fn watch_repo_for_stars(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
    ) -> anyhow::Result<bool> {
        let result = sqlx::query(
            r#"
            INSERT INTO star_watch (provider, owner, repo)
            VALUES ($1, $2, $3)
            ON CONFLICT (provider, owner, repo) DO NOTHING
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Every watched repo, for the daily snapshot task to iterate.
    pub async fn watched_star_repos(
        &self,
    ) -> anyhow::Result<Vec<(RepositoryProvider, String, String)>> {
        let rows = sqlx::query("SELECT provider, owner, repo FROM star_watch")
            .fetch_all(&self.pool)
            .await?;

        rows.into_iter()
            .map(|row| {
                let provider: String = row.try_get("provider")?;
                let owner: String = row.try_get("owner")?;
                let repo: String = row.try_get("repo")?;
                let provider = provider_from_str(&provider)
                    .ok_or_else(|| anyhow::anyhow!("unknown provider {provider}"))?;
                Ok((provider, owner, repo))
            })
            .collect()
    }

    /// Inserts or replaces today's (or a backfilled day's) star count for a
    /// repo. `ON CONFLICT ... DO UPDATE` rather than `DO NOTHING` so a repeat
    /// snapshot the same day corrects an earlier bad read instead of freezing
    /// on it, and so a backfill re-run recovers cleanly from a partial prior
    /// attempt.
    pub async fn record_star_snapshot(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
        date: NaiveDate,
        star_count: i64,
    ) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            INSERT INTO star_snapshots (provider, owner, repo, snapshot_date, star_count)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (provider, owner, repo, snapshot_date)
            DO UPDATE SET star_count = EXCLUDED.star_count
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .bind(date)
        .bind(star_count)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// The full recorded history for a repo, oldest first — whatever mix of
    /// backfilled and daily-snapshot rows exists. Empty for a repo nobody has
    /// ever asked to watch yet.
    pub async fn star_history(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
    ) -> anyhow::Result<Vec<(NaiveDate, i64)>> {
        let rows = sqlx::query(
            r#"
            SELECT snapshot_date, star_count
            FROM star_snapshots
            WHERE provider = $1 AND owner = $2 AND repo = $3
            ORDER BY snapshot_date ASC
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let date: NaiveDate = row.try_get("snapshot_date")?;
                let count: i64 = row.try_get("star_count")?;
                Ok((date, count))
            })
            .collect()
    }

    async fn migrate_sloc_history(&self) -> anyhow::Result<()> {
        // Reuses `star_watch` as the "this repo's history was requested"
        // trigger instead of a second watch table — both the star and SLOC
        // backfills key off the same first-view signal.
        sqlx::query(
            "ALTER TABLE star_watch ADD COLUMN IF NOT EXISTS sloc_backfill_started_at TIMESTAMPTZ",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query("ALTER TABLE star_watch ADD COLUMN IF NOT EXISTS sloc_backfill_completed_at TIMESTAMPTZ")
            .execute(&self.pool)
            .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS sloc_snapshots (
                provider TEXT NOT NULL,
                owner TEXT NOT NULL,
                repo TEXT NOT NULL,
                snapshot_date DATE NOT NULL,
                total_lines BIGINT NOT NULL,
                commit_sha TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT sloc_snapshots_lines_nonnegative CHECK (total_lines >= 0),
                UNIQUE(provider, owner, repo, snapshot_date)
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // `source` distinguishes first-view backfill samples from forward
        // (keep-fresh) samples; `superseded_at` is the compaction task's
        // soft delete — aged points that no longer earn their keep in the
        // rendered curve are hidden, never destroyed, and any re-record of
        // the same date revives the row.
        sqlx::query("ALTER TABLE sloc_snapshots ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'backfill'")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "ALTER TABLE sloc_snapshots ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_sloc_snapshots_lookup ON sloc_snapshots (provider, owner, repo, snapshot_date)",
        )
        .execute(&self.pool)
        .await?;

        // Mirrors the sloc_backfill_* pair above: a repo's real star history
        // (Phase 2) can only be backfilled once a caller proves ownership via
        // a token with write access, so it gets its own started/completed
        // markers on the same star_watch row.
        sqlx::query(
            "ALTER TABLE star_watch ADD COLUMN IF NOT EXISTS star_backfill_started_at TIMESTAMPTZ",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query("ALTER TABLE star_watch ADD COLUMN IF NOT EXISTS star_backfill_completed_at TIMESTAMPTZ")
            .execute(&self.pool)
            .await?;

        // The suspect-point re-sampler's cooldown marker (see
        // `start_sloc_resample_if_needed`): a repo's implausible dips are
        // re-analyzed at most once per 24h, and the marker lives here — next
        // to the other per-repo history state — rather than in process memory
        // so multiple replicas respect the same cooldown.
        sqlx::query(
            "ALTER TABLE star_watch ADD COLUMN IF NOT EXISTS sloc_resample_started_at TIMESTAMPTZ",
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// The `repo_redirects` table: one row per known slug a repository has
    /// answered under before its current one. Written by rename-follow
    /// (`follow_repo_rename`) whenever a resolution proves the repository now
    /// answers under a different slug, and read by the SEO report/redirect
    /// endpoints so a pre-rename page request still finds its data.
    async fn migrate_repo_redirects(&self) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS repo_redirects (
                provider TEXT NOT NULL,
                old_owner TEXT NOT NULL,
                old_repo TEXT NOT NULL,
                new_owner TEXT NOT NULL,
                new_repo TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT repo_redirects_provider_valid CHECK (provider IN ('github', 'gitlab'))
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // First-write-wins per old slug: a redirect, once recorded, is never
        // rewritten by a later fold (a repo renamed *again* records its own
        // row under the intermediate slug, and readers follow the chain).
        // `ADD CONSTRAINT` has no `IF NOT EXISTS`, so idempotency goes through
        // the same catalog check every constraint migration above uses.
        sqlx::query(
            r#"
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'repo_redirects_old_key_unique'
                    AND connamespace = current_schema()::regnamespace
                ) THEN
                    ALTER TABLE repo_redirects
                    ADD CONSTRAINT repo_redirects_old_key_unique UNIQUE (provider, old_owner, old_repo);
                END IF;
            END $$;
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Lookups are case-insensitive like every other slug path in the
        // service (GitHub treats slug casing as the same repository), so the
        // index has to be on the folded key or every lookup degrades to a
        // scan of the table.
        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_repo_redirects_lookup
            ON repo_redirects (provider, lower(old_owner), lower(old_repo))
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Folds everything stored under `old` into `new` when a resolution proves
    /// the repository now answers under a different slug (rename or transfer),
    /// and records the redirect. One transaction, idempotent: after a
    /// successful fold the old key holds nothing canonical, so a repeat call
    /// only re-asserts the redirect row.
    ///
    /// **Merge semantics — nothing is dropped:**
    ///
    /// * `reports`: only canonical-options rows move (`options_canonical`),
    ///   because they are the rows the public surfaces publish; custom-options
    ///   analyses of the old slug stay where they were, still served by the
    ///   interactive paths under that slug. A moving row whose
    ///   (commit_sha, tokei_version) already exists under the new key is the
    ///   same analysis of the same commit as the surviving row, so the
    ///   duplicate is deleted rather than left publishing a second canonical
    ///   report from the old slug; which row stands as latest is decided at
    ///   read time by the usual eligibility rule (canonical options,
    ///   `created_at DESC`), never here. A moved row's primary key `id` is
    ///   deliberately kept: it is the handle every `/api/reports/{id}` link in
    ///   the wild holds, and the next re-analysis of the repo upserts the
    ///   natural id anyway.
    /// * `sloc_snapshots` / `star_snapshots`: every point moves; a same-date
    ///   collision keeps the later-written sample (two histories sampling the
    ///   same repository on the same day agree to within a resample, and a
    ///   later write is a later correction — the same rule
    ///   `record_star_snapshot` applies to repeat snapshots).
    /// * `star_watch`: the per-repo history state merges by keeping the
    ///   earliest of each started/completed marker (`LEAST` skips NULLs), so a
    ///   backfill already done under either slug stays done.
    ///
    /// The old key is matched case-insensitively — a request spelled
    /// `Facebook/React` renames the same stored `facebook/react` rows — and
    /// the redirect row is recorded under the stored casing when any exists,
    /// so the table stays anchored to how the data was actually filed.
    pub async fn follow_repo_rename(
        &self,
        provider: RepositoryProvider,
        old_owner: &str,
        old_repo: &str,
        new_owner: &str,
        new_repo: &str,
    ) -> anyhow::Result<u64> {
        // A casing-only difference is adoption, not a rename; the resolution
        // path already folded it. Guarding here keeps a malformed pair from
        // "moving" a key onto itself.
        if old_owner.eq_ignore_ascii_case(new_owner) && old_repo.eq_ignore_ascii_case(new_repo) {
            return Ok(0);
        }

        let mut tx = self.pool.begin().await?;

        // The stored spelling of the old key, when anything is filed under it.
        // Writers file under the API's canonical casing, so every table that
        // holds the key agrees on it; were they ever to disagree, any choice
        // converges on the next fold (the winner re-files the rest CI).
        let stored_casing = sqlx::query(
            r#"
            SELECT owner AS owner, repo AS repo FROM reports
            WHERE provider = $1 AND lower(owner) = lower($2) AND lower(repo) = lower($3)
            UNION
            SELECT owner, repo FROM star_watch
            WHERE provider = $1 AND lower(owner) = lower($2) AND lower(repo) = lower($3)
            UNION
            SELECT owner, repo FROM sloc_snapshots
            WHERE provider = $1 AND lower(owner) = lower($2) AND lower(repo) = lower($3)
            LIMIT 1
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(old_owner)
        .bind(old_repo)
        .fetch_optional(&mut *tx)
        .await?;
        let (old_owner, old_repo) = match stored_casing {
            Some(ref row) => (
                row.try_get::<String, _>("owner")?,
                row.try_get::<String, _>("repo")?,
            ),
            None => (old_owner.to_string(), old_repo.to_string()),
        };

        sqlx::query(
            r#"
            INSERT INTO repo_redirects (provider, old_owner, old_repo, new_owner, new_repo)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (provider, old_owner, old_repo) DO NOTHING
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(&old_owner)
        .bind(&old_repo)
        .bind(new_owner)
        .bind(new_repo)
        .execute(&mut *tx)
        .await?;

        // 1. Canonical report rows move; their body's repository identity moves
        // with them so `/api/reports/{id}` cannot keep naming a slug the row is
        // no longer filed under. Identity strings only — every number and the
        // citation prose stay exactly as the analyzer wrote them.
        //
        // A moving row whose (commit_sha, analysis key) already exists under
        // the new key cannot move (the table's uniqueness says so, and the
        // surviving row is the *same analysis of the same commit*), and it
        // cannot stay either: a canonical row left under the old slug would
        // keep publishing a second, identical report from the page that is
        // supposed to be redirecting. So the duplicate is deleted — the one
        // thing its deletion loses is the row's opaque `id`, and report ids
        // are internal handles (the public URL is the repository page), while
        // keeping it would lose the fold's entire point.
        let moved_reports = sqlx::query(
            r#"
            UPDATE reports SET
                owner = $4,
                repo = $5,
                body = jsonb_set(
                    jsonb_set(
                        jsonb_set(body, '{repository,owner}', to_jsonb($4::text)),
                        '{repository,name}', to_jsonb($5::text)),
                    '{repository,htmlUrl}', to_jsonb($6::text))
            WHERE id IN (
                SELECT move.id
                FROM reports move
                WHERE move.provider = $1
                  AND lower(move.owner) = lower($2) AND lower(move.repo) = lower($3)
                  AND move.options_canonical
                  AND NOT EXISTS (
                      SELECT 1 FROM reports kept
                      WHERE kept.provider = $1
                        AND lower(kept.owner) = lower($4) AND lower(kept.repo) = lower($5)
                        AND kept.commit_sha = move.commit_sha
                        AND kept.tokei_version = move.tokei_version
                  )
            )
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(&old_owner)
        .bind(&old_repo)
        .bind(new_owner)
        .bind(new_repo)
        .bind(crate::seo::repository_html_url(provider, new_owner, new_repo))
        .execute(&mut *tx)
        .await?
        .rows_affected();

        let deduped_reports = sqlx::query(
            r#"
            DELETE FROM reports move
            WHERE move.provider = $1
              AND lower(move.owner) = lower($2) AND lower(move.repo) = lower($3)
              AND move.options_canonical
              AND EXISTS (
                  SELECT 1 FROM reports kept
                  WHERE kept.provider = $1
                    AND lower(kept.owner) = lower($4) AND lower(kept.repo) = lower($5)
                    AND kept.commit_sha = move.commit_sha
                    AND kept.tokei_version = move.tokei_version
                    AND kept.id <> move.id
              )
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(&old_owner)
        .bind(&old_repo)
        .bind(new_owner)
        .bind(new_repo)
        .execute(&mut *tx)
        .await?
        .rows_affected();

        // 2. SLOC history points fold under the new key, same-date collisions
        // keeping the later-written sample.
        let moved_sloc = sqlx::query(
            r#"
            INSERT INTO sloc_snapshots
                (provider, owner, repo, snapshot_date, total_lines, commit_sha, created_at, source, superseded_at)
            SELECT provider, $4, $5, snapshot_date, total_lines, commit_sha, created_at, source, superseded_at
            FROM sloc_snapshots
            WHERE provider = $1 AND lower(owner) = lower($2) AND lower(repo) = lower($3)
            ON CONFLICT (provider, owner, repo, snapshot_date) DO UPDATE SET
                total_lines = CASE WHEN EXCLUDED.created_at > sloc_snapshots.created_at
                    THEN EXCLUDED.total_lines ELSE sloc_snapshots.total_lines END,
                commit_sha = CASE WHEN EXCLUDED.created_at > sloc_snapshots.created_at
                    THEN EXCLUDED.commit_sha ELSE sloc_snapshots.commit_sha END,
                source = CASE WHEN EXCLUDED.created_at > sloc_snapshots.created_at
                    THEN EXCLUDED.source ELSE sloc_snapshots.source END,
                superseded_at = CASE WHEN EXCLUDED.created_at > sloc_snapshots.created_at
                    THEN EXCLUDED.superseded_at ELSE sloc_snapshots.superseded_at END,
                created_at = GREATEST(sloc_snapshots.created_at, EXCLUDED.created_at)
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(&old_owner)
        .bind(&old_repo)
        .bind(new_owner)
        .bind(new_repo)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        sqlx::query(
            r#"
            DELETE FROM sloc_snapshots
            WHERE provider = $1 AND lower(owner) = lower($2) AND lower(repo) = lower($3)
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(&old_owner)
        .bind(&old_repo)
        .execute(&mut *tx)
        .await?;

        // 3. Star history points fold the same way.
        let moved_stars = sqlx::query(
            r#"
            INSERT INTO star_snapshots (provider, owner, repo, snapshot_date, star_count, created_at)
            SELECT provider, $4, $5, snapshot_date, star_count, created_at
            FROM star_snapshots
            WHERE provider = $1 AND lower(owner) = lower($2) AND lower(repo) = lower($3)
            ON CONFLICT (provider, owner, repo, snapshot_date) DO UPDATE SET
                star_count = CASE WHEN EXCLUDED.created_at > star_snapshots.created_at
                    THEN EXCLUDED.star_count ELSE star_snapshots.star_count END,
                created_at = GREATEST(star_snapshots.created_at, EXCLUDED.created_at)
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(&old_owner)
        .bind(&old_repo)
        .bind(new_owner)
        .bind(new_repo)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        sqlx::query(
            r#"
            DELETE FROM star_snapshots
            WHERE provider = $1 AND lower(owner) = lower($2) AND lower(repo) = lower($3)
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(&old_owner)
        .bind(&old_repo)
        .execute(&mut *tx)
        .await?;

        // 4. Watch state: keep the new-key row, carrying over the earliest of
        // each marker so a completed backfill under either slug stays
        // completed, then drop the old-key row.
        sqlx::query(
            r#"
            INSERT INTO star_watch
                (provider, owner, repo, first_watched_at,
                 sloc_backfill_started_at, sloc_backfill_completed_at,
                 star_backfill_started_at, star_backfill_completed_at,
                 sloc_resample_started_at)
            SELECT provider, $4, $5, first_watched_at,
                 sloc_backfill_started_at, sloc_backfill_completed_at,
                 star_backfill_started_at, star_backfill_completed_at,
                 sloc_resample_started_at
            FROM star_watch
            WHERE provider = $1 AND lower(owner) = lower($2) AND lower(repo) = lower($3)
            ON CONFLICT (provider, owner, repo) DO UPDATE SET
                first_watched_at = LEAST(star_watch.first_watched_at, EXCLUDED.first_watched_at),
                sloc_backfill_started_at = LEAST(star_watch.sloc_backfill_started_at, EXCLUDED.sloc_backfill_started_at),
                sloc_backfill_completed_at = LEAST(star_watch.sloc_backfill_completed_at, EXCLUDED.sloc_backfill_completed_at),
                star_backfill_started_at = LEAST(star_watch.star_backfill_started_at, EXCLUDED.star_backfill_started_at),
                star_backfill_completed_at = LEAST(star_watch.star_backfill_completed_at, EXCLUDED.star_backfill_completed_at),
                sloc_resample_started_at = LEAST(star_watch.sloc_resample_started_at, EXCLUDED.sloc_resample_started_at)
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(&old_owner)
        .bind(&old_repo)
        .bind(new_owner)
        .bind(new_repo)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"
            DELETE FROM star_watch
            WHERE provider = $1 AND lower(owner) = lower($2) AND lower(repo) = lower($3)
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(&old_owner)
        .bind(&old_repo)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(moved_reports + deduped_reports + moved_sloc + moved_stars)
    }

    /// The slug a requested repository is filed under today, following the
    /// recorded redirect chain. `None` when no redirect is recorded for the
    /// requested slug; `Some(final slug)` after one or more hops. Hops are
    /// capped so a redirect cycle (corrupt data, not anything GitHub can
    /// produce) answers as the last slug reached instead of looping.
    pub async fn redirect_target(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
    ) -> anyhow::Result<Option<(String, String)>> {
        const MAX_HOPS: usize = 5;

        let mut current = (owner.to_string(), repo.to_string());
        let mut hopped = false;
        for _ in 0..MAX_HOPS {
            let Some(next) = sqlx::query(
                r#"
                SELECT new_owner AS new_owner, new_repo AS new_repo
                FROM repo_redirects
                WHERE provider = $1
                  AND lower(old_owner) = lower($2) AND lower(old_repo) = lower($3)
                LIMIT 1
                "#,
            )
            .bind(provider_to_str(&provider))
            .bind(&current.0)
            .bind(&current.1)
            .fetch_optional(&self.pool)
            .await?
            else {
                break;
            };
            current = (
                next.try_get::<String, _>("new_owner")?,
                next.try_get::<String, _>("new_repo")?,
            );
            hopped = true;
        }

        Ok(hopped.then_some(current))
    }

    /// Slug pairs known to name the same repository, folded once at startup so
    /// a deploy heals pre-existing split rows without waiting for someone to
    /// re-request the old slug.
    ///
    /// Detection limits, stated plainly: the store keeps no GitHub repository
    /// id, so split rows cannot be found by identity — only by this curated
    /// list (plus replaying redirects already recorded, which covers anything
    /// a live resolution has already proven). A rename absent from this list
    /// is still followed the first time any analysis resolves the old slug;
    /// this pass merely makes the known, already-split cases immediate.
    ///
    /// (`huanglizhuo/OctoPoint` used to live in the edge function's hardcoded
    /// `LEGACY_REPORT_REDIRECTS`; the backend table now owns that knowledge.)
    pub const SEED_REPO_RENAMES: &[(&str, &str, &str, &str)] = &[
        // (old owner, old repo, new owner, new repo)
        ("facebook", "react", "react", "react"),
        ("huanglizhuo", "OctoPoint", "huanglizhuo", "OctoCounts"),
    ];

    /// The startup rename pass: folds every seed pair, then replays every
    /// recorded redirect (rows may have re-appeared under an old slug — an old
    /// binary or a stale replica writing mid-deploy). Idempotent by
    /// construction: a fold with nothing under the old key is a no-op plus one
    /// redirect upsert. Returns how many rows moved, for the startup log.
    pub async fn migrate_repo_renames(&self) -> anyhow::Result<u64> {
        let mut moved = 0_u64;
        for (old_owner, old_repo, new_owner, new_repo) in Self::SEED_REPO_RENAMES {
            moved += self
                .follow_repo_rename(
                    RepositoryProvider::GitHub,
                    old_owner,
                    old_repo,
                    new_owner,
                    new_repo,
                )
                .await?;
        }

        let recorded = sqlx::query(
            "SELECT provider, old_owner, old_repo, new_owner, new_repo FROM repo_redirects",
        )
        .fetch_all(&self.pool)
        .await?;
        for row in recorded {
            let provider: String = row.try_get("provider")?;
            let Some(provider) = provider_from_str(&provider) else {
                continue;
            };
            let old_owner: String = row.try_get("old_owner")?;
            let old_repo: String = row.try_get("old_repo")?;
            let new_owner: String = row.try_get("new_owner")?;
            let new_repo: String = row.try_get("new_repo")?;
            moved += self
                .follow_repo_rename(provider, &old_owner, &old_repo, &new_owner, &new_repo)
                .await?;
        }
        Ok(moved)
    }

    /// Atomically claims the real star-history backfill for a repo (Phase 2:
    /// only runs once a caller has proven ownership/collaborator access via a
    /// write-capable token) — same claim-by-UPDATE pattern as
    /// `start_sloc_backfill_if_needed`.
    pub async fn start_star_backfill_if_needed(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
    ) -> anyhow::Result<bool> {
        let result = sqlx::query(
            r#"
            UPDATE star_watch
            SET star_backfill_started_at = NOW()
            WHERE provider = $1 AND owner = $2 AND repo = $3
              AND star_backfill_started_at IS NULL
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn mark_star_backfill_completed(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
    ) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            UPDATE star_watch
            SET star_backfill_completed_at = NOW()
            WHERE provider = $1 AND owner = $2 AND repo = $3
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Whether a repo's real star-history backfill has been claimed but not
    /// yet finished — drives the frontend's "importing historical star
    /// data…" polling state.
    pub async fn star_backfill_in_progress(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
    ) -> anyhow::Result<bool> {
        let row = sqlx::query(
            r#"
            SELECT star_backfill_started_at IS NOT NULL AND star_backfill_completed_at IS NULL AS in_progress
            FROM star_watch
            WHERE provider = $1 AND owner = $2 AND repo = $3
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row
            .map(|row| row.try_get::<bool, _>("in_progress"))
            .transpose()?
            .unwrap_or(false))
    }

    /// Whether a repo's real star history has already been backfilled at
    /// least once — the frontend uses this (inverted) to decide whether the
    /// "connect your repo" card is still worth showing.
    pub async fn star_history_is_backfilled(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
    ) -> anyhow::Result<bool> {
        let row = sqlx::query(
            r#"
            SELECT star_backfill_completed_at IS NOT NULL AS backfilled
            FROM star_watch
            WHERE provider = $1 AND owner = $2 AND repo = $3
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row
            .map(|row| row.try_get::<bool, _>("backfilled"))
            .transpose()?
            .unwrap_or(false))
    }

    /// Atomically claims the SLOC backfill for a repo: only the caller that
    /// flips `sloc_backfill_started_at` from NULL gets `true` back, so a burst
    /// of concurrent first-views of the same repo spawns exactly one backfill
    /// task instead of one per request.
    ///
    /// The claim is also *re-claimable*: a backfill that was started but never
    /// completed (crash, wall-clock budget exhausted) can be claimed again
    /// once `reclaim_after` has passed since the last claim, so an interrupted
    /// backfill resumes on a later view instead of being abandoned forever.
    /// The re-run is cheap — already-analyzed commits hit the report cache —
    /// and `record_sloc_snapshot`'s upsert keeps repeated samples idempotent.
    /// `reclaim_after` must therefore exceed the backfill's wall-clock budget,
    /// or a long-running backfill would be double-claimed mid-flight.
    pub async fn start_sloc_backfill_if_needed(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
        reclaim_after: std::time::Duration,
    ) -> anyhow::Result<bool> {
        let result = sqlx::query(
            r#"
            UPDATE star_watch
            SET sloc_backfill_started_at = NOW()
            WHERE provider = $1 AND owner = $2 AND repo = $3
              AND (
                sloc_backfill_started_at IS NULL
                OR (
                  sloc_backfill_completed_at IS NULL
                  AND sloc_backfill_started_at < NOW() - make_interval(secs => $4)
                )
              )
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .bind(reclaim_after.as_secs_f64())
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn mark_sloc_backfill_completed(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
    ) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            UPDATE star_watch
            SET sloc_backfill_completed_at = NOW()
            WHERE provider = $1 AND owner = $2 AND repo = $3
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Atomically claims a suspect-point re-sample for a repo, with a
    /// cooldown: only the caller that moves `sloc_resample_started_at` from
    /// NULL (or from older than `cooldown`) gets `true` back, so a repo with
    /// implausible dips is re-analyzed at most once per cooldown window even
    /// under a burst of views. Unlike the backfill claim there is no
    /// completed marker to set — each trigger is a bounded, idempotent fix-up
    /// (see `repo_history::spawn_sloc_resample`), and the next eligible
    /// window simply re-checks the series.
    pub async fn start_sloc_resample_if_needed(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
        cooldown: std::time::Duration,
    ) -> anyhow::Result<bool> {
        let result = sqlx::query(
            r#"
            UPDATE star_watch
            SET sloc_resample_started_at = NOW()
            WHERE provider = $1 AND owner = $2 AND repo = $3
              AND (
                sloc_resample_started_at IS NULL
                OR sloc_resample_started_at < NOW() - make_interval(secs => $4)
              )
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .bind(cooldown.as_secs_f64())
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Whether a repo's SLOC backfill has been claimed but not yet finished —
    /// used to tell the frontend "still gathering historical data" apart from
    /// "this repo genuinely has no history yet".
    pub async fn sloc_backfill_in_progress(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
    ) -> anyhow::Result<bool> {
        let row = sqlx::query(
            r#"
            SELECT sloc_backfill_started_at IS NOT NULL AND sloc_backfill_completed_at IS NULL AS in_progress
            FROM star_watch
            WHERE provider = $1 AND owner = $2 AND repo = $3
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row
            .map(|row| row.try_get::<bool, _>("in_progress"))
            .transpose()?
            .unwrap_or(false))
    }

    /// Inserts or replaces a sampled historical SLOC point. `source` records
    /// which pipeline produced it ("backfill" / "forward").
    /// `ON CONFLICT ... DO UPDATE` mirrors `record_star_snapshot`: a repeat
    /// sample landing on the same day corrects rather than duplicates, and
    /// also revives a row the compaction task had superseded — a fresh write
    /// always beats a soft delete.
    pub async fn record_sloc_snapshot(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
        date: NaiveDate,
        total_lines: i64,
        commit_sha: &str,
        source: &str,
    ) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            INSERT INTO sloc_snapshots (provider, owner, repo, snapshot_date, total_lines, commit_sha, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (provider, owner, repo, snapshot_date)
            DO UPDATE SET
                total_lines = EXCLUDED.total_lines,
                commit_sha = EXCLUDED.commit_sha,
                source = EXCLUDED.source,
                superseded_at = NULL
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .bind(date)
        .bind(total_lines)
        .bind(commit_sha)
        .bind(source)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// The full recorded SLOC history for a repo, oldest first, excluding
    /// points the compaction task has superseded. Each point carries the
    /// commit SHA it was sampled from, so consumers can re-analyze a specific
    /// suspect point rather than the whole series.
    pub async fn sloc_history(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
    ) -> anyhow::Result<Vec<(NaiveDate, i64, String)>> {
        let rows = sqlx::query(
            r#"
            SELECT snapshot_date, total_lines, commit_sha
            FROM sloc_snapshots
            WHERE provider = $1 AND owner = $2 AND repo = $3 AND superseded_at IS NULL
            ORDER BY snapshot_date ASC
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let date: NaiveDate = row.try_get("snapshot_date")?;
                let total_lines: i64 = row.try_get("total_lines")?;
                let commit_sha: String = row.try_get("commit_sha")?;
                Ok((date, total_lines, commit_sha))
            })
            .collect()
    }

    /// The most recent live SLOC snapshot for a repo — the forward sampler
    /// compares its commit SHA against this to decide whether anything new
    /// happened worth analyzing. Returns the date, line count, and SHA.
    pub async fn latest_sloc_snapshot(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
    ) -> anyhow::Result<Option<(NaiveDate, i64, String)>> {
        let row = sqlx::query(
            r#"
            SELECT snapshot_date, total_lines, commit_sha
            FROM sloc_snapshots
            WHERE provider = $1 AND owner = $2 AND repo = $3 AND superseded_at IS NULL
            ORDER BY snapshot_date DESC
            LIMIT 1
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| {
            Ok((
                row.try_get::<NaiveDate, _>("snapshot_date")?,
                row.try_get::<i64, _>("total_lines")?,
                row.try_get::<String, _>("commit_sha")?,
            ))
        })
        .transpose()
    }

    /// Repos whose SLOC backfill has completed at least once — the forward
    /// sampler's work list. Repos still mid-backfill are excluded on purpose:
    /// their freshness is the backfill's job until it finishes.
    pub async fn watched_sloc_repos(
        &self,
    ) -> anyhow::Result<Vec<(RepositoryProvider, String, String)>> {
        let rows = sqlx::query(
            "SELECT provider, owner, repo FROM star_watch WHERE sloc_backfill_completed_at IS NOT NULL",
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let provider: String = row.try_get("provider")?;
                let owner: String = row.try_get("owner")?;
                let repo: String = row.try_get("repo")?;
                let provider = provider_from_str(&provider)
                    .ok_or_else(|| anyhow::anyhow!("unknown provider {provider}"))?;
                Ok((provider, owner, repo))
            })
            .collect()
    }

    /// Every repo that has at least one live SLOC snapshot — the compaction
    /// task's work list, broader than `watched_sloc_repos` on purpose so
    /// even an unfinished backfill's aged points get compacted.
    pub async fn repos_with_sloc_snapshots(
        &self,
    ) -> anyhow::Result<Vec<(RepositoryProvider, String, String)>> {
        let rows = sqlx::query(
            "SELECT DISTINCT provider, owner, repo FROM sloc_snapshots WHERE superseded_at IS NULL",
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let provider: String = row.try_get("provider")?;
                let owner: String = row.try_get("owner")?;
                let repo: String = row.try_get("repo")?;
                let provider = provider_from_str(&provider)
                    .ok_or_else(|| anyhow::anyhow!("unknown provider {provider}"))?;
                Ok((provider, owner, repo))
            })
            .collect()
    }

    /// Soft-deletes the given snapshot dates for a repo (the compaction
    /// task). Rows stay in the table for observability; `sloc_history` and
    /// friends filter them out, and re-recording a date revives it.
    pub async fn supersede_sloc_snapshots(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
        dates: &[NaiveDate],
    ) -> anyhow::Result<u64> {
        if dates.is_empty() {
            return Ok(0);
        }
        let result = sqlx::query(
            r#"
            UPDATE sloc_snapshots
            SET superseded_at = NOW()
            WHERE provider = $1 AND owner = $2 AND repo = $3 AND superseded_at IS NULL
              AND snapshot_date = ANY($4)
            "#,
        )
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .bind(dates)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
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
        let row = sqlx::query(concat!(
            r#"
            SELECT body::text AS body
            FROM reports
            WHERE provider = $1 AND owner = $2 AND repo = $3
              AND "#,
            latest_eligible!("reports"),
            r#"
            ORDER BY created_at DESC
            LIMIT 1
            "#
        ))
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

    /// The newest canonical report for one repository, projected as a
    /// [`ReportCard`].
    ///
    /// The SEO report endpoint uses this instead of `latest_report` because it
    /// needs the analysis configuration for reproducibility (SG-04) and must
    /// not detoast the whole body to get it. Unlike `latest_report`, which
    /// deserializes into `Report` and therefore has serde defaults fill in a
    /// missing `analysisKey`/`analysisOptions` on legacy rows, the SQL
    /// projection keeps them `NULL`, so an unknown configuration surfaces as
    /// unknown instead of looking like a verified default.
    ///
    /// Two rules `latest_report` deliberately does not share:
    ///
    /// * Only rows counted under the canonical options may stand as the public
    ///   report (`canonical_options_sql!`) — a visitor's custom-options
    ///   analysis is a different measurement, not a newer edition of the
    ///   indexed one.
    /// * The key match is case-insensitive. GitHub treats slug casing as the
    ///   same repository, so a wrong-cased request resolves to the stored row,
    ///   and the handler surfaces the row's own spelling as `canonicalSlug`
    ///   for the page's 308. When two case-variants of one slug are stored
    ///   (pre- and post-adoption rows) the newest canonical row wins, which is
    ///   the same `created_at DESC` rule the exact match always used.
    pub async fn latest_report_card(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
    ) -> anyhow::Result<Option<ReportCard>> {
        // `card_projection!` consumes `$3` for the language cap, so the repo
        // predicate binds as `$4` after provider, owner and the cap.
        let row = sqlx::query(concat!(
            card_projection!(),
            r#"
            FROM reports r
            WHERE r.provider = $1
              AND lower(r.owner) = lower($2) AND lower(r.repo) = lower($4)
              AND "#,
            canonical_options_sql!("r"),
            r#"
              AND "#,
            latest_eligible!("r"),
            r#"
            ORDER BY r.created_at DESC
            LIMIT 1
            "#
        ))
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(SEO_CARD_LANGUAGES as i64)
        .bind(repo)
        .fetch_optional(&self.pool)
        .await?;

        row.map(row_to_report_card).transpose()
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

    /// Repositories similar to a given one, for the "similar repositories"
    /// interlinking module on report pages.
    ///
    /// Similarity is deterministic: same top language first, then closest
    /// total code size, then largest, newest, and finally owner/repo name so
    /// ties never reorder between requests. When the repository itself has no
    /// top language (or no size), the ranking degrades to that same order
    /// rather than returning nothing. The query reads only the materialized
    /// stat columns -- no report bodies are detoasted.
    ///
    /// Quality guards against the failure modes seen on real data:
    /// - Self-exclusion is case-insensitive (`Facebook/React` vs
    ///   `facebook/react` are the same repository as far as GitHub is
    ///   concerned).
    /// - Mirrors and renamed copies of the source repo carry an identical
    ///   `(total_code, total_lines)` signature and are excluded outright.
    /// - More generally, at most one repository survives per distinct
    ///   `(total_code, total_lines)` signature: several repos of exactly the
    ///   same size add link-farm noise, not variety.
    /// - Size distance is relative (`|ln(code) - ln(source)|`) so a
    ///   1k-line source is not recommended a 300k-line monolith just because
    ///   the absolute difference to some tiny repo happened to be smaller.
    pub async fn related_reports(
        &self,
        provider: RepositoryProvider,
        owner: &str,
        repo: &str,
        top_language: Option<&str>,
        total_code: i64,
        total_lines: i64,
        limit: i64,
    ) -> anyhow::Result<Vec<RelatedReportRow>> {
        let rows = sqlx::query(concat!(
            r#"
            SELECT
                deduped.provider AS provider,
                deduped.owner AS owner,
                deduped.repo AS repo,
                deduped.top_language AS top_language,
                deduped.total_code AS total_code,
                deduped.total_lines AS total_lines
            FROM (
                -- One row per distinct size signature: `DISTINCT ON` keeps the
                -- first row of each (total_code, total_lines) group under the
                -- relevance ordering, so the surviving representative is
                -- deterministic.
                SELECT DISTINCT ON (filtered.total_code, filtered.total_lines)
                    filtered.provider, filtered.owner, filtered.repo,
                    filtered.top_language, filtered.total_code,
                    filtered.total_lines, filtered.created_at
                FROM (
                    SELECT DISTINCT ON (provider, owner, repo)
                        provider, owner, repo, top_language, total_code, total_lines, created_at
                    FROM reports
                    WHERE provider = $1
                      AND "#,
            canonical_options_sql!("reports"),
            r#"
                      AND "#,
            latest_eligible!("reports"),
            r#"
                    ORDER BY provider, owner, repo, created_at DESC
                ) filtered
                WHERE NOT (lower(filtered.owner) = lower($2) AND lower(filtered.repo) = lower($3))
                  -- NULL-safe mirror exclusion: rows with an unknown size
                  -- signature stay eligible, only exact matches on BOTH
                  -- columns are dropped.
                  AND (filtered.total_code IS DISTINCT FROM $5
                       OR filtered.total_lines IS DISTINCT FROM $6)
                ORDER BY filtered.total_code, filtered.total_lines,
                    COALESCE(filtered.top_language = $4, false) DESC,
                    ABS(ln(GREATEST(COALESCE(filtered.total_code, 0), 1)::float8)
                        - ln(GREATEST($5, 1)::float8)) ASC,
                    filtered.total_lines DESC NULLS LAST,
                    filtered.created_at DESC,
                    filtered.owner ASC,
                    filtered.repo ASC
            ) deduped
            ORDER BY
                COALESCE(deduped.top_language = $4, false) DESC,
                ABS(ln(GREATEST(COALESCE(deduped.total_code, 0), 1)::float8)
                    - ln(GREATEST($5, 1)::float8)) ASC,
                deduped.total_lines DESC NULLS LAST,
                deduped.created_at DESC,
                deduped.owner ASC,
                deduped.repo ASC
            LIMIT $7
            "#
        ))
        .bind(provider_to_str(&provider))
        .bind(owner)
        .bind(repo)
        .bind(top_language)
        .bind(total_code)
        .bind(total_lines)
        .bind(limit.clamp(1, 24))
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let provider: String = row.try_get("provider")?;
                Ok(RelatedReportRow {
                    provider: provider_from_str(&provider).ok_or_else(|| {
                        anyhow::anyhow!("unknown provider in database: {provider}")
                    })?,
                    owner: row.try_get("owner")?,
                    repo: row.try_get("repo")?,
                    top_language: row.try_get("top_language")?,
                    total_code: row.try_get("total_code")?,
                    total_lines: row.try_get("total_lines")?,
                })
            })
            .collect()
    }

    /// Which of the requested provider/owner/repo pairs have at least one
    /// cached report, in an unspecified order.
    ///
    /// One query answering the Pages Function's compare-sitemap existence
    /// check, which used to fan out to one HTTPS report fetch per repository
    /// (about 200 subrequests against a Cloudflare Workers budget of 50 on the
    /// free plan). The VALUES join keeps it a single round trip over the
    /// `reports` columns only.
    pub async fn repos_with_reports(
        &self,
        wanted: &[(RepositoryProvider, String, String)],
    ) -> anyhow::Result<Vec<(RepositoryProvider, String, String)>> {
        if wanted.is_empty() {
            return Ok(Vec::new());
        }

        let mut sql = String::from("WITH wanted(provider, owner, repo) AS (VALUES ");
        for index in 0..wanted.len() {
            if index > 0 {
                sql.push_str(", ");
            }
            let base = index * 3 + 1;
            sql.push_str(&format!(
                "(${base}::text, ${}::text, ${}::text)",
                base + 1,
                base + 2
            ));
        }
        sql.push_str(
            ") SELECT DISTINCT w.provider, w.owner, w.repo \
             FROM wanted w \
             JOIN reports r ON r.provider = w.provider AND r.owner = w.owner AND r.repo = w.repo",
        );

        let mut query = sqlx::query(&sql);
        for (provider, owner, repo) in wanted {
            query = query.bind(provider_to_str(provider)).bind(owner).bind(repo);
        }
        let rows = query.fetch_all(&self.pool).await?;

        rows.into_iter()
            .map(|row| {
                let provider: String = row.try_get("provider")?;
                Ok((
                    provider_from_str(&provider).ok_or_else(|| {
                        anyhow::anyhow!("unknown provider in database: {provider}")
                    })?,
                    row.try_get("owner")?,
                    row.try_get("repo")?,
                ))
            })
            .collect()
    }

    /// Repository identity, last-modified date and measured totals for every
    /// distinct repository, newest first.
    ///
    /// The sitemap only ever needed a handful of scalars per row, but it used to
    /// go through `distinct_reports`, which pulls up to 45k complete report bodies
    /// out of Postgres and runs every one of them through `serde_json`. This
    /// touches neither `body` (beyond the one `generatedAt` detoast below) nor
    /// the TOAST table for the totals: they come from the narrow materialized
    /// columns the `reports_materialize_stats` trigger maintains.
    ///
    /// Deduplication, sorting and the row cap all run over narrow scalar columns;
    /// only the surviving page is joined back for its `generatedAt`.
    ///
    /// `lastmod` deliberately comes from the body rather than from the `created_at`
    /// column. `save_report` writes `created_at` from `Report::generated_at`, so in
    /// practice they agree -- but only in practice, and a row where they disagree
    /// across a UTC midnight would silently shift a sitemap date. Reading the same
    /// field the old code read costs one detoast for at most 500 rows and removes
    /// the question entirely.
    pub async fn sitemap_entries(&self, limit: i64) -> anyhow::Result<Vec<SitemapRow>> {
        let rows = sqlx::query(concat!(
            r#"
            SELECT
                r.provider AS provider,
                r.owner AS owner,
                r.repo AS repo,
                r.body->>'generatedAt' AS generated_at,
                -- A row that escaped both the trigger and the stats backfill has
                -- NULL totals; the sitemap would rather publish a zero than lie
                -- about a repository it could not read.
                COALESCE(r.total_files, 0) AS total_files,
                COALESCE(r.total_lines, 0) AS total_lines,
                COALESCE(r.total_code, 0) AS total_code
            FROM (
                SELECT id, created_at
                FROM (
                    SELECT DISTINCT ON (provider, owner, repo) id, created_at
                    FROM reports
                    WHERE "#,
            canonical_options_sql!("reports"),
            r#"
                      AND "#,
            latest_eligible!("reports"),
            r#"
                    ORDER BY provider, owner, repo, created_at DESC
                ) latest
                ORDER BY created_at DESC
                LIMIT $1
            ) page
            JOIN reports r ON r.id = page.id
            ORDER BY page.created_at DESC
            "#
        ))
        // The sitemap honours the limit its handler actually asks for. It used to
        // go through `distinct_reports`, whose `clamp(0, 500)` meant a handler
        // requesting 45,000 entries emitted 500 -- an SEO endpoint whose whole job
        // is to enumerate canonical URLs was publishing about 1% of them. B2 made
        // the query cheap enough (70ms -> 8ms, no body reads) to afford the full
        // list; `SITEMAP_MAX_ENTRIES` is the backstop.
        .bind(limit.clamp(0, SITEMAP_MAX_ENTRIES))
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let provider: String = row.try_get("provider")?;
                let generated_at: String = row.try_get("generated_at")?;
                Ok(SitemapRow {
                    provider: provider_from_str(&provider).ok_or_else(|| {
                        anyhow::anyhow!("unknown provider in database: {provider}")
                    })?,
                    owner: row.try_get("owner")?,
                    repo: row.try_get("repo")?,
                    lastmod: DateTime::parse_from_rfc3339(&generated_at)?
                        .with_timezone(&Utc)
                        .date_naive(),
                    total_files: row.try_get("total_files")?,
                    total_lines: row.try_get("total_lines")?,
                    total_code: row.try_get("total_code")?,
                })
            })
            .collect()
    }

    pub async fn growth_stats(&self) -> anyhow::Result<GrowthStats> {
        let totals = self.growth_totals().await?;
        let windows = self.growth_windows().await?;
        let sources = self.growth_sources().await?;
        let languages = self.growth_languages().await?;
        let top_repositories = self
            .growth_repository_list(ReportOrder::Monolith, 12)
            .await?;
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

    /// Live job counts grouped by status, for `/internal/stats`.
    pub async fn job_status_counts(&self) -> anyhow::Result<Vec<(String, i64)>> {
        let rows = sqlx::query("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| (row.get::<String, _>("status"), row.get::<i64, _>("count")))
            .collect())
    }

    /// Total stored reports, for `/internal/stats`.
    pub async fn reports_count(&self) -> anyhow::Result<i64> {
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM reports")
            .fetch_one(&self.pool)
            .await?;
        Ok(count)
    }

    /// # A fixed bug
    ///
    /// Until this change the query read `FROM reports LEFT JOIN LATERAL
    /// jsonb_array_elements(body->'languages') ON TRUE`, which fans each report
    /// out into one row per language. `COUNT(*)` and the two `SUM`s therefore
    /// counted every report once *per language it contains*: with ~30 languages
    /// per report, `/api/stats` reported `reportsGenerated`, `linesCounted` and
    /// `codeLinesCounted` roughly 30x too high.
    ///
    /// B6 reproduced that inflation deliberately, so that a performance change
    /// would not silently move two public numbers by an order of magnitude. The
    /// correction is this separate commit: each report now contributes exactly
    /// once. The published counters will drop sharply and that is the point --
    /// they are now the real figures.
    ///
    /// `repositoriesAnalyzed` and `languagesDetected` were always correct; both
    /// were guarded by `DISTINCT`, which absorbed the duplicate rows.
    async fn growth_totals(&self) -> anyhow::Result<GrowthTotals> {
        let row = sqlx::query(
            r#"
            SELECT
                COUNT(*)::bigint AS reports_generated,
                COUNT(DISTINCT (provider, owner, repo))::bigint AS repositories_analyzed,
                COALESCE(SUM(COALESCE(total_lines, 0)), 0)::bigint AS lines_counted,
                COALESCE(SUM(COALESCE(total_code, 0)), 0)::bigint AS code_lines_counted,
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
            .bind(limit.clamp(0, LEGACY_LIST_LIMIT))
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
        let row = sqlx::query(sql).bind(id).fetch_optional(&self.pool).await?;

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
        let report_count = report_row_count(config.report_max_rows, tx).await?;
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
    async fn report_reltuples(&self) -> anyhow::Result<f32> {
        sqlx::query_scalar("SELECT reltuples FROM pg_class WHERE oid = to_regclass('reports')")
            .fetch_one(&self.pool)
            .await
            .map_err(Into::into)
    }

    #[cfg(test)]
    async fn analyze_reports(&self) -> anyhow::Result<()> {
        sqlx::query("ANALYZE reports").execute(&self.pool).await?;
        Ok(())
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

/// The row cap the pre-batch-B `distinct_reports` applied to every list query.
/// Preserved verbatim so the rewritten queries return the same number of rows.
///
/// Still in force for the paginated SEO lists, which are browsed a page at a
/// time and have no reason to return more. The sitemap escapes it deliberately;
/// see [`SITEMAP_MAX_ENTRIES`].
const LEGACY_LIST_LIMIT: i64 = 500;

/// Backstop for `sitemap_entries`. The handler asks for 45,000; the sitemap
/// protocol caps a single file at 50,000 URLs, so this sits between the two and
/// keeps a runaway request from trying to serialize the entire table.
const SITEMAP_MAX_ENTRIES: i64 = 45_000;

/// How close to the row cap the planner's estimate may get before cleanup stops
/// trusting it. `reltuples` drifts between autovacuum runs, so it is only used to
/// answer "are we comfortably under the cap?", never to decide how much to delete.
const ROW_ESTIMATE_TRUST_MARGIN: f64 = 0.9;

/// Whether `reltuples` can stand in for a real `COUNT(*)`.
///
/// A negative value means the table has never been analyzed (Postgres 14+ uses
/// -1 for this; older versions leave it at 0, which is indistinguishable from a
/// genuinely empty table). Either way the answer is "no", and the caller pays for
/// an exact count -- which on a table that has never been analyzed is cheap
/// precisely because it is small or new.
fn row_estimate_is_usable(estimate: f32, threshold: i64) -> bool {
    estimate > 0.0 && f64::from(estimate) < threshold as f64 * ROW_ESTIMATE_TRUST_MARGIN
}

/// The number of rows in `reports`, exactly when it matters and approximately
/// when it does not.
///
/// This runs inside the transaction that holds the cleanup advisory lock, so a
/// sequential scan of the whole table here blocks the next cleanup round for its
/// duration. The planner already keeps an estimate in `pg_class.reltuples`;
/// reading it is a single index lookup, and the exact count is only needed when
/// the estimate is close enough to the cap that the difference could change how
/// many rows get evicted.
async fn report_row_count(
    threshold: i64,
    tx: &mut Transaction<'_, Postgres>,
) -> anyhow::Result<i64> {
    // to_regclass resolves through search_path and yields NULL (hence no row)
    // rather than erroring if the table is absent.
    let estimate: Option<f32> =
        sqlx::query_scalar("SELECT reltuples FROM pg_class WHERE oid = to_regclass('reports')")
            .fetch_optional(&mut **tx)
            .await?;

    if let Some(estimate) = estimate {
        if row_estimate_is_usable(estimate, threshold) {
            return Ok(estimate as i64);
        }
    }

    sqlx::query_scalar("SELECT COUNT(*) FROM reports")
        .fetch_one(&mut **tx)
        .await
        .map_err(Into::into)
}

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
    pub ref_name: String,
    pub commit_sha: String,
    pub generated_at: DateTime<Utc>,
    pub duration_ms: u128,
    pub tokei_version: String,
    /// The stored `analysisKey`, `None` when the row predates the field. Never
    /// synthesize a default here: SG-04 requires unknown configuration to stay
    /// unknown instead of masquerading as "default configuration".
    pub analysis_key: Option<String>,
    /// The stored `analysisOptions` snapshot, `None` when the row predates the
    /// field (same rule as `analysis_key`).
    pub analysis_options: Option<AnalysisOptions>,
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
            ref_name: report.ref_name.clone(),
            commit_sha: report.commit_sha.clone(),
            generated_at: report.generated_at,
            duration_ms: report.duration_ms,
            tokei_version: report.tokei_version.clone(),
            analysis_key: Some(report.analysis_key.clone()),
            analysis_options: Some(report.analysis_options.clone()),
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

/// The projection itself lives at the top of the file because
/// `latest_report_card` uses it inside `impl Store`, and `macro_rules` is
/// textually scoped.
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
                            WHERE "#,
                    canonical_options_sql!("reports"),
                    r#"
                              AND "#,
                    latest_eligible!("reports"),
                    r#"
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
                            WHERE "#,
                    canonical_options_sql!("reports"),
                    r#"
                              AND "#,
                    latest_eligible!("reports"),
                    r#"
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
                            WHERE "#,
                    canonical_options_sql!("reports"),
                    r#"
                              AND "#,
                    latest_eligible!("reports"),
                    r#"
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
fn throttled_fetch_sql(body_expr: &str, update_predicate: &str, select_predicate: &str) -> String {
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
        // `analysisOptions` has two different defaults and they disagree.
        //
        // When the key is absent, `Report`'s field-level #[serde(default)] runs
        // `AnalysisOptions::default()`, which is Derive(Default) -- every bool
        // false. When the key is present but incomplete, the *field*-level
        // defaults inside AnalysisOptions apply instead, and three of those are
        // `default_true`. Both are serialized from the Rust types here rather than
        // hand-written, so neither can drift.
        let absent = serde_json::to_string(&AnalysisOptions::default()).expect("options serialize");
        let partial = serde_json::to_string(
            &serde_json::from_str::<AnalysisOptions>("{}").expect("empty options deserialize"),
        )
        .expect("options serialize");
        format!(
            r#"(
                jsonb_build_object('analysisKey', '')
                || body
                || jsonb_build_object(
                       'repository',
                       jsonb_build_object('provider', 'github')
                       || COALESCE(body->'repository', '{{}}'::jsonb)
                   )
                || CASE WHEN body ? 'analysisOptions'
                        THEN jsonb_build_object(
                                 'analysisOptions',
                                 '{partial}'::jsonb || (body->'analysisOptions')
                             )
                        ELSE jsonb_build_object('analysisOptions', '{absent}'::jsonb)
                   END
            )::text"#
        )
    })
    .as_str()
}

fn row_to_report_card(row: sqlx::postgres::PgRow) -> anyhow::Result<ReportCard> {
    let provider: String = row.try_get("provider")?;
    let generated_at: String = row.try_get("generated_at")?;
    let duration_ms: String = row.try_get("duration_ms")?;
    let analysis_options: Option<String> = row.try_get("analysis_options")?;
    let total: String = row.try_get("total")?;
    let languages: String = row.try_get("languages")?;
    let language_count: Option<i32> = row.try_get("language_count")?;
    let languages: Vec<LanguageReport> = serde_json::from_str(&languages)?;

    Ok(ReportCard {
        provider: provider_from_str(&provider)
            .ok_or_else(|| anyhow::anyhow!("unknown provider in database: {provider}"))?,
        owner: row.try_get("owner")?,
        repo: row.try_get("repo")?,
        ref_name: row.try_get("ref_name")?,
        commit_sha: row.try_get("commit_sha")?,
        generated_at: DateTime::parse_from_rfc3339(&generated_at)?.with_timezone(&Utc),
        duration_ms: duration_ms.parse()?,
        tokei_version: row.try_get("tokei_version")?,
        analysis_key: row.try_get("analysis_key")?,
        // `::text` on a missing jsonb key yields SQL NULL, on an explicit
        // JSON null the text "null"; `Option<AnalysisOptions>` handles both.
        analysis_options: analysis_options
            .map(|json| serde_json::from_str(&json))
            .transpose()?,
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
    /// The report's measured totals, from the trigger-maintained stat columns.
    /// The edge sitemap filter drops zero-value entries using these.
    pub total_files: i64,
    pub total_lines: i64,
    pub total_code: i64,
}

/// One "similar repositories" row: repository identity plus the materialized
/// size columns the report-page interlinking module displays.
#[derive(Clone, Debug)]
pub struct RelatedReportRow {
    pub provider: RepositoryProvider,
    pub owner: String,
    pub repo: String,
    pub top_language: Option<String>,
    pub total_code: Option<i64>,
    pub total_lines: Option<i64>,
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
        AnalysisSource::SlocBackfill => "sloc_backfill",
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
        "sloc_backfill" => AnalysisSource::SlocBackfill,
        _ => AnalysisSource::Unknown,
    }
}

fn growth_repository_stat(card: &ReportCard) -> GrowthRepositoryStat {
    GrowthRepositoryStat {
        provider: card.provider,
        owner: card.owner.clone(),
        repo: card.repo.clone(),
        public_path: crate::seo::repository_public_path(card.provider, &card.owner, &card.repo),
        // Derived from the row's identity, not the stored body: the body's
        // `htmlUrl` can carry a pre-/post-rename spelling that disagrees with
        // the owner/repo this row (and its page) is filed under.
        html_url: crate::seo::repository_html_url(card.provider, &card.owner, &card.repo),
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
        store.clear_report_stat_columns(&report.id).await.unwrap();
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
        assert_eq!(actual.ref_name, expected.ref_name);
        assert_eq!(actual.commit_sha, expected.commit_sha);
        assert_eq!(actual.generated_at, expected.generated_at);
        assert_eq!(actual.duration_ms, expected.duration_ms);
        assert_eq!(actual.tokei_version, expected.tokei_version);
        assert_eq!(actual.analysis_key, expected.analysis_key);
        assert_eq!(actual.analysis_options, expected.analysis_options);
        assert_eq!(
            serde_json::to_value(&actual.total).unwrap(),
            serde_json::to_value(&expected.total).unwrap()
        );
        assert_eq!(
            actual.language_count, 20,
            "full count, not the slice length"
        );
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

    /// A row written before `analysisKey` / `analysisOptions` existed used to
    /// project both as `None` — the SQL projection refusing to let serde
    /// defaults turn an unknown configuration into "the default one" (SG-04).
    /// The canonical guard goes further: such a row can no longer be *selected*
    /// as a card at all, because the pre-options analyzer counted docs, tests
    /// and generated code, making its numbers the all-inclusive measurement no
    /// matter what a deserialization default would claim. The unknown-stays-
    /// unknown rule itself is still pinned where it remains reachable: the
    /// `/api/reports/{id}` passthrough (`report_legacy.json`).
    #[tokio::test]
    async fn projected_card_marks_legacy_configuration_as_unknown() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        store
            .insert_raw_report(
                "report-card-legacy",
                "github",
                &owner,
                "count",
                "abc123",
                "tokei-test",
                r#"{
                    "id": "report-card-legacy",
                    "repository": {"owner": "LEGACY", "name": "count", "htmlUrl": "https://github.com/octo/count"},
                    "refName": "main",
                    "commitSha": "abc123",
                    "generatedAt": "2024-02-29T11:30:15.123456789Z",
                    "durationMs": 42,
                    "cached": false,
                    "tokeiVersion": "tokei-test",
                    "languages": [],
                    "total": {"files": 0, "lines": 0, "code": 0, "comments": 0, "blanks": 0}
                }"#,
                Utc::now(),
            )
            .await
            .unwrap();

        // Not selectable as the repository's public card, by report or list.
        assert!(
            store
                .latest_report_card(RepositoryProvider::GitHub, &owner, "count")
                .await
                .unwrap()
                .is_none()
        );
        assert!(store.recent_reports(10, 0).await.unwrap().is_empty());

        // But the row itself is intact and still served by identity: the
        // interactive path deserializes it with serde's defaults, exactly as
        // it always has.
        let report = store.report("report-card-legacy").await.unwrap().unwrap();
        assert_eq!(report.repository.owner, "LEGACY");
        assert_eq!(report.analysis_key, "");
        assert_eq!(report.analysis_options, AnalysisOptions::default());
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
        let clamped = store.sitemap_entries(i64::MAX).await.unwrap();

        assert_eq!(all.len(), 3, "one entry per repository, not per report");
        assert_eq!(
            all.iter().map(|row| row.repo.as_str()).collect::<Vec<_>>(),
            ["alpha", "beta", "gamma"],
        );
        assert_eq!(limited.len(), 2);
        assert_eq!(limited[0].repo, "alpha");
        assert_eq!(
            clamped.len(),
            3,
            "an absurd limit is clamped to SITEMAP_MAX_ENTRIES, not rejected"
        );
        assert_eq!(all[0].provider, RepositoryProvider::GitHub);
        assert_eq!(all[0].lastmod, all[0].lastmod.min(Utc::now().date_naive()));
        store.drop_schema().await;
    }

    /// The cap that used to silence this endpoint. `distinct_reports` clamped
    /// every list to 500 rows, so the sitemap handler's request for 45,000 URLs
    /// yielded 500. Three fixture repositories cannot tell 500 from 45,000, so
    /// this seeds past the old ceiling and demands the rows come back.
    #[tokio::test]
    async fn sitemap_entries_are_not_capped_at_the_legacy_list_limit() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        let legacy_cap = super::LEGACY_LIST_LIMIT;
        let repositories = legacy_cap + 1;
        for index in 0..repositories {
            let mut report = test_report(&format!("report-uncapped-{index}"), &owner, 10);
            report.repository.name = format!("repo{index:04}");
            store
                .save_report(&report, AnalysisSource::Unknown)
                .await
                .unwrap();
        }

        let full = store.sitemap_entries(45_000).await.unwrap();
        let clamped = store.sitemap_entries(i64::MAX).await.unwrap();

        assert_eq!(
            full.len() as i64,
            repositories,
            "the sitemap must emit every repository, not the first {legacy_cap}"
        );
        assert_eq!(clamped.len() as i64, repositories);
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
        let (
            legacy_reports,
            legacy_repositories,
            legacy_lines,
            legacy_code_lines,
            legacy_languages_detected,
        ) = legacy_totals;

        // The two counters that were always right, because `DISTINCT` absorbed
        // the fan-out, still have to agree with the original query exactly.
        assert_eq!(totals.repositories_analyzed, legacy_repositories);
        assert_eq!(totals.languages_detected, legacy_languages_detected);

        // The other three deliberately no longer agree: the legacy query counted
        // each report once per language. The four reports here hold 2, 3, 0 and 3
        // languages, and a report with no languages still produced one row under
        // the LEFT JOIN -- so the old fan-out factor was 2 + 3 + 1 + 3 = 9.
        assert_eq!(totals.reports_generated, 4);
        assert_eq!(legacy_reports, 9);
        assert_eq!(totals.lines_counted, 4 * 110);
        assert_eq!(legacy_lines, 9 * 110);
        assert_eq!(totals.code_lines_counted, 4 * 100);
        assert_eq!(legacy_code_lines, 9 * 100);
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
            store
                .report_language_names("report-langs-v1")
                .await
                .unwrap(),
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
            store
                .report_language_names("report-langs-v2")
                .await
                .unwrap(),
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

    #[test]
    fn row_estimate_is_only_trusted_when_it_is_comfortably_under_the_cap() {
        // Never analyzed: -1 on Postgres 14+, 0 on older versions. Both must fall
        // back, which is why 0 is rejected even though it is a legal row count.
        assert!(!super::row_estimate_is_usable(-1.0, 20_000));
        assert!(!super::row_estimate_is_usable(0.0, 20_000));

        assert!(super::row_estimate_is_usable(1.0, 20_000));
        assert!(super::row_estimate_is_usable(17_999.0, 20_000));

        // Within the margin, or over it: the difference could change how many
        // rows get evicted, so count for real.
        assert!(!super::row_estimate_is_usable(18_000.0, 20_000));
        assert!(!super::row_estimate_is_usable(25_000.0, 20_000));
    }

    /// A freshly created table has never been analyzed, so `reltuples` is -1 and
    /// cleanup has to notice and count for real -- otherwise nothing is ever
    /// evicted from a young deployment.
    #[tokio::test]
    async fn cleanup_falls_back_to_an_exact_count_on_a_never_analyzed_table() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        for index in 0..3 {
            let id = format!("report-estimate-{index}");
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

        assert!(
            store.report_reltuples().await.unwrap() <= 0.0,
            "precondition: the table must not have been analyzed yet"
        );

        let stats = cleanup(
            &store,
            CleanupConfig {
                report_min_retention_days: 30,
                report_max_rows: 2,
                report_cleanup_batch_size: 10,
                ..CleanupConfig::default()
            },
        )
        .await;

        assert_eq!(stats.cold_reports_deleted, 1);
        store.drop_schema().await;
    }

    /// Once analyzed and comfortably under the cap, cleanup takes the estimate and
    /// skips the scan entirely.
    #[tokio::test]
    async fn cleanup_trusts_the_estimate_when_it_is_far_below_the_cap() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        for index in 0..3 {
            let id = format!("report-estimate-low-{index}");
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
                    Utc::now() - Duration::days(31),
                )
                .await
                .unwrap();
        }
        store.analyze_reports().await.unwrap();
        assert_eq!(store.report_reltuples().await.unwrap(), 3.0);

        let stats = cleanup(&store, CleanupConfig::default()).await;

        assert_eq!(stats.cold_reports_deleted, 0);
        assert!(store.report_exists("report-estimate-low-0").await.unwrap());
        store.drop_schema().await;
    }

    /// Near the cap the estimate is not good enough: the exact count is what
    /// decides how many rows go.
    #[tokio::test]
    async fn cleanup_counts_exactly_once_the_estimate_approaches_the_cap() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        for index in 0..4 {
            let id = format!("report-estimate-near-{index}");
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
                    Utc::now() - Duration::days(31 + i64::from(3 - index as i32)),
                )
                .await
                .unwrap();
        }
        store.analyze_reports().await.unwrap();
        assert_eq!(store.report_reltuples().await.unwrap(), 4.0);

        let stats = cleanup(
            &store,
            CleanupConfig {
                report_min_retention_days: 30,
                report_max_rows: 3,
                report_cleanup_batch_size: 10,
                ..CleanupConfig::default()
            },
        )
        .await;

        assert_eq!(stats.cold_reports_deleted, 1, "4 rows, cap of 3");
        assert!(!store.report_exists("report-estimate-near-0").await.unwrap());
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

    #[tokio::test]
    async fn watch_repo_for_stars_is_idempotent() {
        let Some(store) = test_store().await else {
            return;
        };

        let first = store
            .watch_repo_for_stars(RepositoryProvider::GitHub, "torvalds", "linux")
            .await
            .unwrap();
        let second = store
            .watch_repo_for_stars(RepositoryProvider::GitHub, "torvalds", "linux")
            .await
            .unwrap();

        assert!(first, "the first call should start watching");
        assert!(!second, "the second call should find it already watched");

        let watched = store.watched_star_repos().await.unwrap();
        assert_eq!(
            watched,
            vec![(
                RepositoryProvider::GitHub,
                "torvalds".to_string(),
                "linux".to_string()
            )]
        );
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn record_star_snapshot_upserts_same_day_instead_of_duplicating() {
        let Some(store) = test_store().await else {
            return;
        };
        let today = Utc::now().date_naive();

        store
            .record_star_snapshot(RepositoryProvider::GitHub, "octo", "counts", today, 100)
            .await
            .unwrap();
        // A same-day re-snapshot (e.g. the daily task running twice, or a
        // repeat backfill) must correct the row in place, not add a second
        // one for the same date.
        store
            .record_star_snapshot(RepositoryProvider::GitHub, "octo", "counts", today, 142)
            .await
            .unwrap();

        let history = store
            .star_history(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();

        assert_eq!(history, vec![(today, 142)]);
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn star_history_returns_snapshots_oldest_first() {
        let Some(store) = test_store().await else {
            return;
        };
        let today = Utc::now().date_naive();
        let yesterday = today - Duration::days(1);
        let last_week = today - Duration::days(7);

        // Inserted out of chronological order on purpose, to prove the query
        // orders by date rather than by insertion order.
        store
            .record_star_snapshot(RepositoryProvider::GitHub, "octo", "counts", today, 300)
            .await
            .unwrap();
        store
            .record_star_snapshot(RepositoryProvider::GitHub, "octo", "counts", last_week, 100)
            .await
            .unwrap();
        store
            .record_star_snapshot(RepositoryProvider::GitHub, "octo", "counts", yesterday, 250)
            .await
            .unwrap();

        let history = store
            .star_history(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();

        assert_eq!(
            history,
            vec![(last_week, 100), (yesterday, 250), (today, 300)]
        );
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn star_history_is_scoped_per_repository() {
        let Some(store) = test_store().await else {
            return;
        };
        let today = Utc::now().date_naive();

        store
            .record_star_snapshot(RepositoryProvider::GitHub, "owner-a", "repo", today, 10)
            .await
            .unwrap();
        store
            .record_star_snapshot(RepositoryProvider::GitHub, "owner-b", "repo", today, 20)
            .await
            .unwrap();

        let a = store
            .star_history(RepositoryProvider::GitHub, "owner-a", "repo")
            .await
            .unwrap();
        let b = store
            .star_history(RepositoryProvider::GitHub, "owner-b", "repo")
            .await
            .unwrap();

        assert_eq!(a, vec![(today, 10)]);
        assert_eq!(b, vec![(today, 20)]);
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn star_history_is_empty_for_an_unwatched_repo() {
        let Some(store) = test_store().await else {
            return;
        };
        let history = store
            .star_history(RepositoryProvider::GitHub, "nobody", "watches-this")
            .await
            .unwrap();
        assert!(history.is_empty());
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn start_sloc_backfill_if_needed_is_idempotent() {
        let Some(store) = test_store().await else {
            return;
        };
        store
            .watch_repo_for_stars(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();

        let first = store
            .start_sloc_backfill_if_needed(
                RepositoryProvider::GitHub,
                "octo",
                "counts",
                std::time::Duration::from_secs(900),
            )
            .await
            .unwrap();
        let second = store
            .start_sloc_backfill_if_needed(
                RepositoryProvider::GitHub,
                "octo",
                "counts",
                std::time::Duration::from_secs(900),
            )
            .await
            .unwrap();

        assert!(first, "the first call should claim the backfill");
        assert!(
            !second,
            "a concurrent second call should find it already claimed"
        );
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn start_sloc_backfill_if_needed_reclaims_an_incomplete_claim_after_the_cooldown() {
        let Some(store) = test_store().await else {
            return;
        };
        store
            .watch_repo_for_stars(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();

        assert!(
            store
                .start_sloc_backfill_if_needed(
                    RepositoryProvider::GitHub,
                    "octo",
                    "counts",
                    std::time::Duration::from_secs(0),
                )
                .await
                .unwrap(),
            "first claim succeeds"
        );
        // A zero cooldown reclaims immediately — the crashed-backfill resume
        // path. NOW() is per-statement, but sleep a beat first so the two
        // transaction timestamps cannot land on the same microsecond.
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        assert!(
            store
                .start_sloc_backfill_if_needed(
                    RepositoryProvider::GitHub,
                    "octo",
                    "counts",
                    std::time::Duration::from_secs(0),
                )
                .await
                .unwrap(),
            "an incomplete claim past the cooldown is re-claimable"
        );

        // Once completed, the same zero cooldown must NOT reclaim: completed
        // repos are the forward sampler's job, not the backfill's.
        store
            .mark_sloc_backfill_completed(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();
        assert!(
            !store
                .start_sloc_backfill_if_needed(
                    RepositoryProvider::GitHub,
                    "octo",
                    "counts",
                    std::time::Duration::from_secs(0),
                )
                .await
                .unwrap(),
            "a completed backfill is never re-claimed"
        );
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn sloc_backfill_in_progress_reflects_started_and_completed_markers() {
        let Some(store) = test_store().await else {
            return;
        };
        store
            .watch_repo_for_stars(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();

        assert!(
            !store
                .sloc_backfill_in_progress(RepositoryProvider::GitHub, "octo", "counts")
                .await
                .unwrap(),
            "not started yet"
        );

        store
            .start_sloc_backfill_if_needed(
                RepositoryProvider::GitHub,
                "octo",
                "counts",
                std::time::Duration::from_secs(900),
            )
            .await
            .unwrap();
        assert!(
            store
                .sloc_backfill_in_progress(RepositoryProvider::GitHub, "octo", "counts")
                .await
                .unwrap(),
            "started but not completed"
        );

        store
            .mark_sloc_backfill_completed(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();
        assert!(
            !store
                .sloc_backfill_in_progress(RepositoryProvider::GitHub, "octo", "counts")
                .await
                .unwrap(),
            "completed"
        );
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn start_star_backfill_if_needed_is_idempotent() {
        let Some(store) = test_store().await else {
            return;
        };
        store
            .watch_repo_for_stars(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();

        let first = store
            .start_star_backfill_if_needed(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();
        let second = store
            .start_star_backfill_if_needed(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();

        assert!(first, "the first call should claim the backfill");
        assert!(
            !second,
            "a concurrent second call should find it already claimed"
        );
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn star_backfill_in_progress_reflects_started_and_completed_markers() {
        let Some(store) = test_store().await else {
            return;
        };
        store
            .watch_repo_for_stars(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();

        assert!(
            !store
                .star_backfill_in_progress(RepositoryProvider::GitHub, "octo", "counts")
                .await
                .unwrap(),
            "not started yet"
        );

        store
            .start_star_backfill_if_needed(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();
        assert!(
            store
                .star_backfill_in_progress(RepositoryProvider::GitHub, "octo", "counts")
                .await
                .unwrap(),
            "started but not completed"
        );

        store
            .mark_star_backfill_completed(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();
        assert!(
            !store
                .star_backfill_in_progress(RepositoryProvider::GitHub, "octo", "counts")
                .await
                .unwrap(),
            "completed"
        );
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn star_history_is_backfilled_reflects_completion() {
        let Some(store) = test_store().await else {
            return;
        };
        store
            .watch_repo_for_stars(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();

        assert!(!store
            .star_history_is_backfilled(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap());

        store
            .start_star_backfill_if_needed(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();
        assert!(
            !store
                .star_history_is_backfilled(RepositoryProvider::GitHub, "octo", "counts")
                .await
                .unwrap(),
            "started but not completed yet"
        );

        store
            .mark_star_backfill_completed(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();
        assert!(store
            .star_history_is_backfilled(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap());
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn record_sloc_snapshot_upserts_same_day_instead_of_duplicating() {
        let Some(store) = test_store().await else {
            return;
        };
        let today = Utc::now().date_naive();

        store
            .record_sloc_snapshot(
                RepositoryProvider::GitHub,
                "octo",
                "counts",
                today,
                1_000,
                "sha1",
                "backfill",
            )
            .await
            .unwrap();
        store
            .record_sloc_snapshot(
                RepositoryProvider::GitHub,
                "octo",
                "counts",
                today,
                1_200,
                "sha2",
                "forward",
            )
            .await
            .unwrap();

        let history = store
            .sloc_history(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();

        assert_eq!(history, vec![(today, 1_200, "sha2".to_string())]);
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn sloc_history_returns_snapshots_oldest_first() {
        let Some(store) = test_store().await else {
            return;
        };
        let today = Utc::now().date_naive();
        let yesterday = today - Duration::days(1);
        let last_week = today - Duration::days(7);

        store
            .record_sloc_snapshot(
                RepositoryProvider::GitHub,
                "octo",
                "counts",
                today,
                3_000,
                "sha-today",
                "forward",
            )
            .await
            .unwrap();
        store
            .record_sloc_snapshot(
                RepositoryProvider::GitHub,
                "octo",
                "counts",
                last_week,
                1_000,
                "sha-lw",
                "backfill",
            )
            .await
            .unwrap();
        store
            .record_sloc_snapshot(
                RepositoryProvider::GitHub,
                "octo",
                "counts",
                yesterday,
                2_000,
                "sha-y",
                "backfill",
            )
            .await
            .unwrap();

        let history = store
            .sloc_history(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();

        assert_eq!(
            history,
            vec![
                (last_week, 1_000, "sha-lw".to_string()),
                (yesterday, 2_000, "sha-y".to_string()),
                (today, 3_000, "sha-today".to_string())
            ]
        );
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn sloc_history_is_empty_for_a_repo_with_no_snapshots() {
        let Some(store) = test_store().await else {
            return;
        };
        let history = store
            .sloc_history(RepositoryProvider::GitHub, "nobody", "watches-this")
            .await
            .unwrap();
        assert!(history.is_empty());
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn superseded_snapshots_are_hidden_until_re_recorded() {
        let Some(store) = test_store().await else {
            return;
        };
        let today = Utc::now().date_naive();
        let last_month = today - Duration::days(30);
        let two_months_ago = today - Duration::days(60);

        for (date, lines, sha) in [
            (two_months_ago, 100, "sha-old"),
            (today - Duration::days(45), 150, "sha-mid"),
            (last_month, 200, "sha-mid2"),
            (today, 400, "sha-now"),
        ] {
            store
                .record_sloc_snapshot(
                    RepositoryProvider::GitHub,
                    "octo",
                    "counts",
                    date,
                    lines,
                    sha,
                    "backfill",
                )
                .await
                .unwrap();
        }

        let superseded = store
            .supersede_sloc_snapshots(
                RepositoryProvider::GitHub,
                "octo",
                "counts",
                &[today - Duration::days(45), last_month],
            )
            .await
            .unwrap();
        assert_eq!(superseded, 2);

        let history = store
            .sloc_history(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();
        assert_eq!(
            history,
            vec![
                (two_months_ago, 100, "sha-old".to_string()),
                (today, 400, "sha-now".to_string())
            ]
        );

        // Re-recording a superseded date revives it: a fresh write always
        // beats a soft delete.
        store
            .record_sloc_snapshot(
                RepositoryProvider::GitHub,
                "octo",
                "counts",
                last_month,
                210,
                "sha-mid2",
                "forward",
            )
            .await
            .unwrap();
        let history = store
            .sloc_history(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();
        assert_eq!(
            history,
            vec![
                (two_months_ago, 100, "sha-old".to_string()),
                (last_month, 210, "sha-mid2".to_string()),
                (today, 400, "sha-now".to_string())
            ]
        );
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn start_sloc_resample_if_needed_enforces_its_cooldown() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octo");
        store
            .watch_repo_for_stars(RepositoryProvider::GitHub, &owner, "count")
            .await
            .unwrap();

        let cooldown = std::time::Duration::from_secs(24 * 60 * 60);
        assert!(
            store
                .start_sloc_resample_if_needed(
                    RepositoryProvider::GitHub,
                    &owner,
                    "count",
                    cooldown
                )
                .await
                .unwrap(),
            "the first claim wins"
        );
        assert!(
            !store
                .start_sloc_resample_if_needed(
                    RepositoryProvider::GitHub,
                    &owner,
                    "count",
                    cooldown
                )
                .await
                .unwrap(),
            "a second claim inside the cooldown is refused"
        );
        assert!(
            !store
                .start_sloc_resample_if_needed(
                    RepositoryProvider::GitHub,
                    "nobody",
                    "watched-this",
                    cooldown
                )
                .await
                .unwrap(),
            "a repo that was never watched claims nothing"
        );

        // Age the marker past the cooldown: the claim becomes eligible again.
        sqlx::query(
            "UPDATE star_watch SET sloc_resample_started_at = NOW() - INTERVAL '25 hours' WHERE owner = $1",
        )
        .bind(&owner)
        .execute(&store.pool)
        .await
        .unwrap();
        assert!(
            store
                .start_sloc_resample_if_needed(
                    RepositoryProvider::GitHub,
                    &owner,
                    "count",
                    cooldown
                )
                .await
                .unwrap(),
            "an aged-out claim can be retaken"
        );
        store.drop_schema().await;
    }

    /// A `test_report` variant for `related_reports` tests: arbitrary repo
    /// name, top language and size, with `total_lines` overridable so a
    /// candidate can share its code count with the source without sharing
    /// the full size signature.
    fn related_repo_report(
        id: &str,
        owner: &str,
        repo: &str,
        language: &str,
        code: usize,
        lines: Option<usize>,
    ) -> Report {
        let mut report = test_report(id, owner, code);
        report.repository.name = repo.to_string();
        let stats = LanguageStats {
            files: 1,
            lines: lines.unwrap_or(code + 10),
            code,
            comments: 7,
            blanks: 3,
        };
        report.languages = vec![LanguageReport {
            name: language.to_string(),
            stats: stats.clone(),
            children: Vec::new(),
        }];
        report.total = stats;
        report
    }

    async fn save_related_repo_report(store: &Store, report: &Report) {
        store
            .save_report(report, AnalysisSource::Unknown)
            .await
            .unwrap();
    }

    fn related_full_names(rows: &[super::RelatedReportRow]) -> Vec<String> {
        rows.iter()
            .map(|row| format!("{}/{}", row.owner, row.repo))
            .collect()
    }

    #[tokio::test]
    async fn related_reports_excludes_case_insensitive_self_mirrors_and_duplicate_sizes() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("Example");

        // Source: "Example/Widget", 1_000 code / 1_010 lines, top language Rust.
        save_related_repo_report(
            &store,
            &related_repo_report("rel-src", &owner, "Widget", "Rust", 1_000, None),
        )
        .await;
        // Same repo in a different case but a DIFFERENT size: only the
        // case-insensitive self-exclusion can drop it.
        save_related_repo_report(
            &store,
            &related_repo_report(
                "rel-self-case",
                &owner.to_uppercase(),
                "widget",
                "Rust",
                500,
                None,
            ),
        )
        .await;
        // A different repo with the source's exact (code, lines) signature:
        // a mirror or renamed copy, excluded outright.
        save_related_repo_report(
            &store,
            &related_repo_report("rel-mirror", "someone-else", "clone", "Rust", 1_000, None),
        )
        .await;
        // Only the code count matches (lines differ): NOT a mirror, must stay.
        save_related_repo_report(
            &store,
            &related_repo_report("rel-half-sig", "third-party", "similar", "Rust", 1_000, Some(1_400)),
        )
        .await;
        // Two distinct repos sharing a (2_000, 2_010) signature: only one
        // survives the size-signature dedupe.
        save_related_repo_report(
            &store,
            &related_repo_report("rel-dup-one", "dup-one", "one", "Rust", 2_000, None),
        )
        .await;
        save_related_repo_report(
            &store,
            &related_repo_report("rel-dup-two", "dup-two", "two", "Rust", 2_000, None),
        )
        .await;
        // An unambiguous healthy candidate.
        save_related_repo_report(
            &store,
            &related_repo_report("rel-healthy", "healthy", "neighbour", "Rust", 1_500, None),
        )
        .await;

        let rows = store
            .related_reports(
                RepositoryProvider::GitHub,
                &owner,
                "Widget",
                Some("Rust"),
                1_000,
                1_010,
                6,
            )
            .await
            .unwrap();
        let names = related_full_names(&rows);

        assert!(
            !names.iter().any(|name| name.to_lowercase() == format!("{owner}/widget").to_lowercase()),
            "the source itself (in any case) must not be recommended: {names:?}"
        );
        assert!(
            !names.contains(&"someone-else/clone".to_string()),
            "an exact size-signature mirror must be excluded: {names:?}"
        );
        assert_eq!(
            names.iter().filter(|name| name.starts_with("dup-")).count(),
            1,
            "one row per distinct size signature: {names:?}"
        );
        assert_eq!(
            names.len(),
            3,
            "exactly the healthy candidate, the half-signature match and one duplicate survive: {names:?}"
        );
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn related_reports_orders_by_relative_size_distance() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("Example");

        // Source: 1_000 code lines.
        save_related_repo_report(
            &store,
            &related_repo_report("rel-src", &owner, "Widget", "Rust", 1_000, None),
        )
        .await;
        // Absolute distance prefers the tiny repo (|100-1000| = 900 versus
        // |5000-1000| = 4000); relative distance correctly prefers the big
        // one (ratio 5 versus ratio 10).
        save_related_repo_report(
            &store,
            &related_repo_report("rel-tiny", "tiny", "repo", "Rust", 100, None),
        )
        .await;
        save_related_repo_report(
            &store,
            &related_repo_report("rel-big", "big", "repo", "Rust", 5_000, None),
        )
        .await;

        let rows = store
            .related_reports(
                RepositoryProvider::GitHub,
                &owner,
                "Widget",
                Some("Rust"),
                1_000,
                1_010,
                6,
            )
            .await
            .unwrap();
        let names = related_full_names(&rows);

        assert_eq!(
            names,
            vec!["big/repo".to_string(), "tiny/repo".to_string()],
            "ln-based distance ranks the 5x repo ahead of the 10x repo"
        );
        store.drop_schema().await;
    }

    fn history_report(
        id: &str,
        commit_sha: &str,
        code: usize,
        generated_at: chrono::DateTime<Utc>,
    ) -> Report {
        let mut report = test_report(id, "octo", code);
        report.commit_sha = commit_sha.to_string();
        report.ref_name = commit_sha.to_string();
        report.generated_at = generated_at;
        report
    }

    #[tokio::test]
    async fn latest_report_ignores_a_historical_sample_written_after_head() {
        let Some(store) = test_store().await else {
            return;
        };
        let today = Utc::now().date_naive();
        let now = Utc::now();

        // The user's HEAD report, then a suspect-point resample that re-analyzes
        // a years-old commit and is therefore the newest row for the repo.
        store
            .save_report(
                &history_report("head", "sha-head", 365_009, now - Duration::hours(2)),
                AnalysisSource::Web,
            )
            .await
            .unwrap();
        store
            .record_sloc_snapshot(
                RepositoryProvider::GitHub,
                "octo",
                "count",
                today,
                365_009,
                "sha-head",
                "forward",
            )
            .await
            .unwrap();
        store
            .record_sloc_snapshot(
                RepositoryProvider::GitHub,
                "octo",
                "count",
                today - Duration::days(1000),
                17_952,
                "sha-old",
                "resample",
            )
            .await
            .unwrap();
        store
            .save_report(
                &history_report("old", "sha-old", 17_952, now),
                AnalysisSource::SlocBackfill,
            )
            .await
            .unwrap();

        let latest = store
            .latest_report(RepositoryProvider::GitHub, "octo", "count")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(latest.commit_sha, "sha-head");
        let card = store
            .latest_report_card(RepositoryProvider::GitHub, "octo", "count")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(card.commit_sha, "sha-head");
        let recent = store.recent_reports(10, 0).await.unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].commit_sha, "sha-head");
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn latest_report_accepts_the_forward_samplers_head_analysis() {
        let Some(store) = test_store().await else {
            return;
        };
        let today = Utc::now().date_naive();
        let now = Utc::now();

        // A stale user report, then the forward sampler analyzing a newer HEAD:
        // its report is the current state and must win.
        store
            .save_report(
                &history_report("stale", "sha-stale", 1_000, now - Duration::days(30)),
                AnalysisSource::Web,
            )
            .await
            .unwrap();
        store
            .save_report(
                &history_report("fresh", "sha-fresh", 1_200, now),
                AnalysisSource::SlocBackfill,
            )
            .await
            .unwrap();
        store
            .record_sloc_snapshot(
                RepositoryProvider::GitHub,
                "octo",
                "count",
                today,
                1_200,
                "sha-fresh",
                "forward",
            )
            .await
            .unwrap();

        let card = store
            .latest_report_card(RepositoryProvider::GitHub, "octo", "count")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(card.commit_sha, "sha-fresh");
        store.drop_schema().await;
    }

    /// A report under a chosen option set, with the analysis key the analyzer
    /// would have derived for it — so the row's `analysisOptions` body,
    /// `analysisKey` and `tokei_version` column agree the way real rows do.
    fn options_report(
        id: &str,
        owner: &str,
        name: &str,
        commit_sha: &str,
        code: usize,
        generated_at: chrono::DateTime<Utc>,
        options: AnalysisOptions,
    ) -> Report {
        let mut report = test_report(id, owner, code);
        report.repository.name = name.to_string();
        report.repository.html_url = format!("https://github.com/{owner}/{name}");
        report.commit_sha = commit_sha.to_string();
        report.generated_at = generated_at;
        report.analysis_options = options.clone();
        report.analysis_key = crate::analyzer::analysis_key(&options);
        report
    }

    /// The all-inclusive set the web app submits (`App.tsx`'s
    /// `defaultAnalysisOptions`, mirrored by serde's field-level defaults).
    fn include_all_options() -> AnalysisOptions {
        AnalysisOptions {
            ignored_dirs: Vec::new(),
            ignored_languages: Vec::new(),
            profile: crate::models::AnalysisProfile::Default,
            include_docs: true,
            include_tests: true,
            include_generated: true,
        }
    }

    /// The live incident this guard exists for. `facebook/react`'s indexed
    /// report is the canonical-options ~365K-code row; a visitor's
    /// include-everything analysis then wrote a 698K row that became the
    /// newest, and — because `save_report`'s upsert keeps a row's
    /// `created_at` and the custom row never conflicts with the canonical
    /// one (different analysis key) — re-analyzing did not restore the
    /// public number. The SEO surfaces must keep answering with the canonical
    /// row no matter how much newer the custom one is.
    #[tokio::test]
    async fn seo_latest_ignores_a_custom_options_row_written_after_the_canonical_one() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("facebook");
        let now = Utc::now();

        let canonical = options_report(
            "incident-canonical",
            &owner,
            "react",
            "sha-indexed",
            365_001,
            now - Duration::days(90),
            AnalysisOptions::canonical(),
        );
        store
            .save_report(&canonical, AnalysisSource::Seed)
            .await
            .unwrap();
        store
            .save_report(
                &options_report(
                    "incident-include-all",
                    &owner,
                    "react",
                    "sha-indexed",
                    698_204,
                    now,
                    include_all_options(),
                ),
                AnalysisSource::Web,
            )
            .await
            .unwrap();

        // The public surfaces keep the indexed number...
        let card = store
            .latest_report_card(RepositoryProvider::GitHub, &owner, "react")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(card.commit_sha, "sha-indexed");
        assert_eq!(card.total.code, 365_001);
        assert_eq!(card.analysis_options.as_ref(), Some(&AnalysisOptions::canonical()));
        let recent = store.recent_reports(10, 0).await.unwrap();
        assert_eq!(recent.len(), 1, "one repository, one canonical row");
        assert_eq!(recent[0].total.code, 365_001);
        let sitemap = store.sitemap_entries(100).await.unwrap();
        assert_eq!(sitemap.len(), 1);
        assert_eq!(sitemap[0].total_code, 365_001);

        // ...while the interactive path (OG share cards) still reports the
        // newest row it has, custom options and all.
        let latest = store
            .latest_report(RepositoryProvider::GitHub, &owner, "react")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(latest.total.code, 698_204);
        store.drop_schema().await;
    }

    /// Rows whose counting configuration is unknown — written before
    /// `analysisOptions` was persisted — cannot stand as the canonical public
    /// report either: the pre-options analyzer had no doc/test/generated
    /// filtering, so their numbers are the all-inclusive measurement in
    /// everything but spelling, and SG-04 forbids presenting an unknown
    /// configuration as the default one. The repository drops out of the SEO
    /// surfaces until a canonical row exists for it.
    #[tokio::test]
    async fn seo_latest_excludes_rows_that_predate_option_tracking() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("octocounts");

        store
            .insert_raw_report(
                "legacy-only",
                "github",
                &owner,
                "legacy",
                "1111222233334444aaaa",
                "tokei-test:default",
                r#"{
                    "id": "legacy-only",
                    "repository": {"owner": "octocounts", "name": "legacy", "htmlUrl": "https://github.com/octocounts/legacy"},
                    "refName": "main",
                    "commitSha": "1111222233334444aaaa",
                    "generatedAt": "2024-02-29T11:30:15Z",
                    "durationMs": 1234,
                    "cached": false,
                    "tokeiVersion": "tokei-test",
                    "languages": [],
                    "total": {"files": 1, "lines": 10, "code": 9, "comments": 1, "blanks": 0}
                }"#,
                Utc::now(),
            )
            .await
            .unwrap();

        assert!(
            store
                .latest_report_card(RepositoryProvider::GitHub, &owner, "legacy")
                .await
                .unwrap()
                .is_none(),
            "a legacy row must not be the canonical report"
        );
        assert!(
            store.recent_reports(10, 0).await.unwrap().is_empty(),
            "a legacy-only repository leaves the SEO lists"
        );
        assert!(
            store.sitemap_entries(100).await.unwrap().is_empty(),
            "a legacy-only repository leaves the sitemap"
        );
        // Still served verbatim by identity, as it always was.
        assert!(
            store
                .latest_report(RepositoryProvider::GitHub, &owner, "legacy")
                .await
                .unwrap()
                .is_some(),
            "the interactive path keeps serving the legacy row"
        );
        store.drop_schema().await;
    }

    /// GitHub treats slug casing as the same repository; the SEO card lookup
    /// agrees, so a wrong-cased request resolves to the stored row (and the
    /// handler turns the row's own spelling into `canonicalSlug`).
    #[tokio::test]
    async fn latest_report_card_resolves_the_key_case_insensitively() {
        let Some(store) = test_store().await else {
            return;
        };
        let owner = unique_name("rust-lang");

        store
            .save_report(
                &options_report(
                    "cased",
                    &owner,
                    "Rust",
                    "sha-cased",
                    2_306_821,
                    Utc::now(),
                    AnalysisOptions::canonical(),
                ),
                AnalysisSource::Seed,
            )
            .await
            .unwrap();

        for (asked_owner, asked_repo) in [
            (&owner, "rust"),
            (&owner.to_uppercase(), "RUST"),
            (&owner, "RuSt"),
        ] {
            let card = store
                .latest_report_card(RepositoryProvider::GitHub, asked_owner, asked_repo)
                .await
                .unwrap()
                .unwrap_or_else(|| panic!("case variant {asked_owner}/{asked_repo} must resolve"));
            assert_eq!(card.repo, "Rust", "the row's own casing wins");
        }
        store.drop_schema().await;
    }

    /// Rename-follow, end to end at the store layer: canonical report rows,
    /// both histories and the watch state all land under the new slug, the
    /// old slug stops answering, a redirect row is written, and the custom-
    /// options row that must not move does not move.
    #[tokio::test]
    async fn follow_repo_rename_rekeys_reports_history_and_watch_and_records_the_redirect() {
        let Some(store) = test_store().await else {
            return;
        };
        let old_owner = unique_name("facebook");
        let today = Utc::now().date_naive();
        let now = Utc::now();

        store
            .save_report(
                &options_report(
                    "rename-canonical",
                    &old_owner,
                    "react",
                    "sha-head",
                    365_001,
                    now - Duration::days(30),
                    AnalysisOptions::canonical(),
                ),
                AnalysisSource::Seed,
            )
            .await
            .unwrap();
        store
            .save_report(
                &options_report(
                    "rename-custom",
                    &old_owner,
                    "react",
                    "sha-head",
                    698_204,
                    now,
                    include_all_options(),
                ),
                AnalysisSource::Web,
            )
            .await
            .unwrap();
        for (days_ago, lines, sha) in [
            (400, 170_000, "sha-400"),
            (200, 300_000, "sha-200"),
            (0, 365_001, "sha-head"),
        ] {
            store
                .record_sloc_snapshot(
                    RepositoryProvider::GitHub,
                    &old_owner,
                    "react",
                    today - Duration::days(days_ago),
                    lines,
                    sha,
                    "backfill",
                )
                .await
                .unwrap();
        }
        store
            .watch_repo_for_stars(RepositoryProvider::GitHub, &old_owner, "react")
            .await
            .unwrap();
        store
            .record_star_snapshot(
                RepositoryProvider::GitHub,
                &old_owner,
                "react",
                today - Duration::days(1),
                230_000,
            )
            .await
            .unwrap();

        let moved = store
            .follow_repo_rename(
                RepositoryProvider::GitHub,
                &old_owner,
                "react",
                "react",
                "react",
            )
            .await
            .unwrap();
        assert!(moved > 0, "reports and history rows must report as moved");

        // The canonical row answers under the new slug, body identity and all.
        let card = store
            .latest_report_card(RepositoryProvider::GitHub, "react", "react")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(card.total.code, 365_001);
        let reloaded = store.report("rename-canonical").await.unwrap().unwrap();
        assert_eq!(reloaded.repository.owner, "react");
        assert_eq!(reloaded.repository.name, "react");
        assert_eq!(
            reloaded.repository.html_url,
            "https://github.com/react/react",
            "the body's identity must follow the row's new key"
        );

        // Histories and watch state moved with it.
        let sloc = store
            .sloc_history(RepositoryProvider::GitHub, "react", "react")
            .await
            .unwrap();
        assert_eq!(sloc.len(), 3, "every history point survives the fold");
        assert_eq!(sloc.first().map(|(_, lines, _)| *lines), Some(170_000));
        let stars = store
            .star_history(RepositoryProvider::GitHub, "react", "react")
            .await
            .unwrap();
        assert_eq!(stars.len(), 1);
        assert!(
            !store
                .watch_repo_for_stars(RepositoryProvider::GitHub, "react", "react")
                .await
                .unwrap(),
            "the watch row must already exist under the new key, so this call starts nothing"
        );
        assert!(
            store
                .watched_star_repos()
                .await
                .unwrap()
                .iter()
                .any(|(provider, owner, repo)| *provider == RepositoryProvider::GitHub
                    && owner == "react" && repo == "react"),
            "the merged watch row is the only one for the repository"
        );

        // The custom-options row stays filed under the old slug...
        assert_eq!(
            store
                .latest_report(RepositoryProvider::GitHub, &old_owner, "react")
                .await
                .unwrap()
                .unwrap()
                .total
                .code,
            698_204,
            "a custom-options analysis is user data under the slug it was requested with"
        );
        // ...so the old slug no longer publishes a canonical report.
        assert!(
            store
                .latest_report_card(RepositoryProvider::GitHub, &old_owner, "react")
                .await
                .unwrap()
                .is_none()
        );

        // And the redirect is on record for the API surfaces.
        assert_eq!(
            store
                .redirect_target(RepositoryProvider::GitHub, &old_owner, "react")
                .await
                .unwrap(),
            Some(("react".to_string(), "react".to_string()))
        );

        // Idempotent: nothing is left to move, and the redirect stands.
        assert_eq!(
            store
                .follow_repo_rename(
                    RepositoryProvider::GitHub,
                    &old_owner,
                    "react",
                    "react",
                    "react"
                )
                .await
                .unwrap(),
            0
        );
        store.drop_schema().await;
    }

    /// The merge case the production data actually presents: `react/react`
    /// already has rows and its own sampled history when `facebook/react`'s
    /// rows fold across. Both histories survive under the new key, a same-date
    /// collision keeps the later-written sample, and a report whose
    /// (commit_sha, analysis key) already exists under the new key is left
    /// behind rather than violating the table's uniqueness — the surviving row
    /// is the same analysis of the same commit.
    #[tokio::test]
    async fn follow_repo_rename_merges_into_an_existing_key_without_dropping_history() {
        let Some(store) = test_store().await else {
            return;
        };
        let old_owner = unique_name("facebook");
        let today = Utc::now().date_naive();
        let now = Utc::now();

        // Old slug: a canonical report on sha-shared plus an older one, and
        // snapshots written yesterday.
        for (id, sha, code, at) in [
            ("merge-shared", "sha-shared", 365_001, now - Duration::days(10)),
            ("merge-old-only", "sha-old-only", 200_000, now - Duration::days(300)),
        ] {
            store
                .save_report(
                    &options_report(id, &old_owner, "react", sha, code, at, AnalysisOptions::canonical()),
                    AnalysisSource::Seed,
                )
                .await
                .unwrap();
        }
        for (days_ago, lines) in [(30, 310_000), (60, 290_000)] {
            store
                .record_sloc_snapshot(
                    RepositoryProvider::GitHub,
                    &old_owner,
                    "react",
                    today - Duration::days(days_ago),
                    lines,
                    &format!("sha-{days_ago}"),
                    "backfill",
                )
                .await
                .unwrap();
        }

        // New slug already holds the same commit under the same analysis key,
        // a newer report of its own, and a snapshot on a shared date written
        // *later* than the old slug's.
        store
            .save_report(
                &options_report(
                    "merge-kept",
                    "react",
                    "react",
                    "sha-shared",
                    365_001,
                    now - Duration::days(5),
                    AnalysisOptions::canonical(),
                ),
                AnalysisSource::Seed,
            )
            .await
            .unwrap();
        store
            .save_report(
                &options_report(
                    "merge-new",
                    "react",
                    "react",
                    "sha-new-head",
                    366_500,
                    now,
                    AnalysisOptions::canonical(),
                ),
                AnalysisSource::Seed,
            )
            .await
            .unwrap();
        for (days_ago, lines, sha) in [(30, 312_000, "sha-new-side"), (0, 312_000, "sha-new-head")] {
            store
                .record_sloc_snapshot(
                    RepositoryProvider::GitHub,
                    "react",
                    "react",
                    today - Duration::days(days_ago),
                    lines,
                    sha,
                    "forward",
                )
                .await
                .unwrap();
        }

        store
            .follow_repo_rename(
                RepositoryProvider::GitHub,
                &old_owner,
                "react",
                "react",
                "react",
            )
            .await
            .unwrap();

        // Merged history: three distinct dates, the shared date carrying the
        // later-written (new-slug) sample.
        let sloc = store
            .sloc_history(RepositoryProvider::GitHub, "react", "react")
            .await
            .unwrap();
        assert_eq!(sloc.len(), 3, "both histories' points survive");
        assert_eq!(sloc[0].1, 290_000, "old-slug-only date survives");
        assert_eq!(sloc[1].1, 312_000, "shared date keeps the later-written sample");
        assert_eq!(sloc[2].1, 312_000);

        // Reports: the duplicate analysis is gone (the new-key row is the same
        // analysis of the same commit), and the newest canonical row is the
        // merged latest.
        assert!(
            store.report("merge-kept").await.unwrap().is_some(),
            "the pre-existing new-key row survives"
        );
        assert!(
            store.report("merge-shared").await.unwrap().is_none(),
            "the colliding old-key row is deleted, not left publishing under the old slug"
        );
        let card = store
            .latest_report_card(RepositoryProvider::GitHub, "react", "react")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(card.commit_sha, "sha-new-head");
        assert!(
            store
                .latest_report_card(RepositoryProvider::GitHub, &old_owner, "react")
                .await
                .unwrap()
                .is_none(),
            "the fold empties the old slug of canonical rows entirely"
        );
        store.drop_schema().await;
    }

    /// Redirect chains (a repository renamed twice) resolve to the final slug,
    /// capped so a corrupt cycle cannot loop.
    #[tokio::test]
    async fn redirect_target_follows_a_chain_of_renames() {
        let Some(store) = test_store().await else {
            return;
        };
        let first = unique_name("first");
        let second = unique_name("second");

        store
            .save_report(
                &options_report(
                    "chain",
                    &first,
                    "repo",
                    "sha-chain",
                    1_000,
                    Utc::now(),
                    AnalysisOptions::canonical(),
                ),
                AnalysisSource::Seed,
            )
            .await
            .unwrap();
        store
            .follow_repo_rename(RepositoryProvider::GitHub, &first, "repo", &second, "repo")
            .await
            .unwrap();
        store
            .follow_repo_rename(RepositoryProvider::GitHub, &second, "repo", "third", "repo")
            .await
            .unwrap();

        assert_eq!(
            store
                .redirect_target(RepositoryProvider::GitHub, &first, "repo")
                .await
                .unwrap(),
            Some(("third".to_string(), "repo".to_string())),
            "a two-hop chain resolves to the final slug"
        );
        assert_eq!(
            store
                .redirect_target(RepositoryProvider::GitHub, "third", "repo")
                .await
                .unwrap(),
            None,
            "the final slug has no redirect of its own"
        );
        assert_eq!(
            store
                .redirect_target(RepositoryProvider::GitHub, "never", "existed")
                .await
                .unwrap(),
            None
        );
        store.drop_schema().await;
    }

    /// The startup pass folds the curated seed pairs and is idempotent — the
    /// second run is a no-op, which is what makes running it at every boot
    /// safe.
    #[tokio::test]
    async fn migrate_repo_renames_folds_the_seed_pairs_and_is_idempotent() {
        let Some(store) = test_store().await else {
            return;
        };

        store
            .save_report(
                &options_report(
                    "seed-fold",
                    "facebook",
                    "react",
                    "sha-seed",
                    365_001,
                    Utc::now(),
                    AnalysisOptions::canonical(),
                ),
                AnalysisSource::Seed,
            )
            .await
            .unwrap();

        let moved = store.migrate_repo_renames().await.unwrap();
        assert!(moved > 0, "the facebook/react seed pair must fold");
        assert!(
            store
                .latest_report_card(RepositoryProvider::GitHub, "react", "react")
                .await
                .unwrap()
                .is_some(),
            "the folded row answers under the current slug"
        );
        assert_eq!(
            store.migrate_repo_renames().await.unwrap(),
            0,
            "a second pass has nothing left to move"
        );
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn latest_sloc_snapshot_returns_the_newest_live_point() {
        let Some(store) = test_store().await else {
            return;
        };
        let today = Utc::now().date_naive();
        let yesterday = today - Duration::days(1);

        store
            .record_sloc_snapshot(
                RepositoryProvider::GitHub,
                "octo",
                "counts",
                yesterday,
                1_000,
                "sha-old",
                "backfill",
            )
            .await
            .unwrap();
        store
            .record_sloc_snapshot(
                RepositoryProvider::GitHub,
                "octo",
                "counts",
                today,
                1_500,
                "sha-new",
                "forward",
            )
            .await
            .unwrap();

        let latest = store
            .latest_sloc_snapshot(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();
        assert_eq!(latest, Some((today, 1_500, "sha-new".to_string())));

        // A superseded newest point must not become the "latest" either.
        store
            .supersede_sloc_snapshots(RepositoryProvider::GitHub, "octo", "counts", &[today])
            .await
            .unwrap();
        let latest = store
            .latest_sloc_snapshot(RepositoryProvider::GitHub, "octo", "counts")
            .await
            .unwrap();
        assert_eq!(latest, Some((yesterday, 1_000, "sha-old".to_string())));
        store.drop_schema().await;
    }

    #[tokio::test]
    async fn watched_sloc_repos_lists_only_completed_backfills() {
        let Some(store) = test_store().await else {
            return;
        };
        store
            .watch_repo_for_stars(RepositoryProvider::GitHub, "octo", "done")
            .await
            .unwrap();
        store
            .watch_repo_for_stars(RepositoryProvider::GitHub, "octo", "pending")
            .await
            .unwrap();

        store
            .start_sloc_backfill_if_needed(
                RepositoryProvider::GitHub,
                "octo",
                "done",
                std::time::Duration::from_secs(900),
            )
            .await
            .unwrap();
        store
            .mark_sloc_backfill_completed(RepositoryProvider::GitHub, "octo", "done")
            .await
            .unwrap();
        store
            .start_sloc_backfill_if_needed(
                RepositoryProvider::GitHub,
                "octo",
                "pending",
                std::time::Duration::from_secs(900),
            )
            .await
            .unwrap();

        let repos = store.watched_sloc_repos().await.unwrap();
        assert_eq!(
            repos,
            vec![(
                RepositoryProvider::GitHub,
                "octo".to_string(),
                "done".to_string()
            )]
        );
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
                stars: None,
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
