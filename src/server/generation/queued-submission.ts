import "server-only";

import type { CanonicalMediaInputs, CanonicalParams } from "@/models/canonical";
import { isProviderId } from "@/providers/definitions";
import { getProvider } from "@/server/providers/registry";
import { connectionFromEnv, getProviderConnection } from "@/server/config/provider-store";
import { assertGenerationEnabled } from "@/server/config/production";
import { resolveUrl } from "@/server/media/input-upload";
import { updateTask, type TaskRecord } from "@/server/tasks/store";
import { safeErrorCode, SUBMISSION_LEASE_MS, taskWorkerMode } from "@/server/tasks/runtime";
import { executeReservedGeneration } from "./provider-submission";

/** Refresh private input links immediately before submission, outside event logs. */
export async function hydrateQueuedMedia(input: CanonicalMediaInputs, signal: AbortSignal): Promise<CanonicalMediaInputs> {
    const cache = new Map<string, Promise<string>>();
    const url = (value: string) => {
        if (!cache.has(value)) cache.set(value, resolveUrl(value, { signal }).then(result => result.remoteUrl));
        return cache.get(value)!;
    };
    const media: CanonicalMediaInputs = {};
    if (input.slots) media.slots = Object.fromEntries(await Promise.all(Object.entries(input.slots).map(async ([key, values]) => [key, await Promise.all(values.map(url))])));
    if (input.images) media.images = Object.fromEntries(await Promise.all(Object.entries(input.images).map(async ([key, value]) => [key, await url(value)])));
    if (input.video) media.video = await url(input.video);
    if (input.audio) media.audio = await url(input.audio);
    if (input.elements) media.elements = await Promise.all(input.elements.map(async element => ({
        ...(element.frontal_image_url ? { frontal_image_url: await url(element.frontal_image_url) } : {}),
        ...(element.reference_image_urls ? { reference_image_urls: await Promise.all(element.reference_image_urls.map(url)) } : {}),
    })));
    return media;
}

export async function submitQueuedTask(task: TaskRecord, signal: AbortSignal): Promise<void> {
    if (!task.submission_ready || !task.submission_media) throw new Error("ERR_INVALID_QUEUED_TASK");
    try {
        if (taskWorkerMode() !== "workflow") throw new Error("ERR_WORKFLOW_REQUIRED");
        assertGenerationEnabled();
        if (!task.deadline_at || Date.parse(task.deadline_at) <= Date.now()) throw new Error("ERR_GENERATION_QUEUE_EXPIRED");
        const providerId = task.provider_id;
        const capabilities = task.provider_capabilities;
        if (!isProviderId(providerId) || !capabilities || capabilities.provider !== providerId) throw new Error("ERR_UNKNOWN_PROVIDER");
        const connection = task.provider_connection_id ? await getProviderConnection(task.provider_connection_id, { forSubmission: true }) : connectionFromEnv(providerId);
        if (task.provider_connection_id && !connection) throw new Error("ERR_PROVIDER_CONNECTION_NOT_FOUND");
        if (connection && connection.providerId !== providerId) throw new Error("ERR_PROVIDER_CONNECTION_PROVIDER_MISMATCH");
        const media = await hydrateQueuedMedia(task.submission_media, signal);
        signal.throwIfAborted();
        // Commit the non-repeatable boundary BEFORE any paid HTTP call. A
        // redelivery sees submitting, never queued, and can only pause/query.
        const reserved = await updateTask({ ...task, lifecycle_phase: "submitting", submission_media: undefined,
            submission_ready: undefined, next_poll_at: new Date(Date.now() + SUBMISSION_LEASE_MS).toISOString() }, { releaseLease: false, signal });
        if (!reserved) return;
        await executeReservedGeneration(reserved, { mediaType: task.media_type, modelId: task.model_id,
            capabilities, params: task.params as unknown as CanonicalParams, media, signal },
            getProvider(providerId), providerId, task.provider_model_id ?? task.model_id, connection);
    } catch (error) {
        if (signal.aborted) throw error;
        const code = safeErrorCode(error, "ERR_QUEUED_SUBMISSION_FAILED");
        if (["ERR_TASK_STORAGE_UNAVAILABLE", "ERR_TASK_SCHEMA_REQUIRED", "ERR_TASK_STORAGE_TIMEOUT"].includes(code)) throw error;
        await updateTask({ ...task, status: "ERROR", freepik_status: "ERROR", lifecycle_phase: "terminal",
            next_poll_at: null, submission_media: undefined, submission_ready: undefined, error_message: code }, { signal });
    }
}
