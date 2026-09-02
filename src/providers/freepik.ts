import { getImageAdapter } from "@/models/adapters/image";
import { getVideoAdapter } from "@/models/adapters/video";
import { freepikGet, freepikPost, normaliseAsyncPayload, extractErrorMessage } from "@/lib/freepik-client";
import type { GenerationProvider, ProviderGenerationRequest, ProviderPollRequest, ProviderPollResult, ProviderSubmission } from "./types";

interface FreepikOperation {
    pollUrl: string;
}

export class FreepikProvider implements GenerationProvider {
    readonly id = "freepik" as const;

    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        const adapter = request.mediaType === "video"
            ? getVideoAdapter(request.modelId)
            : getImageAdapter(request.modelId);
        if (!adapter) throw new Error(`ERR_NO_ADAPTER: ${request.modelId}`);

        const { endpoint, payload } = adapter.process(request.modelId, request.params, request.media);
        if (request.params.seed !== undefined) payload.seed = request.params.seed;
        if (!endpoint.post_path || !endpoint.poll_path) throw new Error("ERR_MODEL_NO_ENDPOINT");

        const response = await freepikPost(endpoint.post_path, payload) as Record<string, unknown>;
        const root = (response.data ?? response) as Record<string, unknown>;
        const taskId = root.task_id as string | undefined;
        if (!taskId) throw new Error("ERR_NO_TASK_ID");

        return {
            status: "CREATED",
            providerTaskId: taskId,
            operation: { pollUrl: endpoint.poll_path.replace("{task_id}", taskId) } satisfies FreepikOperation,
        };
    }

    async poll(request: ProviderPollRequest): Promise<ProviderPollResult> {
        const operation = request.operation as FreepikOperation;
        if (!operation?.pollUrl) throw new Error("ERR_INVALID_PROVIDER_OPERATION");

        const payload = await freepikGet(operation.pollUrl) as Record<string, unknown>;
        if (request.mediaType === "image") {
            const { status, urls } = normaliseAsyncPayload(payload);
            if (!status) throw new Error("ERR_INVALID_STATUS");
            const normalized = status.toUpperCase();
            if (normalized === "COMPLETED") {
                return { status: "COMPLETED", assets: urls.map((url) => ({ url })), operation };
            }
            if (["FAILED", "ERROR", "CANCELLED"].includes(normalized)) {
                return {
                    status: normalized as "FAILED" | "ERROR" | "CANCELLED",
                    error: extractErrorMessage(payload) ?? `Task failed with status ${normalized}`,
                    operation,
                };
            }
            return { status: "IN_PROGRESS", operation };
        }

        const data = (payload.data ?? payload) as Record<string, unknown>;
        const status = String(data.status ?? "IN_PROGRESS").toUpperCase();
        if (status === "COMPLETED") {
            const generated = typeof data.generated === "string" ? [data.generated] : data.generated;
            const urls = Array.isArray(generated) ? generated.filter((value): value is string => typeof value === "string") : [];
            return { status: "COMPLETED", assets: urls.map((url) => ({ url, mimeType: "video/mp4" })), operation };
        }
        if (["FAILED", "ERROR", "CANCELLED"].includes(status)) {
            return {
                status: status as "FAILED" | "ERROR" | "CANCELLED",
                error: extractErrorMessage(payload) ?? `Task failed with status ${status}`,
                operation,
            };
        }
        return { status: "IN_PROGRESS", operation };
    }
}
