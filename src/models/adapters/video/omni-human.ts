import { ModelAdapter } from "../base";
import type { AdapterEndpoint } from "../base";
import type { CanonicalParams, CanonicalMediaInputs } from "@/models/canonical";

/** OmniHuman adapter — covers omni-human-1-5 */
export class OmniHumanAdapter extends ModelAdapter {
    readonly familyModels = ["omni-human-1-5"];

    resolveEndpoint(): AdapterEndpoint {
        return {
            post_path: "/v1/ai/video/omni-human-1-5",
            poll_path: "/v1/ai/video/omni-human-1-5/{task_id}",
        };
    }

    buildPayload(_modelId: string, params: CanonicalParams, media: CanonicalMediaInputs): Record<string, unknown> {
        const payload: Record<string, unknown> = {};

        if (params.prompt) payload.prompt = params.prompt;
        if (media.images?.image) payload.image_url = media.images.image;
        if (media.audio) payload.audio_url = media.audio;

        // Resolution (from resolution_variant)
        if (params.resolution) payload.resolution = params.resolution;

        // Custom fields
        const fv = params.field_values ?? {};
        if (fv.turbo_mode !== undefined) payload.turbo_mode = fv.turbo_mode;

        return payload;
    }
}
