import fs from "fs/promises";
import path from "path";
import type { AnyTask, VideoTask, ImageTask } from "@/types";
import { resumePendingTasks } from "@/lib/poller";
import { STORAGE_ROOT } from "@/lib/storage-paths";

const TASKS_FILE = path.join(STORAGE_ROOT, "tasks_history.json");

type TaskEntry = AnyTask & { events: NonNullable<AnyTask["events"]>; _done: boolean };

// Use global to ensure a single shared instance across Next.js route-handler bundles,
// which each compile shared modules independently in development.
const g = global as typeof globalThis & {
    __taskMemStore?: Map<string, TaskEntry>;
    __taskInitPromise?: Promise<void>;
};
if (!g.__taskMemStore) g.__taskMemStore = new Map<string, TaskEntry>();
const memStore = g.__taskMemStore;

const SAVE_FIELDS: (keyof AnyTask)[] = [
    "task_id", "status", "provider_id", "provider_model_id", "provider_task_id", "provider_operation",
    "freepik_task_id", "freepik_status",
    "prompt", "params", "model_id", "poll_url",
    "created_at", "media_type", "response_style", "result_paths", "result_urls",
    "reuse_state", "error_message",
];
const VIDEO_SAVE_FIELDS: (keyof VideoTask)[] = ["video_path", "video_urls", "image_url"];

function buildLocalImageUrls(taskId: string, resultPaths?: string[]): string[] {
    if (!resultPaths || resultPaths.length === 0) return [];
    return resultPaths.map((_, i) => `/api/download/${taskId}?index=${i}`);
}

export async function saveTasks(): Promise<void> {
    const snapshot = [...memStore.values()].map((t) => {
        const out: Record<string, unknown> = {};
        for (const k of SAVE_FIELDS) {
            if (k in t) out[k] = (t as unknown as Record<string, unknown>)[k];
        }

        if (t.media_type === "image") {
            const imageTask = t as ImageTask;
            // Persist local URLs so history does not depend on expiring CDN links.
            out.result_urls = buildLocalImageUrls(t.task_id, imageTask.result_paths);
        }

        if (t.media_type === "video") {
            for (const k of VIDEO_SAVE_FIELDS) {
                const v = t as VideoTask;
                if (k in v) out[k] = (v as unknown as Record<string, unknown>)[k];
            }
        }
        return out;
    });

    const tmp = TASKS_FILE + ".tmp";
    try {
        await fs.mkdir(path.dirname(TASKS_FILE), { recursive: true });
        await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2));
        await fs.rename(tmp, TASKS_FILE);
    } catch {
        // rename can fail across fs boundaries in some environments — fall back to direct write
        try { await fs.unlink(tmp); } catch { /* ignore */ }
        await fs.writeFile(TASKS_FILE, JSON.stringify(snapshot, null, 2));
    }
}

export async function loadTasks(): Promise<Map<string, AnyTask & { events: NonNullable<AnyTask["events"]>; _done: boolean }>> {
    try {
        const raw = await fs.readFile(TASKS_FILE, "utf-8");
        const rows: AnyTask[] = JSON.parse(raw);
        for (const row of rows) {
            const tid = row.task_id;
            if (!tid) continue;

            // Migrate historical image rows to local persisted URLs.
            if (row.media_type === "image") {
                row.result_urls = buildLocalImageUrls(tid, row.result_paths);
            }

            const status = row.status ?? row.freepik_status ?? "";
            row.status = status;
            const isDone = ["COMPLETED", "FAILED", "ERROR", "CANCELLED"].includes(status);
            const events: NonNullable<AnyTask["events"]> = [];

            if (status === "COMPLETED") {
                if (row.media_type === "image") {
                    events.push({ type: "completed", media_type: "image", result_urls: row.result_urls ?? [], has_download: !!(row.result_paths?.length) });
                } else {
                    const vt = row as VideoTask;
                    events.push({ type: "completed", video_urls: vt.video_urls ?? [], has_download: !!vt.video_path });
                }
            } else if (["FAILED", "ERROR", "CANCELLED"].includes(status)) {
                events.push({ type: "failed", status, message: row.error_message });
            }

            memStore.set(tid, { ...row, events, _done: isDone });
        }
    } catch {
        // File doesn't exist yet — start fresh
    }
    return memStore;
}

export function getStore() {
    return memStore;
}

export function getTask(taskId: string) {
    return memStore.get(taskId);
}

export function setTask(task: AnyTask & { events: NonNullable<AnyTask["events"]>; _done: boolean }) {
    memStore.set(task.task_id, task);
}

export function deleteTask(taskId: string) {
    memStore.delete(taskId);
}

export function pushEvent(taskId: string, event: NonNullable<AnyTask["events"]>[number]) {
    const task = memStore.get(taskId);
    if (!task) return;
    task.events.push(event);
    if (["completed", "failed", "timeout", "error"].includes(event.type)) {
        task._done = true;
    }
    // Async fire-and-forget save
    saveTasks().catch((e) => console.error("[task-store] save error:", e));
}

export function getVideoTasks(): VideoTask[] {
    return [...memStore.values()]
        .filter((t) => t.media_type === "video")
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) as VideoTask[];
}

export function getImageTasks(): ImageTask[] {
    return [...memStore.values()]
        .filter((t) => t.media_type === "image")
        .map((t) => {
            const imageTask = t as ImageTask;
            return {
                ...imageTask,
                result_urls: buildLocalImageUrls(imageTask.task_id, imageTask.result_paths),
            };
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) as ImageTask[];
}

// Eagerly load persisted tasks once per process. Routes can await initStore()
// to ensure the JSON is hydrated before responding.
if (!g.__taskInitPromise) {
    g.__taskInitPromise = loadTasks()
        .then(() => {
            // Resume polling for any tasks that were in-flight when the process died
            const pending = [...memStore.values()]
                .filter((t) => !t._done && (t.provider_operation || t.poll_url))
                .map((t) => ({ task_id: t.task_id }));
            if (pending.length > 0) {
                resumePendingTasks(pending);
            }
        })
        .catch((e) => console.error("[task-store] load error:", e));
}
export function initStore(): Promise<void> {
    return g.__taskInitPromise!;
}
