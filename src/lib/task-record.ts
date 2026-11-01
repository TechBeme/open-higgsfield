import type { AnyTask, TaskEvent } from "@/types";
import { safeErrorCode } from "@/lib/task-runtime";

export type TaskPhase = "submitting" | "polling" | "materializing" | "paused" | "submission_unknown" | "terminal";
export type TaskRecord = AnyTask & {
    revision: number;
    lifecycle_phase: TaskPhase;
    next_poll_at: string | null;
    deadline_at: string | null;
    poll_failures: number;
    lease_token: string | null;
    lease_expires_at: string | null;
    deleted_at: string | null;
};
export type NewTaskRecord = Omit<TaskRecord, "revision">;
export interface TaskCursor { createdAt: string; taskId: string }
export interface TaskPage { tasks: AnyTask[]; nextCursor: string | null }

const STOPPED = new Set<TaskPhase>(["terminal", "paused", "submission_unknown"]);
const TERMINAL = new Set(["COMPLETED", "FAILED", "ERROR", "CANCELLED"]);

export function hasOperation(task: AnyTask): boolean {
    return Boolean(task.provider_operation || task.poll_url);
}

export function assetCount(task: AnyTask): number {
    if (task.media_type === "video") return task.video_path || task.video_urls?.length ? 1 : 0;
    return Math.min(16, Math.max(task.result_paths?.length ?? 0, task.result_urls?.length ?? 0));
}

export function normalizeTask(input: AnyTask & Partial<TaskRecord>): TaskRecord {
    const task = structuredClone(input);
    let status = task.status ?? task.freepik_status ?? "CREATED";
    let phase = task.lifecycle_phase;
    if (!phase) {
        if (status === "COMPLETED" && !assetCount(task)) {
            phase = hasOperation(task) ? "materializing" : "paused";
            status = hasOperation(task) ? "IN_PROGRESS" : "ERROR";
            task.error_message = hasOperation(task) ? undefined : "ERR_ASSET_STORAGE_INCOMPLETE";
        } else if (TERMINAL.has(status)) phase = "terminal";
        else if (hasOperation(task)) phase = "polling";
        else {
            phase = "submission_unknown";
            status = "ERROR";
            task.error_message = "ERR_SUBMISSION_OUTCOME_UNKNOWN";
        }
    }
    const stopped = STOPPED.has(phase);
    return {
        ...task,
        created_at: new Date(task.created_at).toISOString(),
        status,
        freepik_status: status,
        lifecycle_phase: phase,
        revision: task.revision ?? 1,
        next_poll_at: stopped ? null : task.next_poll_at ?? task.created_at,
        deadline_at: task.deadline_at ?? new Date(Date.parse(task.created_at) + 86_400_000).toISOString(),
        poll_failures: task.poll_failures ?? 0,
        lease_token: task.lease_token ?? null,
        lease_expires_at: task.lease_expires_at ?? null,
        deleted_at: task.deleted_at ?? null,
        _done: stopped,
        recovery_required: phase === "paused" || phase === "submission_unknown",
    };
}

export function taskPayload(task: TaskRecord): AnyTask {
    const payload = { ...task } as Record<string, unknown>;
    for (const key of ["revision", "lifecycle_phase", "next_poll_at", "deadline_at", "poll_failures", "lease_token", "lease_expires_at", "deleted_at", "events", "_done", "recovery_required"]) delete payload[key];
    return payload as unknown as AnyTask;
}

function safeNested(value: unknown, depth = 0): unknown {
    if (depth > 6) return undefined;
    if (typeof value === "string") return /^\s*data:/i.test(value) ? undefined : value.slice(0, 2_000);
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (Array.isArray(value)) return value.slice(0, 32).map((item) => safeNested(item, depth + 1)).filter((item) => item !== undefined);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).slice(0, 64)
            .filter(([key]) => !/password|secret|token|operation|(?:^|_)path$/i.test(key))
            .map(([key, item]) => [key.slice(0, 100), safeNested(item, depth + 1)])
            .filter(([, item]) => item !== undefined));
    }
    return undefined;
}

