import {
    experimental_getVideoStatus as getVideoStatus,
    experimental_startVideo as startVideo,
    generateImage,
    generateText,
    createGateway,
} from "ai";
import type { GenerationProvider, ProviderGenerationRequest, ProviderPollRequest, ProviderPollResult, ProviderSubmission } from "./types";
import { getImageUrl, getMediaUrls } from "./utils";
import { createProviderTransport, invalidProviderResponse, ProviderRequestError, publicMediaUrl } from "./request-error";

function requireGatewayKey() {
    const key = process.env.AI_GATEWAY_API_KEY;
    if (!key?.trim()) throw new ProviderRequestError("ERR_AI_GATEWAY_API_KEY_NOT_CONFIGURED");
    return key;
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
        const apiKey = requireGatewayKey();
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
        const generateAudio = request.params.field_values?.generate_audio;
        const result = await startVideo({
            model: gateway.videoModel(request.providerModelId),
            maxRetries: 0,
            abortSignal: request.signal,
            prompt: request.params.prompt,
            duration: request.params.duration ? Number(request.params.duration) : undefined,
            aspectRatio: request.params.aspect_ratio as `${number}:${number}` | undefined,
            resolution: gatewayResolution(request.params.resolution, request.params.aspect_ratio),
            seed: request.params.seed,
            frameImages: frameImages.length > 0 ? frameImages : undefined,
            generateAudio: typeof generateAudio === "boolean" ? generateAudio : undefined,
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
        const urls = getMediaUrls(request.media);
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
            if (assets.length === 0 || assets.some(asset => !asset.data?.byteLength)) throw invalidProviderResponse("GATEWAY", "submit");
            return { status: "COMPLETED", assets };
        }

        const nValue = Number(request.params.field_values?.n ?? 1);
        const result = await generateImage({
            model: gateway.imageModel(request.providerModelId),
            maxRetries: 0,
            abortSignal: request.signal,
            prompt: urls.length > 0 ? { text: request.params.prompt, images: urls } : request.params.prompt,
            n: Number.isFinite(nValue) ? Math.max(1, Math.min(4, nValue)) : 1,
            aspectRatio: request.params.aspect_ratio as `${number}:${number}` | undefined,
            seed: request.params.seed,
        });
        if (!result.images.length || result.images.some(image => !image.uint8Array?.byteLength)) throw invalidProviderResponse("GATEWAY", "submit");
        return {
            status: "COMPLETED",
            assets: result.images.map((image) => ({ data: image.uint8Array, mimeType: image.mediaType })),
        };
    }

    async poll(request: ProviderPollRequest): Promise<ProviderPollResult> {
        const apiKey = requireGatewayKey();
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
