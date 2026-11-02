import "server-only";

import {
    experimental_getVideoStatus as getVideoStatus,
    experimental_startVideo as startVideo,
    generateImage,
    generateText,
    createGateway,
} from "ai";
import type { GenerationProvider, ProviderGenerationRequest, ProviderPollRequest, ProviderPollResult, ProviderSubmission } from "@/providers/types";
import sharp from "sharp";
import { getImageUrl, getMediaSlot } from "@/server/providers/utils";
import { getGatewayCapability, gatewayNamespace, GATEWAY_CATALOG } from "@/server/catalog/gateway";
import { parseModelFields, validateModelMedia, validateModelParams } from "@/models/parameter-schema";
import { createProviderTransport, invalidProviderResponse, ProviderRequestError, publicMediaUrl } from "@/server/providers/request-error";

function requireGatewayKey(override?: string) {
    const key = override ?? process.env.AI_GATEWAY_API_KEY;
    if (!key?.trim()) throw new ProviderRequestError("ERR_AI_GATEWAY_API_KEY_NOT_CONFIGURED");
    return key;
}

function gatewayResolution(resolution?: string, aspectRatio?: string): `${number}x${number}` | undefined {
    if (!resolution) return undefined;
    if (/^\d+x\d+$/.test(resolution)) return resolution as `${number}x${number}`;
    // The unified SDK expects pixel dimensions. Native tier options are used
    // below for vendors whose dimensions depend on their own ratio table.
    const [w, h] = (aspectRatio ?? "16:9").split(":").map(Number);
    const short = ({ "480p": 480, "720p": 720, "768p": 768, "1080p": 1080, "4k": 2160 } as Record<string, number>)[resolution.toLowerCase()];
    if (short && w > 0 && h > 0) return w >= h ? `${Math.round(short * w / h)}x${short}` : `${short}x${Math.round(short * h / w)}`;
    return undefined;
}

