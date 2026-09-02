import type { ModelCapabilities } from "./types";

type ExternalImageCapability = ModelCapabilities & {
    has_edit_variant: boolean;
    size_ui?: {
        width_field: string;
        height_field: string;
        aspect_ratios: Array<{ id: string; w: number; h: number }>;
        resolutions: Array<{ id: string; base: number }>;
        default_aspect: string;
        default_resolution: string;
    };
};

const IMAGE_RATIOS = [
    { id: "1:1", w: 1, h: 1 },
    { id: "16:9", w: 16, h: 9 },
    { id: "9:16", w: 9, h: 16 },
    { id: "4:3", w: 4, h: 3 },
    { id: "3:4", w: 3, h: 4 },
    { id: "3:2", w: 3, h: 2 },
    { id: "2:3", w: 2, h: 3 },
];

function googleImageCapability(options: {
    id: string;
    label: string;
    provider: "google-ai-studio" | "google-vertex";
    providerModelId: string;
    family: string;
    resolutions?: Array<{ id: string; base: number }>;
    sortKey: number;
}): ExternalImageCapability {
    return {
        id: options.id,
        label: options.label,
        family: options.family,
        variant: options.provider === "google-vertex" ? "Vertex" : "AI Studio",
        group: options.provider === "google-vertex" ? "Google Vertex AI" : "Google AI Studio",
        category: "Generate / Edit",
        provider: options.provider,
        provider_model_id: options.providerModelId,
        provider_mode: "native-image",
        prompt_required: true,
        duration: false,
        aspect_ratio: false,
        size: false,
        resolution_variant: false,
        negative_prompt: false,
        cfg_scale: false,
        style: false,
        shot_type: false,
        prompt_expansion: false,
        elements: false,
        media_slots: [
            {
                id: "reference_images",
                label: "Reference images",
                kind: "image",
                multiple: true,
                description: "Optional images to edit or use as visual references",
            },
        ],
        custom_fields: [],
        size_ui: {
            width_field: "width",
            height_field: "height",
            aspect_ratios: IMAGE_RATIOS,
            resolutions: options.resolutions ?? [
                { id: "1K", base: 1024 },
                { id: "2K", base: 2048 },
                { id: "4K", base: 4096 },
            ],
            default_aspect: "1:1",
            default_resolution: "1K",
        },
        has_edit_variant: false,
        sort_key: options.sortKey,
    };
}

function gatewayImageCapability(options: {
    id: string;
    label: string;
    providerModelId: string;
    family: string;
    mode: "language-image" | "image-model";
    acceptsReferences?: boolean;
    sortKey: number;
}): ExternalImageCapability {
    return {
        id: options.id,
        label: options.label,
        family: options.family,
        variant: "AI Gateway",
        group: "Vercel AI Gateway",
        category: options.acceptsReferences ? "Generate / Edit" : "Generate",
        provider: "vercel-ai-gateway",
        provider_model_id: options.providerModelId,
        provider_mode: options.mode,
        prompt_required: true,
        duration: false,
        aspect_ratio: false,
        size: false,
        resolution_variant: false,
        negative_prompt: false,
        cfg_scale: false,
        style: false,
        shot_type: false,
        prompt_expansion: false,
        elements: false,
        media_slots: options.acceptsReferences ? [{
            id: "reference_images",
            label: "Reference images",
            kind: "image",
            multiple: true,
            description: "Optional images to edit or use as visual references",
        }] : [],
        custom_fields: [
            { id: "n", label: "Images", type: "number", default: 1, minimum: 1, maximum: 4 },
        ],
        size_ui: {
            width_field: "width",
            height_field: "height",
            aspect_ratios: IMAGE_RATIOS,
            resolutions: [{ id: "1K", base: 1024 }, { id: "2K", base: 2048 }],
            default_aspect: "1:1",
            default_resolution: "1K",
        },
        has_edit_variant: false,
        sort_key: options.sortKey,
    };
}

