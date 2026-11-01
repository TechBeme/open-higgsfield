BEGIN;

CREATE TABLE IF NOT EXISTS generation_task_schema (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    version INTEGER NOT NULL
);
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM generation_task_schema WHERE version > 2) THEN
        RAISE EXCEPTION 'A newer task schema is installed';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS generation_tasks (
    task_id TEXT PRIMARY KEY,
    media_type TEXT NOT NULL,
    status TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE generation_tasks
    ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS lifecycle_phase TEXT,
    ADD COLUMN IF NOT EXISTS next_poll_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS poll_failures INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS lease_token TEXT,
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

WITH legacy AS (
    SELECT task_id, status,
        (COALESCE(payload->>'poll_url', '') <> '' OR
         (payload->'provider_operation' IS NOT NULL AND payload->'provider_operation' <> 'null'::jsonb)) AS has_operation,
        (COALESCE(payload->>'video_path', '') <> '' OR
         EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(payload->'result_paths') = 'array' THEN payload->'result_paths' ELSE '[]'::jsonb END)) OR
         EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(payload->'result_urls') = 'array' THEN payload->'result_urls' ELSE '[]'::jsonb END)) OR
         EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(payload->'video_urls') = 'array' THEN payload->'video_urls' ELSE '[]'::jsonb END))) AS has_assets
    FROM generation_tasks WHERE lifecycle_phase IS NULL
), classified AS (
    SELECT *, CASE
        WHEN status = 'COMPLETED' AND NOT has_assets THEN CASE WHEN has_operation THEN 'materializing' ELSE 'paused' END
        WHEN status IN ('COMPLETED', 'FAILED', 'ERROR', 'CANCELLED') THEN 'terminal'
        WHEN has_operation THEN 'polling' ELSE 'submission_unknown' END AS phase
    FROM legacy
)
UPDATE generation_tasks AS task SET
    lifecycle_phase = classified.phase,
    status = CASE WHEN classified.phase IN ('paused', 'submission_unknown') THEN 'ERROR'
                  WHEN classified.phase = 'materializing' THEN 'IN_PROGRESS' ELSE task.status END,
    next_poll_at = CASE WHEN classified.phase IN ('polling', 'materializing') THEN NOW() END,
    deadline_at = task.created_at + INTERVAL '24 hours',
    payload = CASE WHEN classified.phase = 'paused' THEN task.payload || '{"error_message":"ERR_ASSET_STORAGE_INCOMPLETE"}'::jsonb
                   WHEN classified.phase = 'submission_unknown' THEN task.payload || '{"error_message":"ERR_SUBMISSION_OUTCOME_UNKNOWN"}'::jsonb ELSE task.payload END
FROM classified WHERE task.task_id = classified.task_id;

ALTER TABLE generation_tasks ALTER COLUMN lifecycle_phase SET NOT NULL;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'generation_tasks'::regclass AND conname = 'generation_tasks_lifecycle_check') THEN
        ALTER TABLE generation_tasks ADD CONSTRAINT generation_tasks_lifecycle_check CHECK (
            revision > 0 AND poll_failures >= 0 AND
            lifecycle_phase IN ('submitting', 'polling', 'materializing', 'paused', 'submission_unknown', 'terminal') AND
            ((lease_token IS NULL) = (lease_expires_at IS NULL)) AND
            (lifecycle_phase NOT IN ('terminal', 'paused', 'submission_unknown') OR next_poll_at IS NULL) AND
            (deleted_at IS NULL OR (next_poll_at IS NULL AND lease_token IS NULL))
        );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS generation_tasks_live_history_idx
    ON generation_tasks (media_type, created_at DESC, task_id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS generation_tasks_due_idx
    ON generation_tasks (next_poll_at, task_id) WHERE deleted_at IS NULL AND next_poll_at IS NOT NULL;
INSERT INTO generation_task_schema (singleton, version) VALUES (TRUE, 2)
    ON CONFLICT (singleton) DO UPDATE SET version = EXCLUDED.version;
COMMIT;
