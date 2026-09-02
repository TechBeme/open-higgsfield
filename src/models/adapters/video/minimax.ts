import { ModelAdapter } from "../base";
import type { AdapterEndpoint } from "../base";
import type { CanonicalParams, CanonicalMediaInputs } from "@/models/canonical";

const MINIMAX_VARIANTS: Record<string, { post_path: string; poll_path: string }> = {
    "1080p": { post_path: "/v1/ai/image-to-video/minimax-hailuo-2-3-1080p", poll_path: "/v1/ai/image-to-video/minimax-hailuo-2-3-1080p/{task_id}" },
    "768p": { post_path: "/v1/ai/image-to-video/minimax-hailuo-2-3-768p", poll_path: "/v1/ai/image-to-video/minimax-hailuo-2-3-768p/{task_id}" },
};

/** MiniMax adapter — covers minimax-hailuo-2-3 */
export class MinimaxAdapter extends ModelAdapter {
    readonly familyModels = ["minimax-hailuo-2-3"];

    resolveEndpoint(_modelId: string, params: CanonicalParams): AdapterEndpoint {
        const variant = MINIMAX_VARIANTS[params.resolution ?? "1080p"] ?? MINIMAX_VARIANTS["1080p"];
        return { post_path: variant.post_path, poll_path: variant.poll_path };
    }

    buildPayload(_modelId: string, params: CanonicalParams, media: CanonicalMediaInputs): Record<string, unknown> {
        const payload: Record<string, unknown> = {};

        if (params.prompt) payload.prompt = params.prompt;
        if (params.duration) payload.duration = parseInt(params.duration, 10);
        if (media.images?.image) payload.first_frame_image = media.images.image;
        if (media.images?.end_image) payload.last_frame_image = media.images.end_image;

        // Custom fields
        const fv = params.field_values ?? {};
        payload.prompt_optimizer = fv.prompt_optimizer !== undefined ? fv.prompt_optimizer : true;

        return payload;
    }
}
