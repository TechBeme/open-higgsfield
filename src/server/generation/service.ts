import "server-only";

import { randomUUID } from "node:crypto";
import type { CanonicalMediaInputs, CanonicalParams } from "@/models/canonical";
import type { ModelCapabilities } from "@/models/capabilities/types";
import { startLocalWorker } from "@/server/tasks/poller";
import { createTask, updateTask, type NewTaskRecord } from "@/server/tasks/store";
import { localWorkerEnabled, observationDeadline, SUBMISSION_LEASE_MS, taskWorkerMode } from "@/server/tasks/runtime";
import { executeReservedGeneration } from "./provider-submission";
import { resolveProvider } from "@/server/providers/registry";
import { resolveProviderConnection } from "@/server/config/provider-store";

export interface SubmitGenerationInput {
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
    const workflow = taskWorkerMode() === "workflow";
    const resolved = resolveProvider(input.capabilities);
    const { provider, providerId, providerModelId } = resolved;
    const connection = await resolveProviderConnection(providerId);
    const now = Date.now();
    const taskId = randomUUID();
    const task = await createTask({
        task_id: taskId, status: "CREATED", freepik_status: "CREATED", media_type: input.mediaType,
        provider_id: providerId, provider_model_id: providerModelId, model_id: input.modelId,
        provider_connection_id: connection?.id,
        provider_capabilities: structuredClone(input.capabilities),
        prompt: input.params.prompt, params: input.params as unknown as Record<string, unknown>,
        reuse_state: input.reuseState, created_at: new Date(now).toISOString(), result_paths: [], result_urls: [],
        lifecycle_phase: workflow ? "queued" : "submitting", next_poll_at: new Date(workflow ? now : now + SUBMISSION_LEASE_MS).toISOString(),
        ...(workflow ? { submission_media: structuredClone(input.media), submission_ready: false } : {}),
        deadline_at: observationDeadline(now), poll_failures: 0, lease_token: workflow ? null : randomUUID(),
        lease_expires_at: workflow ? null : new Date(now + SUBMISSION_LEASE_MS).toISOString(), deleted_at: null,
    } as NewTaskRecord, { signal: input.signal });
    if (workflow) {
        const { startTaskWorkflow } = await import("@/server/tasks/workflow-dispatch");
        // Admission is durable before activation. An unconfirmed admission can
        // never authorize a paid request, even if its run appears later.
        try { await startTaskWorkflow(task, { signal: input.signal }); }
        catch {
            await updateTask({ ...task, lifecycle_phase: "terminal", status: "ERROR", freepik_status: "ERROR",
                submission_media: undefined, submission_ready: false, next_poll_at: null,
                error_message: "ERR_WORKFLOW_DISPATCH_FAILED" }).catch(() => undefined);
            return { task_id: taskId, accepted: false, recovery_required: false, error: "ERR_WORKFLOW_DISPATCH_FAILED", httpStatus: 422 };
        }
        try {
            const activated = await updateTask({ ...task, submission_ready: true }, { signal: input.signal });
            if (!activated) throw new Error("ERR_TASK_WRITE_CONFLICT");
            return { task_id: taskId, accepted: true, recovery_required: false, httpStatus: 202 };
        } catch {
            // A DB write may have committed before the response was lost. Keep
            // the task ID discoverable and never invite automatic resubmission.
            return { task_id: taskId, accepted: false, recovery_required: true, error: "ERR_SUBMISSION_OUTCOME_UNKNOWN", httpStatus: 202 };
        }
    }
    const result = await executeReservedGeneration(task, input, provider, providerId, providerModelId, connection);
    if (localWorker && result.accepted && result.httpStatus === 202) startLocalWorker();
    return result;
}