export const EXTERNAL_IMAGE_CAPABILITIES: Record<string, ExternalImageCapability> = {
    "google-ai-studio__gemini-3.1-flash-image": googleImageCapability({
        id: "google-ai-studio__gemini-3.1-flash-image",
        label: "Gemini 3.1 Flash Image",
        provider: "google-ai-studio",
        providerModelId: "gemini-3.1-flash-image",
        family: "Gemini Image",
        sortKey: 7900,
    }),
    "google-ai-studio__gemini-3-pro-image": googleImageCapability({
        id: "google-ai-studio__gemini-3-pro-image",
        label: "Gemini 3 Pro Image",
        provider: "google-ai-studio",
        providerModelId: "gemini-3-pro-image",
        family: "Gemini Image",
        sortKey: 7800,
    }),
    "google-ai-studio__gemini-2.5-flash-image": googleImageCapability({
        id: "google-ai-studio__gemini-2.5-flash-image",
        label: "Gemini 2.5 Flash Image",
        provider: "google-ai-studio",
        providerModelId: "gemini-2.5-flash-image",
        family: "Gemini Image",
        resolutions: [{ id: "1K", base: 1024 }],
        sortKey: 7700,
    }),
    "google-vertex__gemini-3.1-flash-image": googleImageCapability({
        id: "google-vertex__gemini-3.1-flash-image",
        label: "Gemini 3.1 Flash Image",
        provider: "google-vertex",
        providerModelId: "gemini-3.1-flash-image",
        family: "Gemini Image",
        sortKey: 7600,
    }),
    "google-vertex__gemini-3-pro-image": googleImageCapability({
        id: "google-vertex__gemini-3-pro-image",
        label: "Gemini 3 Pro Image",
        provider: "google-vertex",
        providerModelId: "gemini-3-pro-image",
        family: "Gemini Image",
        sortKey: 7500,
    }),
    "vercel-ai-gateway__google__gemini-3-pro-image": gatewayImageCapability({
        id: "vercel-ai-gateway__google__gemini-3-pro-image",
        label: "Gemini 3 Pro Image",
        providerModelId: "google/gemini-3-pro-image",
        family: "Google Gemini",
        mode: "language-image",
        acceptsReferences: true,
        sortKey: 7400,
    }),
    "vercel-ai-gateway__google__gemini-3.1-flash-image": gatewayImageCapability({
        id: "vercel-ai-gateway__google__gemini-3.1-flash-image",
        label: "Gemini 3.1 Flash Image",
        providerModelId: "google/gemini-3.1-flash-image",
        family: "Google Gemini",
        mode: "language-image",
        acceptsReferences: true,
        sortKey: 7300,
    }),
    "vercel-ai-gateway__bfl__flux-2-flex": gatewayImageCapability({
        id: "vercel-ai-gateway__bfl__flux-2-flex",
        label: "Flux 2 Flex",
        providerModelId: "bfl/flux-2-flex",
        family: "Black Forest Labs",
        mode: "image-model",
        sortKey: 7200,
    }),
    "vercel-ai-gateway__recraft__recraft-v4.1": gatewayImageCapability({
        id: "vercel-ai-gateway__recraft__recraft-v4.1",
        label: "Recraft V4.1",
        providerModelId: "recraft/recraft-v4.1",
        family: "Recraft",
        mode: "image-model",
        sortKey: 7100,
    }),
    "vercel-ai-gateway__openai__gpt-image-2": gatewayImageCapability({
        id: "vercel-ai-gateway__openai__gpt-image-2",
        label: "GPT Image 2",
        providerModelId: "openai/gpt-image-2",
        family: "OpenAI",
        mode: "image-model",
        sortKey: 7000,
    }),
};

