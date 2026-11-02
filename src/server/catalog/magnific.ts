import "server-only";

import contracts from "@/server/catalog/magnific-contracts-data";
import type { ImageModelCapability } from "@/models/capabilities/types";
import type { ModelCapabilities, ParameterSchema, MediaSlotCapability, CustomFieldCapability } from "@/models/capabilities/types";

export interface MagnificSchema extends ParameterSchema { format?: string; properties?: Record<string, MagnificSchema>; items?: MagnificSchema }
export interface MagnificContract {
    path: string; poll: string | null; mediaType: "image" | "video"; contentType: string; synchronous: boolean; label: string; schema: MagnificSchema;
}
/** Reviewed official OpenAPI contracts, refreshed 2026-11-01. No external refs at runtime. */
export const MAGNIFIC_CONTRACTS = contracts as unknown as Record<string, MagnificContract>;
const contractsByPath = new Map(Object.values(MAGNIFIC_CONTRACTS).map(contract => [`${contract.mediaType}:${contract.path}`, contract]));
export function getMagnificContract(providerModelId: string | undefined, mediaType: "image" | "video"): MagnificContract | undefined {
    return contractsByPath.get(`${mediaType}:${providerModelId}`);
}
export interface MagnificMediaBinding { slot: MediaSlotCapability; array: boolean; property?: string; base64: boolean }
const title = (id: string) => id.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());

/** Only unambiguous, documented media shapes become upload slots. Complex shapes retain a schema editor. */
export function magnificMediaBinding(id: string, schema: MagnificSchema, required: boolean): MagnificMediaBinding | undefined {
    const text = `${id} ${schema.description ?? ""}`;
    if (/strength|weight|size|format|quality|mode|type|generation|duration|resolution|scale|count|output|webhook/i.test(id)) return;
    const kind = /audio|sound_url/i.test(id) ? "audio" : /video|motion_reference/i.test(id) ? "video" : /image|mask|structure_reference|style_reference|character|frontal|first_frame|last_frame/i.test(id) ? "image" : undefined;
    if (!kind || schema.enum) return;
    const array = schema.type === "array";
    const item = array ? schema.items : schema;
    let property: string | undefined;
    if (array && item?.type === "object") {
        const props = Object.entries(item.properties ?? {});
        const mediaProp = props.find(([key, val]) => /^(image|image_url|url)$/.test(key) && val.type === "string");
        if (!mediaProp || (item.required ?? []).some(k => k !== mediaProp[0])) return;
        // Objects may carry extra options: use the structured editor to preserve them.
        if (props.length > 1) return;
        property = mediaProp[0];
    } else if (item?.type !== "string") return;
    const base64 = /base64/i.test(text) && !/https|url/i.test(text);
    return { slot: { id, label: title(id), kind, required, multiple: array, max_count: array ? schema.maxItems ?? 16 : 1, min_count: schema.minItems,
        accept: base64 ? "b64_only" : "url_only", description: schema.description }, array, property, base64 };
}

function capabilities(id: string, contract: MagnificContract): ImageModelCapability {
    const props = contract.schema.properties ?? {};
    const fields: CustomFieldCapability[] = [];
    const slots: MediaSlotCapability[] = [];
    for (const [key, schema] of Object.entries(props)) {
        if (key === "prompt") continue;
        const required = contract.schema.required?.includes(key) ?? false;
        const binding = magnificMediaBinding(key, schema, required);
        if (binding) { slots.push(binding.slot); continue; }
        const type = schema.enum && schema.type === "string" ? "select" : schema.type === "boolean" ? "checkbox"
            : schema.type === "number" || schema.type === "integer" ? "number" : schema.type === "string" ? "text" : "json";
        fields.push({ id: key, label: title(key), type, required, default: schema.default, schema,
            options: type === "select" ? schema.enum as string[] : undefined, minimum: schema.minimum, maximum: schema.maximum,
            minLength: schema.minLength, maxLength: schema.maxLength, step: schema.type === "integer" ? 1 : undefined, description: schema.description });
    }
    const modelName = contract.path.split("/").at(-1)!;
    return { id, label: contract.label, family: title(modelName), variant: "", group: "Magnific", provider: "magnific", provider_model_id: contract.path,
        ...(contract.mediaType === "video" ? { provider_mode: "video" as const } : {}),
        category: /upscal|enhanc|relight|expand|camera|remove-background|style-transfer/.test(contract.path) ? "Enhance" : /edit/.test(contract.path) ? "Edit" : "Generate",
        // This provider still publishes its own compatibility endpoint; Google retirement alone does not establish its status.
        prompt_required: contract.schema.required?.includes("prompt") ?? false, prompt_supported: !!props.prompt,
        prompt_max: props.prompt?.maxLength ?? 65536, duration: false, aspect_ratio: false, size: false, resolution_variant: false,
        negative_prompt: false, cfg_scale: false, style: false, shot_type: false, prompt_expansion: false, elements: false,
        custom_fields: fields, media_slots: slots, has_edit_variant: false };
}
export const MAGNIFIC_IMAGE_CAPABILITIES: Record<string, ImageModelCapability> = {};
export const MAGNIFIC_VIDEO_CAPABILITIES: Record<string, ModelCapabilities> = {};
for (const [id, contract] of Object.entries(MAGNIFIC_CONTRACTS)) {
    const caps = capabilities(id, contract);
    (contract.mediaType === "image" ? MAGNIFIC_IMAGE_CAPABILITIES : MAGNIFIC_VIDEO_CAPABILITIES)[id] = caps;
}
