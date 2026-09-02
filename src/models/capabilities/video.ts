/**
 * Video model capabilities — consumed by the frontend to render controls.
 */
import type { ModelCapabilities } from "./types";
import { EXTERNAL_VIDEO_CAPABILITIES } from "./external";

export const VIDEO_CAPABILITIES: Record<string, ModelCapabilities> = {
    "kling-v3-pro": {
        id: "kling-v3-pro",
        label: "Kling 3 Pro", family: "Kling 3", variant: "Pro", group: "Kling",
        prompt_required: false, prompt_max: 2500,
        duration: { options: ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], default: "3" },
        aspect_ratio: { options: [["16:9", "16:9"], ["9:16", "9:16"], ["1:1", "1:1"]], default: ["16:9", "16:9"] },
        size: false,
        resolution_variant: false,
        negative_prompt: true, cfg_scale: true, style: false,
        shot_type: false, prompt_expansion: false, elements: true,
        media_slots: [
            { id: "start_image", label: "Start frame", kind: "image" },
            { id: "end_image", label: "End frame", kind: "image" },
        ],
        custom_fields: [
            { id: "generate_audio", label: "Generate Audio", type: "checkbox", default: true, description: "Generate native audio for the video." },
            { id: "multi_shot", label: "Multi-shot Mode", type: "checkbox", default: false, description: "Enable multi-scene video generation." },
            { id: "shot_type", label: "Shot Type", type: "select", default: "customize", options: ["customize", "intelligent"], description: "'customize': define shots manually. 'intelligent': auto-segments." },
        ],
    },
    "kling-v3-std": {
        id: "kling-v3-std",
        label: "Kling 3 Standard", family: "Kling 3", variant: "Standard", group: "Kling",
        prompt_required: false, prompt_max: 2500,
        duration: { options: ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], default: "3" },
        aspect_ratio: { options: [["16:9", "16:9"], ["9:16", "9:16"], ["1:1", "1:1"]], default: ["16:9", "16:9"] },
        size: false,
        resolution_variant: false,
        negative_prompt: true, cfg_scale: true, style: false,
        shot_type: false, prompt_expansion: false, elements: true,
        media_slots: [
            { id: "start_image", label: "Start frame", kind: "image" },
            { id: "end_image", label: "End frame", kind: "image" },
        ],
        custom_fields: [
            { id: "generate_audio", label: "Generate Audio", type: "checkbox", default: true, description: "Generate native audio for the video." },
            { id: "multi_shot", label: "Multi-shot Mode", type: "checkbox", default: false, description: "Enable multi-scene video generation." },
            { id: "shot_type", label: "Shot Type", type: "select", default: "customize", options: ["customize", "intelligent"], description: "'customize': define shots manually. 'intelligent': auto-segments." },
        ],
    },
    "kling-v3-omni-pro": {
        id: "kling-v3-omni-pro",
        label: "Kling 3 Omni Pro", family: "Kling 3 Omni", variant: "Pro", group: "Kling",
        prompt_required: false, prompt_max: 2500,
        duration: { options: ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], default: "3" },
        aspect_ratio: { options: [["16:9", "16:9"], ["9:16", "9:16"], ["1:1", "1:1"]], default: ["16:9", "16:9"] },
        size: false,
        resolution_variant: false,
        negative_prompt: true, cfg_scale: true, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "start_image", label: "Start frame", kind: "image" },
            { id: "end_image", label: "End frame", kind: "image" },
            { id: "video", label: "Video reference", kind: "video" },
        ],
        custom_fields: [
            { id: "generate_audio", label: "Generate Audio", type: "checkbox", default: true, description: "Generate native audio for the video." },
        ],
    },
    "kling-v3-omni-std": {
        id: "kling-v3-omni-std",
        label: "Kling 3 Omni Standard", family: "Kling 3 Omni", variant: "Standard", group: "Kling",
        prompt_required: false, prompt_max: 2500,
        duration: { options: ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], default: "3" },
        aspect_ratio: { options: [["16:9", "16:9"], ["9:16", "9:16"], ["1:1", "1:1"]], default: ["16:9", "16:9"] },
        size: false,
        resolution_variant: false,
        negative_prompt: true, cfg_scale: true, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "start_image", label: "Start frame", kind: "image" },
            { id: "end_image", label: "End frame", kind: "image" },
            { id: "video", label: "Video reference", kind: "video" },
        ],
        custom_fields: [
            { id: "generate_audio", label: "Generate Audio", type: "checkbox", default: true, description: "Generate native audio for the video." },
        ],
    },
    "kling-v3-motion-control-pro": {
        id: "kling-v3-motion-control-pro",
        label: "Kling 3 Motion Control Pro", family: "Kling 3 Motion Control", variant: "Pro", group: "Kling",
        prompt_required: false,
        duration: false,
        aspect_ratio: false,
        size: false,
        resolution_variant: false,
        negative_prompt: false, cfg_scale: true, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "image", label: "Character image", kind: "image" },
            { id: "video", label: "Motion video", kind: "video", required: true },
        ],
        custom_fields: [
            { id: "character_orientation", label: "Character Orientation", type: "select", default: "video", options: ["video", "image"], description: "Use 'video' to follow video movements. 'image' for character pose." },
        ],
    },
    "kling-v3-motion-control-std": {
        id: "kling-v3-motion-control-std",
        label: "Kling 3 Motion Control Standard", family: "Kling 3 Motion Control", variant: "Standard", group: "Kling",
        prompt_required: false,
        duration: false,
        aspect_ratio: false,
        size: false,
        resolution_variant: false,
        negative_prompt: false, cfg_scale: true, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "image", label: "Character image", kind: "image" },
            { id: "video", label: "Motion video", kind: "video", required: true },
        ],
        custom_fields: [
            { id: "character_orientation", label: "Character Orientation", type: "select", default: "video", options: ["video", "image"], description: "Use 'video' to follow video movements. 'image' for character pose." },
        ],
    },
    "runway-gen-4-5": {
        id: "runway-gen-4-5",
        label: "RunWay Gen 4.5", family: "RunWay Gen 4.5", variant: "", group: "RunWay",
        prompt_required: true,
        duration: { options: ["5", "8", "10"], default: "5" },
        aspect_ratio: {
            options: [
                ["16:9 · 1280×720", "1280:720"], ["9:16 · 720×1280", "720:1280"],
                ["4:3 · 1104×832", "1104:832"], ["1:1 · 960×960", "960:960"],
                ["3:4 · 832×1104", "832:1104"],
            ],
            default: ["16:9 · 1280×720", "1280:720"],
        },
        size: false,
        resolution_variant: false,
        negative_prompt: false, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "image", label: "Reference image", kind: "image" },
        ],
        custom_fields: [],
    },
    "runway-act-two": {
        id: "runway-act-two",
        label: "RunWay Act Two", family: "RunWay Act Two", variant: "Performance", group: "RunWay",
        prompt_required: false, prompt_supported: false,
        duration: false,
        aspect_ratio: {
            options: [
                ["16:9", "widescreen_16_9"], ["9:16", "portrait_9_16"],
                ["4:3", "landscape_4_3"], ["3:4", "portrait_3_4"],
                ["1:1", "square_1_1"], ["21:9", "ultrawide_21_9"],
            ],
            default: ["16:9", "widescreen_16_9"],
        },
        size: false,
        resolution_variant: false,
        negative_prompt: false, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "character_image", label: "Character (image)", kind: "image" },
            { id: "character_video", label: "Character (video)", kind: "video" },
            { id: "reference_video", label: "Performance video", kind: "video", required: true },
        ],
        custom_fields: [
            { id: "body_control", label: "Body Control", type: "checkbox", default: true, description: "Enables gesture and body movement control." },
            { id: "expression_intensity", label: "Expression Intensity", type: "number", default: 3, minimum: 1, maximum: 5, description: "Facial expression intensity (1–5)." },
        ],
    },
    "wan-v2-7": {
        id: "wan-v2-7",
        label: "WAN 2.7", family: "WAN 2.7", variant: "", group: "WAN",
        prompt_required: true,
        duration: { options: ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], default: "5" },
        aspect_ratio: {
            options: [["16:9", "16:9"], ["9:16", "9:16"], ["1:1", "1:1"], ["4:3", "4:3"], ["3:4", "3:4"]],
            default: ["16:9", "16:9"],
        },
        size: false,
        resolution_variant: {
            options: ["1080p", "720p"],
            default: "1080p",
        },
        negative_prompt: true, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: true, elements: false,
        media_slots: [
            { id: "start_image", label: "Start frame", kind: "image" },
            { id: "end_image", label: "End frame", kind: "image" },
            { id: "video", label: "Video to extend", kind: "video" },
        ],
        custom_fields: [],
    },
    "minimax-hailuo-2-3": {
        id: "minimax-hailuo-2-3",
        label: "Hailuo 2.3", family: "MiniMax", variant: "", group: "MiniMax",
        prompt_required: true,
        duration: { options: ["6"], default: "6" },
        aspect_ratio: false,
        size: false,
        resolution_variant: {
            options: ["1080p", "768p"],
            default: "1080p",
        },
        negative_prompt: false, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "image", label: "First frame", kind: "image" },
            { id: "end_image", label: "Last frame", kind: "image" },
        ],
        custom_fields: [
            { id: "prompt_optimizer", label: "Prompt Optimizer", type: "checkbox", default: true, description: "Automatically optimize the prompt to improve generation quality." },
        ],
    },
    "seedance-1-5-pro": {
        id: "seedance-1-5-pro",
        label: "Seedance 1.5 Pro", family: "Seedance", variant: "", group: "Seedance",
        prompt_required: true,
        duration: { options: ["4", "5", "8", "10", "12"], default: "4" },
        aspect_ratio: {
            options: [
                ["21:9", "film_horizontal_21_9"], ["16:9", "widescreen_16_9"],
                ["4:3", "classic_4_3"], ["1:1", "square_1_1"],
                ["3:4", "traditional_3_4"], ["9:16", "social_story_9_16"], ["9:21", "film_vertical_9_21"],
            ],
            default: ["21:9", "film_horizontal_21_9"],
        },
        size: false,
        resolution_variant: {
            options: ["1080p", "720p", "480p"],
            default: "1080p",
        },
        negative_prompt: false, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "image", label: "Reference image", kind: "image" },
        ],
        custom_fields: [
            { id: "generate_audio", label: "Generate Audio", type: "checkbox", default: true, description: "Generate synchronized audio (dialogue, foley, music) from the prompt." },
            { id: "camera_fixed", label: "Fixed Camera", type: "checkbox", default: false, description: "Lock the camera position (tripod shot)." },
        ],
    },
    "pixverse-v5": {
        id: "pixverse-v5",
        label: "PixVerse V5", family: "PixVerse", variant: "", group: "PixVerse",
        prompt_required: true,
        duration: { options: ["5", "8"], default: "5" },
        aspect_ratio: false,
        size: false,
        resolution_variant: {
            options: ["1080p", "720p", "540p", "360p"],
            default: "1080p",
        },
        negative_prompt: true, cfg_scale: false, style: true,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "image", label: "Reference image", kind: "image" },
        ],
        custom_fields: [],
    },
    "pixverse-v5-transition": {
        id: "pixverse-v5-transition",
        label: "PixVerse V5 Transition", family: "PixVerse", variant: "Transition", group: "PixVerse",
        prompt_required: true,
        duration: { options: ["5", "8"], default: "5" },
        aspect_ratio: false,
        size: false,
        resolution_variant: {
            options: ["1080p", "720p", "540p", "360p"],
            default: "1080p",
        },
        negative_prompt: true, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "start_image", label: "Start frame", kind: "image", required: true },
            { id: "end_image", label: "End frame", kind: "image", required: true },
        ],
        custom_fields: [],
    },
    "ltx-2-pro": {
        id: "ltx-2-pro",
        label: "LTX 2.0 Pro", family: "LTX 2.0", variant: "Pro", group: "LTX",
        prompt_required: true,
        duration: { options: ["6", "8", "10"], default: "6" },
        aspect_ratio: false,
        size: false,
        resolution_variant: {
            options: ["1080p", "1440p", "2160p"],
            default: "1080p",
        },
        negative_prompt: false, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "image", label: "Reference image", kind: "image" },
        ],
        custom_fields: [
            { id: "generate_audio", label: "Generate Audio", type: "checkbox", default: false, description: "Generate synchronized audio for the video." },
            { id: "fps", label: "FPS", type: "select", default: "25", options: ["25", "50"], description: "Frames per second. 50 FPS only available for durations up to 10s." },
        ],
    },
    "ltx-2-fast": {
        id: "ltx-2-fast",
        label: "LTX 2.0 Fast", family: "LTX 2.0", variant: "Fast", group: "LTX",
        prompt_required: true,
        duration: { options: ["6", "8", "10", "12", "14", "16", "18", "20"], default: "6" },
        aspect_ratio: false,
        size: false,
        resolution_variant: {
            options: ["1080p", "1440p", "2160p"],
            default: "1080p",
        },
        negative_prompt: false, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "image", label: "Reference image", kind: "image" },
        ],
        custom_fields: [
            { id: "generate_audio", label: "Generate Audio", type: "checkbox", default: false, description: "Generate synchronized audio for the video." },
            { id: "fps", label: "FPS", type: "select", default: "25", options: ["25", "50"], description: "Frames per second. 50 FPS only for durations up to 10s at 1080p." },
        ],
    },
    "omni-human-1-5": {
        id: "omni-human-1-5",
        label: "OmniHuman 1.5", family: "OmniHuman 1.5", variant: "", group: "OmniHuman",
        prompt_required: false,
        duration: false,
        aspect_ratio: false,
        size: false,
        resolution_variant: {
            options: ["1080p", "720p"],
            default: "1080p",
        },
        negative_prompt: false, cfg_scale: false, style: false,
        shot_type: false, prompt_expansion: false, elements: false,
        media_slots: [
            { id: "image", label: "Character image", kind: "image", required: true },
            { id: "audio", label: "Audio track", kind: "audio", required: true },
        ],
        custom_fields: [
            { id: "turbo_mode", label: "Turbo Mode", type: "checkbox", default: false, description: "Faster generation with potentially reduced quality." },
        ],
    },
    ...EXTERNAL_VIDEO_CAPABILITIES,
};

/** Ordered list of group IDs for display */
export const VIDEO_CAPABILITY_GROUPS = [
    "Kling", "RunWay", "WAN", "MiniMax", "Seedance", "PixVerse", "LTX", "OmniHuman",
    "Google AI Studio", "Google Vertex AI", "Vercel AI Gateway",
];

/** Get all capabilities for models in a given group */
export function getVideoCapabilitiesByGroup(group: string): ModelCapabilities[] {
    return Object.values(VIDEO_CAPABILITIES).filter((c) => c.group === group);
}

/** Get unique families within a group */
export function getVideoFamilies(group: string): string[] {
    const families = new Set<string>();
    getVideoCapabilitiesByGroup(group).forEach((c) => families.add(c.family));
    return [...families];
}

/** Get all unique groups that exist in capabilities */
export function getVideoGroups(): string[] {
    const existing = new Set(Object.values(VIDEO_CAPABILITIES).map((c) => c.group));
    return VIDEO_CAPABILITY_GROUPS.filter((g) => existing.has(g)).concat(
        [...existing].filter((g) => !VIDEO_CAPABILITY_GROUPS.includes(g))
    );
}
