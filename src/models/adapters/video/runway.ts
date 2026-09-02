import { ModelAdapter } from "../base";
import type { AdapterEndpoint } from "../base";
import type { CanonicalParams, CanonicalMediaInputs } from "@/models/canonical";
import { setNested } from "@/lib/payload-utils";

/** RunWay adapter — covers gen-4-5 and act-two */
export class RunwayAdapter extends ModelAdapter {
    readonly familyModels = ["runway-gen-4-5", "runway-act-two"];

    resolveEndpoint(modelId: string, _params: CanonicalParams, media: CanonicalMediaInputs): AdapterEndpoint {
        if (modelId === "runway-gen-4-5") {
            const hasImage = !!media.images && Object.keys(media.images).length > 0;
            if (hasImage) {
                return {
                    post_path: "/v1/ai/image-to-video/runway-4-5",
                    poll_path: "/v1/ai/image-to-video/runway-4-5/{task_id}",
                };
            }
            return {
                post_path: "/v1/ai/text-to-video/runway-4-5",
                poll_path: "/v1/ai/text-to-video/runway-4-5/{task_id}",
            };
        }

        // act-two
        return {
            post_path: "/v1/ai/video/runway-act-two",
            poll_path: "/v1/ai/video/runway-act-two/{task_id}",
        };
    }

    buildPayload(modelId: string, params: CanonicalParams, media: CanonicalMediaInputs): Record<string, unknown> {
        const payload: Record<string, unknown> = {};

        if (modelId === "runway-gen-4-5") {
            if (params.prompt) payload.prompt = params.prompt;
            if (params.duration) payload.duration = parseInt(params.duration, 10);
            if (params.aspect_ratio) payload.ratio = params.aspect_ratio;
            if (media.images?.image) payload.image = media.images.image;
            return payload;
        }

        // act-two: no prompt, attachment-based
        if (params.aspect_ratio) payload.ratio = params.aspect_ratio;

        const fv = params.field_values ?? {};
        if (fv.body_control !== undefined) payload.body_control = fv.body_control;
        if (fv.expression_intensity !== undefined) payload.expression_intensity = Number(fv.expression_intensity);

        // Attachment roles for act-two
        if (media.images) {
            if (media.images.character_image) {
                setNested(payload, "character.uri", media.images.character_image);
                setNested(payload, "character.type", "image");
            }
            if (media.images.character_video) {
                setNested(payload, "character.uri", media.images.character_video);
                setNested(payload, "character.type", "video");
            }
            if (media.images.reference_video) {
                setNested(payload, "reference.uri", media.images.reference_video);
                setNested(payload, "reference.type", "video");
            }
        }

        return payload;
    }
}
