import { GenerateVideosOperation, GoogleGenAI, type Image, type Part } from "@google/genai";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { readBoundedResponse } from "@/lib/media-transfer";
import type { GenerationProvider, ProviderGenerationRequest, ProviderPollRequest, ProviderPollResult, ProviderSubmission } from "./types";
import { fetchMedia, getImageUrl, getMediaUrls } from "./utils";
import { createProviderTransport, invalidProviderResponse, providerObject, ProviderRequestError, publicMediaUrl } from "./request-error";

type GoogleProviderId = "google-ai-studio" | "google-vertex";

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

function createGoogleClient(provider: GoogleProviderId, transport: ReturnType<typeof createProviderTransport>): GoogleGenAI {
    const httpOptions = { timeout: transport.timeout, retryOptions: { attempts: 1 }, fetch: transport.fetch };
    if (provider === "google-ai-studio") {
        const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
        if (!apiKey?.trim()) throw new ProviderRequestError("ERR_GEMINI_API_KEY_NOT_CONFIGURED");
        return new GoogleGenAI({ apiKey, httpOptions });
    }

    const project = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
    if (!project) throw new ProviderRequestError("ERR_GOOGLE_CLOUD_PROJECT_NOT_CONFIGURED");
    const credentials = parseCredentials();
    return new GoogleGenAI({
        vertexai: true,
        project,
        location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
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
    for (const url of getMediaUrls(request.media)) {
        const media = await fetchMedia(url, { signal: request.signal });
        parts.push({
            inlineData: {
                data: Buffer.from(media.data).toString("base64"),
                mimeType: media.mimeType,
            },
        });
    }
    return parts;
}

async function generateAiStudioImage(ai: GoogleGenAI, request: ProviderGenerationRequest, timeout: number) {
    const input: Array<
        { type: "text"; text: string } |
        { type: "image"; data: string; mime_type: string }
    > = [{ type: "text", text: request.params.prompt }];

    for (const url of getMediaUrls(request.media)) {
        const media = await fetchMedia(url, { signal: request.signal });
        input.push({
            type: "image",
            data: Buffer.from(media.data).toString("base64"),
            mime_type: media.mimeType,
        });
    }

    const interaction = await ai.interactions.create({
        model: request.providerModelId,
        input,
        response_format: {
            type: "image",
            aspect_ratio: request.params.aspect_ratio,
            image_size: request.params.resolution,
        },
    }, { retries: { strategy: "none" }, timeout_ms: timeout, signal: request.signal });
    const image = interaction.output_image;
    if (image?.data) {
        const data = Buffer.from(image.data, "base64");
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
    constructor(readonly id: GoogleProviderId) { }

    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        const transport = createProviderTransport("GOOGLE", "submit", request.signal);
        transport.assertActive();
        const ai = createGoogleClient(this.id, transport);
        request = { ...request, signal: transport.signal };
        try { return await this.submitWithClient(ai, request, transport.timeout); }
        catch (error) { throw transport.classify(error); }
    }

    private async submitWithClient(ai: GoogleGenAI, request: ProviderGenerationRequest, timeout: number): Promise<ProviderSubmission> {
        if (request.mediaType === "image") {
            if (this.id === "google-ai-studio") {
                return { status: "COMPLETED", assets: await generateAiStudioImage(ai, request, timeout) };
            }

            const response = await ai.models.generateContent({
                model: request.providerModelId,
                contents: [{ role: "user", parts: await buildImageParts(request) }],
                config: {
                    abortSignal: request.signal,
                    httpOptions: { timeout, retryOptions: { attempts: 1 } },
                    responseModalities: ["TEXT", "IMAGE"],
                    imageConfig: {
                        aspectRatio: request.params.aspect_ratio,
                        imageSize: request.params.resolution,
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

        const startUrl = getImageUrl(request.media, "start_image", "image", "input_image");
        const endUrl = getImageUrl(request.media, "end_image");
        const fieldValues = request.params.field_values ?? {};
        const operation = await ai.models.generateVideos({
            model: request.providerModelId,
            source: {
                prompt: request.params.prompt,
                image: startUrl ? await toGoogleImage(startUrl, request.signal) : undefined,
            },
            config: {
                abortSignal: request.signal,
                httpOptions: { timeout, retryOptions: { attempts: 1 } },
                numberOfVideos: 1,
                durationSeconds: request.params.duration ? Number(request.params.duration) : undefined,
                aspectRatio: request.params.aspect_ratio,
                resolution: request.params.resolution,
                seed: request.params.seed,
                negativePrompt: request.params.negative_prompt,
                enhancePrompt: request.params.expand_prompt,
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
        if (request.mediaType !== "video" || !validOperationName(reference.name)) throw new ProviderRequestError("ERR_GOOGLE_OPERATION");
        const transport = createProviderTransport("GOOGLE", "poll", request.signal);
        transport.assertActive();
        const ai = createGoogleClient(this.id, transport);
        try { return await this.pollWithClient(ai, reference.name, transport); }
        catch (error) { throw transport.classify(error); }
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
                const data = Buffer.from(video.videoBytes, "base64");
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
