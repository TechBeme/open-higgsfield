import { ModelAdapter } from "../base";
import type { AdapterEndpoint } from "../base";
import type { CanonicalParams, CanonicalMediaInputs } from "@/models/canonical";
import { setNested } from "@/lib/payload-utils";

/** Kling adapter — covers v3-pro, v3-std, v3-omni-pro, v3-omni-std, v3-motion-control-pro, v3-motion-control-std */
export class KlingAdapter extends ModelAdapter {
    readonly familyModels = [
        "kling-v3-pro", "kling-v3-std",
        "kling-v3-omni-pro", "kling-v3-omni-std",
        "kling-v3-motion-control-pro", "kling-v3-motion-control-std",
    ];

    private static readonly ENDPOINTS: Record<string, { post: string; poll: string }> = {
        "kling-v3-pro": { post: "/v1/ai/video/kling-v3-pro", poll: "/v1/ai/video/kling-v3/{task_id}" },
        "kling-v3-std": { post: "/v1/ai/video/kling-v3-std", poll: "/v1/ai/video/kling-v3/{task_id}" },
        "kling-v3-omni-pro": { post: "/v1/ai/video/kling-v3-omni-pro", poll: "/v1/ai/video/kling-v3-omni/{task_id}" },
        "kling-v3-omni-std": { post: "/v1/ai/video/kling-v3-omni-std", poll: "/v1/ai/video/kling-v3-omni/{task_id}" },
        "kling-v3-motion-control-pro": { post: "/v1/ai/video/kling-v3-motion-control-pro", poll: "/v1/ai/video/kling-v3-motion-control-pro/{task_id}" },
        "kling-v3-motion-control-std": { post: "/v1/ai/video/kling-v3-motion-control-std", poll: "/v1/ai/video/kling-v3-motion-control-std/{task_id}" },
    };

    private static readonly V2V_ENDPOINTS: Record<string, { post: string; poll: string }> = {
        "kling-v3-omni-pro": { post: "/v1/ai/reference-to-video/kling-v3-omni-pro", poll: "/v1/ai/reference-to-video/kling-v3-omni/{task_id}" },
        "kling-v3-omni-std": { post: "/v1/ai/reference-to-video/kling-v3-omni-std", poll: "/v1/ai/reference-to-video/kling-v3-omni/{task_id}" },
    };

    private isOmni(modelId: string): boolean {
        return modelId.includes("omni");
    }

    private isMotionControl(modelId: string): boolean {
        return modelId.includes("motion-control");
    }

    resolveEndpoint(modelId: string, _params: CanonicalParams, media: CanonicalMediaInputs): AdapterEndpoint {
        // V2V mode for omni models when video is provided
        if (this.isOmni(modelId) && media.video) {
            const v2v = KlingAdapter.V2V_ENDPOINTS[modelId];
            if (v2v) return { post_path: v2v.post, poll_path: v2v.poll };
        }

        const ep = KlingAdapter.ENDPOINTS[modelId];
        return { post_path: ep.post, poll_path: ep.poll };
    }

    buildPayload(modelId: string, params: CanonicalParams, media: CanonicalMediaInputs): Record<string, unknown> {
        const payload: Record<string, unknown> = {};

        if (params.prompt) payload.prompt = params.prompt;

        const isV2V = this.isOmni(modelId) && !!media.video;

        // Duration (string type for Kling)
        if (params.duration) payload.duration = params.duration;

        // Aspect ratio
        if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;

        // Image inputs
        if (media.images) {
            if (this.isMotionControl(modelId)) {
                if (media.images.image) payload.image_url = media.images.image;
            } else if (this.isOmni(modelId)) {
                if (media.images.start_image) payload.image_url = media.images.start_image;
                if (!isV2V && media.images.end_image) payload.end_image_url = media.images.end_image;
            } else {
                // Standard v3 pro/std — image_roles
                if (media.images.start_image) payload.start_image_url = media.images.start_image;
                if (media.images.end_image) payload.end_image_url = media.images.end_image;
            }
        }

        // Video input
        if (media.video) {
            payload.video_url = media.video;
        }

        // Negative prompt
        if (params.negative_prompt) payload.negative_prompt = params.negative_prompt;

        // CFG scale
        if (params.cfg_scale !== undefined) payload.cfg_scale = params.cfg_scale;

        // Elements
        if (media.elements?.length) payload.elements = media.elements;

        // Custom fields
        const fv = params.field_values ?? {};
        if (this.isMotionControl(modelId)) {
            if (fv.character_orientation !== undefined) payload.character_orientation = fv.character_orientation;
        } else {
            if (fv.generate_audio !== undefined) payload.generate_audio = fv.generate_audio;
            if (fv.multi_shot !== undefined) payload.multi_shot = fv.multi_shot;
            if (fv.shot_type !== undefined) setNested(payload, "shot_type", fv.shot_type);
        }

        return payload;
    }
}
