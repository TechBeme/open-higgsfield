import type { GenerationProvider, ProviderGenerationRequest, ProviderPollRequest, ProviderPollResult, ProviderSubmission } from "./types";
import { createProviderTransport, invalidProviderResponse, providerHttpError, providerObject, ProviderRequestError, publicMediaUrl } from "./request-error";

const IMAGE_MODELS = new Set(["gpt-image-2", "gpt-image-2.5-flare"]);
const VIDEO_MODELS = new Set(["seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2-5"]);
const RATIOS = new Set(["16:9", "1:1", "9:16"]);
const TASK_ID = /^[A-Za-z0-9_-]{1,200}$/;
type Json = Record<string, unknown>;
interface Operation { version: 1; taskId: string; mediaType: "image" | "video"; model: string; origin: string; }
interface Options { apiKey?: string; origin?: string; fetcher?: typeof fetch; }

function toapisOrigin(value: string): string {
    if (value !== "https://toapis.com" && value !== "https://toapis.com/") throw new ProviderRequestError("ERR_TOAPIS_ORIGIN");
    return "https://toapis.com";
}

export class ToapisProvider implements GenerationProvider {
    readonly id = "toapis" as const;
    constructor(private readonly options: Options = {}) {}

    private config() {
        const key = this.options.apiKey ?? process.env.TOAPIS_API_KEY;
        if (!key?.trim()) throw new ProviderRequestError("ERR_TOAPIS_NOT_CONFIGURED");
        return { key, origin: toapisOrigin(this.options.origin ?? process.env.TOAPIS_BASE_URL ?? "https://toapis.com") };
    }

    private async request(path: string, phase: "submit" | "poll", signal?: AbortSignal, body?: Json): Promise<Json> {
        const config = this.config();
        const transport = createProviderTransport("TOAPIS", phase, signal, this.options.fetcher);
        transport.assertActive();
        try {
            const response = await transport.fetch(`${config.origin}/v1/${path}`, {
                method: body ? "POST" : "GET", cache: "no-store",
                headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json", Accept: "application/json" },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            if (!response.ok) {
                await response.body?.cancel();
                throw providerHttpError("TOAPIS", phase, response.status, response.headers.get("retry-after"));
            }
            let result: unknown;
            try { result = await response.json(); } catch { throw invalidProviderResponse("TOAPIS", phase); }
            return providerObject(result, "TOAPIS", phase);
        } catch (error) { throw transport.classify(error); }
    }

    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        const config = this.config();
        if (request.signal?.aborted) throw new ProviderRequestError("ERR_TOAPIS_ABORTED");
        const model = request.providerModelId;
        if (!(request.mediaType === "image" ? IMAGE_MODELS : VIDEO_MODELS).has(model)) throw new ProviderRequestError("ERR_TOAPIS_UNSUPPORTED_MODEL");
        const params = request.params;
        const prompt = params.prompt?.trim();
        if (!prompt || prompt.length > (request.mediaType === "image" ? 32_000 : 2500)) throw new ProviderRequestError("ERR_TOAPIS_PROMPT");
        if (request.media.video || request.media.audio || request.media.elements?.length) throw new ProviderRequestError("ERR_TOAPIS_UNSUPPORTED_MEDIA");
        const images = Object.entries(request.media.images ?? {}).filter(([, value]) => !!value);
        const body: Json = { model, prompt };
        if (request.mediaType === "image") {
            if (images.length) throw new ProviderRequestError("ERR_TOAPIS_IMAGE_EDIT_NOT_ENABLED");
            const ratio = params.aspect_ratio || "16:9";
            if (!RATIOS.has(ratio)) throw new ProviderRequestError("ERR_TOAPIS_ASPECT_RATIO");
            const resolution = (params.resolution || "1K").toUpperCase();
            if (!["1K", "2K", "4K"].includes(resolution)) throw new ProviderRequestError("ERR_TOAPIS_RESOLUTION");
            Object.assign(body, { n: 1, size: ratio, resolution: model === "gpt-image-2" ? resolution.toLowerCase() : resolution });
            if (model === "gpt-image-2.5-flare") body.quality = "high";
        } else {
            const ratio = params.aspect_ratio || (model === "seedance-2-5" ? "adaptive" : "16:9");
            if (model === "seedance-2-5" ? ratio !== "adaptive" : !RATIOS.has(ratio)) throw new ProviderRequestError("ERR_TOAPIS_ASPECT_RATIO");
            if (params.duration && params.duration !== "4") throw new ProviderRequestError("ERR_TOAPIS_DURATION");
            const resolution = params.resolution || "720p";
            if (!["480p", "720p"].includes(resolution)) throw new ProviderRequestError("ERR_TOAPIS_RESOLUTION");
            if (images.length !== 1 || images[0][0] !== "first_frame") throw new ProviderRequestError("ERR_TOAPIS_FIRST_FRAME_REQUIRED");
            if (params.generate_audio || params.field_values?.generate_audio) throw new ProviderRequestError("ERR_TOAPIS_AUDIO_NOT_ENABLED");
            Object.assign(body, { duration: 4, resolution, aspect_ratio: ratio, generate_audio: false,
                image_with_roles: [{ url: publicMediaUrl(images[0][1], "ERR_TOAPIS_MEDIA_URL", 2048), role: "first_frame" }] });
            if (request.clientTaskId) {
                if (!TASK_ID.test(request.clientTaskId)) throw new ProviderRequestError("ERR_TOAPIS_CLIENT_TASK_ID");
                body.client_business_id = request.clientTaskId;
            }
        }
        const response = await this.request(`${request.mediaType === "image" ? "images" : "videos"}/generations`, "submit", request.signal, body);
        if (typeof response.id !== "string" || !TASK_ID.test(response.id) || response.model !== model
            || response.object !== "generation.task" || !["pending", "queued", "in_progress", "completed", "failed"].includes(String(response.status))) {
            throw invalidProviderResponse("TOAPIS", "submit");
        }
        return { status: "CREATED", providerTaskId: response.id, operation: {
            version: 1, taskId: response.id, mediaType: request.mediaType, model, origin: config.origin,
        } satisfies Operation };
    }

