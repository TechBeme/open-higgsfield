import { ModelAdapter } from "../base";
import type { AdapterEndpoint } from "../base";
import type { CanonicalParams, CanonicalMediaInputs } from "@/models/canonical";

const ENDPOINTS = {
    text: { post_path: "/v1/ai/text-to-video/wan-2-7", poll_path: "/v1/ai/text-to-video/wan-2-7/{task_id}" },
    image: { post_path: "/v1/ai/image-to-video/wan-2-7", poll_path: "/v1/ai/image-to-video/wan-2-7/{task_id}" },
};

/** WAN adapter — covers wan-v2-7 */
export class WanAdapter extends ModelAdapter {
    readonly familyModels = ["wan-v2-7"];

    resolveEndpoint(_modelId: string, _params: CanonicalParams, media: CanonicalMediaInputs): AdapterEndpoint {
        const hasImage = !!media.images && Object.keys(media.images).length > 0;
        const hasVideo = !!media.video;
        const backend = (hasImage || hasVideo) ? ENDPOINTS.image : ENDPOINTS.text;
        return { post_path: backend.post_path, poll_path: backend.poll_path };
    }

    buildPayload(_modelId: string, params: CanonicalParams, media: CanonicalMediaInputs): Record<string, unknown> {
        const payload: Record<string, unknown> = {};

        if (params.prompt) payload.prompt = params.prompt;
        if (params.negative_prompt) payload.negative_prompt = params.negative_prompt;
        if (params.duration) payload.duration = Number(params.duration);

        // Aspect ratio (T2V only — not used in I2V)
        if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;

        // Resolution: capabilities use lowercase "1080p"/"720p", API expects uppercase "1080P"/"720P"
        if (params.resolution) payload.resolution = params.resolution.toUpperCase();

        // Audio URL
        if (media.audio) payload.audio_url = media.audio;

        // Image-to-video inputs
        if (media.images?.start_image) payload.start_image_url = media.images.start_image;
        if (media.images?.end_image) payload.end_image_url = media.images.end_image;
        if (media.video) payload.video_url = media.video;

        // Prompt expansion → additional_settings.prompt_extend
        if (params.expand_prompt !== undefined) {
            payload.additional_settings = { prompt_extend: params.expand_prompt };
        }

        return payload;
    }
}
