import {
    experimental_getVideoStatus as getVideoStatus,
    experimental_startVideo as startVideo,
    generateImage,
    generateText,
} from "ai";
import type { GenerationProvider, ProviderGenerationRequest, ProviderPollRequest, ProviderPollResult, ProviderSubmission } from "./types";
import { getImageUrl, getMediaUrls } from "./utils";

function requireGatewayKey() {
    if (!process.env.AI_GATEWAY_API_KEY) throw new Error("ERR_AI_GATEWAY_API_KEY_NOT_CONFIGURED");
}

function gatewayResolution(resolution?: string, aspectRatio?: string): `${number}x${number}` | undefined {
    if (!resolution) return undefined;
    if (/^\d+x\d+$/.test(resolution)) return resolution as `${number}x${number}`;
    const portrait = aspectRatio === "9:16";
    if (resolution.toLowerCase() === "1080p") return portrait ? "1080x1920" : "1920x1080";
    if (resolution.toLowerCase() === "720p") return portrait ? "720x1280" : "1280x720";
    return undefined;
}

export class VercelAiGatewayProvider implements GenerationProvider {
    readonly id = "vercel-ai-gateway" as const;

    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        requireGatewayKey();
        if (request.mediaType === "image") return this.submitImage(request);

        const startImage = getImageUrl(request.media, "start_image", "image", "input_image");
        const endImage = getImageUrl(request.media, "end_image");
        const frameImages = [
            ...(startImage ? [{ image: startImage, frameType: "first_frame" as const }] : []),
            ...(endImage ? [{ image: endImage, frameType: "last_frame" as const }] : []),
        ];
        const generateAudio = request.params.field_values?.generate_audio;
        const result = await startVideo({
            model: request.providerModelId,
            prompt: request.params.prompt,
            duration: request.params.duration ? Number(request.params.duration) : undefined,
            aspectRatio: request.params.aspect_ratio as `${number}:${number}` | undefined,
            resolution: gatewayResolution(request.params.resolution, request.params.aspect_ratio),
            seed: request.params.seed,
            frameImages: frameImages.length > 0 ? frameImages : undefined,
            generateAudio: typeof generateAudio === "boolean" ? generateAudio : undefined,
        });

        const metadata = result.providerMetadata as Record<string, Record<string, unknown>> | undefined;
        const gateway = metadata?.gateway as Record<string, unknown> | undefined;
        const asyncJob = gateway?.asyncJob as Record<string, unknown> | undefined;
        return {
            status: "CREATED",
            operation: result.operation,
            providerTaskId: typeof asyncJob?.jobId === "string" ? asyncJob.jobId : undefined,
        };
    }

    private async submitImage(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        const urls = getMediaUrls(request.media);
        if (request.providerMode === "language-image") {
            const content = [
                { type: "text" as const, text: request.params.prompt },
                ...urls.map((url) => ({ type: "image" as const, image: url })),
            ];
            const result = await generateText({
                model: request.providerModelId,
                messages: [{ role: "user", content }],
                providerOptions: {
                    google: {
                        imageConfig: {
                            aspectRatio: request.params.aspect_ratio,
                            imageSize: request.params.resolution,
                        },
                    },
                },
            });
            const assets = result.files
                .filter((file) => file.mediaType.startsWith("image/"))
                .map((file) => ({ data: file.uint8Array, mimeType: file.mediaType }));
            if (assets.length === 0) throw new Error("ERR_NO_IMAGE_GENERATED");
            return { status: "COMPLETED", assets };
        }

        const nValue = Number(request.params.field_values?.n ?? 1);
        const result = await generateImage({
            model: request.providerModelId,
            prompt: urls.length > 0 ? { text: request.params.prompt, images: urls } : request.params.prompt,
            n: Number.isFinite(nValue) ? Math.max(1, Math.min(4, nValue)) : 1,
            aspectRatio: request.params.aspect_ratio as `${number}:${number}` | undefined,
            seed: request.params.seed,
        });
        return {
            status: "COMPLETED",
            assets: result.images.map((image) => ({ data: image.uint8Array, mimeType: image.mediaType })),
        };
    }

    async poll(request: ProviderPollRequest): Promise<ProviderPollResult> {
        requireGatewayKey();
        const result = await getVideoStatus(request.providerModelId, { operation: request.operation as never });
        if (result.status === "pending") return { status: "IN_PROGRESS", operation: request.operation };
        if (result.status === "error") return { status: "FAILED", error: result.error, operation: request.operation };

        return {
            status: "COMPLETED",
            operation: request.operation,
            assets: result.videos.map((video) => {
                if (video.type === "url") return { url: video.url, mimeType: video.mediaType };
                if (video.type === "base64") return { data: Buffer.from(video.data, "base64"), mimeType: video.mediaType };
                return { data: video.data, mimeType: video.mediaType };
            }),
        };
    }
}