export class VercelAiGatewayProvider implements GenerationProvider {
    readonly id = "vercel-ai-gateway" as const;
    constructor(private readonly apiKey?: string) {}

    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        const apiKey = requireGatewayKey(request.connection?.secret ?? this.apiKey);
        const cap = request.capabilities.catalog_source === "custom" ? request.capabilities : getGatewayCapability(request.providerModelId);
        if (!cap || (cap.provider_mode === "video") !== (request.mediaType === "video")) throw new ProviderRequestError("ERR_GATEWAY_MODEL");
        const fields = parseModelFields(cap, request.params.field_values ?? {});
        request = { ...request, capabilities: cap, providerMode: cap.provider_mode, params: { ...request.params, field_values: fields.values } };
        if (fields.errors.length || validateModelParams(cap, request.params).length || validateModelMedia(cap, request.media).length) throw new ProviderRequestError("ERR_GATEWAY_PARAMETERS");
        validateGatewayRequest(request);
        const transport = createProviderTransport("GATEWAY", "submit", request.signal);
        transport.assertActive();
        const gateway = createGateway({ apiKey, fetch: transport.fetch });
        request = { ...request, signal: transport.signal };
        try {
            if (request.mediaType === "image") return await this.submitImage(request, gateway, transport.timeout);
            return await this.submitVideo(request, gateway);
        } catch (error) { throw transport.classify(error); }
    }

    private async submitVideo(request: ProviderGenerationRequest, gateway: ReturnType<typeof createGateway>): Promise<ProviderSubmission> {

        const startImage = getImageUrl(request.media, "start_image", "image", "input_image");
        const endImage = getImageUrl(request.media, "end_image");
        const frameImages = [
            ...(startImage ? [{ image: startImage, frameType: "first_frame" as const }] : []),
            ...(endImage ? [{ image: endImage, frameType: "last_frame" as const }] : []),
        ];
        const values = request.params.field_values ?? {};
        const generateAudio = request.params.generate_audio ?? values.generate_audio;
        const namespace = gatewayNamespace(request.providerModelId);
        const options = generationOptions(request);
        const referenceImages = getMediaSlot(request.media, "reference_images");
        const videoUrls = getMediaSlot(request.media, "reference_videos");
        const audioUrls = getMediaSlot(request.media, "reference_audio");
        const topaz = request.providerModelId.startsWith("topaz/");
        const grokVideoInput = request.providerModelId.startsWith("spacexai/") && videoUrls.length > 0;
        const motionControl = request.providerModelId.includes("motion-control");
        if (motionControl || grokVideoInput) options.videoUrl = videoUrls[0];
        if (grokVideoInput) options.mode = values.operationMode === "extend-video" ? "extend-video" : "edit-video";
        if (request.providerModelId.startsWith("minimax/") && audioUrls.length) options.referenceAudioUrls = audioUrls;
        else if (request.providerModelId.startsWith("bytedance/") && audioUrls.length) options.referenceAudio = audioUrls;
        else if (request.providerModelId.startsWith("alibaba/") && audioUrls.length) options.audioUrl = audioUrls[0];
        const keyframes = getMediaSlot(request.media, "keyframes");
        if (keyframes.length) options.keyframes = keyframes;
        const nativeResolution = /^(bfl|heygen|minimax|spacexai)\//.test(request.providerModelId);
        if (nativeResolution && request.params.resolution) options.resolution = request.providerModelId.startsWith("minimax/") ? request.params.resolution.toUpperCase() : request.params.resolution;
        const references = [
            ...referenceImages,
            ...(!grokVideoInput && !motionControl ? videoUrls.map(data => ({ data, mediaType: "video/mp4" })) : []),
            ...(request.providerModelId.startsWith("heygen/") ? audioUrls.map(data => ({ data, mediaType: "audio/mpeg" })) : []),
        ];
        const result = await startVideo({
            model: gateway.videoModel(request.providerModelId),
            maxRetries: 0,
            n: Number(values.n ?? 1),
            maxVideosPerCall: GATEWAY_CATALOG.find(model => model.id === request.providerModelId)?.video?.max_sample_count ?? 1,
            abortSignal: request.signal,
            prompt: request.params.prompt,
            duration: topaz || values.operationMode === "edit-video" ? undefined : request.params.duration ? Number(request.params.duration) : undefined,
            aspectRatio: topaz || grokVideoInput || (request.providerModelId.startsWith("heygen/") && startImage) ? undefined : request.params.aspect_ratio as `${number}:${number}` | undefined,
            resolution: nativeResolution || grokVideoInput ? undefined : gatewayResolution(request.params.resolution, request.params.aspect_ratio),
            fps: values.fps === undefined ? undefined : Number(values.fps),
            seed: topaz ? undefined : request.params.seed,
            frameImages: frameImages.length > 0 ? frameImages : undefined,
            inputReferences: references.length ? references : undefined,
            generateAudio: !topaz && typeof generateAudio === "boolean" ? generateAudio : undefined,
            providerOptions: { [namespace]: options } as never,
        });

        const metadata = result.providerMetadata as Record<string, Record<string, unknown>> | undefined;
        const gatewayMetadata = metadata?.gateway as Record<string, unknown> | undefined;
        const asyncJob = gatewayMetadata?.asyncJob as Record<string, unknown> | undefined;
        if (!validOperation(result.operation)) throw invalidProviderResponse("GATEWAY", "submit");
        return {
            status: "CREATED",
            operation: result.operation,
            providerTaskId: typeof asyncJob?.jobId === "string" ? asyncJob.jobId : undefined,
        };
    }

    private async submitImage(request: ProviderGenerationRequest, gateway: ReturnType<typeof createGateway>, timeout: number): Promise<ProviderSubmission> {
        const urls = request.capabilities.media_slots.filter(slot => slot.kind === "image" && slot.id !== "mask").flatMap(slot => getMediaSlot(request.media, slot.id));
        const options = generationOptions(request);
        const google = request.providerModelId.startsWith("google/");
        const quiver = request.providerModelId.startsWith("quiverai/");
        const namespace = google ? "google" : gatewayNamespace(request.providerModelId);
        if (request.providerMode === "language-image") {
            const content = [
                { type: "text" as const, text: request.params.prompt },
                ...urls.map((url) => ({ type: "image" as const, image: url })),
            ];
            const result = await generateText({
                model: gateway.languageModel(request.providerModelId),
                maxRetries: 0,
                abortSignal: request.signal,
                timeout: { totalMs: timeout },
                messages: [{ role: "user", content }],
                ...(quiver ? { temperature: options.temperature as number | undefined, maxOutputTokens: options.maxOutputTokens as number | undefined } : {}),
                providerOptions: { [namespace]: google ? {
                    ...options, responseModalities: ["IMAGE"],
                    imageConfig: { aspectRatio: request.params.aspect_ratio, imageSize: request.params.resolution },
                } : { reasoningEffort: options.reasoningEffort } } as never,
            });
            let assets = result.files
                .filter((file) => file.mediaType.startsWith("image/"))
                .map((file) => ({ data: file.uint8Array, mimeType: file.mediaType }));
            // Arrow's Responses surface may return the SVG document as text.
            if (quiver && !assets.length && /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(result.text)) assets = [{ data: Buffer.from(result.text), mimeType: "image/svg+xml" }];
            if (assets.length === 0 || assets.some(asset => !asset.data?.byteLength)) throw invalidProviderResponse("GATEWAY", "submit");
            return { status: "COMPLETED", assets: await Promise.all(assets.map(normalizeGatewayImage)) };
        }

        const mask = getImageUrl(request.media, "mask");
        if (request.params.resolution && request.providerModelId.startsWith("bfl/flux-3")) options.resolution = request.params.resolution;
        if (request.params.resolution && request.providerModelId.startsWith("spacexai/")) options.resolution = request.params.resolution;
        if (request.params.resolution && request.providerModelId.startsWith("bytedance/")) options.size = request.params.resolution;
        const size = typeof options.customSize === "string" ? options.customSize : request.params.size;
        delete options.customSize;
        const topaz = request.providerModelId.startsWith("topaz/");
        const result = await generateImage({
            model: gateway.imageModel(request.providerModelId),
            maxRetries: 0,
            abortSignal: request.signal,
            prompt: urls.length > 0 ? { text: topaz ? undefined : request.params.prompt, images: urls, ...(mask ? { mask } : {}) } : request.params.prompt,
            n: Number(request.params.field_values?.n ?? 1),
            size: size as `${number}x${number}` | undefined,
            aspectRatio: request.params.aspect_ratio as `${number}:${number}` | undefined,
            seed: topaz ? undefined : request.params.seed,
            providerOptions: { [namespace]: options } as never,
        });
        if (!result.images.length || result.images.some(image => !image.uint8Array?.byteLength)) throw invalidProviderResponse("GATEWAY", "submit");
        return {
            status: "COMPLETED",
            assets: await Promise.all(result.images.map((image) => normalizeGatewayImage({ data: image.uint8Array, mimeType: image.mediaType }))),
        };
    }

    async poll(request: ProviderPollRequest): Promise<ProviderPollResult> {
        const apiKey = requireGatewayKey(request.connection?.secret ?? this.apiKey);
        if (request.mediaType !== "video" || !validOperation(request.operation)) throw new ProviderRequestError("ERR_GATEWAY_OPERATION");
        const transport = createProviderTransport("GATEWAY", "poll", request.signal);
        transport.assertActive();
        const gateway = createGateway({ apiKey, fetch: transport.fetch });
        try {
            return await this.pollWithModel(request, gateway, transport.signal);
        } catch (error) { throw transport.classify(error); }
    }

    private async pollWithModel(request: ProviderPollRequest, gateway: ReturnType<typeof createGateway>, signal: AbortSignal): Promise<ProviderPollResult> {
        const result = await getVideoStatus(gateway.videoModel(request.providerModelId), { operation: request.operation as never, maxRetries: 0, abortSignal: signal });
        if (result.status === "pending") return { status: "IN_PROGRESS", operation: request.operation };
        if (result.status === "error") return { status: "FAILED", error: "ERR_GATEWAY_TASK_FAILED", operation: request.operation };
        if (result.status !== "completed" || !result.videos?.length) throw invalidProviderResponse("GATEWAY", "poll");

        return {
            status: "COMPLETED",
            operation: request.operation,
            assets: result.videos.map((video) => {
                if (video.type === "url") return { url: publicMediaUrl(video.url, "ERR_GATEWAY_OUTPUT"), mimeType: video.mediaType };
                const data = video.type === "base64" ? Buffer.from(video.data, "base64") : video.data;
                if (!(data instanceof Uint8Array) || !data.byteLength) throw invalidProviderResponse("GATEWAY", "poll");
                return { data, mimeType: video.mediaType };
            }),
        };
    }
}

