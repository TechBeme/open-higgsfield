import "server-only";

import type { CustomFieldCapability, ModelCapabilities } from "@/models/capabilities/types";

type GoogleId = "google-ai-studio" | "google-vertex";
type ImageCapability = ModelCapabilities & {
    has_edit_variant: boolean;
    size_ui: { width_field: string; height_field: string; aspect_ratios: Array<{ id: string; w: number; h: number }>; resolutions: Array<{ id: string; base: number }>; default_aspect: string; default_resolution: string };
};
const RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const WIDE_RATIOS = [...RATIOS, "1:4", "4:1", "1:8", "8:1"];
const base = { prompt_required: true, duration: false, aspect_ratio: false, size: false, resolution_variant: false, negative_prompt: false, cfg_scale: false, style: false, shot_type: false, prompt_expansion: false, elements: false } as const;
const spec = [
    { model: "gemini-nano-banana-2.1", label: "Nano Banana 2.1", sizes: ["1K", "2K", "4K"], thinking: ["minimal", "medium", "high"], sort: 8900 },
    { model: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite", sizes: ["1K"], thinking: ["minimal", "high"], sort: 8800 },
    { model: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image", sizes: ["512", "1K", "2K", "4K"], thinking: ["minimal", "high"], sort: 7900 },
    { model: "gemini-3-pro-image", label: "Gemini 3 Pro Image", sizes: ["1K", "2K", "4K"], thinking: [], sort: 7800 },
    { model: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image", sizes: ["1K"], thinking: [], sort: 7700 },
];
export const GOOGLE_IMAGE_CAPABILITIES: Record<string, ImageCapability> = {};
for (const provider of ["google-ai-studio", "google-vertex"] as const) for (const model of spec) {
    if (provider === "google-vertex" && model.model === "gemini-2.5-flash-image") continue;
    const legacy = model.model === "gemini-2.5-flash-image";
    const lite = model.model === "gemini-3.1-flash-lite-image";
    const pro = model.model === "gemini-3-pro-image";
    const nano = model.model === "gemini-nano-banana-2.1";
    const id = `${provider}__${model.model}`;
    const custom: CustomFieldCapability[] = [
        { id: "output_mime_type", label: "Image format", type: "select", options: ["image/png", "image/jpeg"], default: "image/png" },
        { id: "system_instruction", label: "System instructions", type: "text", maxLength: 16000 },
    ];
    if (model.thinking.length) custom.push({ id: "thinking_level", label: "Thinking level", type: "select", options: model.thinking, default: nano ? "medium" : "minimal" });
    if (!lite && !legacy) custom.push({ id: "google_search", label: "Google search grounding", type: "select", options: pro || provider === "google-vertex" && !nano ? ["off", "web"] : ["off", "web", "image", "web_and_image"], default: "off" });
    if (provider === "google-vertex") {
        custom.push({ id: "person_generation", label: "People", type: "select", options: ["ALLOW_ALL", "ALLOW_ADULT", "ALLOW_NONE"] });
        custom.push({ id: "output_compression_quality", label: "JPEG quality", type: "number", minimum: 1, maximum: 100, step: 1, description: "Applies only to JPEG output." });
        if (!nano) custom.push({ id: "temperature", label: "Temperature", type: "number", minimum: 0, maximum: 2, step: 0.05 }, { id: "top_p", label: "Top P", type: "number", minimum: 0, maximum: 1, step: 0.05 });
    }
    const ratios = provider === "google-vertex" || !legacy && !lite && !pro ? WIDE_RATIOS : RATIOS;
    GOOGLE_IMAGE_CAPABILITIES[id] = {
        ...base, id, label: model.label, family: "Gemini Image", variant: provider === "google-vertex" ? "Vertex" : "AI Studio", group: provider === "google-vertex" ? "Google Vertex AI" : "Google AI Studio", category: "Generate / Edit", provider, provider_model_id: model.model, provider_mode: "native-image", has_edit_variant: false, sort_key: model.sort - (provider === "google-vertex" ? 50 : 0),
        media_slots: [ { id: "reference_images", label: "Reference images", kind: "image", multiple: true, max_count: legacy ? 3 : 14, max_bytes: 7 * 1024 * 1024, accept: "image/png,image/jpeg,image/webp,image/heic,image/heif" }, ...(!legacy && !pro ? [{ id: "input_video", label: "Video to use as image reference", kind: "video" as const, max_count: 1, accept: "video/mp4,video/webm,video/quicktime" }] : []) ],
        custom_fields: custom,
        size_ui: { width_field: "width", height_field: "height", aspect_ratios: ratios.map(id => { const [w, h] = id.split(":").map(Number); return { id, w, h }; }), resolutions: model.sizes.map(id => ({ id, base: id === "512" ? 512 : Number.parseInt(id) * 1024 })), default_aspect: "1:1", default_resolution: "1K" },
    };
}

function video(provider: GoogleId, model: string, label: string, omni: boolean, sort: number): ModelCapabilities {
    const lite = model.includes("lite");
    const custom: CustomFieldCapability[] = omni ? [
        { id: "task", label: "Video task", type: "select", options: ["auto", "text_to_video", "image_to_video", "reference_to_video", "edit", "extend"], default: "auto" },
    ] : [
        { id: "generate_audio", label: "Generate audio", type: "checkbox", default: true },
        { id: "number_of_videos", label: "Videos", type: "number", default: 1, minimum: 1, maximum: 4, step: 1 },
        { id: "resize_mode", label: "Resize mode", type: "select", options: ["crop", "pad"], default: "crop" },
        { id: "compression_quality", label: "Compression", type: "select", options: ["OPTIMIZED", "LOSSLESS"], default: "OPTIMIZED" },
        { id: "person_generation", label: "People", type: "select", options: ["allow_adult", "disallow"], default: "allow_adult" },
    ];
    return {
        ...base, id: `${provider}__${model}`, label, family: omni ? "Gemini Omni" : "Veo", variant: provider === "google-vertex" ? "Vertex" : "AI Studio", group: provider === "google-vertex" ? "Google Vertex AI" : "Google AI Studio", provider, provider_model_id: model, provider_mode: "video", sort_key: sort,
        duration: omni && provider === "google-ai-studio" ? false : { options: omni ? ["3", "4", "5", "6", "7", "8", "9", "10"] : ["4", "6", "8"], default: "8" },
        aspect_ratio: { options: [["Landscape (16:9)", "16:9"], ["Portrait (9:16)", "9:16"]], default: ["Landscape (16:9)", "16:9"] },
        resolution_variant: { options: omni ? ["360p", "720p", "1080p", "4k"] : model === "veo-3.1-generate-001" ? ["720p", "1080p", "4k"] : ["720p", "1080p"], default: "720p" },
        negative_prompt: !omni, prompt_expansion: !omni,
        seed: omni ? false : { minimum: 0, maximum: 4294967295 },
        media_slots: omni ? [
            { id: "reference_images", label: "Reference images", kind: "image", multiple: true, max_count: 10, max_bytes: 20 * 1024 * 1024 },
            { id: "start_image", label: "First frame", kind: "image", max_count: 1, max_bytes: 20 * 1024 * 1024 },
            { id: "end_image", label: "Last frame", kind: "image", max_count: 1, max_bytes: 20 * 1024 * 1024 },
            { id: "input_video", label: "Video to edit, extend, or reference", kind: "video", multiple: true, max_count: 3, description: "Uploaded clips must be at most 10 seconds. Reference clips must be at most 3 seconds." },
            ...(provider === "google-ai-studio" ? [{ id: "input_audio", label: "Audio reference", kind: "audio" as const, max_count: 1 }] : []),
        ] : lite ? [] : [
            { id: "start_image", label: "First frame", kind: "image", max_bytes: 20 * 1024 * 1024 },
            { id: "end_image", label: "Last frame", kind: "image", max_bytes: 20 * 1024 * 1024 },
            { id: "reference_images", label: "Asset references", kind: "image", multiple: true, max_count: 3, max_bytes: 20 * 1024 * 1024, description: "Reference generation requires an 8 second output." },
            { id: "input_video", label: "Video to extend", kind: "video", max_count: 1 },
        ],
        custom_fields: custom,
    };
}
export const GOOGLE_VIDEO_CAPABILITIES: Record<string, ModelCapabilities> = {};
for (const entry of [
    video("google-ai-studio", "gemini-omni-1.1-flash", "Gemini Omni 1.1 Flash", true, 8900),
    video("google-vertex", "gemini-omni-1.1-flash-preview", "Gemini Omni 1.1 Flash Preview", true, 8850),
    video("google-vertex", "veo-3.1-generate-001", "Veo 3.1", false, 7800),
    video("google-vertex", "veo-3.1-fast-generate-001", "Veo 3.1 Fast", false, 7750),
    video("google-vertex", "veo-3.1-lite-generate-001", "Veo 3.1 Lite Preview", false, 7700),
    { ...video("google-ai-studio", "veo-3.1-generate-preview", "Veo 3.1 Preview (retired)", false, 0), deprecated: true, custom_fields: [] },
]) GOOGLE_VIDEO_CAPABILITIES[entry.id] = entry;
