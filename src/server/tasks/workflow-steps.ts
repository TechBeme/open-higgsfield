import "server-only";

import { randomUUID } from "node:crypto";
import { RetryableError } from "workflow";
import { claimTask, getTask, initStore, updateTask } from "./store";
import { processDueTasks } from "./poller";
import { safeErrorCode } from "./runtime";
import { assertAssetId } from "@/server/media/storage";

export interface GenerationWorkflowInput {
    taskId: string;
    minimumRevision: number;
    activationExpiresAt: number;
    expiresAt: number;
}

export function workflowPollInterval(createdAt: string, now = Date.now()): number {
    const elapsed = now - Date.parse(createdAt);
    return elapsed < 120_000 ? 10_000 : elapsed < 600_000 ? 20_000
        : elapsed < 3_600_000 ? 30_000 : elapsed < 86_400_000 ? 120_000 : 600_000;
}

/** Every replay rereads and claims SQL state; completed steps expose no task payload. */
export async function advanceGeneration(input: GenerationWorkflowInput): Promise<number | null> {
    "use step";
    assertAssetId(input.taskId);
    try {
        await initStore();
        let task = await getTask(input.taskId);
        if (!task || task.lifecycle_phase === "terminal") return null;
        const now = Date.now();
        if (task.revision < input.minimumRevision) {
            return now < input.activationExpiresAt ? Math.min(now + 2_000, input.activationExpiresAt) : null;
        }
        if (["paused", "submission_unknown"].includes(task.lifecycle_phase)) return null;
        if (task.lifecycle_phase === "queued" && !task.submission_ready) {
            if (now < input.activationExpiresAt) return Math.min(now + 2_000, input.activationExpiresAt);
            await updateTask({ ...task, lifecycle_phase: "terminal", status: "ERROR", freepik_status: "ERROR", next_poll_at: null,
                submission_media: undefined, submission_ready: undefined, error_message: "ERR_WORKFLOW_DISPATCH_FAILED" });
            return null;
        }
        await processDueTasks({ taskId: input.taskId, limit: 1, budgetMs: 240_000 });
        task = await getTask(input.taskId);
        if (!task || ["terminal", "paused", "submission_unknown"].includes(task.lifecycle_phase)) return null;
        return Math.max(Date.now() + workflowPollInterval(task.created_at),
            Date.parse(task.next_poll_at ?? task.created_at), task.lease_expires_at ? Date.parse(task.lease_expires_at) + 250 : 0);
    } catch (error) {
        // Do not serialize raw SQL/SDK errors (which may include secrets) into
        // Workflow events. Durable sleep retries even through long outages.
        console.warn("[task-workflow] observation deferred", { task_id: input.taskId, code: safeErrorCode(error, "ERR_TASK_STORAGE_UNAVAILABLE") });
        return Date.now() + 60_000;
    }
}

export async function expireGeneration(taskId: string): Promise<void> {
    "use step";
    try {
        let task = await getTask(taskId);
        if (!task || ["terminal", "paused", "submission_unknown"].includes(task.lifecycle_phase)) return;
        // A resumed task has a newer observation deadline; an older run must
        // not pause it. Reclaim expired leases before any final write.
        if (task.deadline_at && Date.parse(task.deadline_at) > Date.now()) return;
        const retry = () => new RetryableError("ERR_TASK_FINALIZATION_BUSY", {
            retryAfter: new Date(Math.max(Date.now() + 2_000, task?.lease_expires_at ? Date.parse(task.lease_expires_at) + 250 : 0)),
        });
        if (task.lifecycle_phase !== "queued" || task.submission_ready) {
            const claimed = await claimTask(randomUUID(), 60_000, taskId);
            if (!claimed) throw retry();
            task = claimed;
            if (task.deadline_at && Date.parse(task.deadline_at) > Date.now()) {
                await updateTask(task);
                return;
            }
        }
        const queued = task.lifecycle_phase === "queued";
        const submitting = task.lifecycle_phase === "submitting";
        const updated = await updateTask({ ...task, status: "ERROR", freepik_status: "ERROR",
            lifecycle_phase: queued ? "terminal" : submitting ? "submission_unknown" : "paused",
            next_poll_at: null, submission_media: undefined, submission_ready: undefined,
            error_message: queued ? "ERR_GENERATION_QUEUE_EXPIRED" : submitting ? "ERR_SUBMISSION_OUTCOME_UNKNOWN" : "ERR_POLLING_PAUSED_UPSTREAM_STATUS_UNKNOWN" });
        if (!updated) throw retry();
    } catch (error) {
        if (error instanceof RetryableError) throw error;
        throw new Error("ERR_TASK_STORAGE_UNAVAILABLE");
    }
}
