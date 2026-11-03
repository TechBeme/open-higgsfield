import "server-only";

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { AnyTask, MediaType } from "@/types";
import { normalizeTask, publicTask, taskPayload, type NewTaskRecord, type TaskCursor, type TaskRecord } from "@/server/tasks/record";
import { boundedSignal, withSignal } from "@/server/tasks/runtime";
import type { GalleryPatch } from "./gallery";

let sqlClient: NeonQueryFunction<false, false> | undefined;
let schemaVerified = false;

export function isDatabaseConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL) && process.env.NEXT_PHASE !== "phase-production-build";
}

async function query(statement: string, values: unknown[] = [], parent?: AbortSignal): Promise<Record<string, unknown>[]> {
    const signal = boundedSignal(10_000, parent);
    try {
        sqlClient ??= neon(process.env.DATABASE_URL!);
        return await withSignal(signal, () => sqlClient!.query(statement, values, { fetchOptions: { signal } }));
    } catch { throw new Error(signal.aborted ? "ERR_TASK_STORAGE_TIMEOUT" : "ERR_TASK_STORAGE_UNAVAILABLE"); }
}

export async function ensureTaskSchema(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (schemaVerified) return;
    let rows: Record<string, unknown>[];
    try { rows = await query("SELECT version FROM generation_task_schema WHERE singleton = TRUE", [], signal); }
    catch (error) { if (signal?.aborted) throw error; throw new Error("ERR_TASK_SCHEMA_REQUIRED"); }
    if (Number(rows[0]?.version) !== 2) throw new Error("ERR_TASK_SCHEMA_REQUIRED");
    schemaVerified = true;
}

function record(row: Record<string, unknown>): TaskRecord {
    const timestamp = (value: unknown) => value ? new Date(String(value)).toISOString() : null;
    const payload = row.payload as AnyTask;
    const task = {
        ...payload,
        task_id: String(row.task_id),
        status: String(row.status), created_at: timestamp(row.created_at)!,
        revision: Number(row.revision), lifecycle_phase: row.lifecycle_phase as TaskRecord["lifecycle_phase"],
        next_poll_at: timestamp(row.next_poll_at), deadline_at: timestamp(row.deadline_at),
        poll_failures: Number(row.poll_failures), lease_token: row.lease_token as string | null,
        lease_expires_at: timestamp(row.lease_expires_at), deleted_at: timestamp(row.deleted_at),
    };
    if (!payload || !["image", "video"].includes(row.media_type as string) || payload.media_type !== row.media_type) {
        throw new Error("ERR_TASK_STORAGE_CORRUPT");
    }
    return normalizeTask(task);
}

const PUBLIC_COLUMNS = `task_id, media_type, status, created_at, revision, lifecycle_phase,
    payload->'gallery' AS gallery,
    LEFT(payload->>'model_id', 200) AS model_id,
    LEFT(payload->>'prompt', 8000) AS prompt,
    LEFT(payload->>'error_message', 300) AS error_message,
    CASE WHEN octet_length((payload->'params')::text) <= 8192 THEN payload->'params' END AS params,
    CASE WHEN octet_length((payload->'reuse_state')::text) <= 8192 THEN payload->'reuse_state' END AS reuse_state,
    CASE WHEN media_type = 'video' THEN
        CASE WHEN COALESCE(payload->>'video_path', '') <> '' OR
            (jsonb_typeof(payload->'video_urls') = 'array' AND jsonb_array_length(payload->'video_urls') > 0)
            THEN 1 ELSE 0 END
        ELSE LEAST(16, GREATEST(
            CASE WHEN jsonb_typeof(payload->'result_paths') = 'array' THEN jsonb_array_length(payload->'result_paths') ELSE 0 END,
            CASE WHEN jsonb_typeof(payload->'result_urls') = 'array' THEN jsonb_array_length(payload->'result_urls') ELSE 0 END))
    END AS result_count`;

