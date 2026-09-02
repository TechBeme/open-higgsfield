/**
 * Base adapter — abstract class that video/image adapters extend.
 */
import type { CanonicalParams, CanonicalMediaInputs } from "@/models/canonical";
import type { ModelCapabilities } from "@/models/capabilities/types";

export interface AdapterEndpoint {
    post_path: string;
    poll_path: string;
}

export interface AdapterResult {
    endpoint: AdapterEndpoint;
    payload: Record<string, unknown>;
}

export abstract class ModelAdapter {
    abstract readonly familyModels: string[];

    /** Resolve the correct API endpoint based on model, inputs, and variant */
    abstract resolveEndpoint(
        modelId: string,
        params: CanonicalParams,
        media: CanonicalMediaInputs,
    ): AdapterEndpoint;

    /** Build the vendor-specific payload */
    abstract buildPayload(
        modelId: string,
        params: CanonicalParams,
        media: CanonicalMediaInputs,
    ): Record<string, unknown>;

    /** Validate params against capabilities, returns list of errors */
    validate(
        modelId: string,
        params: CanonicalParams,
        caps: ModelCapabilities,
    ): string[] {
        const errors: string[] = [];

        if (caps.prompt_required && !params.prompt) {
            errors.push("ERR_PROMPT_REQUIRED");
        }

        if (params.negative_prompt && !caps.negative_prompt) {
            errors.push("ERR_UNSUPPORTED_PARAM: negative_prompt");
        }

        if (params.cfg_scale !== undefined && !caps.cfg_scale) {
            errors.push("ERR_UNSUPPORTED_PARAM: cfg_scale");
        }

        if (params.style && !caps.style) {
            errors.push("ERR_UNSUPPORTED_PARAM: style");
        }

        if (params.shot_type && !caps.shot_type) {
            errors.push("ERR_UNSUPPORTED_PARAM: shot_type");
        }

        if (params.expand_prompt && !caps.prompt_expansion) {
            errors.push("ERR_UNSUPPORTED_PARAM: expand_prompt");
        }

        return errors;
    }

    /** Convenience: resolve + build in one call */
    process(
        modelId: string,
        params: CanonicalParams,
        media: CanonicalMediaInputs,
    ): AdapterResult {
        return {
            endpoint: this.resolveEndpoint(modelId, params, media),
            payload: this.buildPayload(modelId, params, media),
        };
    }
}
