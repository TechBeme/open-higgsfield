import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AnyTask, MediaType } from "@/types";
import { STORAGE_ROOT } from "@/lib/storage-paths";
import { claimPersistedTask, createPersistedTask, deletePersistedTask, ensureTaskSchema, isDatabaseConfigured,
    listPersistedTasks, readPersistedTask, readPublicPersistedTask, updatePersistedTask } from "@/lib/database";
import { compareTaskOrder, hasOperation, isDue, makePage, normalizeTask, pageOptions, publicTask,
    type NewTaskRecord, type TaskPage, type TaskRecord } from "@/lib/task-record";
import { observationDeadline, withSignal } from "@/lib/task-runtime";

export type { TaskRecord, NewTaskRecord } from "@/lib/task-record";
const TASKS_FILE = path.join(STORAGE_ROOT, "tasks_history.json");
interface FileState { rows: Map<string, TaskRecord>; ready?: Promise<void>; queue: Promise<unknown> }
const shared = globalThis as typeof globalThis & { __durableTaskFiles?: Map<string, FileState> };
shared.__durableTaskFiles ??= new Map();
if (!shared.__durableTaskFiles.has(TASKS_FILE)) shared.__durableTaskFiles.set(TASKS_FILE, { rows: new Map(), queue: Promise.resolve() });
const file = shared.__durableTaskFiles.get(TASKS_FILE)!;

