import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { AnyTask } from "@/types";

type SqlClient = NeonQueryFunction<false, false>;

let sqlClient: SqlClient | null = null;
let schemaPromise: Promise<void> | null = null;

export function isDatabaseConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL) && process.env.NEXT_PHASE !== "phase-production-build";
}

function getSql(): SqlClient {
    if (sqlClient) return sqlClient;
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
    sqlClient = neon(databaseUrl);
    return sqlClient;
}

async function ensureSchema(): Promise<void> {
    if (!isDatabaseConfigured()) return;
    if (!schemaPromise) {
        schemaPromise = (async () => {
            const sql = getSql();
            await sql`
                DO $$
                BEGIN
                    CREATE TABLE generation_tasks (
                        task_id TEXT PRIMARY KEY,
                        media_type TEXT NOT NULL,
                        status TEXT NOT NULL,
                        payload JSONB NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                EXCEPTION
                    WHEN duplicate_table OR unique_violation THEN NULL;
                END
                $$
            `;
            await sql`
                DO $$
                BEGIN
                    CREATE INDEX generation_tasks_created_at_idx
                    ON generation_tasks (created_at DESC);
                EXCEPTION
                    WHEN duplicate_table OR duplicate_object OR unique_violation THEN NULL;
                END
                $$
            `;
        })();
    }
    await schemaPromise;
}

export async function loadPersistedTasks(): Promise<AnyTask[]> {
    if (!isDatabaseConfigured()) return [];
    await ensureSchema();
    const rows = await getSql()`
        SELECT payload
        FROM generation_tasks
        ORDER BY created_at DESC
    `;
    return rows.map((row) => row.payload as AnyTask);
}

export async function persistTasks(tasks: AnyTask[]): Promise<void> {
    if (!isDatabaseConfigured()) return;
    await ensureSchema();
    const sql = getSql();
    await Promise.all(tasks.map((task) => sql`
        INSERT INTO generation_tasks (task_id, media_type, status, payload, created_at, updated_at)
        VALUES (
            ${task.task_id},
            ${task.media_type},
            ${task.status ?? task.freepik_status ?? "CREATED"},
            ${JSON.stringify(task)}::jsonb,
            ${task.created_at},
            NOW()
        )
        ON CONFLICT (task_id) DO UPDATE SET
            media_type = EXCLUDED.media_type,
            status = EXCLUDED.status,
            payload = EXCLUDED.payload,
            updated_at = NOW()
    `));
}

export async function deletePersistedTask(taskId: string): Promise<void> {
    if (!isDatabaseConfigured()) return;
    await ensureSchema();
    await getSql()`DELETE FROM generation_tasks WHERE task_id = ${taskId}`;
}
