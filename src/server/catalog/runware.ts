import "server-only";

import contracts from "./runware-contracts-data";
import type { CustomFieldCapability, ImageModelCapability, MediaSlotCapability, ParameterSchema } from "@/models/capabilities/types";

export interface RunwareConstraint {
    operation: string;
    parameters: string[];
    minimum?: number;
    maximum?: number;
    allowed?: Array<string | number>;
    scope?: string;
    when?: { present?: string[]; absent?: string[] };
}
export interface RunwareSchema extends ParameterSchema {
    properties?: Record<string, RunwareSchema>;
    items?: RunwareSchema;
    multipleOf?: number;
    [key: string]: unknown;
}
export interface RunwareContract {
    label: string;
    air: string;
    mediaType: "image" | "video";
    /** Official Runware task type (imageInference, videoInference or a media utility). */
    operation: string;
    outputUrlField: "imageURL" | "videoURL" | "guideImageURL" | "maskImageURL";
    source: string;
    schemaSha256: string;
    schema: RunwareSchema;
}
export const RUNWARE_CONTRACTS = contracts as unknown as Record<string, RunwareContract>;
const byAir = new Map(Object.values(RUNWARE_CONTRACTS).map(c => [`${c.mediaType}:${c.air}`, c]));
export const isRunwareAir = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]+:[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+$/.test(value) && value.length <= 200;
export const getRunwareContract = (air: string | undefined, mediaType: "image" | "video") => byAir.get(`${mediaType}:${air}`);
const title = (id: string) => id.replaceAll(".", " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, c => c.toUpperCase());

/** UI hints use the shared portable subset; the complete schema is validated by Ajv before dispatch. */
function fieldSchema(schema: RunwareSchema): ParameterSchema {
    const keys = new Set(["type", "enum", "const", "required", "additionalProperties", "minItems", "maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern"]);
    const result: Record<string, unknown> = Object.fromEntries(Object.entries(schema).filter(([key]) => keys.has(key) && !(key === "enum" && (schema.enum?.length ?? 0) > 512)));
    if (schema.properties) result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, fieldSchema(value)]));
    if (schema.items) result.items = fieldSchema(schema.items);
    // URI/UUID alternatives differ only in format; omitting oneOf avoids ambiguity in the portable validator.
    for (const key of ["anyOf", "oneOf", "allOf"] as const) if (schema[key]) {
        const parts = schema[key].map(part => fieldSchema(part as RunwareSchema));
        if (parts.every(part => Object.keys(part).length > 0)) result[key] = parts;
    }
    return result as ParameterSchema;
}

export function runwareDimensionPairs(schema: RunwareSchema): Array<[number, number]> {
    const pairs = new Map<string, [number, number]>();
    function visit(value: unknown) {
        if (!value || typeof value !== "object") return;
        const node = value as RunwareSchema;
        const width = node.properties?.width?.const;
        const height = node.properties?.height?.const;
        if (typeof width === "number" && typeof height === "number") pairs.set(`${width}x${height}`, [width, height]);
        for (const child of Object.values(value)) if (typeof child === "object") visit(child);
    }
    visit(schema);
    return [...pairs.values()];
}

export function runwareMediaBinding(key: string, schema: RunwareSchema, required: boolean, contract: RunwareContract): MediaSlotCapability | undefined {
    const kind = /image/i.test(key) ? "image" : /video/i.test(key) ? "video" : /audio/i.test(key) ? "audio" : undefined;
    if (!kind || !["string", "array"].includes(String(schema.type))) return;
    const item = schema.type === "array" ? schema.items : schema;
    // Frame arrays accept strings in order; complex forms remain available through advanced input controls.
    const acceptsString = item?.type === "string" || (item?.anyOf ?? []).some(s => s.type === "string");
    if (!acceptsString) return;
    const limits = (contract.schema["x-constraints"] ?? []) as RunwareConstraint[];
    const maxBytes = limits.filter(c => c.operation === "fileSize" && c.scope === "each" && c.parameters.includes(`inputs.${key}`) && !c.when)
        .map(c => c.maximum).filter((n): n is number => n !== undefined);
    return { id: key, label: title(key), kind, required, multiple: schema.type === "array", min_count: required ? schema.minItems ?? 1 : 0,
        max_count: schema.type === "array" ? Math.min(schema.maxItems ?? 16, 64) : 1,
        ...(maxBytes.length ? { max_bytes: Math.min(...maxBytes) } : {}), accept: "url_only",
        ...(key === "frameImages" ? { description: "Add the first frame, then the last frame. Their order matters." } : {}),
    };
}