async function initFile(): Promise<void> {
    file.ready ??= (async () => {
        let raw: string;
        try { raw = await fs.readFile(TASKS_FILE, "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw new Error("ERR_TASK_STORAGE_UNAVAILABLE"); }
        try {
            const value = JSON.parse(raw);
            const rows = Array.isArray(value) ? value : value.version === 2 ? value.tasks : undefined;
            if (!Array.isArray(rows)) throw new Error();
            const normalized = rows.map((task) => {
                if (!task || typeof task.task_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(task.task_id) ||
                    !["image", "video"].includes(task.media_type) || !Number.isFinite(Date.parse(task.created_at))) throw new Error();
                return normalizeTask(task);
            });
            file.rows = new Map(normalized.map((task) => [task.task_id, task]));
        } catch { throw new Error("ERR_TASK_HISTORY_CORRUPT"); }
    })().catch((error) => { file.ready = undefined; throw error; });
    await file.ready;
}

export async function initStore(): Promise<void> {
    if (isDatabaseConfigured()) await ensureTaskSchema();
    else await initFile();
}

async function waitFor<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    return signal ? withSignal(signal, operation) : operation();
}

async function writeFile(rows: Map<string, TaskRecord>, signal?: AbortSignal): Promise<void> {
    const temp = `${TASKS_FILE}.${randomUUID()}.tmp`;
    try {
        await waitFor(signal, () => fs.mkdir(path.dirname(TASKS_FILE), { recursive: true }));
        signal?.throwIfAborted();
        const handle = await fs.open(temp, "wx", 0o600);
        try {
            await waitFor(signal, () => handle.writeFile(JSON.stringify({ version: 2, tasks: [...rows.values()] })));
            await waitFor(signal, () => handle.sync());
        }
        finally { await handle.close(); }
        await waitFor(signal, () => fs.rename(temp, TASKS_FILE));
        signal?.throwIfAborted();
        const directory = await fs.open(path.dirname(TASKS_FILE), "r");
        try { await waitFor(signal, () => directory.sync()); } finally { await directory.close(); }
    } catch {
        await fs.unlink(temp).catch(() => undefined);
        throw new Error("ERR_TASK_STORAGE_UNAVAILABLE");
    }
}

async function mutateFile<T>(change: (rows: Map<string, TaskRecord>) => T | undefined, signal?: AbortSignal): Promise<T | undefined> {
    await waitFor(signal, initFile);
    const pending = file.queue.then(async () => {
        await waitFor(signal, initFile);
        signal?.throwIfAborted();
        const rows = structuredClone(file.rows);
        const value = change(rows);
        if (value !== undefined) {
            try { await writeFile(rows, signal); signal?.throwIfAborted(); file.rows = rows; }
            catch (error) { file.ready = undefined; throw error; }
        }
        return structuredClone(value);
    });
    file.queue = pending.catch(() => undefined);
    return waitFor(signal, () => pending);
}

export async function getTask(id: string): Promise<TaskRecord | undefined> {
    if (isDatabaseConfigured()) return readPersistedTask(id);
    await file.queue; await initFile();
    const task = file.rows.get(id);
    return task && !task.deleted_at ? structuredClone(task) : undefined;
}

export async function getPublicTask(id: string): Promise<AnyTask | undefined> {
    if (isDatabaseConfigured()) return readPublicPersistedTask(id);
    const task = await getTask(id);
    return task ? publicTask(task) : undefined;
}

export async function createTask(task: NewTaskRecord, options: { signal?: AbortSignal } = {}): Promise<TaskRecord> {
    if (isDatabaseConfigured()) return createPersistedTask(task, options.signal);
    return (await mutateFile((rows) => {
        if (rows.has(task.task_id)) throw new Error("ERR_TASK_ID_CONFLICT");
        const result = normalizeTask({ ...task, revision: 1 } as TaskRecord);
        rows.set(task.task_id, result);
        return result;
    }, options.signal))!;
}

export async function updateTask(task: TaskRecord, options: { releaseLease?: boolean; signal?: AbortSignal } = {}): Promise<TaskRecord | undefined> {
    const release = options.releaseLease !== false;
    if (isDatabaseConfigured()) return updatePersistedTask(task, release, options.signal);
    return mutateFile((rows) => {
        const current = rows.get(task.task_id);
        if (!current || current.deleted_at || current.lifecycle_phase === "terminal" || current.revision !== task.revision ||
            current.lease_token !== task.lease_token || (current.lease_expires_at && Date.parse(current.lease_expires_at) <= Date.now())) return;
        const result = normalizeTask({ ...task, revision: current.revision + 1,
            lease_token: release ? null : current.lease_token, lease_expires_at: release ? null : current.lease_expires_at });
        rows.set(task.task_id, result);
        return result;
    }, options.signal);
}

export async function deleteTask(id: string): Promise<boolean> {
    if (isDatabaseConfigured()) return deletePersistedTask(id);
    return Boolean(await mutateFile((rows) => {
        const current = rows.get(id);
        if (!current || current.deleted_at) return;
        rows.set(id, { task_id: id, model_id: "", media_type: current.media_type, created_at: current.created_at,
            status: "CANCELLED", revision: current.revision + 1, deleted_at: new Date().toISOString(),
            lifecycle_phase: "terminal", next_poll_at: null, deadline_at: null, poll_failures: 0,
            lease_token: null, lease_expires_at: null, _done: true });
        return true;
    }));
}

export async function claimTask(token: string, leaseMs: number, id?: string, options: { signal?: AbortSignal } = {}): Promise<TaskRecord | undefined> {
    if (isDatabaseConfigured()) return claimPersistedTask(token, leaseMs, id, options.signal);
    return mutateFile((rows) => {
        const now = Date.now();
        const current = [...rows.values()].filter((task) => (!id || task.task_id === id) && isDue(task, now))
            .sort((a, b) => a.next_poll_at!.localeCompare(b.next_poll_at!) || a.task_id.localeCompare(b.task_id))[0];
        if (!current) return;
        const task = { ...current, revision: current.revision + 1, lease_token: token, lease_expires_at: new Date(now + leaseMs).toISOString() };
        rows.set(task.task_id, task);
        return task;
    }, options.signal);
}

export async function listTasks(media: MediaType, options: { limit?: number; cursor?: string } = {}): Promise<TaskPage> {
    const { limit, cursor } = pageOptions(options);
    if (isDatabaseConfigured()) return makePage(await listPersistedTasks(media, limit, cursor), limit);
    await file.queue; await initFile();
    const rows = [...file.rows.values()].filter((task) => !task.deleted_at && task.media_type === media &&
        (!cursor || compareTaskOrder(task, { created_at: cursor.createdAt, task_id: cursor.taskId }) < 0))
        .sort((a, b) => compareTaskOrder(b, a)).slice(0, limit + 1);
    return makePage(rows, limit);
}

export async function resumeTask(id: string): Promise<"resumed" | "missing" | "conflict"> {
    const task = await getTask(id);
    if (!task) return "missing";
    if (task.lifecycle_phase !== "paused" || !hasOperation(task)) return "conflict";
    const updated = await updateTask({ ...task, lifecycle_phase: "polling", status: "IN_PROGRESS", freepik_status: "IN_PROGRESS",
        next_poll_at: new Date().toISOString(), deadline_at: observationDeadline(), poll_failures: 0, error_message: undefined });
    return updated ? "resumed" : "conflict";
}
