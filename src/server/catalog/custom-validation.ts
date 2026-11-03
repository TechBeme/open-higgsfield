import "server-only";

import { z } from "zod";
import type { ModelCapabilities, ParameterSchema } from "@/models/capabilities/types";
import { fieldSchema, validateParameter } from "@/models/parameter-schema";
import { isProviderId } from "@/providers/definitions";
import { IMAGE_CAPABILITIES } from "./image";
import { VIDEO_CAPABILITIES } from "./video";
import { getMagnificContract } from "./magnific";
import { getToapisContract } from "./toapis";
import { getRunwareContract } from "./runware";

const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,180}$/).refine(value => value.split(/[.:]/).every(part => !unsafeKeys.has(part)));
const label = z.string().trim().min(1).max(300);
const description = z.string().max(16_000).optional();
const nonnegative = z.number().int().nonnegative();
const pattern = z.string().max(1024).refine(value => { try { new RegExp(value, "u"); return true; } catch { return false; } });
const jsonType = z.enum(["string", "number", "integer", "boolean", "object", "array", "null"]);
const parameterSchema: z.ZodType<ParameterSchema> = z.lazy(() => z.strictObject({
    type: z.union([jsonType, z.array(jsonType).min(1).max(7)]).optional(),
    enum: z.array(z.unknown()).min(1).max(512).optional(), const: z.unknown().optional(),
    properties: z.record(z.string(), parameterSchema).optional(),
    required: z.array(z.string()).max(256).optional(),
    additionalProperties: z.union([z.boolean(), parameterSchema]).optional(),
    items: parameterSchema.optional(),
    minItems: nonnegative.optional(), maxItems: nonnegative.optional(),
    minimum: z.number().optional(), maximum: z.number().optional(),
    exclusiveMinimum: z.number().optional(), exclusiveMaximum: z.number().optional(),
    minLength: nonnegative.optional(), maxLength: nonnegative.optional(), pattern: pattern.optional(),
    anyOf: z.array(parameterSchema).min(1).max(32).optional(),
    oneOf: z.array(parameterSchema).min(1).max(32).optional(),
    allOf: z.array(parameterSchema).min(1).max(32).optional(),
    description, title: z.string().max(300).optional(), format: z.string().max(100).optional(),
    default: z.unknown().optional(),
}).refine(value => (value.minimum === undefined || value.maximum === undefined || value.minimum <= value.maximum)
    && (value.minItems === undefined || value.maxItems === undefined || value.minItems <= value.maxItems)
    && (value.minLength === undefined || value.maxLength === undefined || value.minLength <= value.maxLength)));

const stringControl = z.strictObject({ options: z.array(z.string()).max(512).optional(), default: z.string().optional() });
const tuple = z.tuple([z.string(), z.string()]);
const tupleControl = z.strictObject({ options: z.array(tuple).max(512).optional(), default: tuple.optional() });
const customField = z.strictObject({
    id: identifier, label, type: z.enum(["select", "number", "checkbox", "text", "json"]),
    required: z.boolean().optional(), step: z.number().positive().optional(),
    minLength: nonnegative.optional(), maxLength: nonnegative.optional(), pattern: pattern.optional(),
    schema: parameterSchema.optional(), default: z.unknown().optional(),
    options: z.array(z.string()).min(1).max(512).optional(),
    minimum: z.number().optional(), maximum: z.number().optional(), description,
}).refine(field => (field.type !== "select" || Boolean(field.options?.length))
    && (field.minimum === undefined || field.maximum === undefined || field.minimum <= field.maximum)
    && (field.minLength === undefined || field.maxLength === undefined || field.minLength <= field.maxLength));
const mediaSlot = z.strictObject({
    id: identifier.refine(value => /^[A-Za-z0-9_]{1,123}$/.test(value)), label, kind: z.enum(["image", "video", "audio"]),
    required: z.boolean().optional(), multiple: z.boolean().optional(),
    max_count: nonnegative.max(256).optional(), min_count: nonnegative.max(256).optional(),
    max_bytes: nonnegative.optional(), accept: z.string().max(1024).optional(),
    type: z.string().max(180).optional(), description,
}).refine(slot => (slot.min_count ?? (slot.required ? 1 : 0)) <= (slot.max_count ?? (slot.multiple ? 256 : 1)));