function validOperation(value: unknown): boolean {
    if (typeof value === "string") return value.length > 0 && value.length <= 8000;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0) return false;
    try { return JSON.stringify(value).length <= 8000; } catch { return false; }
}

function generationOptions(request: ProviderGenerationRequest): Record<string, unknown> {
    const values = request.params.field_values ?? {};
    const options: Record<string, unknown> = {};
    const sdkFields = new Set(["n", "fps", "generate_audio", "operationMode"]);
    for (const field of request.capabilities.custom_fields) {
        const value = values[field.id];
        if (value !== undefined && !sdkFields.has(field.id)) options[field.id] = value;
    }
    if (request.capabilities.negative_prompt && request.params.negative_prompt) options.negativePrompt = request.params.negative_prompt;
    return options;
}

/** Reject invalid or mutually exclusive inputs before creating a paid remote job. */
function validateGatewayRequest(request: ProviderGenerationRequest): void {
    const reject = (): never => { throw new ProviderRequestError("ERR_GATEWAY_PARAMETERS"); };
    const { params, media, capabilities: cap, providerModelId: id } = request;
    const fields = params.field_values ?? {};
    if (params.seed !== undefined && (!Number.isSafeInteger(params.seed) || params.seed < 0 || params.seed > 4294967295)) reject();
    if (params.negative_prompt && (!cap.negative_prompt || params.negative_prompt.length > (id.startsWith("alibaba/") ? 500 : 2500))) reject();
    if (cap.prompt_supported === false && params.prompt) reject();
    for (const key of ["duration", "aspect_ratio", "size", "resolution"] as const) {
        const control = key === "resolution" ? cap.resolution_variant : cap[key];
        if (params[key] && !control) reject();
    }
    const known = new Set(cap.media_slots.map(slot => slot.id));
    for (const [slot, urls] of Object.entries(media.slots ?? {})) {
        if (!known.has(slot) && urls.length) reject();
    }
    for (const slot of cap.media_slots) for (const url of getMediaSlot(media, slot.id)) publicMediaUrl(url, "ERR_GATEWAY_INPUT", 8192);
    const start = getImageUrl(media, "start_image"), end = getImageUrl(media, "end_image");
    const images = getMediaSlot(media, "reference_images"), videos = getMediaSlot(media, "reference_videos"), audio = getMediaSlot(media, "reference_audio");
    if (end && !start) reject();
    if ((start || end) && (images.length || audio.length || (videos.length && !id.includes("motion-control")))) reject();
    const limits = GATEWAY_CATALOG.find(model => model.id === id)?.video?.input_limits;
    for (const kind of ["image", "video", "audio"] as const) {
        const count = cap.media_slots.filter(slot => slot.kind === kind).reduce((sum, slot) => sum + getMediaSlot(media, slot.id).length, 0);
        const maximum = limits?.[kind]?.max_count;
        if (maximum !== undefined && count > maximum) reject();
    }
    if (fields.n !== undefined && !Number.isSafeInteger(fields.n)) reject();
    if (id.startsWith("topaz/")) {
        if (params.seed !== undefined || params.generate_audio !== undefined) reject();
        const out = fields.output as Record<string, unknown> | undefined;
        if (out?.frameRate !== undefined) reject(); // No interpolation filter is exposed without a verified range contract.
    }
    if (id.startsWith("openai/") && typeof fields.customSize === "string") {
        const match = /^(\d+)x(\d+)$/.exec(fields.customSize);
        if (!match) reject();
        const width = Number(match![1]), height = Number(match![2]), area = width * height;
        if (width % 16 || height % 16 || width > 3840 || height > 3840 || width / height < 1 / 3 || width / height > 3 || area < 655360 || area > 8294400) reject();
    }
    if (id.startsWith("bytedance/") && request.mediaType === "image" && fields.sequentialImageGeneration === "auto" && images.length + Number(fields.maxImages ?? 1) > (id.endsWith("pro") ? 10 : 15)) reject();
    if (id.startsWith("minimax/") && audio.length && !images.length && !videos.length) reject();
    if (id.startsWith("heygen/")) {
        if (audio.length && !images.length && !videos.length) reject();
        if (images.length + videos.length + audio.length > 12) reject();
        if (params.generate_audio === false) reject();
        if (["1080p", "2k"].includes(params.resolution ?? "") && !start && params.aspect_ratio && !["16:9", "9:16"].includes(params.aspect_ratio)) reject();
    }
    if (id.startsWith("spacexai/")) {
        const mode = fields.operationMode;
        if ((mode === "edit-video" || mode === "extend-video") && videos.length !== 1) reject();
        if (mode === "reference-to-video" && !images.length) reject();
        if (videos.length && images.length) reject();
        if (videos.length && (!mode || mode === "generate" || mode === "reference-to-video")) reject();
        if (mode === "extend-video" && Number(params.duration ?? 6) > 10) reject();
        if (mode === "edit-video" && (params.duration || params.aspect_ratio || params.resolution)) reject();
        if (fields.referenceVoiceIds !== undefined && !images.length) reject();
        if (images.length && params.resolution === "1080p") reject();
        if (fields.keyframes !== undefined) {
            if (videos.length || !Array.isArray(fields.keyframes)) reject();
            for (const frame of fields.keyframes as Array<{ imageUrl: string; timestampSeconds: number }>) {
                publicMediaUrl(frame.imageUrl, "ERR_GATEWAY_INPUT");
                if (frame.timestampSeconds <= 0 || frame.timestampSeconds >= Number(params.duration ?? 15)) reject();
            }
        }
    }
    if (id.startsWith("bfl/") && request.mediaType === "video") {
        if (getMediaSlot(media, "keyframes").length && (start || end || videos.length)) reject();
        if (fields.draftCache && (start || end || images.length || videos.length || getMediaSlot(media, "keyframes").length)) reject();
    }
    if (id.startsWith("klingai/")) {
        if (fields.voiceList !== undefined && !(params.generate_audio ?? fields.generate_audio)) reject();
        const shots = fields.multiPrompt as Array<{ index: number; duration: string }> | undefined;
        if (fields.multiShot === true && !shots?.length) reject();
        if (shots && (fields.multiShot !== true || shots.some((shot, index) => shot.index !== index + 1) || shots.reduce((sum, shot) => sum + Number(shot.duration), 0) !== Number(params.duration))) reject();
        const camera = fields.cameraControl as { type?: string; config?: Record<string, number> } | undefined;
        if (camera?.type === "simple" && Object.values(camera.config ?? {}).filter(value => value !== 0).length !== 1) reject();
        if (camera && camera.type !== "simple" && camera.config !== undefined) reject();
    }
}

