import { ModelAdapter } from "../base";
import type { AdapterEndpoint } from "../base";
import type { CanonicalParams, CanonicalMediaInputs } from "@/models/canonical";

/** LTX adapter — covers ltx-2-pro and ltx-2-fast */
export class LtxAdapter extends ModelAdapter {
    readonly familyModels = ["ltx-2-pro", "ltx-2-fast"];

    private static readonly BACKENDS: Record<string, {
        text: { post_path: string; poll_path: string };
        image: { post_path: string; poll_path: string };
    }> = {
            "ltx-2-pro": {
                text: { post_path: "/v1/ai/text-to-video/ltx-2-pro", poll_path: "/v1/ai/text-to-video/ltx-2-pro/{task_id}" },
                image: { post_path: "/v1/ai/image-to-video/ltx-2-pro", poll_path: "/v1/ai/image-to-video/ltx-2-pro/{task_id}" },
            },
            "ltx-2-fast": {
                text: { post_path: "/v1/ai/text-to-video/ltx-2-fast", poll_path: "/v1/ai/text-to-video/ltx-2-fast/{task_id}" },
                image: { post_path: "/v1/ai/image-to-video/ltx-2-fast", poll_path: "/v1/ai/image-to-video/ltx-2-fast/{task_id}" },
            },
        };

    resolveEndpoint(modelId: string, _params: CanonicalParams, media: CanonicalMediaInputs): AdapterEndpoint {
        const backends = LtxAdapter.BACKENDS[modelId];
        const hasImage = !!media.images && Object.keys(media.images).length > 0;
        const backend = hasImage ? backends.image : backends.text;
        return { post_path: backend.post_path, poll_path: backend.poll_path };
    }

    buildPayload(modelId: string, params: CanonicalParams, media: CanonicalMediaInputs): Record<string, unknown> {
        const payload: Record<string, unknown> = {};

        if (params.prompt) payload.prompt = params.prompt;
        if (params.duration) payload.duration = parseInt(params.duration, 10);
        if (media.images?.image) payload.image = media.images.image;

        // Resolution (from resolution_variant)
        payload.resolution = params.resolution ?? "1080p";

        // Custom fields
        const fv = params.field_values ?? {};
        if (fv.generate_audio !== undefined) payload.generate_audio = fv.generate_audio;
        if (fv.fps !== undefined) payload.fps = parseInt(String(fv.fps), 10);

        return payload;
    }
}
