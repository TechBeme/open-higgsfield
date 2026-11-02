import "server-only";

import { magnificGet, validateMagnificPath } from "@/server/providers/magnific-client";
import { submitMagnific } from "@/server/providers/magnific";
import { invalidProviderResponse, providerObject, ProviderRequestError, publicMediaUrl } from "@/server/providers/request-error";
import type { GenerationProvider, ProviderGenerationRequest, ProviderPollRequest, ProviderPollResult, ProviderSubmission } from "@/providers/types";

export class MagnificProvider implements GenerationProvider {
    readonly id = "magnific" as const;

    submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        return submitMagnific(request);
    }

    async poll(request: ProviderPollRequest): Promise<ProviderPollResult> {
        const operation = providerObject(request.operation, "MAGNIFIC", "poll");
        if (operation.api !== "magnific") throw new ProviderRequestError("ERR_MAGNIFIC_OPERATION");
        validateMagnificPath(operation.pollUrl);
        const payload = providerObject(await magnificGet(operation.pollUrl, request.signal, request.connection?.secret), "MAGNIFIC", "poll");
        const data = providerObject(payload.data ?? payload, "MAGNIFIC", "poll");
        const status = String(data.status ?? data.task_status ?? "").toUpperCase();
        if (status === "COMPLETED") {
            const generated = typeof data.generated === "string" ? [data.generated] : data.generated;
            const urls = Array.isArray(generated) ? generated.filter((value): value is string => typeof value === "string") : [];
            if (!urls.length) throw invalidProviderResponse("MAGNIFIC", "poll");
            return { status: "COMPLETED", assets: urls.map((url) => ({ url: publicMediaUrl(url, "ERR_MAGNIFIC_OUTPUT"), ...(request.mediaType === "video" ? { mimeType: "video/mp4" } : {}) })), operation };
        }
        if (status === "FAILED" || status === "ERROR" || status === "CANCELLED") {
            return { status, error: `ERR_MAGNIFIC_TASK_${status}`, operation };
        }
        if (["CREATED", "IN_PROGRESS", "PENDING", "QUEUED"].includes(status)) return { status: "IN_PROGRESS", operation };
        throw invalidProviderResponse("MAGNIFIC", "poll");
    }
}
