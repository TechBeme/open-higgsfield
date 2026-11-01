import { randomUUID } from "node:crypto";
import type { CanonicalMediaInputs, CanonicalParams } from "@/models/canonical";
import type { ModelCapabilities } from "@/models/capabilities/types";
import { attachGeneratedAssets } from "@/lib/generated-assets";
import { startLocalWorker } from "@/lib/poller";
import { createTask, updateTask, type NewTaskRecord, type TaskRecord } from "@/lib/task-store";
import { ASSET_TIMEOUT_MS, boundedSignal, localWorkerEnabled, observationDeadline, safeErrorCode,
    SUBMISSION_LEASE_MS, SUBMISSION_TIMEOUT_MS, withSignal } from "@/lib/task-runtime";
import { resolveProvider } from "@/providers/registry";

interface SubmitGenerationInput {
    mediaType: "image" | "video";
    modelId: string;
    capabilities: ModelCapabilities;
    params: CanonicalParams;
    media: CanonicalMediaInputs;
    reuseState?: Record<string, unknown>;
    signal?: AbortSignal;
}

export interface GenerationResponse {
    httpStatus: 200 | 202 | 422;
    task_id: string;
    accepted: boolean;
    recovery_required: boolean;
    error?: string;
}

export async function submitGeneration(input: SubmitGenerationInput): Promise<GenerationResponse> {
    if (input.signal?.aborted) throw new Error("ERR_REQUEST_CANCELLED");
    const localWorker = localWorkerEnabled();
    const { provider, providerId, providerModelId } = resolveProvider(input.capabilities);
    const now = Date.now();
    const taskId = randomUUID();
    let task = await createTask({
        task_id: taskId, status: "CREATED", freepik_status: "CREATED", media_type: input.mediaType,
        provider_id: providerId, provider_model_id: providerModelId, model_id: input.modelId,
        prompt: input.params.prompt, params: input.params as unknown as Record<string, unknown>,
        reuse_state: input.reuseState, created_at: new Date(now).toISOString(), result_paths: [], result_urls: [],
        lifecycle_phase: "submitting", next_poll_at: new Date(now + SUBMISSION_LEASE_MS).toISOString(),
        deadline_at: observationDeadline(now), poll_failures: 0, lease_token: randomUUID(),
        lease_expires_at: new Date(now + SUBMISSION_LEASE_MS).toISOString(), deleted_at: null,
    } as NewTaskRecord, { signal: input.signal });
    let synchronousResult = false;
    let dispatched = false;

    try {
        if (input.signal?.aborted) throw new Error("ERR_REQUEST_CANCELLED");
        const signal = boundedSignal(SUBMISSION_TIMEOUT_MS, input.signal);
        const submission = await withSignal(signal, () => {
            dispatched = true;
            return provider.submit({
                clientTaskId: taskId, signal, mediaType: input.mediaType, modelId: input.modelId,
                providerModelId, providerMode: input.capabilities.provider_mode, capabilities: input.capabilities,
                params: input.params, media: input.media,
            });
        });
        synchronousResult = submission.status === "COMPLETED";
        const operation = "operation" in submission ? submission.operation : undefined;
        const updated = await updateTask({ ...task,
            provider_task_id: submission.providerTaskId, provider_operation: operation,
            freepik_task_id: providerId === "freepik" ? submission.providerTaskId : undefined,
            status: synchronousResult ? "IN_PROGRESS" : submission.status,
            freepik_status: synchronousResult ? "IN_PROGRESS" : submission.status,
            lifecycle_phase: synchronousResult ? "materializing" : "polling",
            next_poll_at: new Date(Date.now() + (synchronousResult ? SUBMISSION_LEASE_MS : 10_000 + Math.floor(Math.random() * 2_000))).toISOString(),
        }, { releaseLease: !synchronousResult, signal: input.signal });
        if (!updated) throw new Error("ERR_TASK_WRITE_CONFLICT");
        task = updated;
        if (submission.status !== "COMPLETED") {
            if (localWorker) startLocalWorker();
            return { task_id: taskId, accepted: true, recovery_required: false, httpStatus: 202 };
        }

        const draft = structuredClone(task);
        const assetSignal = boundedSignal(ASSET_TIMEOUT_MS, input.signal);
        await withSignal(assetSignal, () => attachGeneratedAssets(draft, submission.assets, { signal: assetSignal }));
        const completed = await updateTask({ ...draft, status: "COMPLETED", freepik_status: "COMPLETED",
            lifecycle_phase: "terminal", next_poll_at: null, error_message: undefined }, { signal: input.signal });
        if (!completed) throw new Error("ERR_TASK_WRITE_CONFLICT");
        return { task_id: taskId, accepted: true, recovery_required: false, httpStatus: 200 };
    } catch (error) {
        const knownRejection = !dispatched || (error as { submissionUncertain?: boolean })?.submissionUncertain === false;
        const code = synchronousResult ? "ERR_ASSET_STORAGE_INCOMPLETE" : knownRejection
            ? safeErrorCode(error) : "ERR_SUBMISSION_OUTCOME_UNKNOWN";
        const phase: TaskRecord["lifecycle_phase"] = synchronousResult ? "paused" : knownRejection ? "terminal" : "submission_unknown";
        // The reservation remains discoverable even when this recovery write also fails.
        if (!input.signal?.aborted) await updateTask({ ...task, lifecycle_phase: phase, status: "ERROR", freepik_status: "ERROR",
            next_poll_at: null, error_message: code }, { signal: input.signal }).catch(() => undefined);
        if (!knownRejection || synchronousResult) console.warn("[generation] task requires recovery", { task_id: taskId, provider_id: providerId, code });
        return { task_id: taskId, accepted: false, recovery_required: !knownRejection || synchronousResult,
            error: code, httpStatus: knownRejection && !synchronousResult ? 422 : 202 };
    }
}
