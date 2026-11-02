import "server-only";

import type { GenerationProvider, ProviderGenerationRequest, ProviderPollRequest, ProviderPollResult, ProviderSubmission } from "@/providers/types";
import type { ParameterSchema, CustomFieldCapability } from "@/models/capabilities/types";
import { getToapisContract, type ToapisContract } from "@/server/catalog/toapis";
import { createProviderTransport, invalidProviderResponse, providerHttpError, providerObject, ProviderRequestError, publicMediaUrl } from "@/server/providers/request-error";

const TASK_ID = /^[A-Za-z0-9_-]{1,200}$/;
type Json = Record<string, unknown>;
interface Operation { version: 1 | 2; taskId: string; mediaType: "image" | "video"; model: string; origin: string; action?: string; maxOutputs?: number; actionRequired?: "mask"; }
interface Options { apiKey?: string; origin?: string; fetcher?: typeof fetch; }
const fail = (suffix: string): never => { throw new ProviderRequestError(`ERR_TOAPIS_${suffix}`); };
function toapisOrigin(value: string): string {
    if (!["https://toapis.com", "https://toapis.com/", "https://api.toapis.com", "https://api.toapis.com/"].includes(value)) fail("ORIGIN");
    return value.replace(/\/$/, "");
}
function set(body: Json, path: string, value: unknown) {
    const parts = path.split("."); let current = body;
    for (const key of parts.slice(0, -1)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) fail("PARAMETER");
        current[key] ??= {}; current = current[key] as Json;
    }
    current[parts.at(-1)!] = value;
}
function get(body: Json, path: string): unknown { return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Json)[key] : undefined, body); }
function schema(value: unknown, rule: ParameterSchema, depth = 0): unknown {
    if (depth > 12) fail("PARAMETER");
    const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    const allowed = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (rule.type && !allowed.some(t => t === type || t === "integer" && type === "number" && Number.isSafeInteger(value))) fail("PARAMETER");
    if (rule.enum && !rule.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) fail("PARAMETER");
    if (rule.const !== undefined && JSON.stringify(rule.const) !== JSON.stringify(value)) fail("PARAMETER");
    if (typeof value === "number" && (!Number.isFinite(value) || rule.minimum !== undefined && value < rule.minimum || rule.maximum !== undefined && value > rule.maximum)) fail("PARAMETER");
    if (typeof value === "string") {
        if (rule.minLength !== undefined && [...value].length < rule.minLength || rule.maxLength !== undefined && [...value].length > rule.maxLength || rule.pattern && !new RegExp(rule.pattern).test(value)) fail("PARAMETER");
        if (rule.pattern === "^https://") return publicMediaUrl(value, "ERR_TOAPIS_MEDIA_URL", 2048);
    }
    if (Array.isArray(value)) {
        if (rule.minItems !== undefined && value.length < rule.minItems || rule.maxItems !== undefined && value.length > rule.maxItems) fail("PARAMETER");
        return value.map(item => rule.items ? schema(item, rule.items, depth + 1) : item);
    }
    if (type === "object") {
        const object = value as Json;
        if (rule.required?.some(key => !Object.hasOwn(object, key))) fail("PARAMETER");
        const result: Json = {};
        for (const [key, entry] of Object.entries(object)) {
            if (["__proto__", "constructor", "prototype"].includes(key)) fail("PARAMETER");
            const property = rule.properties?.[key];
            if (!property && rule.additionalProperties === false) fail("PARAMETER");
            result[key] = property ? schema(entry, property, depth + 1) : entry;
        }
        return result;
    }
    return value;
}
function fieldValue(field: CustomFieldCapability, value: unknown): unknown {
    if (field.type === "number") {
        if (typeof value !== "number" || !Number.isFinite(value) || field.step === 1 && !Number.isSafeInteger(value) || field.minimum !== undefined && value < field.minimum || field.maximum !== undefined && value > field.maximum) fail("PARAMETER");
    } else if (field.type === "checkbox") { if (typeof value !== "boolean") fail("PARAMETER"); }
    else if (field.type === "select") { if (typeof value !== "string" || !field.options?.includes(value)) fail("PARAMETER"); }
    else if (field.type === "text") {
        if (typeof value !== "string" || field.maxLength !== undefined && [...value].length > field.maxLength || field.minLength !== undefined && [...value].length < field.minLength || field.pattern && !new RegExp(field.pattern).test(value)) fail("PARAMETER");
    } else if (field.schema) return schema(value, field.schema);
    if (["n", "batch_size"].includes(field.id) && typeof value === "string") return Number(value);
    return value;
}
function actionFromRequest(request: ProviderGenerationRequest) {
    if (request.providerModelId !== "midjourney") return undefined;
    if (request.capabilities.provider_action) return request.capabilities.provider_action;
    return request.modelId.startsWith("toapis__midjourney__") ? request.modelId.slice("toapis__midjourney__".length) : "imagine";
}
/** Every field and semantic media role is checked before a billable POST. */
export function buildToapisRequest(request: ProviderGenerationRequest): { body: Json; path: string; contract: ToapisContract; maxOutputs: number } {
    const contract = getToapisContract(request.providerModelId, request.mediaType, actionFromRequest(request));
    if (!contract) fail("UNSUPPORTED_MODEL");
    const c = contract!, params = request.params;
    const values = params.field_values ?? {};
    if (!values || typeof values !== "object" || Array.isArray(values)) fail("PARAMETER");
    if (request.media.elements?.length) fail("UNSUPPORTED_MEDIA");
    const body: Json = { model: c.model, ...c.fixed };
    const prompt = params.prompt?.trim();
    const finalDraft = c.model === "seedance-2-5" && !!values.draft_task_id;
    if (!prompt && c.promptRequired !== false && !finalDraft || prompt && [...prompt].length > (c.promptMax ?? 100_000)) fail("PROMPT");
    if (prompt) body.prompt = prompt;
    for (const key of Object.keys(values)) if (!c.fields.some(field => field.id === key)) fail("UNSUPPORTED_PARAMETER");
    for (const field of c.fields) {
        const value = values[field.id] ?? field.default;
        if (value === undefined || value === "") { if (field.required) fail("PARAMETER_REQUIRED"); continue; }
        set(body, field.id, fieldValue(field, value));
    }
    for (const [options, value, path, code] of [
        [c.ratios, params.aspect_ratio, c.ratioField ?? "aspect_ratio", "ASPECT_RATIO"],
        [c.resolutions, params.resolution, c.resolutionField ?? "resolution", "RESOLUTION"],
    ] as const) {
        if (value && (!options || !options.includes(value))) fail(code);
        if (options?.length && !finalDraft) set(body, path, value || options[0]);
    }
    if (params.duration) {
        const duration = Number(params.duration);
        if (!c.durations?.includes(duration)) fail("DURATION");
        set(body, c.durationField ?? "duration", duration);
    } else if (c.durations?.length && !finalDraft) set(body, c.durationField ?? "duration", c.durations[0]);
    if (params.generate_audio !== undefined) {
        if (!c.fields.some(f => f.id === "generate_audio")) fail("UNSUPPORTED_PARAMETER");
        if (values.generate_audio !== undefined && values.generate_audio !== params.generate_audio) fail("PARAMETER");
        body.generate_audio = params.generate_audio;
    }
    if (params.seed !== undefined) { const f = c.fields.find(f => f.id === "seed" || f.id === "metadata.seed"); if (!f) fail("UNSUPPORTED_PARAMETER"); set(body, f!.id, fieldValue(f!, params.seed)); }
    if (params.negative_prompt) { const f = c.fields.find(f => /negative_?[pP]rompt$/.test(f.id)); if (!f) fail("UNSUPPORTED_PARAMETER"); set(body, f!.id, fieldValue(f!, params.negative_prompt)); }
    const media: Record<string, string[]> = { ...request.media.slots };
    for (const [id, item] of Object.entries(request.media.images ?? {})) if (item) { if (media[id] && media[id][0] !== item) fail("MEDIA_CONFLICT"); media[id] ??= [item]; }
    for (const kind of ["video", "audio"] as const) if (request.media[kind]) {
        const slots = c.slots.filter(s => s.kind === kind);
        if (slots.length !== 1) fail("UNSUPPORTED_MEDIA");
        const id = slots[0].id; if (media[id] && media[id][0] !== request.media[kind]) fail("MEDIA_CONFLICT"); media[id] ??= [request.media[kind]!];
    }
    const counts: Record<string, number> = {};
    for (const [id, urls] of Object.entries(media)) {
        const definition = c.slots.find(s => s.id === id);
        if (!definition || !Array.isArray(urls) || urls.length > (definition.max_count ?? 1)) fail("UNSUPPORTED_MEDIA");
        const values = urls.map(item => publicMediaUrl(item, "ERR_TOAPIS_MEDIA_URL", 2048));
        counts[id] = values.length;
        if (!values.length) continue;
        const s = definition!;
        const encoded = s.encoding === "single" ? values[0] : s.encoding === "roles" ? values.map(url => ({ url, role: s.role })) : s.encoding === "url-objects" ? values.map(url => ({ url })) : s.encoding === "image-list" ? values.map(image_url => ({ image_url })) : s.encoding === "video-list" ? values.map(video_url => ({ video_url })) : values;
        const previous = get(body, s.target);
        if (Array.isArray(encoded) && Array.isArray(previous)) set(body, s.target, [...previous, ...encoded]);
        else if (previous !== undefined) fail("MEDIA_CONFLICT");
        else set(body, s.target, encoded);
    }
    for (const s of c.slots) if (s.required && (counts[s.id] ?? 0) < Math.max(1, s.min_count ?? 1)) fail("MEDIA_REQUIRED");
    const n = (id: string) => counts[id] ?? 0;
    const first = n("first_frame"), last = n("last_frame"), refs = n("reference_images"), videos = n("reference_videos"), audios = n("reference_audios");
    const frames = first + last + n("keyframes");
    const anyMedia = Object.values(counts).some(Boolean);
    if (last && !first && c.model !== "kling-4.0") fail("FIRST_FRAME_REQUIRED");
    if (frames && refs && !c.model.startsWith("kling-v")) fail("MEDIA_MODE_CONFLICT");
    if (n("mask") && !refs && c.model !== "midjourney") fail("MASK_REQUIRES_IMAGE");
    if (body.tools && anyMedia) fail("TOOLS_TEXT_ONLY");
    if (body.custom_size) {
        if (c.model.startsWith("qwen")) {
            const [w, h] = String(body.custom_size).split(/[x*]/).map(Number);
            if (w * h < 512 ** 2 || w * h > 2048 ** 2 || w / h < 1 / 8 || w / h > 8) fail("SIZE");
            delete body.resolution;
        } else { const [w, h] = String(body.custom_size).split(":").map(Number); if (Math.max(w / h, h / w) > 3) fail("SIZE"); }
        body.size = body.custom_size; delete body.custom_size;
    }
    if (body.output_compression !== undefined && body.output_format !== "jpeg") fail("COMPRESSION_REQUIRES_JPEG");
    if (get(body, "metadata.imageOutputOptions.compressionQuality") !== undefined && get(body, "metadata.imageOutputOptions.mimeType") !== "image/jpeg") fail("COMPRESSION_REQUIRES_JPEG");
    if (get(body, "metadata.google_image_search") && !get(body, "metadata.google_search")) fail("SEARCH_DEPENDENCY");
    if (body.size === "match_input_image" && !refs || body.size === "auto" && c.model === "doubao-seedream-4-0" && !refs) fail("REFERENCE_REQUIRED");
    if (c.model.startsWith("doubao-seedream")) {
        if (body.layer_decomposition) { body.size = get(body, "metadata.resolution"); }
        if (refs + Math.max(Number(body.n ?? 1), Number(get(body, "metadata.sequential_image_generation_options.max_images") ?? 1)) > 15) fail("OUTPUT_LIMIT");
        if (get(body, "metadata.sequential_image_generation_options.max_images") && get(body, "metadata.sequential_image_generation") !== "auto") fail("SEQUENTIAL_MODE_REQUIRED");
    }
    if (c.model === "seedance-2-5") {
        const operation = body.video_operation ?? "generate";
        if (operation !== "generate" && !videos) fail("VIDEO_REQUIRED");
        if (operation === "edit" && body.duration !== -1) fail("DURATION");
        if (operation !== "generate" || frames) { if (params.aspect_ratio && params.aspect_ratio !== "adaptive") fail("ASPECT_RATIO"); body.aspect_ratio = "adaptive"; }
        if (body.draft && finalDraft || finalDraft && (prompt || anyMedia)) fail("DRAFT_CONFLICT");
        if (body.draft) { if (params.resolution && params.resolution !== "480p") fail("DRAFT_RESOLUTION"); body.resolution = "480p"; if (body.output_format) fail("DRAFT_FORMAT"); }
        if (finalDraft) { if (params.resolution && params.resolution !== "1080p") fail("DRAFT_RESOLUTION"); body.resolution = "1080p"; }
    } else if (c.model.startsWith("seedance-2") && !c.model.endsWith("ext") && audios && !(refs || videos)) fail("VISUAL_REFERENCE_REQUIRED");
    if (c.model === "seedance-2.5-ext") {
        if (audios && !(refs || videos)) fail("VISUAL_REFERENCE_REQUIRED");
        if (body.seconds === 15 && (videos || audios || refs > 10)) fail("DURATION");
    }
    if (c.model.startsWith("doubao-seedance-1-0") && refs && body.resolution === "1080p") fail("RESOLUTION");
    if (c.model.startsWith("MiniMax-H3")) {
        if (!anyMedia && body.aspect_ratio === "adaptive") fail("ASPECT_RATIO");
        if (audios && !(refs || videos)) fail("VISUAL_REFERENCE_REQUIRED");
        if (frames) { delete body.aspect_ratio; if (videos || audios) fail("MEDIA_MODE_CONFLICT"); }
    }
    if (c.model.startsWith("MiniMax-Hailuo")) {
        if (body.resolution === "1080P" && body.duration !== 6 || body.resolution === "512P" && (!first || last)) fail("RESOLUTION");
        if (!prompt && !first) fail("PROMPT");
    }
    if (c.model === "happyhorse-1.1") {
        body.action ??= first ? "image-to-video" : "text-to-video";
        if (body.action === "image-to-video" && !first || body.action === "reference-to-video" && !refs || body.action === "video-edit" && !n("source_video")) fail("MEDIA_REQUIRED");
        if (body.action !== "image-to-video" && !prompt) fail("PROMPT");
        if (body.action === "video-edit" && refs > 5) fail("MEDIA_LIMIT");
        if (first) delete body.aspect_ratio;
    }
    if (c.model === "kling-v2-6" && body.audio && body.mode !== "pro") fail("AUDIO_MODE");
    if ((c.model === "kling-v3-omni" || c.model === "kling-video-o1") && body.audio && body.video_list) fail("AUDIO_VIDEO_CONFLICT");
    const imageList = get(body, "metadata.image_list") as Json[] | undefined;
    if (imageList?.some(item => item.type === "end_frame") && !imageList.some(item => item.type === "first_frame")) fail("FIRST_FRAME_REQUIRED");
    if (c.model === "kling-4.0") {
        if (frames && (refs || videos) || frames > Math.min(Number(body.duration) + 1, 10)) fail("MEDIA_MODE_CONFLICT");
        if (get(body, "metadata.keep_original_sound") !== undefined && (!videos || frames)) fail("VIDEO_REQUIRED");
    }
    if (c.model.startsWith("grok")) {
        if (first + refs > (c.model === "grok-video-1.0" ? 8 : 7)) fail("MEDIA_LIMIT");
        if (c.model === "grok-video-1.5") {
            const mode = body.video_generation_mode ?? (refs ? "reference_images_to_video" : first ? "first_frame_image_to_video" : "text_to_video");
            if (mode === "reference_images_to_video" && (!refs || first || body.resolution === "1080p") || mode === "first_frame_image_to_video" && (!first || refs) || mode === "text_to_video" && (first || refs)) fail("MEDIA_MODE_CONFLICT");
            body.video_generation_mode = mode;
        }
    }
    if (c.model.toLowerCase().startsWith("veo")) {
        if (first && refs) fail("MEDIA_MODE_CONFLICT");
        if (!c.model.endsWith("official") && c.model.includes("quality") && (refs > 2 || get(body, "metadata.generation_type") === "reference")) fail("MEDIA_MODE_CONFLICT");
        if (!c.model.endsWith("official") && get(body, "metadata.generation_type") === "frame" && refs > 2) fail("MEDIA_MODE_CONFLICT");
        if (get(body, "metadata.enable_gif") && get(body, "metadata.resolution") !== "720p") fail("RESOLUTION");
    }
    if (c.model === "gemini-omni-flash" || c.model === "gemini_omni_flash") if (body.resolution === "1080p" && body.aspect_ratio !== "16:9") fail("RESOLUTION");
    if (c.model === "gemini-omni-1.1-flash-preview-vip") {
        if (refs === 2 || body.generation_type === "frame" && refs !== 1 || body.generation_type === "reference" && ![1, 3].includes(refs) || body.generation_type && !refs) fail("MEDIA_MODE_CONFLICT");
        if (videos) { if (params.duration) fail("DURATION"); delete body.duration; }
    }
    if (c.model.startsWith("gemini-omni") && c.model.endsWith("official")) {
        const task = get(body, "metadata.task");
        if (["edit", "extend"].includes(String(task)) && !videos) fail("VIDEO_REQUIRED");
        if (task === "extend" && get(body, "metadata.previous_interaction_id")) fail("MEDIA_MODE_CONFLICT");
        if (videos && (!task || task === "edit" || task === "extend")) delete body.aspect_ratio;
    }
    if (c.model === "sora-2-vvip") {
        const times = get(body, "metadata.character_timestamps");
        if (times) { const [a, b] = String(times).split(",").map(Number); if (b - a !== 2 || !n("character_video")) fail("CHARACTER_TIMESTAMPS"); }
        if (n("character_video") && !times) fail("CHARACTER_TIMESTAMPS");
    }
    if (c.model.startsWith("viduq3") && ["viduq3", "viduq3-pro", "viduq3-turbo"].includes(c.model)) {
        if (c.model === "viduq3" && !refs && !get(body, "metadata.subjects")) fail("REFERENCE_REQUIRED");
        if (get(body, "metadata.off_peak") && body.audio !== true) fail("AUDIO_REQUIRED");
    }
    if (c.model === "viduq4-preview") {
        if (!refs) fail("REFERENCE_REQUIRED");
        if (audios || refs > 1) body.video_generation_mode = "reference_images_to_video";
    }
    if (c.model.startsWith("wan2.6")) {
        if (first && videos) fail("MEDIA_MODE_CONFLICT");
        if (!first && !videos && (c.model.endsWith("flash") || !prompt)) fail("MEDIA_REQUIRED");
        if (first) { delete body.aspect_ratio; if (body.shot_type) fail("UNSUPPORTED_PARAMETER"); }
        if (c.model === "wan2.6" && body.audio === false) fail("AUDIO_REQUIRED");
    }
    if (c.model === "wan3.0-video" && (!prompt && !anyMedia && !get(body, "metadata.media") || frames && get(body, "metadata.media"))) fail("MEDIA_MODE_CONFLICT");
    if (!prompt && !anyMedia && !finalDraft && c.model !== "midjourney") fail("PROMPT");
    let path = `${c.mediaType === "image" ? "images" : "videos"}/generations`;
    if (c.model === "midjourney") {
        path = `midjourney/generations/${c.action}`;
        const initial = ["imagine", "blend", "edits"].includes(c.action!);
        if (!initial && !(c.action === "video" && refs) && !body.task_id) fail("PARENT_TASK_REQUIRED");
        if (["upscale", "variation", "high-variation", "low-variation", "remix-strong", "remix-subtle"].includes(c.action!) && !body.index && !body.custom_id) fail("ACTION_INDEX_REQUIRED");
        if (c.action === "video" && body.task_id && !body.index) fail("ACTION_INDEX_REQUIRED");
    }
    const taskAction = body.task_action; delete body.task_action;
    if (taskAction && taskAction !== "generate") {
        if (taskAction === "extend" && c.model === "grok-imagine-video-official") {
            if (!body.video_id && !n("source_video")) fail("PARENT_TASK_REQUIRED");
            if (Number(body.duration) < 2 || Number(body.duration) > 10) fail("DURATION");
        } else if (!body.video_id) fail("PARENT_TASK_REQUIRED");
        path = body.video_id ? `videos/${encodeURIComponent(String(body.video_id))}/${taskAction}` : "videos/extend";
        delete body.video_id;
        if (c.model === "sora-2-official") { if (anyMedia || params.duration || params.aspect_ratio) fail("REMIX_INHERITS_SETTINGS"); delete body.duration; delete body.aspect_ratio; }
        else if (c.model === "grok-video-1.0") { delete body.duration; delete body.resolution; }
    } else if (body.video_id || n("source_video") && c.model.startsWith("grok")) fail("ACTION_REQUIRED");
    if (request.clientTaskId && (c.model.startsWith("seedance") || c.model.startsWith("MiniMax-H3") || c.model.startsWith("qwen"))) {
        if (!TASK_ID.test(request.clientTaskId)) fail("CLIENT_TASK_ID"); body.client_business_id = request.clientTaskId;
    }
    const maxOutputs = c.model === "midjourney" ? 4 : c.model === "doubao-seedream-5-0-pro" && body.layer_decomposition ? 32 : Math.max(Number(body.n ?? 1), Number(get(body, "metadata.n") ?? 1), Number(get(body, "metadata.sequential_image_generation_options.max_images") ?? 1));
    return { body, path, contract: c, maxOutputs };
}

