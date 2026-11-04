BEGIN;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM generation_task_schema WHERE singleton = TRUE AND version IN (2, 3)) THEN
        RAISE EXCEPTION 'Apply task lifecycle migration 0001 before workflow migration';
    END IF;
END $$;
ALTER TABLE generation_tasks DROP CONSTRAINT IF EXISTS generation_tasks_lifecycle_check;
ALTER TABLE generation_tasks ADD CONSTRAINT generation_tasks_lifecycle_check CHECK (
    revision > 0 AND poll_failures >= 0 AND
    lifecycle_phase IN ('queued', 'submitting', 'polling', 'materializing', 'paused', 'submission_unknown', 'terminal') AND
    ((lease_token IS NULL) = (lease_expires_at IS NULL)) AND
    (lifecycle_phase NOT IN ('terminal', 'paused', 'submission_unknown') OR next_poll_at IS NULL) AND
    (deleted_at IS NULL OR (next_poll_at IS NULL AND lease_token IS NULL))
);
UPDATE generation_task_schema SET version = 3 WHERE singleton = TRUE;
COMMIT;
