import type { CanonicalParams, CanonicalMediaInputs } from "./canonical";
import type { CustomFieldCapability, ModelCapabilities, ParameterSchema } from "./capabilities/types";

/** Validate without coercion, defaults, remote references or executable expressions. */
export function validateParameter(value: unknown, schema: ParameterSchema, path = "value", depth = 0): string[] {
    if (depth > 24) return [`${path}: structure too deep`];
    const errors: string[] = [];
    const walk = (v: unknown, s: ParameterSchema, p = path) => validateParameter(v, s, p, depth + 1);
    if (schema.allOf) for (const s of schema.allOf) errors.push(...walk(value, s));
    if (schema.anyOf && !schema.anyOf.some(s => walk(value, s).length === 0)) errors.push(`${path}: no accepted shape`);
    if (schema.oneOf && schema.oneOf.filter(s => walk(value, s).length === 0).length !== 1) errors.push(`${path}: ambiguous or invalid shape`);
    if (schema.enum && !schema.enum.some(v => JSON.stringify(v) === JSON.stringify(value))) errors.push(`${path}: unsupported option`);
    if (Object.hasOwn(schema, "const") && JSON.stringify(schema.const) !== JSON.stringify(value)) errors.push(`${path}: unexpected constant`);
    const matches = (type: string) => type === "null" ? value === null : type === "array" ? Array.isArray(value)
        : type === "object" ? !!value && typeof value === "object" && !Array.isArray(value)
        : type === "integer" ? Number.isSafeInteger(value) : type === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === type;
    if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(matches)) return [...errors, `${path}: invalid type`];
    if (typeof value === "number") {
        if (!Number.isFinite(value) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)
            || (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) || (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum)) errors.push(`${path}: outside accepted range`);
    }
    if (typeof value === "string") {
        if ((schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength)) errors.push(`${path}: invalid length`);
        if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${path}: invalid format`);
    }
    if (Array.isArray(value)) {
        if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) errors.push(`${path}: invalid item count`);
        if (value.length > 256) errors.push(`${path}: too many items`);
        else if (schema.items) value.forEach((v, i) => errors.push(...walk(v, schema.items!, `${path}[${i}]`)));
    } else if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        for (const key of schema.required ?? []) if (!Object.hasOwn(obj, key)) errors.push(`${path}.${key}: required`);
        for (const [key, item] of Object.entries(obj)) {
            if (["__proto__", "prototype", "constructor"].includes(key)) { errors.push(`${path}: unsafe key`); continue; }
            const child = schema.properties?.[key];
            if (child) errors.push(...walk(item, child, `${path}.${key}`));
            else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unknown parameter`);
            else if (typeof schema.additionalProperties === "object") errors.push(...walk(item, schema.additionalProperties, `${path}.${key}`));
        }
    }
    return errors;
}

export function fieldSchema(field: CustomFieldCapability): ParameterSchema {
    return field.schema ?? { type: field.type === "number" ? "number" : field.type === "checkbox" ? "boolean" : field.type === "json" ? undefined : "string",
        ...(field.options ? { enum: field.options } : {}), minimum: field.minimum, maximum: field.maximum,
        minLength: field.minLength, maxLength: field.maxLength, pattern: field.pattern };
}

/** Parse only declared controls; keep empty optional controls absent. */
export function parseModelFields(model: ModelCapabilities, input: unknown): { values: Record<string, unknown>; errors: string[] } {
    if (!input || typeof input !== "object" || Array.isArray(input)) return { values: {}, errors: ["Invalid model parameters"] };
    const raw = input as Record<string, unknown>;
    const values: Record<string, unknown> = {};
    const declaredFields = model.custom_fields ?? [];
    const fields = new Map(declaredFields.map(f => [f.id, f]));
    const errors: string[] = [];
    for (const key of Object.keys(raw)) if (!fields.has(key)) errors.push(`${key}: unknown parameter`);
    for (const field of declaredFields) {
        let value = raw[field.id];
        if (value === "" || value === null || value === undefined) value = field.default;
        if (value === undefined) { if (field.required) errors.push(`${field.label}: required`); continue; }
        if (field.type === "json" && typeof value === "string") {
            try { value = JSON.parse(value); } catch { errors.push(`${field.label}: invalid JSON`); continue; }
        }
        errors.push(...validateParameter(value, fieldSchema(field), field.label));
        values[field.id] = value;
    }
    return { values, errors };
}

export function validateModelParams(model: ModelCapabilities, params: CanonicalParams): string[] {
    const errors: string[] = [];
    if (model.deprecated) errors.push("This model is retired; choose a current model");
    if (model.prompt_required && !params.prompt.trim()) errors.push("Prompt required");
    if (params.prompt.length > (model.prompt_max ?? 65536)) errors.push("Prompt exceeds model limit");
    const check = (key: string, value: string | undefined, options: string[] | undefined) => {
        if (value && options?.length && !options.includes(value)) errors.push(`${key}: unsupported option`);
    };
    check("duration", params.duration, model.duration ? model.duration.options : undefined);
    check("aspect_ratio", params.aspect_ratio, model.aspect_ratio ? model.aspect_ratio.options?.flatMap(o => [o[0], o[1]]) : undefined);
    check("size", params.size, model.size ? model.size.options?.map(o => o[1]) : undefined);
    check("resolution", params.resolution, model.resolution_variant ? model.resolution_variant.options : undefined);
    return errors;
}

export function validateModelMedia(model: ModelCapabilities, media: CanonicalMediaInputs): string[] {
    return (model.media_slots ?? []).flatMap(slot => {
        const count = media.slots?.[slot.id]?.length ?? (media.images?.[slot.id] || (slot.kind === "video" && media.video) || (slot.kind === "audio" && media.audio) ? 1 : 0);
        return count < (slot.min_count ?? (slot.required ? 1 : 0)) || count > (slot.max_count ?? (slot.multiple ? 256 : 1)) ? [`${slot.label}: invalid reference count`] : [];
    });
}
