import { ModelAdapter } from "../base";
import type { AdapterEndpoint } from "../base";
import type { CanonicalParams, CanonicalMediaInputs } from "@/models/canonical";

const SEEDANCE_VARIANTS: Record<string, { post_path: string; poll_path: string }> = {
    "1080p": { post_path: "/v1/ai/video/seedance-1-5-pro-1080p", poll_path: "/v1/ai/video/seedance-1-5-pro-1080p/{task_id}" },
    "720p": { post_path: "/v1/ai/video/seedance-1-5-pro-720p", poll_path: "/v1/ai/video/seedance-1-5-pro-720p/{task_id}" },
    "480p": { post_path: "/v1/ai/video/seedance-1-5-pro-480p", poll_path: "/v1/ai/video/seedance-1-5-pro-480p/{task_id}" },
};

/** Seedance adapter — covers seedance-1-5-pro */
export class SeedanceAdapter extends ModelAdapter {
    readonly familyModels = ["seedance-1-5-pro"];

    resolveEndpoint(_modelId: string, params: CanonicalParams): AdapterEndpoint {
        const variant = SEEDANCE_VARIANTS[params.resolution ?? "1080p"] ?? SEEDANCE_VARIANTS["1080p"];
        return { post_path: variant.post_path, poll_path: variant.poll_path };
    }

    buildPayload(_modelId: string, params: CanonicalParams, media: CanonicalMediaInputs): Record<string, unknown> {
        const payload: Record<string, unknown> = {};

        if (params.prompt) payload.prompt = params.prompt;
        if (params.duration) payload.duration = parseInt(params.duration, 10);
        if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
        if (media.images?.image) payload.image = media.images.image;

        // Custom fields
        const fv = params.field_values ?? {};
        if (fv.generate_audio !== undefined) payload.generate_audio = fv.generate_audio;
        if (fv.camera_fixed !== undefined) payload.camera_fixed = fv.camera_fixed;

        return payload;
    }
}
