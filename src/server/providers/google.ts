import "server-only";

import { GenerateVideosOperation, GoogleGenAI, ImageResizeMode, VideoCompressionQuality, type Image, type Part, type Interactions, ThinkingLevel, VideoGenerationReferenceType } from "@google/genai";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { readBoundedResponse } from "@/server/media/transfer";
import type { GenerationProvider, ProviderGenerationRequest, ProviderPollRequest, ProviderPollResult, ProviderSubmission } from "@/providers/types";
import { fetchMedia, getImageUrl, getMediaUrls } from "@/server/providers/utils";
import { createProviderTransport, invalidProviderResponse, providerObject, ProviderRequestError, publicMediaUrl } from "@/server/providers/request-error";

type GoogleProviderId = "google-ai-studio" | "google-vertex";

interface GoogleProviderOptions {
    apiKey?: string;
    project?: string;
    location?: string;
    veoLocation?: string;
    credentials?: Record<string, unknown>;
}

function parseCredentials(): Record<string, unknown> | undefined {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? process.env.GOOGLE_CLOUD_CREDENTIALS;
    if (!raw) return undefined;
    try {
        const credentials = JSON.parse(raw);
        if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) throw new Error();
        return credentials as Record<string, unknown>;
    } catch {
        throw new ProviderRequestError("ERR_INVALID_GOOGLE_SERVICE_ACCOUNT_JSON");
    }
}

function createGoogleClient(provider: GoogleProviderId, transport: ReturnType<typeof createProviderTransport>, model?: string, options: GoogleProviderOptions = {}): GoogleGenAI {
    const httpOptions = { timeout: transport.timeout, retryOptions: { attempts: 1 }, fetch: transport.fetch };
    if (provider === "google-ai-studio") {
        const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
        if (!apiKey?.trim()) throw new ProviderRequestError("ERR_GEMINI_API_KEY_NOT_CONFIGURED");
        return new GoogleGenAI({ apiKey, httpOptions });
    }

    const project = options.project ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
    if (!project) throw new ProviderRequestError("ERR_GOOGLE_CLOUD_PROJECT_NOT_CONFIGURED");
    const credentials = options.credentials ?? parseCredentials();
    return new GoogleGenAI({
        vertexai: true,
        project,
        location: model?.startsWith("veo-") ? (options.veoLocation ?? process.env.GOOGLE_VEO_LOCATION ?? "us-central1") : (options.location ?? process.env.GOOGLE_CLOUD_LOCATION ?? "global"),
        googleAuthOptions: credentials ? { credentials } : undefined,
        httpOptions,
    });
}

async function toGoogleImage(url: string, signal?: AbortSignal): Promise<Image> {
    const media = await fetchMedia(url, { signal });
    return {
        imageBytes: Buffer.from(media.data).toString("base64"),
        mimeType: media.mimeType,
    };
}

async function buildImageParts(request: ProviderGenerationRequest): Promise<Part[]> {
    const parts: Part[] = [{ text: request.params.prompt }];
    for (const url of imageUrls(request)) {
        const media = await fetchMedia(url, { signal: request.signal });
        parts.push({
            inlineData: {
                data: Buffer.from(media.data).toString("base64"),
                mimeType: media.mimeType,
            },
        });
    }
    for (const url of slot(request, "input_video")) {
        const media = await fetchMedia(url, { signal: request.signal });
        parts.push({ inlineData: { data: Buffer.from(media.data).toString("base64"), mimeType: media.mimeType } });
    }
    return parts;
}

