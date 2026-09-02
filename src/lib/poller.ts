/** Provider-neutral background polling for asynchronous generation tasks. */
import { attachGeneratedAssets } from "@/lib/generated-assets";
import { publicErrorMessage } from "@/lib/public-error";
import { getTask, pushEvent, saveTasks } from "@/lib/task-store";
import { getProvider } from "@/providers/registry";
import type { ProviderId } from "@/providers/types";
import type { VideoTask } from "@/types";

const g = global as typeof globalThis & { __activePollers?: Map<string, NodeJS.Timeout> };
if (!g.__activePollers) g.__activePollers = new Map<string, NodeJS.Timeout>();
const activePollers = g.__activePollers;

function setStatus(taskId: string, status: string) {
    const task = getTask(taskId);
    if (!task) return;
    task.status = status;
    // Keep old clients and persisted histories compatible during the migration.
    task.freepik_status = status;
}

async function pollOnce(taskId: string, elapsed: number): Promise<"continue" | "done"> {
    const task = getTask(taskId);
    if (!task) return "done";

    try {
        const providerId = (task.provider_id ?? "freepik") as ProviderId;
        const operation = task.provider_operation ?? (task.poll_url ? { pollUrl: task.poll_url } : undefined);
        if (!operation) throw new Error("ERR_MISSING_PROVIDER_OPERATION");

        const result = await getProvider(providerId).poll({
            mediaType: task.media_type,
            providerModelId: task.provider_model_id ?? task.model_id,
            operation,
        });

        if (result.operation !== undefined) task.provider_operation = result.operation;
        setStatus(taskId, result.status);
        pushEvent(taskId, { type: "status", status: result.status, elapsed });

        if (result.status === "COMPLETED") {
            await attachGeneratedAssets(task, result.assets);
            if (task.media_type === "image") {
                pushEvent(taskId, {
                    type: "completed",
                    media_type: "image",
                    result_urls: task.result_urls ?? [],
                    result_count: task.result_urls?.length ?? 0,
                    has_download: !!task.result_paths?.length,
                });
            } else {
                const videoTask = task as VideoTask;
                pushEvent(taskId, {
                    type: "completed",
                    video_urls: videoTask.video_urls ?? [],
                    has_download: !!videoTask.video_path,
                });
            }
            return "done";
        }

        if (result.status === "FAILED" || result.status === "ERROR" || result.status === "CANCELLED") {
            task.error_message = result.error;
            pushEvent(taskId, { type: "failed", status: result.status, message: result.error });
            return "done";
        }

        return "continue";
    } catch (error) {
        const message = publicErrorMessage(error);
        task.error_message = message;
        setStatus(taskId, "ERROR");
        pushEvent(taskId, { type: "error", status: "ERROR", message });
        return "done";
    }
}

export function startPolling(taskId: string) {
    let elapsed = 0;
    const maxElapsed = 900;

    const run = async () => {
        if (elapsed >= maxElapsed) {
            setStatus(taskId, "FAILED");
            pushEvent(taskId, { type: "timeout", status: "FAILED", message: "Generation timed out" });
            activePollers.delete(taskId);
            await saveTasks();
            return;
        }

        const result = await pollOnce(taskId, elapsed);
        if (result === "done") {
            activePollers.delete(taskId);
            await saveTasks();
            return;
        }

        elapsed += 10;
        const timeout = setTimeout(run, 10_000);
        activePollers.set(taskId, timeout);
    };

    const timeout = setTimeout(run, 3_000);
    activePollers.set(taskId, timeout);
}

export function stopPolling(taskId: string) {
    const timeout = activePollers.get(taskId);
    if (timeout) clearTimeout(timeout);
    activePollers.delete(taskId);
}

export function isPolling(taskId: string): boolean {
    return activePollers.has(taskId);
}

export function resumePendingTasks(pendingTasks: Array<{ task_id: string }>) {
    for (const task of pendingTasks) {
        if (!activePollers.has(task.task_id)) startPolling(task.task_id);
    }
}
