/**
 * ModelCapabilities — tells the frontend which controls to render per model.
 * Importable on both client and server (no side-effects).
 */
import type { ProviderId } from "@/providers/types";

export interface FieldOption {
    label: string;
    value: string;
}

/** Portable, closed subset of JSON Schema used by documented model parameters. */
export interface ParameterSchema {
    type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null" | Array<"string" | "number" | "integer" | "boolean" | "object" | "array" | "null">;
    enum?: unknown[];
    const?: unknown;
    properties?: Record<string, ParameterSchema>;
    required?: string[];
    additionalProperties?: boolean | ParameterSchema;
    items?: ParameterSchema;
    minItems?: number;
    maxItems?: number;
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number;
    exclusiveMaximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    anyOf?: ParameterSchema[];
    oneOf?: ParameterSchema[];
    allOf?: ParameterSchema[];
    description?: string;
    default?: unknown;
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
    max_count?: number;
    min_count?: number;
    max_bytes?: number;
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
    type: "select" | "number" | "checkbox" | "text" | "json";
    required?: boolean;
    step?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    schema?: ParameterSchema;
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
    /** Retained for saved-task recovery, excluded from new generation choices. */
    deprecated?: boolean;

    /** API provider used to execute this model. Every model must specify one. */
    provider: ProviderId;
    /** Model identifier expected by the upstream provider. */
    provider_model_id?: string;
    /** Selects the provider API surface when a provider exposes more than one. */
    provider_mode?: "native-image" | "language-image" | "image-model" | "video" | "interaction";
    /** Reviewed provider action, independent of the user-editable local model ID. */
    provider_action?: string;

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
    /** Optional seed control for providers using the canonical seed parameter. */
    seed?: false | { minimum: number; maximum: number };

    /** Media input slots */
    media_slots: MediaSlotCapability[];

    /** Custom vendor-specific fields */
    custom_fields: CustomFieldCapability[];

    /** Sort key for UI ordering */
    sort_key?: number;

    /** Runtime catalog metadata. These fields are omitted from legacy built-ins. */
    catalog_source?: "builtin" | "discovered" | "custom";
    catalog_status?: "verified" | "unverified" | "disabled";
}

/** Info about a model group for UI display */
export interface ModelGroupInfo {
    id: string;
    label: string;
    families: string[];
}

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
