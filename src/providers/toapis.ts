import type { GenerationProvider, ProviderGenerationRequest, ProviderPollRequest, ProviderPollResult, ProviderSubmission } from "./types";

const IMAGE_MODELS = new Set(["gpt-image-2", "gpt-image-2.5-flare"]);
const VIDEO_MODELS = new Set(["seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2-5"]);
const RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]);
type Json = Record<string, unknown>;
interface Operation { version: 1; taskId: string; mediaType: "image" | "video"; model: string; origin: string; }
interface Options { apiKey?: string; origin?: string; fetcher?: typeof fetch; }

function object(value: unknown): Json {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ERR_TOAPIS_RESPONSE");
    return value as Json;
}

function origin(value: string): string {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "toapis.com" || url.port || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
        throw new Error("ERR_TOAPIS_ORIGIN: use https://toapis.com without /v1");
    }
    return url.origin;
}

function mediaUrl(value: unknown): string {
    if (typeof value !== "string") throw new Error("ERR_TOAPIS_MEDIA_URL");
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hostname === "localhost" || url.hostname === "127.0.0.1") throw new Error("ERR_TOAPIS_MEDIA_URL");
    return url.href;
}

/** Optional server-side provider. Submission is attempted once; polling never submits. */
export class ToapisProvider implements GenerationProvider {
    readonly id = "toapis" as const;
    constructor(private readonly options: Options = {}) {}

    private config() {
        const key = this.options.apiKey ?? process.env.TOAPIS_API_KEY;
        if (!key) throw new Error("ERR_TOAPIS_NOT_CONFIGURED");
        return { key, origin: origin(this.options.origin ?? process.env.TOAPIS_BASE_URL ?? "https://toapis.com") };
    }

    private async request(path: string, body?: Json): Promise<Json> {
        const config = this.config();
        let response: Response;
        try {
            response = await (this.options.fetcher ?? fetch)(config.origin + "/v1/" + path, {
                method: body ? "POST" : "GET",
                headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json", Accept: "application/json" },
                redirect: "error",
                signal: AbortSignal.timeout(body ? 90_000 : 30_000),
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
        } catch {
            // Never retry POST after a lost response; an upstream task may already exist.
            throw new Error(body ? "ERR_TOAPIS_SUBMISSION_UNCERTAIN: reconcile upstream before generating again" : "ERR_TOAPIS_QUERY_FAILED");
        }
        if (!response.ok) throw new Error(`ERR_TOAPIS_HTTP_${response.status}`);
        try { return object(await response.json()); } catch { throw new Error(body ? "ERR_TOAPIS_SUBMISSION_UNCERTAIN" : "ERR_TOAPIS_RESPONSE"); }
    }

    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        const model = request.providerModelId;
        const models = request.mediaType === "image" ? IMAGE_MODELS : VIDEO_MODELS;
        if (!models.has(model)) throw new Error("ERR_TOAPIS_UNSUPPORTED_MODEL");
        const params = request.params;
        const prompt = params.prompt?.trim();
        if (!prompt) throw new Error("ERR_TOAPIS_PROMPT_REQUIRED");
        const ratio = params.aspect_ratio || "16:9";
        if (!RATIOS.has(ratio)) throw new Error("ERR_TOAPIS_ASPECT_RATIO");
        if (request.media.video || request.media.audio || request.media.elements?.length) throw new Error("ERR_TOAPIS_UNSUPPORTED_MEDIA");
        const images = Object.entries(request.media.images ?? {}).filter(([, value]) => !!value);
        const body: Json = { model, prompt };
        if (request.mediaType === "image") {
            if (images.length) throw new Error("ERR_TOAPIS_IMAGE_EDIT_NOT_ENABLED");
            const resolution = (params.resolution || "1K").toUpperCase();
            if (!["1K", "2K", "4K"].includes(resolution)) throw new Error("ERR_TOAPIS_RESOLUTION");
            Object.assign(body, { n: 1, size: ratio, resolution });
            if (model === "gpt-image-2.5-flare") body.quality = "high";
        } else {
            if (params.duration && params.duration !== "4") throw new Error("ERR_TOAPIS_DURATION: this initial adapter enables 4s only");
            const resolution = params.resolution || "720p";
            if (!["480p", "720p"].includes(resolution)) throw new Error("ERR_TOAPIS_RESOLUTION");
            if (images.length !== 1 || images[0][0] !== "first_frame") throw new Error("ERR_TOAPIS_FIRST_FRAME_REQUIRED");
            if (params.generate_audio || params.field_values?.generate_audio) throw new Error("ERR_TOAPIS_AUDIO_NOT_ENABLED");
            Object.assign(body, { duration: 4, resolution, aspect_ratio: ratio, generate_audio: false,
                image_with_roles: [{ url: mediaUrl(images[0][1]), role: "first_frame" }] });
        }
        const response = await this.request(`${request.mediaType === "image" ? "images" : "videos"}/generations`, body);
        if (typeof response.id !== "string" || !response.id) throw new Error("ERR_TOAPIS_SUBMISSION_UNCERTAIN: missing task ID");
        return { status: "CREATED", providerTaskId: response.id, operation: {
            version: 1, taskId: response.id, mediaType: request.mediaType, model, origin: this.config().origin,
        } satisfies Operation };
    }

    async poll(request: ProviderPollRequest): Promise<ProviderPollResult> {
        const op = object(request.operation) as unknown as Operation;
        if (op.version !== 1 || typeof op.taskId !== "string" || !op.taskId || op.mediaType !== request.mediaType || op.model !== request.providerModelId || op.origin !== this.config().origin) throw new Error("ERR_TOAPIS_OPERATION");
        if (!(op.mediaType === "image" ? IMAGE_MODELS : VIDEO_MODELS).has(op.model)) throw new Error("ERR_TOAPIS_UNSUPPORTED_MODEL");
        const result = await this.request(`${op.mediaType === "image" ? "images" : "videos"}/generations/${encodeURIComponent(op.taskId)}`);
        if (result.id !== op.taskId || result.model !== op.model) throw new Error("ERR_TOAPIS_TASK_IDENTITY");
        const status = String(result.status).toLowerCase();
        if (status === "completed") {
            const output = object(result.result).data;
            if (!Array.isArray(output) || output.length !== 1) throw new Error("ERR_TOAPIS_RESULT_COUNT");
            const url = mediaUrl(object(output[0]).url);
            return { status: "COMPLETED", assets: [{ url, ...(op.mediaType === "video" ? { mimeType: "video/mp4" } : {}) }], operation: op };
        }
        if (["failed", "cancelled", "expired"].includes(status)) return { status: status === "cancelled" ? "CANCELLED" : "FAILED", error: `ERR_TOAPIS_TASK_${status.toUpperCase()}`, operation: op };
        if (["pending", "queued", "processing", "in_progress", "created"].includes(status)) return { status: "IN_PROGRESS", operation: op };
        throw new Error("ERR_TOAPIS_STATUS");
    }
}