async function generateAiStudioImage(ai: GoogleGenAI, request: ProviderGenerationRequest, timeout: number) {
    const input: Array<
        { type: "text"; text: string } |
        { type: "image" | "video"; data: string; mime_type: string }
    > = [{ type: "text", text: request.params.prompt }];

    for (const url of imageUrls(request)) {
        const media = await fetchMedia(url, { signal: request.signal });
        input.push({
            type: "image",
            data: Buffer.from(media.data).toString("base64"),
            mime_type: media.mimeType,
        });
    }

    for (const url of slot(request, "input_video")) {
        const media = await fetchMedia(url, { signal: request.signal });
        input.push({ type: "video", data: Buffer.from(media.data).toString("base64"), mime_type: media.mimeType });
    }
    const fields = request.params.field_values ?? {};
    const interaction = await ai.interactions.create({
        model: request.providerModelId,
        input,
        store: false,
        system_instruction: textField(fields, "system_instruction"),
        generation_config: { thinking_level: textField(fields, "thinking_level") },
        tools: searchTypes(fields).length ? [{ type: "google_search", search_types: searchTypes(fields) }] : undefined,
        response_format: {
            type: "image",
            mime_type: textField(fields, "output_mime_type"),
            aspect_ratio: request.params.aspect_ratio,
            image_size: request.params.resolution,
        },
    }, { retries: { strategy: "none" }, timeout_ms: timeout, signal: request.signal });
    const image = interaction.output_image;
    if (image?.data) {
        const data = decodeBounded(image.data);
        if (!data.byteLength) throw invalidProviderResponse("GOOGLE", "submit");
        return [{ data, mimeType: image.mime_type ?? "image/png" }];
    }
    if (image?.uri) {
        try { return [{ url: publicMediaUrl(image.uri, "ERR_GOOGLE_OUTPUT"), mimeType: image.mime_type ?? "image/png" }]; }
        catch { throw invalidProviderResponse("GOOGLE", "submit"); }
    }
    throw invalidProviderResponse("GOOGLE", "submit");
}

