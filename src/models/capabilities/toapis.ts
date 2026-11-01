import type { ModelCapabilities } from "./types";
import type { ImageModelCapability } from "./image";

const ratios: [string, string][] = [["16:9", "16:9"], ["1:1", "1:1"], ["9:16", "9:16"]];
const base = {
    provider: "toapis" as const, variant: "BYOK", group: "ToAPIs", category: "Generate",
    prompt_required: true, negative_prompt: false, cfg_scale: false, style: false,
    shot_type: false, prompt_expansion: false, elements: false,
    aspect_ratio: { options: ratios, default: ratios[0] }, size: false as const,
    custom_fields: [], sort_key: -100,
};

export const TOAPIS_IMAGE_CAPABILITIES: Record<string, ImageModelCapability> = Object.fromEntries(
    ["gpt-image-2", "gpt-image-2.5-flare"].map(model => {
        const id = "toapis__" + model;
        return [id, { ...base, id, label: `${model} - ToAPIs`, family: model,
            provider_model_id: model, provider_mode: "image-model" as const, prompt_max: 32_000,
            duration: false, resolution_variant: false, has_edit_variant: false, media_slots: [],
            size_ui: { width_field: "width", height_field: "height",
                aspect_ratios: [{ id: "16:9", w: 16, h: 9 }, { id: "1:1", w: 1, h: 1 }, { id: "9:16", w: 9, h: 16 }],
                resolutions: [{ id: "1K", base: 1024 }, { id: "2K", base: 2048 }, { id: "4K", base: 2880 }],
                default_aspect: "16:9", default_resolution: "1K" } }];
    })
);

export const TOAPIS_VIDEO_CAPABILITIES: Record<string, ModelCapabilities> = Object.fromEntries(
    ["seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2-5"].map(model => {
        const id = "toapis__" + model;
        // First-frame Seedance 2.5 requires adaptive, including the UI default.
        const modelRatios: [string, string][] = model === "seedance-2-5" ? [["adaptive", "adaptive"]] : ratios;
        return [id, { ...base, id, label: `${model} - ToAPIs`, family: "Seedance",
            provider_model_id: model, provider_mode: "video" as const,
            aspect_ratio: { options: modelRatios, default: modelRatios[0] },
            duration: { options: ["4"], default: "4" },
            resolution_variant: { options: ["720p", "480p"], default: "720p" },
            media_slots: [{ id: "first_frame", label: "First frame", kind: "image", type: "first_frame", required: true,
                description: "One public HTTPS first frame. Four seconds, no audio." }] }];
    })
);
