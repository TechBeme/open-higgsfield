import "server-only";

import type { TaskRecord } from "./store";
import { boundedSignal, withSignal } from "./runtime";

export const WORKFLOW_ACTIVATION_MS = 60_000;

/** Pass scheduling identifiers only; never serialize prompts, media or keys. */
export async function startTaskWorkflow(task: TaskRecord, options: { minimumRevision?: number; signal?: AbortSignal } = {}): Promise<void> {
    const signal = boundedSignal(25_000, options.signal);
    try {
        await withSignal(signal, async () => {
            const { start } = await import("workflow/api");
            const { generationWorkflow } = await import("@/workflows/generation");
            signal.throwIfAborted();
            await start(generationWorkflow, [{ taskId: task.task_id, minimumRevision: options.minimumRevision ?? 0,
                activationExpiresAt: Date.now() + WORKFLOW_ACTIVATION_MS,
                expiresAt: Date.parse(task.deadline_at ?? task.created_at) + 300_000 }]);
        });
    } catch { throw new Error("ERR_WORKFLOW_DISPATCH_FAILED"); }
}