export class GoogleProvider implements GenerationProvider {
    constructor(readonly id: GoogleProviderId, private readonly options: GoogleProviderOptions = {}) { }

    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        validateGoogleRequest(request);
        const transport = createProviderTransport("GOOGLE", "submit", request.signal);
        transport.assertActive();
        const ai = createGoogleClient(this.id, transport, request.providerModelId, this.optionsFromRequest(request));
        request = { ...request, signal: transport.signal };
        try { return await this.submitWithClient(ai, request, transport.timeout); }
        catch (error) { throw transport.classify(error); }
    }

    private async submitWithClient(ai: GoogleGenAI, request: ProviderGenerationRequest, timeout: number): Promise<ProviderSubmission> {
        if (request.mediaType === "image") {
            if (this.id === "google-ai-studio") {
                return { status: "COMPLETED", assets: await generateAiStudioImage(ai, request, timeout) };
            }

            const fields = request.params.field_values ?? {};
            const response = await ai.models.generateContent({
                model: request.providerModelId,
                contents: [{ role: "user", parts: await buildImageParts(request) }],
                config: {
                    abortSignal: request.signal,
                    httpOptions: { timeout, retryOptions: { attempts: 1 } },
                    responseModalities: ["TEXT", "IMAGE"],
                    systemInstruction: textField(fields, "system_instruction"),
                    temperature: numberField(fields, "temperature"),
                    topP: numberField(fields, "top_p"),
                    thinkingConfig: textField(fields, "thinking_level") ? { thinkingLevel: textField(fields, "thinking_level")!.toUpperCase() as ThinkingLevel } : undefined,
                    tools: searchTypes(fields).length ? [{ googleSearch: { searchTypes: { ...(searchTypes(fields).includes("web_search") ? { webSearch: {} } : {}), ...(searchTypes(fields).includes("image_search") ? { imageSearch: {} } : {}) } } }] : undefined,
                    imageConfig: {
                        aspectRatio: request.params.aspect_ratio,
                        imageSize: request.params.resolution,
                        personGeneration: textField(fields, "person_generation"),
                        imageOutputOptions: { mimeType: textField(fields, "output_mime_type"), compressionQuality: numberField(fields, "output_compression_quality") },
                    },
                },
            });

            const assets = (response.candidates ?? []).flatMap((candidate) => candidate.content?.parts ?? [])
                .filter((part) => part.inlineData?.data)
                .map((part) => ({
                    data: Buffer.from(part.inlineData!.data!, "base64"),
                    mimeType: part.inlineData?.mimeType ?? "image/png",
                }));
            if (assets.length === 0 || assets.some(asset => !asset.data.byteLength)) throw invalidProviderResponse("GOOGLE", "submit");
            return { status: "COMPLETED", assets };
        }

        if (request.providerModelId.startsWith("gemini-omni-")) {
            const fields = request.params.field_values ?? {};
            const input: Interactions.Content[] = [{ type: "text", text: omniPrompt(request) }];
            for (const [kind, urls] of [["image", imageUrls(request)], ["video", slot(request, "input_video")], ["audio", slot(request, "input_audio")]] as const) for (const url of urls) {
                const media = await fetchMedia(url, { signal: request.signal });
                input.push({ type: kind, data: Buffer.from(media.data).toString("base64"), mime_type: media.mimeType });
            }
            const task = textField(fields, "task");
            const interaction = await ai.interactions.create({
                model: request.providerModelId, input, background: true, store: true, stream: false,
                response_format: { type: "video", delivery: this.id === "google-vertex" ? "inline" : "uri", aspect_ratio: request.params.aspect_ratio,
                    resolution: request.params.resolution, duration: request.params.duration ? `${request.params.duration}s` : undefined },
                generation_config: task && task !== "auto" ? { video_config: { task } } : undefined,
            }, { retries: { strategy: "none" }, timeout_ms: timeout, signal: request.signal });
            if (!validInteractionId(interaction.id)) throw invalidProviderResponse("GOOGLE", "submit");
            // Always recover through GET, even if the POST completes immediately. Never persist upstream media bytes.
            return { status: "CREATED", providerTaskId: interaction.id, operation: { kind: "interaction", id: interaction.id } };
        }
        const startUrl = getImageUrl(request.media, "start_image", "image", "input_image");
        const endUrl = getImageUrl(request.media, "end_image");
        const fieldValues = request.params.field_values ?? {};
        const videoUrl = slot(request, "input_video")[0];
        const referenceImages = await Promise.all(slot(request, "reference_images").map(async url => ({ image: await toGoogleImage(url, request.signal), referenceType: VideoGenerationReferenceType.ASSET })));
        const videoMedia = videoUrl ? await fetchMedia(videoUrl, { signal: request.signal }) : undefined;
        const operation = await ai.models.generateVideos({
            model: request.providerModelId,
            source: {
                prompt: request.params.prompt,
                image: startUrl ? await toGoogleImage(startUrl, request.signal) : undefined,
                video: videoMedia ? { videoBytes: Buffer.from(videoMedia.data).toString("base64"), mimeType: videoMedia.mimeType } : undefined,
            },
            config: {
                abortSignal: request.signal,
                httpOptions: { timeout, retryOptions: { attempts: 1 } },
                numberOfVideos: numberField(fieldValues, "number_of_videos") ?? 1,
                personGeneration: textField(fieldValues, "person_generation"),
                referenceImages: referenceImages.length ? referenceImages : undefined,
                durationSeconds: videoUrl ? undefined : (request.params.duration ? Number(request.params.duration) : undefined),
                aspectRatio: request.params.aspect_ratio,
                resolution: request.params.resolution,
                seed: request.params.seed,
                negativePrompt: request.params.negative_prompt,
                enhancePrompt: request.params.expand_prompt,
                resizeMode: textField(fieldValues, "resize_mode") as ImageResizeMode | undefined,
                compressionQuality: textField(fieldValues, "compression_quality") as VideoCompressionQuality | undefined,
                generateAudio: this.id === "google-vertex"
                    ? typeof fieldValues.generate_audio === "boolean" ? fieldValues.generate_audio : true
                    : undefined,
                lastFrame: endUrl ? await toGoogleImage(endUrl, request.signal) : undefined,
            },
        });

        if (!validOperationName(operation.name)) throw invalidProviderResponse("GOOGLE", "submit");
        return {
            status: operation.done ? "IN_PROGRESS" : "CREATED",
            providerTaskId: operation.name,
            operation: { name: operation.name },
        };
    }

    async poll(request: ProviderPollRequest): Promise<ProviderPollResult> {
        const reference = providerObject(request.operation, "GOOGLE", "poll");
        if (request.mediaType !== "video") throw new ProviderRequestError("ERR_GOOGLE_OPERATION");
        if (reference.kind === "interaction") {
            if (!request.providerModelId.startsWith("gemini-omni-") || !validInteractionId(reference.id)) throw new ProviderRequestError("ERR_GOOGLE_OPERATION");
            const transport = createProviderTransport("GOOGLE", "poll", request.signal);
            transport.assertActive();
            const ai = createGoogleClient(this.id, transport, request.providerModelId, this.optionsFromRequest(request));
            try {
                const interaction = await ai.interactions.get(reference.id, { include_input: false }, { retries: { strategy: "none" }, timeout_ms: transport.timeout, signal: transport.signal });
                if (interaction.id !== reference.id) throw invalidProviderResponse("GOOGLE", "poll");
                const serialized = { kind: "interaction", id: reference.id };
                if (["queued", "in_progress"].includes(interaction.status)) return { status: "IN_PROGRESS", operation: serialized };
                if (interaction.status === "cancelled") return { status: "CANCELLED", error: "ERR_GOOGLE_TASK_CANCELLED", operation: serialized };
                if (["failed", "incomplete", "budget_exceeded", "requires_action"].includes(interaction.status)) return { status: "FAILED", error: "ERR_GOOGLE_TASK_FAILED", operation: serialized };
                if (interaction.status !== "completed" || !interaction.output_video) throw invalidProviderResponse("GOOGLE", "poll");
                const output = interaction.output_video;
                if (output.data) return { status: "COMPLETED", assets: [{ data: decodeBounded(output.data), mimeType: output.mime_type ?? "video/mp4" }], operation: serialized };
                const uri = validGoogleFileUri(output.uri);
                const name = new URL(uri).pathname.replace(/^\/v1(?:beta)?\//, "").replace(/:download$/, "");
                const file = await ai.files.get({ name, config: { abortSignal: transport.signal, httpOptions: { timeout: transport.timeout, retryOptions: { attempts: 1 } } } });
                if (file.state === "PROCESSING") return { status: "IN_PROGRESS", operation: serialized };
                if (file.state === "FAILED") return { status: "FAILED", error: "ERR_GOOGLE_TASK_FAILED", operation: serialized };
                if (file.state !== "ACTIVE") throw invalidProviderResponse("GOOGLE", "poll");
                return { status: "COMPLETED", assets: [{ data: await downloadVideo(ai, { uri, mimeType: output.mime_type }, transport), mimeType: output.mime_type ?? "video/mp4" }], operation: serialized };
            } catch (error) { throw transport.classify(error); }
        }
        if (!validOperationName(reference.name)) throw new ProviderRequestError("ERR_GOOGLE_OPERATION");
        const transport = createProviderTransport("GOOGLE", "poll", request.signal);
        transport.assertActive();
        const ai = createGoogleClient(this.id, transport, request.providerModelId, this.optionsFromRequest(request));
        try { return await this.pollWithClient(ai, reference.name, transport); }
        catch (error) { throw transport.classify(error); }
    }

    private optionsFromRequest(request: ProviderGenerationRequest | ProviderPollRequest): GoogleProviderOptions {
        const context = request.connection;
        const metadata = context?.metadata ?? {};
        if (this.id === "google-ai-studio") return { apiKey: context?.secret };
        let credentials: Record<string, unknown> | undefined;
        if (context?.secret) {
            try { const parsed = JSON.parse(context.secret); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) credentials = parsed; } catch { throw new ProviderRequestError("ERR_INVALID_GOOGLE_SERVICE_ACCOUNT_JSON"); }
        }
        return { credentials, project: typeof metadata.project === "string" ? metadata.project : undefined, location: typeof metadata.location === "string" ? metadata.location : undefined, veoLocation: typeof metadata.veoLocation === "string" ? metadata.veoLocation : undefined };
    }

    private async pollWithClient(ai: GoogleGenAI, operationName: string, transport: ReturnType<typeof createProviderTransport>): Promise<ProviderPollResult> {
        // Legacy records may contain outputs; the SDK only needs the validated name.
        const operationReference = Object.assign(new GenerateVideosOperation(), { name: operationName });
        const operation = await ai.operations.getVideosOperation({
            operation: operationReference,
            config: { abortSignal: transport.signal, httpOptions: { timeout: transport.timeout, retryOptions: { attempts: 1 } } },
        });
        if (operation.name !== operationReference.name) throw invalidProviderResponse("GOOGLE", "poll");
        if (operation.done !== undefined && typeof operation.done !== "boolean") throw invalidProviderResponse("GOOGLE", "poll");

        const serialized = { name: operationName };
        if (operation.error) {
            providerObject(operation.error, "GOOGLE", "poll");
            return { status: "FAILED", error: "ERR_GOOGLE_TASK_FAILED", operation: serialized };
        }
        if (!operation.done) return { status: "IN_PROGRESS", operation: serialized };

        const assets = [];
        for (const generated of operation.response?.generatedVideos ?? []) {
            const video = generated.video;
            if (!video) continue;
            if (video.videoBytes) {
                const data = decodeBounded(video.videoBytes);
                if (!data.byteLength) throw invalidProviderResponse("GOOGLE", "poll");
                assets.push({ data, mimeType: video.mimeType ?? "video/mp4" });
                continue;
            }

            const downloadPath = path.join("/tmp", `google-video-${randomUUID()}.mp4`);
            const uri = publicMediaUrl(video.uri, "ERR_GOOGLE_OUTPUT");
            const url = new URL(uri);
            if (url.hostname !== "generativelanguage.googleapis.com" || !/^\/v1(?:beta)?\/files\/[a-z0-9]+(?::download)?$/.test(url.pathname)) {
                throw new ProviderRequestError("ERR_GOOGLE_OUTPUT");
            }
            try {
                await ai.files.download({ file: video, downloadPath, config: {
                    abortSignal: transport.signal,
                    httpOptions: { timeout: transport.timeout, retryOptions: { attempts: 1 }, fetch: async (input, init) => {
                        const response = await transport.fetch(input, init);
                        if (!response.ok) return response;
                        // The SDK's pipe does not forward source errors; finish the bounded read first.
                        const data = await readBoundedResponse(response, { maxBytes: 64 * 1024 * 1024, signal: transport.signal });
                        return new Response(new Uint8Array(data), { status: response.status, headers: response.headers });
                    } },
                } });
                const data = await fs.readFile(downloadPath);
                if (!data.byteLength) throw invalidProviderResponse("GOOGLE", "poll");
                assets.push({ data, mimeType: video.mimeType ?? "video/mp4" });
            } finally {
                await fs.unlink(downloadPath).catch(() => undefined);
            }
        }

        if (assets.length === 0) throw invalidProviderResponse("GOOGLE", "poll");
        return { status: "COMPLETED", assets, operation: serialized };
    }
}

