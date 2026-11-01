import { getImageAdapter } from "@/models/adapters/image";
import { getVideoAdapter } from "@/models/adapters/video";
import { freepikGet, freepikPost, normaliseAsyncPayload, validateFreepikPath } from "@/lib/freepik-client";
import type { GenerationProvider, ProviderGenerationRequest, ProviderPollRequest, ProviderPollResult, ProviderSubmission } from "./types";
import { invalidProviderResponse, providerObject, ProviderRequestError, publicMediaUrl } from "./request-error";

interface FreepikOperation {
    pollUrl: string;
}

export class FreepikProvider implements GenerationProvider {
    readonly id = "freepik" as const;

    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        const adapter = request.mediaType === "video"
            ? getVideoAdapter(request.modelId)
            : getImageAdapter(request.modelId);
        if (!adapter) throw new ProviderRequestError("ERR_NO_ADAPTER");

        let processed: ReturnType<typeof adapter.process>;
        try { processed = adapter.process(request.modelId, request.params, request.media); }
        catch { throw new ProviderRequestError("ERR_FREEPIK_INPUT"); }
        const { endpoint, payload } = processed;
        if (request.params.seed !== undefined) payload.seed = request.params.seed;
        if (!endpoint.post_path || !endpoint.poll_path) throw new ProviderRequestError("ERR_MODEL_NO_ENDPOINT");
        validateFreepikPath(endpoint.poll_path.replace("{task_id}", "pending"));

        const response = providerObject(await freepikPost(endpoint.post_path, payload, request.signal), "FREEPIK", "submit");
        const root = providerObject(response.data ?? response, "FREEPIK", "submit");
        const taskId = root.task_id;
        if (typeof taskId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(taskId)) throw invalidProviderResponse("FREEPIK", "submit");

        return {
            status: "CREATED",
            providerTaskId: taskId,
            operation: { pollUrl: endpoint.poll_path.replace("{task_id}", taskId) } satisfies FreepikOperation,
        };
    }

    async poll(request: ProviderPollRequest): Promise<ProviderPollResult> {
        const operation = providerObject(request.operation, "FREEPIK", "poll") as unknown as FreepikOperation;
        validateFreepikPath(operation.pollUrl);

        const payload = providerObject(await freepikGet(operation.pollUrl, request.signal), "FREEPIK", "poll");
        providerObject(payload.data ?? payload, "FREEPIK", "poll");
        if (request.mediaType === "image") {
            const { status, urls } = normaliseAsyncPayload(payload);
            if (!status) throw invalidProviderResponse("FREEPIK", "poll");
            const normalized = status.toUpperCase();
            if (normalized === "COMPLETED") {
                if (urls.length === 0) throw invalidProviderResponse("FREEPIK", "poll");
                return { status: "COMPLETED", assets: urls.map((url) => ({ url: publicMediaUrl(url, "ERR_FREEPIK_OUTPUT") })), operation };
            }
            if (["FAILED", "ERROR", "CANCELLED"].includes(normalized)) {
                return {
                    status: normalized as "FAILED" | "ERROR" | "CANCELLED",
                    error: `ERR_FREEPIK_TASK_${normalized}`,
                    operation,
                };
            }
            if (["CREATED", "IN_PROGRESS", "PENDING", "QUEUED"].includes(normalized)) return { status: "IN_PROGRESS", operation };
            throw invalidProviderResponse("FREEPIK", "poll");
        }

        const data = (payload.data ?? payload) as Record<string, unknown>;
        const status = typeof data.status === "string" ? data.status.toUpperCase() : "";
        if (status === "COMPLETED") {
            const generated = typeof data.generated === "string" ? [data.generated] : data.generated;
            const urls = Array.isArray(generated) ? generated.filter((value): value is string => typeof value === "string") : [];
            if (urls.length === 0) throw invalidProviderResponse("FREEPIK", "poll");
            return { status: "COMPLETED", assets: urls.map((url) => ({ url: publicMediaUrl(url, "ERR_FREEPIK_OUTPUT"), mimeType: "video/mp4" })), operation };
        }
        if (["FAILED", "ERROR", "CANCELLED"].includes(status)) {
            return {
                status: status as "FAILED" | "ERROR" | "CANCELLED",
                error: `ERR_FREEPIK_TASK_${status}`,
                operation,
            };
        }
        if (["CREATED", "IN_PROGRESS", "PENDING", "QUEUED"].includes(status)) return { status: "IN_PROGRESS", operation };
        throw invalidProviderResponse("FREEPIK", "poll");
    }
}
