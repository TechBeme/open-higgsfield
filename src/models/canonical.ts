/**
 * Canonical parameters — the single normalised interface the frontend always uses.
 * Backend adapters translate these to vendor-specific API formats.
 */

export interface CanonicalParams {
    model_id: string;
    prompt: string;
    negative_prompt?: string;
    duration?: string;
    aspect_ratio?: string;
    resolution?: string;
    size?: string;
    width?: number;
    height?: number;
    cfg_scale?: number;
    seed?: number;
    style?: string;
    generate_audio?: boolean;
    expand_prompt?: boolean;
    shot_type?: string;
    /** Per-model custom field values keyed by field id */
    field_values?: Record<string, unknown>;
}

export interface CanonicalMediaInputs {
    /** Image attachments keyed by role/slot id → uploaded URL */
    images?: Record<string, string>;
    /** Video attachment URL */
    video?: string;
    /** Audio attachment URL */
    audio?: string;
    /** Elements (character/style reference images) */
    elements?: Array<{
        frontal_image_url?: string;
        reference_image_urls?: string[];
    }>;
}
