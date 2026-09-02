import { ModelAdapter } from "../base";
import type { AdapterEndpoint } from "../base";
import type { CanonicalParams, CanonicalMediaInputs } from "@/models/canonical";
import { setNested, coerceFieldValue } from "@/lib/payload-utils";
import { IMAGE_CAPABILITIES, type ImageModelCapability } from "@/models/capabilities/image";

/**
 * Flux adapter — covers Flux 2 Pro, Flux 2 Turbo, Flux 2 Klein, Flux Kontext Pro.
 *
 * Pro  & Turbo use size_ui (pixel calculation from aspect+resolution).
 * Klein & Kontext Pro use field-based aspect_ratio.
 */
export class FluxAdapter extends ModelAdapter {
    readonly familyModels = [
        "v1__ai__text_to_image__flux_2_pro",
        "v1__ai__text_to_image__flux_2_turbo",
        "v1__ai__text_to_image__flux_2_klein",
        "v1__ai__text_to_image__flux_kontext_pro",
    ];

    private static readonly ENDPOINTS: Record<string, { post: string; poll: string }> = {
        "v1__ai__text_to_image__flux_2_pro": { post: "/v1/ai/text-to-image/flux-2-pro", poll: "/v1/ai/text-to-image/flux-2-pro/{task_id}" },
        "v1__ai__text_to_image__flux_2_turbo": { post: "/v1/ai/text-to-image/flux-2-turbo", poll: "/v1/ai/text-to-image/flux-2-turbo/{task_id}" },
        "v1__ai__text_to_image__flux_2_klein": { post: "/v1/ai/text-to-image/flux-2-klein", poll: "/v1/ai/text-to-image/flux-2-klein/{task_id}" },
        "v1__ai__text_to_image__flux_kontext_pro": { post: "/v1/ai/text-to-image/flux-kontext-pro", poll: "/v1/ai/text-to-image/flux-kontext-pro/{task_id}" },
    };

    resolveEndpoint(modelId: string): AdapterEndpoint {
        const ep = FluxAdapter.ENDPOINTS[modelId];
        return { post_path: ep.post, poll_path: ep.poll };
    }

    buildPayload(modelId: string, params: CanonicalParams, media: CanonicalMediaInputs): Record<string, unknown> {
        const payload: Record<string, unknown> = {};
        const caps = IMAGE_CAPABILITIES[modelId] as ImageModelCapability;

        // Prompt
        if (params.prompt) payload.prompt = params.prompt;

        // Custom fields (skip aspect_ratio and resolution — handled below)
        if (params.field_values) {
            for (const field of caps.custom_fields) {
                if (field.id === "aspect_ratio" || field.id === "resolution") continue;
                const val = params.field_values[field.id];
                if (val === undefined || val === "" || val === null) continue;
                const coerced = coerceFieldValue(val, field.type);
                setNested(payload, field.id, coerced);
            }
        }

        // Size UI models: calculate pixel dimensions
        if (caps.size_ui) {
            const sizeAspect = params.aspect_ratio ?? caps.size_ui.default_aspect;
            const sizeResolution = params.resolution ?? caps.size_ui.default_resolution;

            if (sizeAspect !== "custom") {
                const ar = caps.size_ui.aspect_ratios.find((a) => a.id === sizeAspect) ?? caps.size_ui.aspect_ratios[0];
                const res = caps.size_ui.resolutions.find((r) => r.id === sizeResolution) ?? caps.size_ui.resolutions[0];
                if (ar && res) {
                    const w = Math.round((res.base * ar.w) / Math.max(ar.w, ar.h));
                    const h = Math.round((res.base * ar.h) / Math.max(ar.w, ar.h));
                    // Turbo uses "image_size.width", Pro uses "width"
                    setNested(payload, caps.size_ui.width_field.replace(/__/g, "."), w);
                    setNested(payload, caps.size_ui.height_field.replace(/__/g, "."), h);
                }
            }
        }

        // Field-based aspect_ratio (Klein, Kontext Pro)
        if (!caps.size_ui && params.aspect_ratio && params.aspect_ratio !== "custom") {
            const arField = caps.custom_fields.find((f) => f.id === "aspect_ratio" && f.type === "select");
            if (arField?.options) {
                const matched = arField.options.find((opt) => {
                    const m = String(opt).match(/_(\d+)_(\d+)$/);
                    return m ? `${m[1]}:${m[2]}` === params.aspect_ratio : opt === params.aspect_ratio;
                });
                if (matched) payload.aspect_ratio = matched;
            }
        }

        // Field-based resolution (Klein)
        if (!caps.size_ui && params.resolution) {
            const resField = caps.custom_fields.find((f) => f.id === "resolution" && f.type === "select");
            if (resField?.options?.includes(params.resolution)) {
                payload.resolution = params.resolution;
            }
        }

        // Image slots
        if (media.images) {
            for (const [slotId, url] of Object.entries(media.images)) {
                payload[slotId] = url;
            }
        }

        return payload;
    }
}
