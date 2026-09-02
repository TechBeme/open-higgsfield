import { ModelAdapter } from "../base";
import type { AdapterEndpoint } from "../base";
import type { CanonicalParams, CanonicalMediaInputs } from "@/models/canonical";
import { coerceFieldValue } from "@/lib/payload-utils";
import { IMAGE_CAPABILITIES, type ImageModelCapability } from "@/models/capabilities/image";

/**
 * Seedream adapter — covers Seedream V5 Lite and Seedream 4.5.
 *
 * Both have an edit_variant: when reference_images are provided in media,
 * switch to the edit endpoint.
 */
export class SeedreamAdapter extends ModelAdapter {
    readonly familyModels = [
        "v1__ai__text_to_image__seedream_v5_lite",
        "v1__ai__text_to_image__seedream_v4_5",
    ];

    private static readonly ENDPOINTS: Record<string, { post: string; poll: string }> = {
        "v1__ai__text_to_image__seedream_v5_lite": { post: "/v1/ai/text-to-image/seedream-v5-lite", poll: "/v1/ai/text-to-image/seedream-v5-lite/{task_id}" },
        "v1__ai__text_to_image__seedream_v4_5": { post: "/v1/ai/text-to-image/seedream-v4-5", poll: "/v1/ai/text-to-image/seedream-v4-5/{task_id}" },
    };

    private static readonly EDIT_ENDPOINTS: Record<string, { post: string; poll: string }> = {
        "v1__ai__text_to_image__seedream_v5_lite": { post: "/v1/ai/text-to-image/seedream-v5-lite-edit", poll: "/v1/ai/text-to-image/seedream-v5-lite-edit/{task_id}" },
        "v1__ai__text_to_image__seedream_v4_5": { post: "/v1/ai/text-to-image/seedream-v4-5-edit", poll: "/v1/ai/text-to-image/seedream-v4-5-edit/{task_id}" },
    };

    private isEditMode(media: CanonicalMediaInputs): boolean {
        // Edit mode when reference_images slot has data
        return !!media.images && !!media.images["reference_images"];
    }

    resolveEndpoint(modelId: string, _params: CanonicalParams, media: CanonicalMediaInputs): AdapterEndpoint {
        if (this.isEditMode(media)) {
            const ep = SeedreamAdapter.EDIT_ENDPOINTS[modelId];
            return { post_path: ep.post, poll_path: ep.poll };
        }
        const ep = SeedreamAdapter.ENDPOINTS[modelId];
        return { post_path: ep.post, poll_path: ep.poll };
    }

    buildPayload(modelId: string, params: CanonicalParams, media: CanonicalMediaInputs): Record<string, unknown> {
        const payload: Record<string, unknown> = {};
        const caps = IMAGE_CAPABILITIES[modelId] as ImageModelCapability;

        if (params.prompt) payload.prompt = params.prompt;

        // Custom fields (skip aspect_ratio — handled below)
        if (params.field_values) {
            for (const field of caps.custom_fields) {
                if (field.id === "aspect_ratio") continue;
                const val = params.field_values[field.id];
                if (val === undefined || val === "" || val === null) continue;
                payload[field.id] = coerceFieldValue(val, field.type);
            }
        }

        // Field-based aspect_ratio — map "16:9" → "widescreen_16_9"
        if (params.aspect_ratio && params.aspect_ratio !== "custom") {
            const arField = caps.custom_fields.find((f) => f.id === "aspect_ratio" && f.type === "select");
            if (arField?.options) {
                const matched = arField.options.find((opt) => {
                    const m = String(opt).match(/_(\d+)_(\d+)$/);
                    return m ? `${m[1]}:${m[2]}` === params.aspect_ratio : opt === params.aspect_ratio;
                });
                if (matched) payload.aspect_ratio = matched;
            }
        }

        // Reference images (for edit mode) — API requires an array
        if (media.images) {
            if (media.images["reference_images"]) {
                const val = media.images["reference_images"];
                payload.reference_images = Array.isArray(val) ? val : [val];
            }
        }

        return payload;
    }
}
