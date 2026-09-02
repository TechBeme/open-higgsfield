/**
 * Image model capabilities — consumed by the frontend to render controls.
 * Migrated from image_models.json to TypeScript.
 */
import type { ModelCapabilities } from "./types";
import { EXTERNAL_IMAGE_CAPABILITIES } from "./external";

/** Extended image capability with image-specific fields */
export interface ImageModelCapability extends ModelCapabilities {
    /** Size UI configuration for pixel-based aspect ratio/resolution */
    size_ui?: {
        width_field: string;
        height_field: string;
        aspect_ratios: Array<{ id: string; w: number; h: number }>;
        resolutions: Array<{ id: string; base: number }>;
        default_aspect: string;
        default_resolution: string;
    };
    /** Edit variant configuration */
    has_edit_variant: boolean;
}

export const IMAGE_CAPABILITIES: Record<string, ImageModelCapability> = {
    "v1__ai__text_to_image__flux_2_pro": {
        id: "v1__ai__text_to_image__flux_2_pro",
        label: "Flux 2 Pro", family: "Flux 2", variant: "Pro", group: "Flux",
        category: "Generate",
        prompt_required: true,
        duration: false, aspect_ratio: false, size: false, resolution_variant: false,
        negative_prompt: false, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "input_image", label: "Guide 1", kind: "image", accept: "b64_only", description: "Style or content reference" },
            { id: "input_image_2", label: "Guide 2", kind: "image", accept: "b64_only", description: "Style or content reference" },
            { id: "input_image_3", label: "Guide 3", kind: "image", accept: "b64_only", description: "Style or content reference" },
            { id: "input_image_4", label: "Guide 4", kind: "image", accept: "b64_only", description: "Style or content reference" },
        ],
        custom_fields: [
            { id: "seed", label: "Seed", type: "number", minimum: 0, maximum: 4294967295 },
            { id: "prompt_upsampling", label: "Prompt Upsampling", type: "checkbox", default: false },
            { id: "enable_safety_checker", label: "Enable Safety Checker", type: "checkbox", default: false },
        ],
        size_ui: {
            width_field: "width", height_field: "height",
            aspect_ratios: [
                { id: "1:1", w: 1, h: 1 }, { id: "16:9", w: 16, h: 9 }, { id: "9:16", w: 9, h: 16 },
                { id: "4:3", w: 4, h: 3 }, { id: "3:4", w: 3, h: 4 }, { id: "3:2", w: 3, h: 2 },
                { id: "2:3", w: 2, h: 3 }, { id: "2:1", w: 2, h: 1 }, { id: "1:2", w: 1, h: 2 },
            ],
            resolutions: [{ id: "1k", base: 1024 }, { id: "1.5k", base: 1440 }],
            default_aspect: "16:9", default_resolution: "1k",
        },
        has_edit_variant: false,
        sort_key: 9000,
    },
    "v1__ai__text_to_image__flux_2_turbo": {
        id: "v1__ai__text_to_image__flux_2_turbo",
        label: "Flux 2 Turbo", family: "Flux 2", variant: "Turbo", group: "Flux",
        category: "Generate",
        prompt_required: true,
        duration: false, aspect_ratio: false, size: false, resolution_variant: false,
        negative_prompt: false, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [],
        custom_fields: [
            { id: "guidance_scale", label: "Guidance Scale", type: "number", default: 2.5, minimum: 1.0, maximum: 20.0 },
            { id: "seed", label: "Seed", type: "number", minimum: 0, maximum: 4294967295 },
            { id: "enable_safety_checker", label: "Enable Safety Checker", type: "checkbox", default: false },
            { id: "output_format", label: "Output Format", type: "select", default: "png", options: ["jpeg", "png"] },
        ],
        size_ui: {
            width_field: "image_size__width", height_field: "image_size__height",
            aspect_ratios: [
                { id: "1:1", w: 1, h: 1 }, { id: "16:9", w: 16, h: 9 }, { id: "9:16", w: 9, h: 16 },
                { id: "4:3", w: 4, h: 3 }, { id: "3:4", w: 3, h: 4 }, { id: "3:2", w: 3, h: 2 },
                { id: "2:3", w: 2, h: 3 }, { id: "2:1", w: 2, h: 1 }, { id: "1:2", w: 1, h: 2 },
            ],
            resolutions: [{ id: "1k", base: 1024 }, { id: "2k", base: 2048 }],
            default_aspect: "16:9", default_resolution: "1k",
        },
        has_edit_variant: false,
        sort_key: 8900,
    },
    "v1__ai__text_to_image__flux_2_klein": {
        id: "v1__ai__text_to_image__flux_2_klein",
        label: "Flux 2 Klein", family: "Flux 2", variant: "Klein", group: "Flux",
        category: "Generate",
        prompt_required: true,
        duration: false, aspect_ratio: false, size: false, resolution_variant: false,
        negative_prompt: false, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "input_image", label: "Guide 1", kind: "image", accept: "b64_only", description: "Style or content reference" },
            { id: "input_image_2", label: "Guide 2", kind: "image", accept: "b64_only", description: "Style or content reference" },
            { id: "input_image_3", label: "Guide 3", kind: "image", accept: "b64_only", description: "Style or content reference" },
            { id: "input_image_4", label: "Guide 4", kind: "image", accept: "b64_only", description: "Style or content reference" },
        ],
        custom_fields: [
            { id: "aspect_ratio", label: "Aspect Ratio", type: "select", default: "square_1_1", options: ["square_1_1", "classic_4_3", "traditional_3_4", "widescreen_16_9", "social_story_9_16", "standard_3_2", "portrait_2_3", "horizontal_2_1", "vertical_1_2", "social_post_4_5"] },
            { id: "resolution", label: "Resolution", type: "select", default: "1k", options: ["1k", "2k"] },
            { id: "seed", label: "Seed", type: "number", minimum: 0, maximum: 4294967295 },
            { id: "safety_tolerance", label: "Safety Tolerance", type: "number", default: 5, minimum: 0, maximum: 5 },
            { id: "output_format", label: "Output Format", type: "select", options: ["jpeg", "png"] },
        ],
        has_edit_variant: false,
        sort_key: 8800,
    },
    "v1__ai__text_to_image__flux_kontext_pro": {
        id: "v1__ai__text_to_image__flux_kontext_pro",
        label: "Flux Kontext Pro", family: "Flux Kontext", variant: "Pro", group: "Flux",
        category: "Generate",
        prompt_required: true,
        duration: false, aspect_ratio: false, size: false, resolution_variant: false,
        negative_prompt: false, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "input_image", label: "Context image", kind: "image", required: true, accept: "url_only", description: "Image to edit or transform" },
        ],
        custom_fields: [
            { id: "prompt_upsampling", label: "Prompt Upsampling", type: "checkbox", default: false },
            { id: "seed", label: "Seed", type: "number" },
            { id: "guidance", label: "Guidance", type: "number", default: 3.0, minimum: 1.0, maximum: 10.0 },
            { id: "steps", label: "Steps", type: "number", default: 50, minimum: 1, maximum: 100 },
            { id: "aspect_ratio", label: "Aspect Ratio", type: "select", default: "square_1_1", options: ["square_1_1", "classic_4_3", "traditional_3_4", "widescreen_16_9", "social_story_9_16", "standard_3_2", "portrait_2_3", "horizontal_2_1", "vertical_1_2", "social_post_4_5"] },
            { id: "safety_tolerance", label: "Safety Tolerance", type: "number", default: 6, minimum: 0, maximum: 6 },
            { id: "output_format", label: "Output Format", type: "select", options: ["jpeg", "png"] },
        ],
        has_edit_variant: false,
        sort_key: 8700,
    },
    "v1__ai__text_to_image__seedream_v5_lite": {
        id: "v1__ai__text_to_image__seedream_v5_lite",
        label: "Seedream V5 Lite", family: "Seedream", variant: "V5 Lite", group: "Seedream",
        category: "Generate",
        prompt_required: true,
        duration: false, aspect_ratio: false, size: false, resolution_variant: false,
        negative_prompt: false, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [],
        custom_fields: [
            { id: "aspect_ratio", label: "Aspect Ratio", type: "select", default: "square_1_1", options: ["square_1_1", "widescreen_16_9", "social_story_9_16", "portrait_2_3", "traditional_3_4", "standard_3_2", "classic_4_3", "cinematic_21_9"] },
            { id: "seed", label: "Seed", type: "number", minimum: 0, maximum: 4294967295 },
            { id: "enable_safety_checker", label: "Enable Safety Checker", type: "checkbox", default: false },
        ],
        has_edit_variant: false,
        sort_key: 8600,
    },
    "v1__ai__text_to_image__seedream_v4_5": {
        id: "v1__ai__text_to_image__seedream_v4_5",
        label: "Seedream 4.5", family: "Seedream", variant: "V4.5", group: "Seedream",
        category: "Generate",
        prompt_required: true,
        duration: false, aspect_ratio: false, size: false, resolution_variant: false,
        negative_prompt: false, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [],
        custom_fields: [
            { id: "aspect_ratio", label: "Aspect Ratio", type: "select", default: "square_1_1", options: ["square_1_1", "widescreen_16_9", "social_story_9_16", "portrait_2_3", "traditional_3_4", "standard_3_2", "classic_4_3", "cinematic_21_9"] },
            { id: "seed", label: "Seed", type: "number", minimum: 0, maximum: 4294967295 },
            { id: "enable_safety_checker", label: "Enable Safety Checker", type: "checkbox", default: false },
        ],
        has_edit_variant: true,
        sort_key: 8500,
    },
    "v1__ai__text_to_image__z_image": {
        id: "v1__ai__text_to_image__z_image",
        label: "Z-Image", family: "Z-Image", variant: "", group: "Z-Image",
        category: "Generate",
        prompt_required: true,
        duration: false, aspect_ratio: false, size: false, resolution_variant: false,
        negative_prompt: false, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [],
        custom_fields: [
            { id: "image_size", label: "Image Size", type: "select", default: "square_hd", options: ["square", "square_hd", "portrait_3_4", "portrait_9_16", "landscape_4_3", "landscape_16_9"] },
            { id: "num_inference_steps", label: "Num Inference Steps", type: "number", default: 8, minimum: 1, maximum: 50 },
            { id: "seed", label: "Seed", type: "number", minimum: 0, maximum: 4294967295 },
            { id: "output_format", label: "Output Format", type: "select", default: "png", options: ["jpeg", "png"] },
            { id: "enable_safety_checker", label: "Enable Safety Checker", type: "checkbox", default: false },
        ],
        has_edit_variant: false,
        sort_key: 8400,
    },
    ...EXTERNAL_IMAGE_CAPABILITIES,
};

export const IMAGE_CAPABILITIES_LIST = Object.values(IMAGE_CAPABILITIES)
    .sort((a, b) => (b.sort_key ?? 0) - (a.sort_key ?? 0));

export const IMAGE_CAPABILITY_GROUPS = [...new Set(IMAGE_CAPABILITIES_LIST.map((c) => c.group))];

export function getImageCapabilitiesByGroup(group: string): ImageModelCapability[] {
    return IMAGE_CAPABILITIES_LIST.filter((c) => c.group === group);
}