function validOperationName(value: unknown): value is string {
    return typeof value === "string" && value.length <= 1000 && /^[A-Za-z0-9_./-]+$/.test(value)
        && !value.includes("..") && !value.includes("//") && /(?:^|\/)operations\/[A-Za-z0-9_-]+$/.test(value);
}

function validInteractionId(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(value);
}
function textField(fields: Record<string, unknown>, key: string): string | undefined {
    return typeof fields[key] === "string" && fields[key] !== "" ? fields[key] : undefined;
}
function numberField(fields: Record<string, unknown>, key: string): number | undefined {
    return typeof fields[key] === "number" && Number.isFinite(fields[key]) ? fields[key] : undefined;
}
function searchTypes(fields: Record<string, unknown>): Array<"web_search" | "image_search"> {
    const mode = fields.google_search;
    return mode === "web" ? ["web_search"] : mode === "image" ? ["image_search"] : mode === "web_and_image" ? ["web_search", "image_search"] : [];
}
function slot(request: ProviderGenerationRequest, name: string): string[] {
    const slots = request.media.slots?.[name];
    if (slots) return slots;
    const image = (request.media.images as Record<string, unknown> | undefined)?.[name];
    if (Array.isArray(image)) return image.filter((value): value is string => typeof value === "string");
    if (typeof image === "string") return [image];
    if (name === "input_video" && request.media.video) return [request.media.video];
    if (name === "input_audio" && request.media.audio) return [request.media.audio];
    return [];
}
function validateGoogleRequest(request: ProviderGenerationRequest) {
    const fail = () => { throw new ProviderRequestError("ERR_GOOGLE_PARAMETERS"); };
    const fields = request.params.field_values ?? {};
    for (const capability of request.capabilities.media_slots ?? []) {
        const count = slot(request, capability.id).length;
        if (capability.max_count !== undefined && count > capability.max_count) fail();
        if (capability.min_count !== undefined && count < capability.min_count) fail();
        if (!capability.multiple && count > 1) fail();
    }
    if (request.mediaType === "image") {
        if (request.params.field_values?.output_compression_quality !== undefined && fields.output_mime_type !== "image/jpeg") fail();
        if (request.providerModelId === "gemini-nano-banana-2.1" && (request.params.seed !== undefined || fields.temperature !== undefined || fields.top_p !== undefined)) fail();
        return;
    }
    if (request.providerModelId.startsWith("gemini-omni-")) {
        if (request.params.negative_prompt || request.params.expand_prompt || request.params.seed !== undefined || fields.temperature !== undefined || fields.top_p !== undefined || fields.generate_audio !== undefined) fail();
        if (request.capabilities.provider === "google-vertex" && slot(request, "input_audio").length) fail();
        if (imageUrls(request).length > 10 || slot(request, "input_video").length > 3) fail();
        if (slot(request, "end_image").length && !slot(request, "start_image").length) fail();
        if (["extend", "edit"].includes(String(fields.task)) && slot(request, "input_video").length !== 1) fail();
        if (fields.task === "extend" || fields.task === "edit") { if (!slot(request, "input_video").length) fail(); }
        if (fields.task === "image_to_video" && !imageUrls(request).length) fail();
        return;
    }
    if (request.providerModelId === "veo-3.1-generate-preview" && request.capabilities.deprecated) throw new ProviderRequestError("ERR_GOOGLE_MODEL_RETIRED");
    const refs = slot(request, "reference_images");
    const start = getImageUrl(request.media, "start_image", "image", "input_image");
    const end = getImageUrl(request.media, "end_image");
    const video = slot(request, "input_video");
    if (end && !start || refs.length > 3 || refs.length && (start || end || video.length) || video.length && (start || end)) fail();
    if (refs.length && (request.params.duration ?? "8") !== "8") fail();
    if (request.providerModelId.includes("lite") && (imageUrls(request).length || video.length)) fail();
    if (request.params.resolution === "4k" && request.providerModelId !== "veo-3.1-generate-001") fail();
    if (numberField(fields, "number_of_videos") !== undefined && (numberField(fields, "number_of_videos")! < 1 || numberField(fields, "number_of_videos")! > 4)) fail();
    if (request.params.seed !== undefined && (!Number.isInteger(request.params.seed) || request.params.seed < 0 || request.params.seed > 4294967295)) fail();
}
function decodeBounded(value: string): Buffer {
    if (value.length > Math.ceil(64 * 1024 * 1024 / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new ProviderRequestError("ERR_GOOGLE_OUTPUT");
    const data = Buffer.from(value, "base64");
    if (!data.length || data.length > 64 * 1024 * 1024) throw new ProviderRequestError("ERR_GOOGLE_OUTPUT");
    return data;
}
function validGoogleFileUri(value: unknown): string {
    const uri = publicMediaUrl(value, "ERR_GOOGLE_OUTPUT");
    const url = new URL(uri);
    if (url.hostname !== "generativelanguage.googleapis.com" || !/^\/v1(?:beta)?\/files\/[a-z0-9]+(?::download)?$/.test(url.pathname)) throw new ProviderRequestError("ERR_GOOGLE_OUTPUT");
    return uri;
}
async function downloadVideo(ai: GoogleGenAI, video: { uri: string; mimeType?: string }, transport: ReturnType<typeof createProviderTransport>): Promise<Buffer> {
    validGoogleFileUri(video.uri);
    const downloadPath = path.join("/tmp", `google-video-${randomUUID()}.mp4`);
    try {
        await ai.files.download({ file: video, downloadPath, config: {
            abortSignal: transport.signal,
            httpOptions: { timeout: transport.timeout, retryOptions: { attempts: 1 }, fetch: async (input, init) => {
                const response = await transport.fetch(input, init);
                if (!response.ok) return response;
                const data = await readBoundedResponse(response, { maxBytes: 64 * 1024 * 1024, signal: transport.signal });
                return new Response(new Uint8Array(data), { status: response.status, headers: response.headers });
            } },
        } });
        const data = await fs.readFile(downloadPath);
        if (!data.length || data.length > 64 * 1024 * 1024) throw invalidProviderResponse("GOOGLE", "poll");
        return data;
    } finally { await fs.unlink(downloadPath).catch(() => undefined); }
}
function imageUrls(request: ProviderGenerationRequest): string[] {
    const imageSlots = request.capabilities.media_slots?.filter(value => value.kind === "image");
    if (request.media.slots && imageSlots?.length) return imageSlots.flatMap(value => slot(request, value.id));
    return getMediaUrls(request.media);
}

function omniPrompt(request: ProviderGenerationRequest): string {
    const images = imageUrls(request);
    const first = slot(request, "start_image")[0];
    const last = slot(request, "end_image")[0];
    const sources = [first ? `<FIRST_FRAME>@Image${images.indexOf(first) + 1}` : "", last ? `<LAST_FRAME>@Image${images.indexOf(last) + 1}` : ""].filter(Boolean);
    const task = request.params.field_values?.task;
    if (slot(request, "input_video").length && task === "extend") sources.push("<PREVIOUS_VIDEO>@Video1");
    if (slot(request, "input_video").length && task === "edit") sources.push("<VIDEO_0>@Video1");
    return sources.length ? `${request.params.prompt}\n[# Sources ${sources.join(" ")}]` : request.params.prompt;
}