/** Keep generated SVG/TIFF out of the public asset path; rasterize in-process. */
export async function normalizeGatewayImage(asset: { data: Uint8Array; mimeType: string }): Promise<{ data: Uint8Array; mimeType: string }> {
    if (!asset.data.byteLength || asset.data.byteLength > 32 * 1024 * 1024) throw invalidProviderResponse("GATEWAY", "submit");
    const svg = asset.mimeType === "image/svg+xml";
    if (!svg && !["image/tiff", "image/tif"].includes(asset.mimeType)) return asset;
    if (svg) {
        const source = Buffer.from(asset.data).toString("utf8");
        const inspected = source.replace(/\sxmlns(?::[a-z]+)?\s*=\s*(["'])https?:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xlink)\1/gi, "");
        if (asset.data.byteLength > 2 * 1024 * 1024 || !/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(source)
            || /<!|<\?(?!xml\s)|\bon[a-z]+\s*=|\bstyle\s*=|@import|\\|(?:https?|file|data|ftp):/i.test(inspected)
            || /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(source)
            || /(?:xlink:)?href\s*=\s*["'](?!#)/i.test(source)
            || /url\s*\((?!\s*["']?#[\w.-]+["']?\s*\))/i.test(source)) throw invalidProviderResponse("GATEWAY", "submit");
        const allowed = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "clippath", "mask", "lineargradient", "radialgradient", "stop", "title", "desc", "pattern"]);
        for (const match of source.matchAll(/<\/?\s*([\w:-]+)/g)) if (!allowed.has(match[1].toLowerCase())) throw invalidProviderResponse("GATEWAY", "submit");
    }
    try {
        const pipeline = sharp(Buffer.from(asset.data), { limitInputPixels: 16_777_216, failOn: "warning", sequentialRead: true });
        const metadata = await pipeline.metadata();
        if (!metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192 || metadata.width * metadata.height > 16_777_216) throw new Error("Invalid dimensions");
        return { data: await pipeline.png().toBuffer(), mimeType: "image/png" };
    } catch { throw invalidProviderResponse("GATEWAY", "submit"); }
}