const managed = new Set(["model", "taskType", "taskUUID", "positivePrompt", "inputs", "deliveryMethod", "outputType", "includeCost", "webhookURL", "uploadEndpoint", "ttl", "routing"]);
export function runwareCapabilities(id: string, c: RunwareContract): ImageModelCapability {
    const fields: CustomFieldCapability[] = [];
    const slots: MediaSlotCapability[] = [];
    const props = c.schema.properties ?? {};
    const dimensions = runwareDimensionPairs(c.schema);
    if (dimensions.length) fields.push({ id: "output_size", label: "Output size", type: "select", options: dimensions.map(([w, h]) => `${w}x${h}`),
        description: "Leave the size at default to use the model's automatic size or a compatible preset. With frame inputs, use resolution instead." });
    function add(key: string, schema: RunwareSchema, required = false) {
        if (Object.hasOwn(schema, "const")) return;
        if (key === "duration" && Array.isArray(schema.type) && schema.type.includes("integer") && schema.type.includes("string")) {
            const numeric = schema.oneOf?.find(part => part.type === "integer");
            if (numeric?.minimum !== undefined && numeric.maximum !== undefined && numeric.maximum - numeric.minimum <= 120
                && schema.oneOf?.some(part => part.const === "auto")) {
                fields.push({ id: key, label: "Duration", type: "select", default: String(schema.default ?? "auto"), options: ["auto", ...Array.from({ length: numeric.maximum - numeric.minimum + 1 }, (_, i) => String(numeric.minimum! + i))] });
                return;
            }
        }
        // Keep advanced structures together; model settings use ordinary controls.
        if (schema.type === "object" && schema.properties && /^(settings|providerSettings)(\.|$)/.test(key)) {
            for (const [child, value] of Object.entries(schema.properties)) add(`${key}.${child}`, value, required && !!schema.required?.includes(child));
            return;
        }
        // Large provider directories (e.g. avatar IDs) stay text/JSON controls;
        // the complete server schema still validates their accepted values.
        const type = schema.enum && schema.enum.length <= 512 && schema.type === "string" ? "select" : schema.type === "boolean" ? "checkbox"
            : ["number", "integer"].includes(String(schema.type)) ? "number" : schema.type === "string" ? "text" : "json";
        const portable = fieldSchema(schema);
        if (key === "numberResults") portable.maximum = Math.min(schema.maximum ?? 1, c.mediaType === "video" ? 1 : 16);
        fields.push({ id: key, label: title(key), type, required: ["width", "height"].includes(key) ? false : required,
            schema: portable, options: type === "select" ? schema.enum as string[] : undefined,
            minimum: schema.minimum, maximum: portable.maximum, step: schema.multipleOf ?? (schema.type === "integer" ? 1 : undefined),
            minLength: schema.minLength, maxLength: schema.maxLength,
            // Conditional secondary settings should stay optional: a default mode
            // would make disabling prompt expansion an invalid upstream request.
            ...(!["width", "height", "resolution", "strength", "settings.promptExtendMode"].includes(key) && schema.default !== undefined
                && !(type === "json" && typeof schema.default === "string") ? { default: schema.default } : {}),
        });
    }
    for (const [key, schema] of Object.entries(props)) {
        if (managed.has(key) || dimensions.length && ["width", "height"].includes(key)) continue;
        if (key === "numberResults" && c.mediaType === "video") continue;
        add(key, schema, c.schema.required?.includes(key));
    }
    for (const [key, schema] of Object.entries(props.inputs?.properties ?? {})) {
        const required = !!c.schema.required?.includes("inputs") && !!props.inputs.required?.includes(key);
        const slot = runwareMediaBinding(key, schema, required, c);
        if (slot) slots.push(slot);
        // Also expose object variants (timed frames, reference clips) without discarding their options.
        if (!slot || schema.type === "array" && schema.items?.type !== "string") add(`inputs.${key}`, schema, !slot && required);
    }
    return { id, label: c.label, family: c.label, group: "Runware", variant: "", category: "Generate", provider: "runware", provider_model_id: c.air,
        ...(c.mediaType === "video" ? { provider_mode: "video" as const } : {}),
        prompt_required: !!c.schema.required?.includes("positivePrompt"), prompt_supported: !!props.positivePrompt, prompt_max: props.positivePrompt?.maxLength,
        duration: false, aspect_ratio: false, size: false, resolution_variant: false, negative_prompt: false, cfg_scale: false,
        style: false, shot_type: false, prompt_expansion: false, elements: false, custom_fields: fields, media_slots: slots, has_edit_variant: false };
}
export const RUNWARE_IMAGE_CAPABILITIES: Record<string, ImageModelCapability> = {};
export const RUNWARE_VIDEO_CAPABILITIES: Record<string, ImageModelCapability> = {};
for (const [id, contract] of Object.entries(RUNWARE_CONTRACTS)) {
    (contract.mediaType === "image" ? RUNWARE_IMAGE_CAPABILITIES : RUNWARE_VIDEO_CAPABILITIES)[id] = runwareCapabilities(id, contract);
}