function videoCapability(options: {
    id: string;
    label: string;
    provider: "google-ai-studio" | "google-vertex" | "vercel-ai-gateway";
    providerModelId: string;
    group: string;
    family: string;
    duration?: string[];
    imageRequired?: boolean;
    supportsEndFrame?: boolean;
    generateAudio?: boolean;
}): ModelCapabilities {
    const slots: ModelCapabilities["media_slots"] = [];
    if (options.imageRequired || options.supportsEndFrame) {
        slots.push({ id: "start_image", label: "Start frame", kind: "image", required: options.imageRequired });
    }
    if (options.supportsEndFrame) {
        slots.push({ id: "end_image", label: "End frame", kind: "image" });
    }

    return {
        id: options.id,
        label: options.label,
        family: options.family,
        variant: "",
        group: options.group,
        provider: options.provider,
        provider_model_id: options.providerModelId,
        provider_mode: "video",
        prompt_required: true,
        prompt_max: 2500,
        duration: { options: options.duration ?? ["4", "6", "8"], default: options.duration?.[0] ?? "4" },
        aspect_ratio: { options: [["16:9", "16:9"], ["9:16", "9:16"]], default: ["16:9", "16:9"] },
        size: false,
        resolution_variant: { options: ["720p", "1080p"], default: "720p" },
        negative_prompt: true,
        cfg_scale: false,
        style: false,
        shot_type: false,
        prompt_expansion: true,
        elements: false,
        media_slots: slots,
        custom_fields: options.generateAudio === false ? [] : [
            { id: "generate_audio", label: "Generate Audio", type: "checkbox", default: true },
        ],
    };
}

export const EXTERNAL_VIDEO_CAPABILITIES: Record<string, ModelCapabilities> = {
    "google-ai-studio__veo-3.1-generate-preview": videoCapability({
        id: "google-ai-studio__veo-3.1-generate-preview",
        label: "Veo 3.1",
        provider: "google-ai-studio",
        providerModelId: "veo-3.1-generate-preview",
        group: "Google AI Studio",
        family: "Veo 3.1",
        supportsEndFrame: true,
    }),
    "google-vertex__veo-3.1-generate-001": videoCapability({
        id: "google-vertex__veo-3.1-generate-001",
        label: "Veo 3.1",
        provider: "google-vertex",
        providerModelId: "veo-3.1-generate-001",
        group: "Google Vertex AI",
        family: "Veo 3.1",
        supportsEndFrame: true,
    }),
    "vercel-ai-gateway__google__veo-3.1-generate-001": videoCapability({
        id: "vercel-ai-gateway__google__veo-3.1-generate-001",
        label: "Google Veo 3.1",
        provider: "vercel-ai-gateway",
        providerModelId: "google/veo-3.1-generate-001",
        group: "Vercel AI Gateway",
        family: "Google Veo",
        supportsEndFrame: true,
    }),
    "vercel-ai-gateway__alibaba__wan-v2.6-t2v": videoCapability({
        id: "vercel-ai-gateway__alibaba__wan-v2.6-t2v",
        label: "Wan 2.6 Text to Video",
        provider: "vercel-ai-gateway",
        providerModelId: "alibaba/wan-v2.6-t2v",
        group: "Vercel AI Gateway",
        family: "Alibaba Wan",
        duration: ["5", "10"],
        generateAudio: false,
    }),
    "vercel-ai-gateway__alibaba__wan-v2.6-i2v": videoCapability({
        id: "vercel-ai-gateway__alibaba__wan-v2.6-i2v",
        label: "Wan 2.6 Image to Video",
        provider: "vercel-ai-gateway",
        providerModelId: "alibaba/wan-v2.6-i2v",
        group: "Vercel AI Gateway",
        family: "Alibaba Wan",
        duration: ["5", "10"],
        imageRequired: true,
        generateAudio: false,
    }),
    "vercel-ai-gateway__klingai__kling-v3.0-t2v": videoCapability({
        id: "vercel-ai-gateway__klingai__kling-v3.0-t2v",
        label: "Kling 3.0 Text to Video",
        provider: "vercel-ai-gateway",
        providerModelId: "klingai/kling-v3.0-t2v",
        group: "Vercel AI Gateway",
        family: "KlingAI",
        duration: ["5", "10"],
    }),
    "vercel-ai-gateway__klingai__kling-v3.0-i2v": videoCapability({
        id: "vercel-ai-gateway__klingai__kling-v3.0-i2v",
        label: "Kling 3.0 Image to Video",
        provider: "vercel-ai-gateway",
        providerModelId: "klingai/kling-v3.0-i2v",
        group: "Vercel AI Gateway",
        family: "KlingAI",
        duration: ["5", "10"],
        imageRequired: true,
        supportsEndFrame: true,
    }),
};