    async poll(request: ProviderPollRequest): Promise<ProviderPollResult> {
        const config = this.config();
        const op = providerObject(request.operation, "TOAPIS", "poll") as unknown as Operation;
        if (op.version !== 1 || typeof op.taskId !== "string" || !TASK_ID.test(op.taskId)
            || op.mediaType !== request.mediaType || op.model !== request.providerModelId || op.origin !== config.origin
            || !(op.mediaType === "image" ? IMAGE_MODELS : VIDEO_MODELS).has(op.model)) {
            throw new ProviderRequestError("ERR_TOAPIS_OPERATION");
        }
        const result = await this.request(`${op.mediaType === "image" ? "images" : "videos"}/generations/${encodeURIComponent(op.taskId)}`, "poll", request.signal);
        if (result.id !== op.taskId || result.model !== op.model || result.object !== "generation.task") throw new ProviderRequestError("ERR_TOAPIS_TASK_IDENTITY");
        if (result.status === "failed") return { status: "FAILED", error: "ERR_TOAPIS_TASK_FAILED", operation: op };
        if (["pending", "queued", "in_progress"].includes(String(result.status))) return { status: "IN_PROGRESS", operation: op };
        if (result.status !== "completed") throw new ProviderRequestError("ERR_TOAPIS_STATUS");
        const output = providerObject(result.result, "TOAPIS", "poll");
        if (output.type !== op.mediaType || !Array.isArray(output.data) || output.data.length !== 1) throw invalidProviderResponse("TOAPIS", "poll");
        const item = providerObject(output.data[0], "TOAPIS", "poll");
        const url = publicMediaUrl(item.url, "ERR_TOAPIS_MEDIA_URL");
        if (op.mediaType === "video" && item.format !== undefined && item.format !== "mp4") throw invalidProviderResponse("TOAPIS", "poll");
        return { status: "COMPLETED", assets: [{ url, ...(op.mediaType === "video" ? { mimeType: "video/mp4" } : {}) }], operation: op };
    }
}