export class ToapisProvider implements GenerationProvider {
    readonly id = "toapis" as const;
    constructor(private readonly options: Options = {}) {}
    private config(override?: string) {
        const key = override ?? this.options.apiKey ?? process.env.TOAPIS_API_KEY;
        if (!key?.trim()) fail("NOT_CONFIGURED");
        return { key, origin: toapisOrigin(this.options.origin ?? process.env.TOAPIS_BASE_URL ?? "https://toapis.com") };
    }
    private async request(path: string, phase: "submit" | "poll", signal?: AbortSignal, body?: Json, origin?: string, secret?: string): Promise<Json> {
        const config = this.config(secret);
        const transport = createProviderTransport("TOAPIS", phase, signal, this.options.fetcher);
        transport.assertActive();
        try {
            const response = await transport.fetch(`${origin ?? config.origin}/v1/${path}`, { method: body ? "POST" : "GET", cache: "no-store", headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json", Accept: "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
            if (!response.ok) { await response.body?.cancel(); throw providerHttpError("TOAPIS", phase, response.status, response.headers.get("retry-after")); }
            let result: unknown; try { result = await response.json(); } catch { throw invalidProviderResponse("TOAPIS", phase); }
            return providerObject(result, "TOAPIS", phase);
        } catch (error) { throw transport.classify(error); }
    }
    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        const config = this.config(request.connection?.secret);
        if (request.signal?.aborted) fail("ABORTED");
        const { body, path, contract, maxOutputs } = buildToapisRequest(request);
        const response = await this.request(path, "submit", request.signal, body, contract.origin, request.connection?.secret);
        if (typeof response.id !== "string" || !TASK_ID.test(response.id) || response.model !== contract.model || response.object !== "generation.task" || !["pending", "queued", "in_progress", "completed", "failed"].includes(String(response.status))) throw invalidProviderResponse("TOAPIS", "submit");
        return { status: "CREATED", providerTaskId: response.id, operation: { version: 2, taskId: response.id, mediaType: request.mediaType, model: contract.model, origin: contract.origin ?? config.origin, maxOutputs, ...(contract.action ? { action: contract.action } : {}) } satisfies Operation };
    }
    async poll(request: ProviderPollRequest): Promise<ProviderPollResult> {
        const config = this.config(request.connection?.secret);
        const op = providerObject(request.operation, "TOAPIS", "poll") as unknown as Operation;
        const contract = getToapisContract(op.model, op.mediaType, op.action);
        if (![1, 2].includes(op.version) || typeof op.taskId !== "string" || !TASK_ID.test(op.taskId) || op.mediaType !== request.mediaType || op.model !== request.providerModelId || op.origin !== (contract?.origin ?? config.origin) || !contract || op.maxOutputs !== undefined && (!Number.isInteger(op.maxOutputs) || op.maxOutputs < 1 || op.maxOutputs > 32)) fail("OPERATION");
        const result = await this.request(op.model === "midjourney" ? `midjourney/${encodeURIComponent(op.taskId)}` : `${op.mediaType === "image" ? "images" : "videos"}/generations/${encodeURIComponent(op.taskId)}`, "poll", request.signal, undefined, contract?.origin, request.connection?.secret);
        if (result.id !== op.taskId || result.model !== op.model || result.object !== "generation.task") fail("TASK_IDENTITY");
        if (result.status === "failed" || result.status === "FAILURE") return { status: "FAILED", error: "ERR_TOAPIS_TASK_FAILED", operation: op };
        if (result.status === "MODAL" && op.model === "midjourney") return { status: "IN_PROGRESS", operation: { ...op, actionRequired: "mask" } };
        if (["pending", "queued", "in_progress", "NOT_START", "SUBMITTED", "IN_PROGRESS"].includes(String(result.status))) return { status: "IN_PROGRESS", operation: op };
        if (result.status !== "completed" && !(op.model === "midjourney" && result.status === "SUCCESS")) fail("STATUS");
        if (op.model === "midjourney" && !result.result) {
            const urls = op.mediaType === "video" ? result.video_urls : result.image_urls ?? (result.grid_image_url ? [result.grid_image_url] : undefined);
            if (!Array.isArray(urls) || !urls.length || urls.length > 4) throw invalidProviderResponse("TOAPIS", "poll");
            return { status: "COMPLETED", assets: urls.map(url => ({ url: publicMediaUrl(url, "ERR_TOAPIS_MEDIA_URL") })), operation: op };
        }
        const output = providerObject(result.result, "TOAPIS", "poll");
        if (output.type !== op.mediaType || !Array.isArray(output.data) || !output.data.length || output.data.length > (op.maxOutputs ?? 1)) throw invalidProviderResponse("TOAPIS", "poll");
        const assets = output.data.map(value => {
            const item = providerObject(value, "TOAPIS", "poll");
            const url = publicMediaUrl(item.url, "ERR_TOAPIS_MEDIA_URL");
            const formats: Record<string, string> = op.mediaType === "video" ? { mp4: "video/mp4", mov: "video/quicktime", gif: "image/gif" } : { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", webp: "image/webp" };
            if (item.format !== undefined && (typeof item.format !== "string" || !formats[item.format])) throw invalidProviderResponse("TOAPIS", "poll");
            return { url, ...(typeof item.format === "string" ? { mimeType: formats[item.format] } : op.mediaType === "video" ? { mimeType: "video/mp4" } : {}) };
        });
        return { status: "COMPLETED", assets, operation: op };
    }
}
