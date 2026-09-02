import { ModelAdapter } from "../base";
import type { AdapterEndpoint } from "../base";
import type { CanonicalParams } from "@/models/canonical";
import { coerceFieldValue } from "@/lib/payload-utils";
import { IMAGE_CAPABILITIES } from "@/models/capabilities/image";

/**
 * Z-Image adapter — single model with straightforward field mapping.
 */
export class ZImageAdapter extends ModelAdapter {
    readonly familyModels = ["v1__ai__text_to_image__z_image"];

    resolveEndpoint(): AdapterEndpoint {
        return {
            post_path: "/v1/ai/text-to-image/z-image",
            poll_path: "/v1/ai/text-to-image/z-image/{task_id}",
        };
    }

    buildPayload(modelId: string, params: CanonicalParams): Record<string, unknown> {
        const payload: Record<string, unknown> = {};
        const caps = IMAGE_CAPABILITIES[modelId];

        if (params.prompt) payload.prompt = params.prompt;

        // All custom fields map directly
        if (params.field_values) {
            for (const field of caps.custom_fields) {
                const val = params.field_values[field.id];
                if (val === undefined || val === "" || val === null) continue;
                payload[field.id] = coerceFieldValue(val, field.type);
            }
        }

        return payload;
    }
}
