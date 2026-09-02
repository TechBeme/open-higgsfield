/**
 * Frontend helper functions for video capabilities.
 * Derive UI-friendly data shapes from ModelCapabilities.
 */
import type { ModelCapabilities } from "./types";

/* ── Image / attachment roles ── */

export interface ImageRole {
    id: string;
    label: string;
    kind: "image";
    type?: string;
}

export interface AttachmentRole {
    id: string;
    label: string;
    kind: "image" | "video" | "audio";
    required?: boolean;
    set_fields?: Record<string, string>;
    path?: string;
}

export interface AttachmentGroup {
    id: string;
    label: string;
    roles: string[];
    min?: number;
    max?: number;
}

/** Per-model frontend overrides for data not captured in capabilities */
interface FrontendOverrides {
    v2v_mode?: { post_path: string; poll_path: string };
    attachment_roles?: AttachmentRole[];
    attachment_groups?: AttachmentGroup[];
    min_image_roles_required?: number;
}

const OVERRIDES: Record<string, FrontendOverrides> = {
    "kling-v3-omni-pro": {
        v2v_mode: {
            post_path: "/v1/ai/reference-to-video/kling-v3-omni-pro",
            poll_path: "/v1/ai/reference-to-video/kling-v3-omni/{task_id}",
        },
    },
    "kling-v3-omni-std": {
        v2v_mode: {
            post_path: "/v1/ai/reference-to-video/kling-v3-omni-std",
            poll_path: "/v1/ai/reference-to-video/kling-v3-omni/{task_id}",
        },
    },
    "runway-act-two": {
        attachment_roles: [
            { id: "character_image", label: "Character (image)", kind: "image", path: "character.uri", set_fields: { "character.type": "image" } },
            { id: "character_video", label: "Character (video)", kind: "video", path: "character.uri", set_fields: { "character.type": "video" } },
            { id: "reference_video", label: "Performance video", kind: "video", path: "reference.uri", required: true, set_fields: { "reference.type": "video" } },
        ],
        attachment_groups: [{
            id: "character_source", label: "character", roles: ["character_image", "character_video"], min: 1, max: 1,
        }],
    },
    "pixverse-v5-transition": {
        min_image_roles_required: 2,
    },
};

export function getVideoOverrides(modelId: string): FrontendOverrides {
    return OVERRIDES[modelId] ?? {};
}

/** Resolution variant for frontend display */
export interface ResolutionVariant {
    id: string;
    label: string;
    durations?: string[];
    sizes?: [string, string][];
    aspect_ratios?: [string, string][];
}

/** Derive resolution variants from capabilities */
export function getResolutionVariants(caps: ModelCapabilities): ResolutionVariant[] | undefined {
    if (!caps.resolution_variant || !caps.resolution_variant.options) return undefined;
    const variants = caps.resolution_variant.options.map(opt => {
        const vo = caps.variant_overrides?.[opt];
        return {
            id: opt,
            label: opt,
            ...(vo?.duration?.options ? { durations: vo.duration.options } : {}),
            ...(vo?.size?.options ? { sizes: vo.size.options } : {}),
            ...(vo?.aspect_ratio?.options ? { aspect_ratios: vo.aspect_ratio.options } : {}),
        };
    });
    return variants.length > 1 ? variants : undefined;
}

/** Get durations, respecting variant overrides */
export function getDurations(caps: ModelCapabilities, variantId?: string): string[] {
    if (variantId && caps.variant_overrides?.[variantId]?.duration?.options) {
        return caps.variant_overrides[variantId].duration!.options!;
    }
    return caps.duration ? (caps.duration.options ?? []) : [];
}

/** Get aspect ratios, respecting variant overrides */
export function getAspectRatios(caps: ModelCapabilities, variantId?: string): [string, string][] | null {
    if (variantId && caps.variant_overrides?.[variantId]?.aspect_ratio?.options) {
        return caps.variant_overrides[variantId].aspect_ratio!.options!;
    }
    return caps.aspect_ratio ? (caps.aspect_ratio.options ?? null) : null;
}

/** Get sizes, respecting variant overrides */
export function getSizes(caps: ModelCapabilities, variantId?: string): [string, string][] | null {
    if (variantId && caps.variant_overrides?.[variantId]?.size?.options) {
        return caps.variant_overrides[variantId].size!.options!;
    }
    return caps.size ? (caps.size.options ?? null) : null;
}

/** Get image roles from media_slots (multiple image slots → roles) */
export function getImageRoles(caps: ModelCapabilities): ImageRole[] | undefined {
    const ov = OVERRIDES[caps.id];
    if (ov?.attachment_roles) return undefined; // act-two uses attachment_roles instead

    const imageSlots = caps.media_slots.filter(s => s.kind === "image");
    const isMultiRole = imageSlots.length > 1 ||
        imageSlots.some(s => s.id.includes("start") || s.id.includes("end"));

    if (!isMultiRole) return undefined;

    return imageSlots.map(s => ({
        id: s.id,
        label: s.label,
        kind: "image" as const,
        type: s.type,
    }));
}

/** Get single image field from media_slots (exactly 1 image slot) */
export function getImageField(caps: ModelCapabilities): string | undefined {
    const imageSlots = caps.media_slots.filter(s => s.kind === "image");
    if (imageSlots.length !== 1) return undefined;
    if (imageSlots[0].id.includes("start") || imageSlots[0].id.includes("end")) return undefined;
    return imageSlots[0].id;
}

/** Check if model has image_required (single mandatory image slot) */
export function isImageRequired(caps: ModelCapabilities): boolean {
    const imageSlots = caps.media_slots.filter(s => s.kind === "image");
    return imageSlots.length === 1 && !!imageSlots[0].required;
}

/** Get video field from media_slots */
export function getVideoField(caps: ModelCapabilities): string | undefined {
    const videoSlots = caps.media_slots.filter(s => s.kind === "video");
    return videoSlots.length > 0 ? videoSlots[0].id : undefined;
}

/** Check if video is required */
export function isVideoRequired(caps: ModelCapabilities): boolean {
    return caps.media_slots.some(s => s.kind === "video" && s.required);
}

/** Check if audio is required */
export function isAudioRequired(caps: ModelCapabilities): boolean {
    return caps.media_slots.some(s => s.kind === "audio" && s.required);
}

/** Check if model has any attachment needs (images, video, audio, or custom attachment_roles) */
export function hasAttachments(caps: ModelCapabilities): boolean {
    const ov = OVERRIDES[caps.id];
    if (ov?.attachment_roles?.length) return true;
    return caps.media_slots.some(s => s.kind === "image" || s.kind === "video");
}
