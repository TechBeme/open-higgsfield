/** Durable polling: each invocation claims current storage state and never submits generation. */
import { randomUUID } from "node:crypto";
import { attachGeneratedAssets } from "@/lib/generated-assets";
import { claimTask, updateTask, type TaskRecord } from "@/lib/task-store";
import { hasOperation } from "@/lib/task-record";
import { ASSET_TIMEOUT_MS, boundedSignal, localWorkerEnabled, POLL_TIMEOUT_MS, queryRetry,
    safeErrorCode, withSignal, WORKER_LEASE_MS } from "@/lib/task-runtime";
import { getProvider } from "@/providers/registry";

async function persist(task: TaskRecord, signal: AbortSignal, releaseLease = true) {
    return withSignal(signal, () => updateTask(task, { signal, releaseLease }));
}

async function pause(task: TaskRecord, code: string, signal: AbortSignal, unknownSubmission = false): Promise<void> {
    await persist({ ...task, status: "ERROR", freepik_status: "ERROR", next_poll_at: null,
        lifecycle_phase: unknownSubmission ? "submission_unknown" : "paused", error_message: code }, signal);
}

async function processClaim(task: TaskRecord, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (task.lifecycle_phase === "submitting") return pause(task, "ERR_SUBMISSION_OUTCOME_UNKNOWN", signal, true);
    if (!hasOperation(task)) return pause(task, "ERR_ASSET_STORAGE_INCOMPLETE", signal);
    if (task.deadline_at && Date.parse(task.deadline_at) <= Date.now()) return pause(task, "ERR_POLLING_PAUSED_UPSTREAM_STATUS_UNKNOWN", signal);
    let materializing = task.lifecycle_phase === "materializing";
    try {
        const pollSignal = boundedSignal(POLL_TIMEOUT_MS, signal);
        const result = await withSignal(pollSignal, () => getProvider(task.provider_id ?? "freepik").poll({
            mediaType: task.media_type, providerModelId: task.provider_model_id ?? task.model_id,
            operation: task.provider_operation ?? { pollUrl: task.poll_url }, signal: pollSignal,
        }));
        if (result.operation !== undefined) task = { ...task, provider_operation: result.operation };
        if (result.status === "COMPLETED") {
            const pending = await persist({ ...task, status: "IN_PROGRESS", freepik_status: "IN_PROGRESS",
                lifecycle_phase: "materializing", next_poll_at: new Date().toISOString() }, signal, false);
            if (!pending) return;
            task = pending;
            materializing = true;
            const draft = structuredClone(task);
            const assetSignal = boundedSignal(ASSET_TIMEOUT_MS, signal);
            await withSignal(assetSignal, () => attachGeneratedAssets(draft, result.assets, { signal: assetSignal }));
            await persist({ ...draft, status: "COMPLETED", freepik_status: "COMPLETED", lifecycle_phase: "terminal",
                next_poll_at: null, poll_failures: 0, error_message: undefined }, signal);
            return;
        }
        if (result.status === "FAILED" || result.status === "ERROR" || result.status === "CANCELLED") {
            await persist({ ...task, status: result.status, freepik_status: result.status, lifecycle_phase: "terminal",
                next_poll_at: null, error_message: safeErrorCode({ message: result.error }, "ERR_PROVIDER_TASK_FAILED") }, signal);
            return;
        }
        await persist({ ...task, status: result.status, freepik_status: result.status,
            lifecycle_phase: "polling", poll_failures: 0, error_message: undefined,
            next_poll_at: new Date(Date.now() + 10_000 + Math.floor(Math.random() * 2_000)).toISOString() }, signal);
    } catch (error) {
        if (signal.aborted) throw error;
        const code = safeErrorCode(error);
        // A failed storage write has an uncertain outcome; let its lease expire and reread.
        if (["ERR_TASK_STORAGE_UNAVAILABLE", "ERR_TASK_SCHEMA_REQUIRED", "ERR_TASK_STORAGE_TIMEOUT"].includes(code)) throw error;
        const retry = queryRetry(error, task.poll_failures);
        if (!retry.retryable && !materializing) return pause(task, retry.code, signal);
        // If Retry-After exceeds observation time, wake only to pause, never query early.
        const nextAttempt = Math.min(Date.now() + retry.delayMs, task.deadline_at ? Date.parse(task.deadline_at) : 8_640_000_000_000_000);
        await persist({ ...task, lifecycle_phase: materializing ? "materializing" : "polling",
            status: "IN_PROGRESS", freepik_status: "IN_PROGRESS", poll_failures: task.poll_failures + 1,
            error_message: materializing ? "ERR_ASSET_STORAGE_RETRY" : retry.code,
            next_poll_at: new Date(nextAttempt).toISOString() }, signal);
    }
}

export async function processDueTasks(options: { limit?: number; budgetMs?: number; taskId?: string } = {}): Promise<{ claimed: number; processed: number }> {
    const limit = options.limit ?? 4;
    const budgetMs = options.budgetMs ?? 50_000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(budgetMs) || budgetMs < 1_000 || budgetMs > 240_000) {
        throw new Error("ERR_TASK_WORKER_OPTIONS");
    }
    const deadline = Date.now() + budgetMs;
    const signal = boundedSignal(budgetMs);
    const result = { claimed: 0, processed: 0 };
    while (result.claimed < limit && deadline - Date.now() > 500) {
        let task: TaskRecord | undefined;
        try { task = await withSignal(signal, () => claimTask(randomUUID(), WORKER_LEASE_MS, options.taskId, { signal })); }
        catch (error) { if (signal.aborted) break; throw error; }
        if (!task) break;
        result.claimed++;
        try { await processClaim(task, boundedSignal(90_000, signal)); }
        catch (error) {
            if (signal.aborted) break;
            console.error("[task-worker] task processing deferred", { task_id: task.task_id, code: safeErrorCode(error, "ERR_TASK_STORAGE_UNAVAILABLE") });
            throw error;
        }
        result.processed++;
    }
    return result;
}

const shared = globalThis as typeof globalThis & { __taskWorker?: { timer: NodeJS.Timeout; running: boolean } };

export function startLocalWorker(): void {
    if (!localWorkerEnabled() || shared.__taskWorker) return;
    const tick = async () => {
        const worker = shared.__taskWorker;
        if (!worker || worker.running) return;
        worker.running = true;
        try { await processDueTasks(); }
        catch { console.error("[task-worker] durable polling unavailable; next invocation will recover"); }
        finally { worker.running = false; }
    };
    const timer = setInterval(tick, 10_000);
    timer.unref?.();
    shared.__taskWorker = { timer, running: false };
}

export function stopLocalWorker(): void {
    if (shared.__taskWorker) clearInterval(shared.__taskWorker.timer);
    delete shared.__taskWorker;
}