const capabilitySchema = z.strictObject({
    id: identifier, label, family: label, variant: z.string().max(300), group: label,
    category: z.string().max(300).optional(), deprecated: z.boolean().optional(),
    provider: z.string().refine(isProviderId), provider_model_id: z.string().regex(/^[A-Za-z0-9_.:@/-]{1,200}$/),
    provider_mode: z.enum(["native-image", "language-image", "image-model", "video", "interaction"]).optional(),
    provider_action: identifier.optional(),
    prompt_required: z.boolean(), prompt_supported: z.boolean().optional(), prompt_max: nonnegative.optional(),
    duration: z.union([z.literal(false), stringControl]), aspect_ratio: z.union([z.literal(false), tupleControl]),
    size: z.union([z.literal(false), tupleControl]), resolution_variant: z.union([z.literal(false), stringControl]),
    variant_overrides: z.record(z.string(), z.strictObject({ duration: stringControl.optional(), aspect_ratio: tupleControl.optional(), size: tupleControl.optional() })).optional(),
    negative_prompt: z.boolean(), cfg_scale: z.boolean(), style: z.boolean(), shot_type: z.boolean(), prompt_expansion: z.boolean(), elements: z.boolean(),
    seed: z.union([z.literal(false), z.strictObject({ minimum: z.number(), maximum: z.number() }).refine(value => value.minimum <= value.maximum)]).optional(),
    media_slots: z.array(mediaSlot).max(32), custom_fields: z.array(customField).max(128), sort_key: z.number().optional(),
    catalog_source: z.enum(["custom", "discovered"]).optional(), catalog_status: z.enum(["verified", "unverified", "disabled"]).optional(),
    has_edit_variant: z.boolean().optional(),
    size_ui: z.strictObject({
        width_field: identifier, height_field: identifier,
        aspect_ratios: z.array(z.strictObject({ id: z.string(), w: z.number().positive(), h: z.number().positive() })).min(1).max(128),
        resolutions: z.array(z.strictObject({ id: z.string(), base: z.number().positive() })).min(1).max(128),
        default_aspect: z.string(), default_resolution: z.string(),
    }).optional(),
});

function assertBoundedStructure(value: unknown): void {
    const pending = [{ value, depth: 0 }];
    let nodes = 0;
    while (pending.length) {
        const item = pending.pop()!;
        if (++nodes > 12_000 || item.depth > 24) throw new Error("ERR_CUSTOM_MODEL_INVALID");
        if (!item.value || typeof item.value !== "object") continue;
        for (const [key, child] of Object.entries(item.value)) {
            if (unsafeKeys.has(key)) throw new Error("ERR_CUSTOM_MODEL_INVALID");
            pending.push({ value: child, depth: item.depth + 1 });
        }
    }
}

/** Validate the editable contract before it can reach renderers or generation code. */
export function assertCustomModelCapabilities(value: unknown, mediaType: "image" | "video", modelId?: string): asserts value is ModelCapabilities {
    assertBoundedStructure(value);
    const parsed = capabilitySchema.safeParse(value);
    if (!parsed.success) throw new Error("ERR_CUSTOM_MODEL_INVALID");
    const model = parsed.data;
    if (model.id !== (modelId ?? model.id) || Object.hasOwn(IMAGE_CAPABILITIES, model.id) || Object.hasOwn(VIDEO_CAPABILITIES, model.id)) throw new Error("ERR_CUSTOM_MODEL_INVALID");
    if (mediaType === "video" && model.provider_mode !== "video" || mediaType === "image" && model.provider_mode === "video") throw new Error("ERR_CUSTOM_MODEL_MEDIA_TYPE");
    if (model.provider === "magnific" && !getMagnificContract(model.provider_model_id, mediaType)
        || model.provider === "toapis" && !getToapisContract(model.provider_model_id, mediaType, model.provider_action)
        || model.provider === "runware" && !getRunwareContract(model.provider_model_id, mediaType)) throw new Error("ERR_CUSTOM_MODEL_ADAPTER_REQUIRED");
    if (model.provider !== "runware" && model.provider_model_id.includes("@")) throw new Error("ERR_CUSTOM_MODEL_INVALID");
    for (const fields of [model.custom_fields, model.media_slots]) {
        if (new Set(fields.map(field => field.id)).size !== fields.length) throw new Error("ERR_CUSTOM_MODEL_INVALID");
    }
    for (const field of model.custom_fields) {
        if (field.default !== undefined && validateParameter(field.default, fieldSchema(field)).length) throw new Error("ERR_CUSTOM_MODEL_INVALID");
    }
    if (model.size_ui && (!model.size_ui.aspect_ratios.some(ratio => ratio.id === model.size_ui!.default_aspect)
        || !model.size_ui.resolutions.some(resolution => resolution.id === model.size_ui!.default_resolution))) throw new Error("ERR_CUSTOM_MODEL_INVALID");
}

export function hasBuiltInCapability(mediaType: "image" | "video", modelId: string): boolean {
    return Object.hasOwn(mediaType === "image" ? IMAGE_CAPABILITIES : VIDEO_CAPABILITIES, modelId);
}
