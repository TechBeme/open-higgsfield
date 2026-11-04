import "server-only";

import type { ProviderConnectionContext } from "@/providers/types";
import type { GenerationProvider, ProviderId } from "@/providers/types";
import type { SubmitGenerationInput, GenerationResponse } from "./service";
import type { TaskRecord } from "@/server/tasks/store";
import { updateTask } from "@/server/tasks/store";
import { attachGeneratedAssets } from "@/server/media/generated-assets";
import { ASSET_TIMEOUT_MS, boundedSignal, safeErrorCode, SUBMISSION_LEASE_MS, SUBMISSION_TIMEOUT_MS, withSignal } from "@/server/tasks/runtime";

export async function executeReservedGeneration(task: TaskRecord, input: SubmitGenerationInput,
    provider: GenerationProvider, providerId: ProviderId, providerModelId: string,
    connection?: ProviderConnectionContext): Promise<GenerationResponse> {
    const taskId = task.task_id;
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
                connection,
            });
        });
        synchronousResult = submission.status === "COMPLETED";
        const operation = "operation" in submission ? submission.operation : undefined;
        const updated = await updateTask({ ...task,
            provider_task_id: submission.providerTaskId, provider_operation: operation,
            status: synchronousResult ? "IN_PROGRESS" : submission.status,
            freepik_status: synchronousResult ? "IN_PROGRESS" : submission.status,
            lifecycle_phase: synchronousResult ? "materializing" : "polling",
            next_poll_at: new Date(Date.now() + (synchronousResult ? SUBMISSION_LEASE_MS : 10_000 + Math.floor(Math.random() * 2_000))).toISOString(),
        }, { releaseLease: !synchronousResult, signal: input.signal });
        if (!updated) throw new Error("ERR_TASK_WRITE_CONFLICT");
        task = updated;
        if (submission.status !== "COMPLETED") {
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
