import { GenerateVideosOperation, GoogleGenAI, type Image, type Part } from "@google/genai";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { GenerationProvider, ProviderGenerationRequest, ProviderPollRequest, ProviderPollResult, ProviderSubmission } from "./types";
import { errorMessage, fetchMedia, getImageUrl, getMediaUrls, toSerializable } from "./utils";

type GoogleProviderId = "google-ai-studio" | "google-vertex";

function parseCredentials(): Record<string, unknown> | undefined {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? process.env.GOOGLE_CLOUD_CREDENTIALS;
    if (!raw) return undefined;
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    } catch {
        throw new Error("ERR_INVALID_GOOGLE_SERVICE_ACCOUNT_JSON");
    }
}

function createGoogleClient(provider: GoogleProviderId): GoogleGenAI {
    if (provider === "google-ai-studio") {
        const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
        if (!apiKey) throw new Error("ERR_GEMINI_API_KEY_NOT_CONFIGURED");
        return new GoogleGenAI({ apiKey });
    }

    const project = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
    if (!project) throw new Error("ERR_GOOGLE_CLOUD_PROJECT_NOT_CONFIGURED");
    const credentials = parseCredentials();
    return new GoogleGenAI({
        vertexai: true,
        project,
        location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
        googleAuthOptions: credentials ? { credentials } : undefined,
    });
}

async function toGoogleImage(url: string): Promise<Image> {
    const media = await fetchMedia(url);
    return {
        imageBytes: Buffer.from(media.data).toString("base64"),
        mimeType: media.mimeType,
    };
}

async function buildImageParts(request: ProviderGenerationRequest): Promise<Part[]> {
    const parts: Part[] = [{ text: request.params.prompt }];
    for (const url of getMediaUrls(request.media)) {
        const media = await fetchMedia(url);
        parts.push({
            inlineData: {
                data: Buffer.from(media.data).toString("base64"),
                mimeType: media.mimeType,
            },
        });
    }
    return parts;
}

async function generateAiStudioImage(ai: GoogleGenAI, request: ProviderGenerationRequest) {
    const input: Array<
        { type: "text"; text: string } |
        { type: "image"; data: string; mime_type: string }
    > = [{ type: "text", text: request.params.prompt }];

    for (const url of getMediaUrls(request.media)) {
        const media = await fetchMedia(url);
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
    });
    const image = interaction.output_image;
    if (image?.data) {
        return [{ data: Buffer.from(image.data, "base64"), mimeType: image.mime_type ?? "image/png" }];
    }
    if (image?.uri) return [{ url: image.uri, mimeType: image.mime_type ?? "image/png" }];
    throw new Error("ERR_NO_IMAGE_GENERATED");
}

export class GoogleProvider implements GenerationProvider {
    constructor(readonly id: GoogleProviderId) { }

    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        const ai = createGoogleClient(this.id);
        if (request.mediaType === "image") {
            if (this.id === "google-ai-studio") {
                return { status: "COMPLETED", assets: await generateAiStudioImage(ai, request) };
            }

            const response = await ai.models.generateContent({
                model: request.providerModelId,
                contents: [{ role: "user", parts: await buildImageParts(request) }],
                config: {
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
            if (assets.length === 0) throw new Error("ERR_NO_IMAGE_GENERATED");
            return { status: "COMPLETED", assets };
        }

        const startUrl = getImageUrl(request.media, "start_image", "image", "input_image");
        const endUrl = getImageUrl(request.media, "end_image");
        const fieldValues = request.params.field_values ?? {};
        const operation = await ai.models.generateVideos({
            model: request.providerModelId,
            prompt: request.params.prompt,
            image: startUrl ? await toGoogleImage(startUrl) : undefined,
            config: {
                numberOfVideos: 1,
                durationSeconds: request.params.duration ? Number(request.params.duration) : undefined,
                aspectRatio: request.params.aspect_ratio,
                resolution: request.params.resolution,
                seed: request.params.seed,
                negativePrompt: request.params.negative_prompt,
                enhancePrompt: request.params.expand_prompt,
                generateAudio: typeof fieldValues.generate_audio === "boolean" ? fieldValues.generate_audio : true,
                lastFrame: endUrl ? await toGoogleImage(endUrl) : undefined,
            },
        });

        return {
            status: operation.done ? "IN_PROGRESS" : "CREATED",
            providerTaskId: operation.name,
            operation: toSerializable(operation),
        };
    }

    async poll(request: ProviderPollRequest): Promise<ProviderPollResult> {
        const ai = createGoogleClient(this.id);
        let operation: GenerateVideosOperation;
        try {
            const operationReference = Object.assign(new GenerateVideosOperation(), request.operation);
            operation = await ai.operations.getVideosOperation({
                operation: operationReference,
            });
        } catch (error) {
            return { status: "ERROR", error: errorMessage(error), operation: request.operation };
        }

        const serialized = toSerializable(operation);
        if (operation.error) {
            return { status: "FAILED", error: errorMessage(operation.error), operation: serialized };
        }
        if (!operation.done) return { status: "IN_PROGRESS", operation: serialized };

        const assets = [];
        for (const generated of operation.response?.generatedVideos ?? []) {
            const video = generated.video;
            if (!video) continue;
            if (video.videoBytes) {
                assets.push({ data: Buffer.from(video.videoBytes, "base64"), mimeType: video.mimeType ?? "video/mp4" });
                continue;
            }

            const downloadPath = path.join("/tmp", `google-video-${randomUUID()}.mp4`);
            try {
                await ai.files.download({ file: video, downloadPath });
                assets.push({ data: await fs.readFile(downloadPath), mimeType: video.mimeType ?? "video/mp4" });
            } finally {
                await fs.unlink(downloadPath).catch(() => undefined);
            }
        }

        if (assets.length === 0) return { status: "FAILED", error: "ERR_NO_VIDEO_GENERATED", operation: serialized };
        return { status: "COMPLETED", assets, operation: serialized };
    }
}