function publicRow(row: Record<string, unknown>): AnyTask {
    return publicTask({ ...row, created_at: new Date(String(row.created_at)).toISOString(),
        revision: Number(row.revision), result_count: Number(row.result_count), has_download: Number(row.result_count) > 0 } as unknown as AnyTask);
}

export async function readPersistedTask(id: string): Promise<TaskRecord | undefined> {
    await ensureTaskSchema();
    const rows = await query("SELECT * FROM generation_tasks WHERE task_id = $1 AND deleted_at IS NULL", [id]);
    return rows[0] ? record(rows[0]) : undefined;
}

export async function readPublicPersistedTask(id: string): Promise<AnyTask | undefined> {
    await ensureTaskSchema();
    const rows = await query(`SELECT ${PUBLIC_COLUMNS} FROM generation_tasks WHERE task_id = $1 AND deleted_at IS NULL`, [id]);
    return rows[0] ? publicRow(rows[0]) : undefined;
}

export async function listPersistedTasks(media: MediaType, limit: number, cursor: TaskCursor | null): Promise<AnyTask[]> {
    await ensureTaskSchema();
    const rank = `COALESCE((SELECT MIN(value::double precision) FROM jsonb_each_text(payload->'gallery'->'order')), -EXTRACT(EPOCH FROM created_at)::double precision * 1000)`;
    const rows = await query(`SELECT ${PUBLIC_COLUMNS} FROM generation_tasks
        WHERE media_type = $1 AND deleted_at IS NULL
        AND ($2::double precision IS NULL OR ${rank} > $2 OR (${rank} = $2 AND (created_at, task_id) < ($3::timestamptz, $4::text)))
        ORDER BY ${rank}, created_at DESC, task_id DESC LIMIT $5`, [media, cursor ? cursor.order ?? -Date.parse(cursor.createdAt) : null, cursor?.createdAt ?? null, cursor?.taskId ?? null, limit + 1]);
    return rows.map(publicRow);
}

export async function applyPersistedGallery(patches: GalleryPatch[]): Promise<boolean> {
    await ensureTaskSchema();
    const rows = await query(`WITH changes AS MATERIALIZED (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id text, revision bigint, gallery jsonb, remove boolean)
    ), locked AS MATERIALIZED (
        SELECT t.task_id, t.revision, t.deleted_at FROM generation_tasks t JOIN changes c ON c.id = t.task_id
        ORDER BY t.task_id FOR UPDATE OF t
    ), valid AS (
        SELECT COUNT(*) = (SELECT COUNT(*) FROM changes) AS ok FROM locked l JOIN changes c ON c.id = l.task_id
        WHERE l.deleted_at IS NULL AND l.revision = c.revision
    ) UPDATE generation_tasks t SET
        payload = CASE WHEN c.remove THEN jsonb_build_object('task_id', t.task_id, 'media_type', t.media_type, 'model_id', '', 'created_at', t.created_at)
            ELSE jsonb_set(t.payload, '{gallery}', c.gallery) END, revision = t.revision + 1, updated_at = NOW(),
        deleted_at = CASE WHEN c.remove THEN NOW() ELSE t.deleted_at END,
        status = CASE WHEN c.remove THEN 'CANCELLED' ELSE t.status END,
        lifecycle_phase = CASE WHEN c.remove THEN 'terminal' ELSE t.lifecycle_phase END,
        next_poll_at = CASE WHEN c.remove THEN NULL ELSE t.next_poll_at END,
        lease_token = CASE WHEN c.remove THEN NULL ELSE t.lease_token END,
        lease_expires_at = CASE WHEN c.remove THEN NULL ELSE t.lease_expires_at END
        FROM changes c WHERE t.task_id = c.id AND (SELECT ok FROM valid) RETURNING t.task_id`, [JSON.stringify(patches)]);
    return rows.length === patches.length;
}

/** Bounded metadata projection: bulk gallery edits never read full base64 media payloads. */
export async function readGalleryTasks(ids: string[]): Promise<TaskRecord[]> {
    await ensureTaskSchema();
    const rows = await query(`SELECT ${PUBLIC_COLUMNS} FROM generation_tasks WHERE task_id = ANY($1::text[]) AND deleted_at IS NULL`, [ids]);
    return rows.map(row => ({ ...publicRow(row), revision: Number(row.revision), deleted_at: null } as TaskRecord));
}

