BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':cache-purge-migration', 0));

CREATE SEQUENCE IF NOT EXISTS cache_purge_version;
CREATE TABLE IF NOT EXISTS cache_purge_queue (
    tag TEXT PRIMARY KEY,
    version BIGINT NOT NULL DEFAULT nextval('cache_purge_version'),
    ready_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '45 seconds',
    attempts INTEGER NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION queue_cache_tag(value TEXT) RETURNS void AS $$
    INSERT INTO cache_purge_queue (tag) VALUES (value)
    ON CONFLICT (tag) DO UPDATE SET version = nextval('cache_purge_version');
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION queue_repo_cache(p TEXT, o TEXT, r TEXT) RETURNS void AS $$
DECLARE item RECORD;
BEGIN
    -- Include predecessor slugs: their API URLs also resolve to this repository.
    FOR item IN
        WITH RECURSIVE aliases(owner, repo) AS (
            SELECT lower(o), lower(r)
            UNION
            SELECT lower(d.old_owner), lower(d.old_repo)
            FROM repo_redirects d JOIN aliases a
              ON lower(d.new_owner) = a.owner AND lower(d.new_repo) = a.repo
            WHERE d.provider = p
        )
        SELECT 'octo-repo-' || encode(sha256(convert_to(lower(p || ':' || owner || '/' || repo), 'UTF8')), 'hex') AS tag
        FROM aliases ORDER BY tag
    LOOP
        PERFORM queue_cache_tag(item.tag);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION report_cache_changed() RETURNS trigger AS $$
DECLARE item JSONB;
BEGIN
    IF TG_TABLE_NAME = 'repository_refs' AND TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - 'resolved_at') = (to_jsonb(OLD) - 'resolved_at') THEN
            RETURN NULL;
        END IF;
    END IF;
    FOR item IN SELECT DISTINCT value FROM jsonb_array_elements(
        CASE WHEN TG_OP = 'INSERT' THEN jsonb_build_array(to_jsonb(NEW))
             WHEN TG_OP = 'DELETE' THEN jsonb_build_array(to_jsonb(OLD))
             ELSE jsonb_build_array(to_jsonb(OLD), to_jsonb(NEW)) END)
    LOOP
        IF TG_TABLE_NAME = 'repo_redirects' THEN
            PERFORM queue_repo_cache(item->>'provider', item->>'old_owner', item->>'old_repo');
            PERFORM queue_repo_cache(item->>'provider', item->>'new_owner', item->>'new_repo');
        ELSE
            PERFORM queue_repo_cache(item->>'provider', item->>'owner', item->>'repo');
            IF TG_TABLE_NAME = 'reports' THEN
                PERFORM queue_cache_tag('octo-report-' || encode(sha256(convert_to(item->>'id', 'UTF8')), 'hex'));
            END IF;
        END IF;
    END LOOP;
    -- Delivered only at commit; rolled-back writes never invalidate origin caches.
    PERFORM pg_notify('octocounts_cache_changed', '');
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER report_cache_changed
AFTER INSERT OR DELETE OR UPDATE OF id, provider, owner, repo, body, source, created_at ON reports
FOR EACH ROW EXECUTE FUNCTION report_cache_changed();
CREATE OR REPLACE TRIGGER ref_cache_changed
AFTER INSERT OR UPDATE OR DELETE ON repository_refs
FOR EACH ROW EXECUTE FUNCTION report_cache_changed();
CREATE OR REPLACE TRIGGER redirect_cache_changed
AFTER INSERT OR UPDATE OR DELETE ON repo_redirects
FOR EACH ROW EXECUTE FUNCTION report_cache_changed();
COMMIT;