function boundedState(value?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!value || Buffer.byteLength(JSON.stringify(value)) > 8_192) return undefined;
    return safeNested(value) as Record<string, unknown>;
}

// The SQL public projection already excludes large media; this also serves file mode.
export function publicTask(task: AnyTask & { revision?: number; lifecycle_phase?: TaskPhase }): AnyTask {
    const phase = task.lifecycle_phase;
    const count = Math.min(16, Math.max(0, task.result_count ?? assetCount(task)));
    const hasDownload = task.has_download ?? count > 0;
    const status = task.status ?? task.freepik_status ?? "CREATED";
    const base = {
        task_id: task.task_id,
        media_type: task.media_type,
        model_id: task.model_id?.slice(0, 200),
        status,
        freepik_status: status,
        prompt: task.prompt?.slice(0, 8_000),
        created_at: task.created_at,
        params: boundedState(task.params),
        reuse_state: boundedState(task.reuse_state),
        error_message: task.error_message ? safeErrorCode({ message: task.error_message }) : undefined,
        lifecycle_phase: phase,
        recovery_required: phase === "paused" || phase === "submission_unknown",
        _done: phase ? STOPPED.has(phase) : TERMINAL.has(status),
        has_download: hasDownload,
        result_count: count,
        revision: task.revision,
    };
    return task.media_type === "image"
        ? { ...base, media_type: "image", result_urls: Array.from({ length: count }, (_, i) => `/api/download/${encodeURIComponent(task.task_id)}?index=${i}`) }
        : { ...base, media_type: "video", video_urls: hasDownload ? [`/api/download/${encodeURIComponent(task.task_id)}?inline=1`] : [] };
}

export function taskEvent(task: AnyTask): TaskEvent {
    if (task.status === "COMPLETED") return {
        type: "completed", media_type: task.media_type, status: "COMPLETED",
        result_urls: task.result_urls, video_urls: task.media_type === "video" ? task.video_urls : undefined,
        has_download: task.has_download, result_count: task.result_count,
    };
    if (task._done) return { type: task.recovery_required ? "error" : "failed", status: task.status, message: task.error_message };
    return { type: "status", status: task.status, elapsed: Math.max(0, Math.floor((Date.now() - Date.parse(task.created_at)) / 1_000)) };
}

export function pageOptions(options: { limit?: number; cursor?: string } = {}): { limit: number; cursor: TaskCursor | null } {
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("ERR_INVALID_PAGINATION");
    if (!options.cursor) return { limit, cursor: null };
    try {
        if (options.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(options.cursor)) throw new Error();
        const cursor = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8")) as TaskCursor;
        if (typeof cursor.createdAt !== "string" || !Number.isFinite(Date.parse(cursor.createdAt)) ||
            typeof cursor.taskId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(cursor.taskId)) throw new Error();
        return { limit, cursor: { ...cursor, createdAt: new Date(cursor.createdAt).toISOString() } };
    } catch { throw new Error("ERR_INVALID_PAGINATION"); }
}

export function makePage(rows: AnyTask[], limit: number): TaskPage {
    const tasks = rows.slice(0, limit).map(publicTask);
    const last = tasks.at(-1);
    return {
        tasks,
        nextCursor: rows.length > limit && last
            ? Buffer.from(JSON.stringify({ createdAt: last.created_at, taskId: last.task_id })).toString("base64url") : null,
    };
}

export function isDue(task: TaskRecord, now: number): boolean {
    return !task.deleted_at && !STOPPED.has(task.lifecycle_phase) && Boolean(task.next_poll_at) &&
        Date.parse(task.next_poll_at!) <= now && (!task.lease_expires_at || Date.parse(task.lease_expires_at) <= now);
}

export function compareTaskOrder(a: { created_at: string; task_id: string }, b: { created_at: string; task_id: string }): number {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.task_id === b.task_id ? 0 : a.task_id < b.task_id ? -1 : 1;
}