export async function createPersistedTask(task: NewTaskRecord, signal?: AbortSignal): Promise<TaskRecord> {
    await ensureTaskSchema(signal);
    const rows = await query(`INSERT INTO generation_tasks
        (task_id, media_type, status, payload, created_at, lifecycle_phase, next_poll_at, deadline_at,
         poll_failures, lease_token, lease_expires_at)
        VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6, $7::timestamptz, $8::timestamptz, $9, $10, $11::timestamptz)
        ON CONFLICT (task_id) DO NOTHING RETURNING *`, [
        task.task_id, task.media_type, task.status, JSON.stringify(taskPayload({ ...task, revision: 1 } as TaskRecord)),
        task.created_at, task.lifecycle_phase, task.next_poll_at, task.deadline_at, task.poll_failures,
        task.lease_token, task.lease_expires_at,
    ], signal);
    if (!rows[0]) throw new Error("ERR_TASK_ID_CONFLICT");
    return record(rows[0]);
}

export async function updatePersistedTask(task: TaskRecord, releaseLease = true, signal?: AbortSignal): Promise<TaskRecord | undefined> {
    await ensureTaskSchema(signal);
    const rows = await query(`UPDATE generation_tasks SET
        payload = $4::jsonb, status = $5, lifecycle_phase = $6,
        next_poll_at = $7::timestamptz, deadline_at = $8::timestamptz, poll_failures = $9,
        lease_token = CASE WHEN $10::boolean THEN NULL ELSE lease_token END,
        lease_expires_at = CASE WHEN $10::boolean THEN NULL ELSE lease_expires_at END,
        revision = revision + 1, updated_at = NOW()
        WHERE task_id = $1 AND revision = $2::bigint AND deleted_at IS NULL
        AND lifecycle_phase <> 'terminal'
        AND lease_token IS NOT DISTINCT FROM $3::text
        AND (lease_token IS NULL OR lease_expires_at > NOW()) RETURNING *`, [
        task.task_id, task.revision, task.lease_token, JSON.stringify(taskPayload(task)), task.status,
        task.lifecycle_phase, task.next_poll_at, task.deadline_at, task.poll_failures, releaseLease,
    ], signal);
    return rows[0] ? record(rows[0]) : undefined;
}

export async function deletePersistedTask(id: string): Promise<boolean> {
    await ensureTaskSchema();
    const rows = await query(`UPDATE generation_tasks SET deleted_at = NOW(), revision = revision + 1,
        payload = jsonb_build_object('task_id', task_id, 'media_type', media_type, 'model_id', '', 'created_at', created_at),
        status = 'CANCELLED', lifecycle_phase = 'terminal', next_poll_at = NULL,
        lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
        WHERE task_id = $1 AND deleted_at IS NULL RETURNING task_id`, [id]);
    return rows.length === 1;
}

export async function claimPersistedTask(token: string, leaseMs: number, id?: string, signal?: AbortSignal): Promise<TaskRecord | undefined> {
    await ensureTaskSchema(signal);
    const rows = await query(`WITH candidate AS (
        SELECT task_id FROM generation_tasks WHERE deleted_at IS NULL
        AND lifecycle_phase IN ('submitting', 'polling', 'materializing')
        AND next_poll_at <= NOW() AND (lease_expires_at IS NULL OR lease_expires_at <= NOW())
        AND ($3::text IS NULL OR task_id = $3)
        ORDER BY next_poll_at, task_id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE generation_tasks AS task SET lease_token = $1,
        lease_expires_at = NOW() + $2::bigint * INTERVAL '1 millisecond',
        revision = task.revision + 1, updated_at = NOW()
        FROM candidate WHERE task.task_id = candidate.task_id RETURNING task.*`, [token, leaseMs, id ?? null], signal);
    return rows[0] ? record(rows[0]) : undefined;
}
