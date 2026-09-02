import { ModelAdapter } from "../base";
import type { AdapterEndpoint } from "../base";
import type { CanonicalParams, CanonicalMediaInputs } from "@/models/canonical";

/** PixVerse adapter — covers pixverse-v5 and pixverse-v5-transition */
export class PixverseAdapter extends ModelAdapter {
    readonly familyModels = ["pixverse-v5", "pixverse-v5-transition"];

    resolveEndpoint(modelId: string): AdapterEndpoint {
        if (modelId === "pixverse-v5-transition") {
            return {
                post_path: "/v1/ai/image-to-video/pixverse-v5-transition",
                poll_path: "/v1/ai/image-to-video/pixverse-v5-transition/{task_id}",
            };
        }
        return {
            post_path: "/v1/ai/image-to-video/pixverse-v5",
            poll_path: "/v1/ai/image-to-video/pixverse-v5/{task_id}",
        };
    }

    buildPayload(modelId: string, params: CanonicalParams, media: CanonicalMediaInputs): Record<string, unknown> {
        const payload: Record<string, unknown> = {};

        if (params.prompt) payload.prompt = params.prompt;
        if (params.duration) payload.duration = parseInt(params.duration, 10);
        if (params.negative_prompt) payload.negative_prompt = params.negative_prompt;
        if (params.style && params.style !== "none") payload.style = params.style;

        if (modelId === "pixverse-v5") {
            if (media.images?.image) payload.image_url = media.images.image;
            // Resolution as extra field
            if (params.resolution) payload.resolution = params.resolution;
        } else {
            // Transition: start + end images
            if (media.images?.start_image) payload.first_image_url = media.images.start_image;
            if (media.images?.end_image) payload.last_image_url = media.images.end_image;
            // Resolution for transition
            if (params.resolution) payload.resolution = params.resolution;
            if (params.negative_prompt) payload.negative_prompt = params.negative_prompt;
        }

        return payload;
    }
}
