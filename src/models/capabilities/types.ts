/**
 * ModelCapabilities — tells the frontend which controls to render per model.
 * Importable on both client and server (no side-effects).
 */

export interface FieldOption {
    label: string;
    value: string;
}

/** A parameter the model supports */
export interface FieldCapability<T = string> {
    options?: T[];
    default?: T;
}

/** A media upload slot */
export interface MediaSlotCapability {
    id: string;
    label: string;
    kind: "image" | "video" | "audio";
    required?: boolean;
    multiple?: boolean;
    accept?: string;
    /** Describes the semantic role (e.g. "first_frame", "end_frame") */
    type?: string;
    /** Description for the UI tooltip */
    description?: string;
}

/** A custom field not covered by canonical params */
export interface CustomFieldCapability {
    id: string;
    label: string;
    type: "select" | "number" | "checkbox" | "text";
    default?: unknown;
    options?: string[];
    minimum?: number;
    maximum?: number;
    description?: string;
}

export interface ModelCapabilities {
    id: string;
    label: string;
    family: string;
    variant: string;
    group: string;
    category?: string;

    /** API provider used to execute this model. Legacy entries default to Freepik. */
    provider?: "freepik" | "google-ai-studio" | "google-vertex" | "vercel-ai-gateway";
    /** Model identifier expected by the upstream provider. */
    provider_model_id?: string;
    /** Selects the provider API surface when a provider exposes more than one. */
    provider_mode?: "native-image" | "language-image" | "image-model" | "video";

    /** Whether prompt is required */
    prompt_required: boolean;
    /** Whether prompt input is supported at all (false = no prompt field) */
    prompt_supported?: boolean;
    prompt_max?: number;

    /** Duration control */
    duration: false | FieldCapability<string>;
    /** Aspect ratio control — options are [label, value] tuples */
    aspect_ratio: false | FieldCapability<[string, string]>;
    /** Size control — options are [label, value] tuples */
    size: false | FieldCapability<[string, string]>;
    /** Resolution variants (e.g. 1080p, 720p) */
    resolution_variant: false | FieldCapability<string>;

    /** Per-variant UI overrides (keyed by variant option id) */
    variant_overrides?: Record<string, {
        duration?: FieldCapability<string>;
        aspect_ratio?: FieldCapability<[string, string]>;
        size?: FieldCapability<[string, string]>;
    }>;

    /** Feature flags */
    negative_prompt: boolean;
    cfg_scale: boolean;
    style: boolean;
    shot_type: boolean;
    prompt_expansion: boolean;
    elements: boolean;

    /** Media input slots */
    media_slots: MediaSlotCapability[];

    /** Custom vendor-specific fields */
    custom_fields: CustomFieldCapability[];

    /** Sort key for UI ordering */
    sort_key?: number;
}

/** Info about a model group for UI display */
export interface ModelGroupInfo {
    id: string;
    label: string;
    families: string[];
}
