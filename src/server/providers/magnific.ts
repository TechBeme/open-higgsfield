import "server-only";

import { getMagnificContract, magnificMediaBinding } from "@/server/catalog/magnific";
import { parseModelFields, validateParameter, validateModelMedia, validateModelParams } from "@/models/parameter-schema";
import { magnificPost } from "@/server/providers/magnific-client";
import { getMediaSlot, fetchMedia } from "@/server/providers/utils";
import { invalidProviderResponse, providerObject, ProviderRequestError, publicMediaUrl } from "@/server/providers/request-error";
import type { ProviderGenerationRequest, ProviderSubmission } from "@/providers/types";

/** Additional documented relationships which OpenAPI's simple property schemas cannot express. */
function validateRelationships(path: string, payload: Record<string, unknown>) {
    const has = (key: string) => Array.isArray(payload[key]) ? (payload[key] as unknown[]).length > 0 : !!payload[key];
    if (path.includes("seedance-2")) {
        if ((has("image") || has("image_end")) && (has("reference_images") || has("reference_videos"))) throw new ProviderRequestError("ERR_MAGNIFIC_REFERENCE_CONFLICT");
        if (has("image_end") && !has("image")) throw new ProviderRequestError("ERR_MAGNIFIC_FIRST_FRAME_REQUIRED");
        const shots = payload.multishot;
        if (Array.isArray(shots)) {
            const durations = shots.map(s => (s as Record<string, unknown>).duration);
            if (durations.some(v => v !== undefined) && (durations.some(v => typeof v !== "number") || durations.reduce<number>((sum, v) => sum + Number(v), 0) !== Number(payload.duration ?? 5))) throw new ProviderRequestError("ERR_MAGNIFIC_SHOT_DURATION");
        }
    }
    if (path.endsWith("/mystic")) {
        const styling = payload.styling as Record<string, unknown> | undefined;
        if (styling && (has("structure_reference") || has("style_reference") || ["fluid", "flexible", "super_real", "editorial_portraits"].includes(String(payload.model)))
            && ["characters", "styles"].some(k => Array.isArray(styling[k]) && (styling[k] as unknown[]).length)) throw new ProviderRequestError("ERR_MAGNIFIC_LORA_CONFLICT");
    }
}

export async function submitMagnific(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
    const contract = getMagnificContract(request.providerModelId, request.mediaType);
    if (!contract || contract.mediaType !== request.mediaType) throw new ProviderRequestError("ERR_MAGNIFIC_MODEL");
    const fields = parseModelFields(request.capabilities, request.params.field_values ?? {});
    if (fields.errors.length || validateModelParams(request.capabilities, request.params).length || validateModelMedia(request.capabilities, request.media).length) throw new ProviderRequestError("ERR_MAGNIFIC_INPUT");
    const payload: Record<string, unknown> = { ...fields.values };
    const props = contract.schema.properties ?? {};
    if (props.prompt && request.params.prompt) payload.prompt = request.params.prompt;
    for (const [key, schema] of Object.entries(props)) {
        const binding = magnificMediaBinding(key, schema, contract.schema.required?.includes(key) ?? false);
        if (!binding) continue;
        const urls = getMediaSlot(request.media, key);
        if (!urls.length) continue;
        const values: string[] = [];
        for (const url of urls) {
            if (binding.base64) {
                const asset = await fetchMedia(url, { signal: request.signal });
                if (!asset.mimeType.startsWith(`${binding.slot.kind}/`)) throw new ProviderRequestError("ERR_MAGNIFIC_MEDIA_TYPE");
                values.push(Buffer.from(asset.data).toString("base64"));
            } else values.push(publicMediaUrl(url, "ERR_MAGNIFIC_INPUT_URL"));
        }
        const mapped = binding.property ? values.map(url => ({ [binding.property!]: url })) : values;
        payload[key] = binding.array ? mapped : mapped[0];
    }
    if (validateParameter(payload, contract.schema).length) throw new ProviderRequestError("ERR_MAGNIFIC_INPUT");
    validateRelationships(contract.path, payload);
    const response = providerObject(await magnificPost(contract.path, payload, request.signal, contract.contentType === "application/x-www-form-urlencoded", request.connection?.secret), "MAGNIFIC", "submit");
    // Classic Fast returns base64 images synchronously.
    if (contract.path === "/v1/ai/text-to-image") {
        if (!Array.isArray(response.data) || response.data.length === 0 || response.data.length > 32) throw invalidProviderResponse("MAGNIFIC", "submit");
        const assets = response.data.map(item => {
            const image = providerObject(item, "MAGNIFIC", "submit");
            if (typeof image.base64 !== "string" || image.base64.length > 64 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.base64)) throw invalidProviderResponse("MAGNIFIC", "submit");
            return { data: Buffer.from(image.base64, "base64"), mimeType: "image/png" };
        });
        return { status: "COMPLETED", assets };
    }
    if (contract.path === "/v1/ai/beta/remove-background") {
        return { status: "COMPLETED", assets: [{ url: publicMediaUrl(response.high_resolution ?? response.url, "ERR_MAGNIFIC_OUTPUT") }] };
    }
    const root = providerObject(response.data ?? response, "MAGNIFIC", "submit");
    const taskId = root.task_id;
    if (typeof taskId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(taskId)) throw invalidProviderResponse("MAGNIFIC", "submit");
    if (String(root.status).toUpperCase() === "COMPLETED") {
        const urls = typeof root.generated === "string" ? [root.generated] : root.generated;
        if (!Array.isArray(urls) || !urls.length) throw invalidProviderResponse("MAGNIFIC", "submit");
        return { status: "COMPLETED", providerTaskId: taskId, assets: urls.map(url => ({ url: publicMediaUrl(url, "ERR_MAGNIFIC_OUTPUT") })) };
    }
    if (!contract.poll) throw invalidProviderResponse("MAGNIFIC", "submit");
    return { status: "CREATED", providerTaskId: taskId, operation: { pollUrl: contract.poll.replace("{task-id}", taskId), api: "magnific" } };
}
