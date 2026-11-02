import type { ModelCapabilities } from "@/models/capabilities/types";
import { getDurations, getAspectRatios, getSizes } from "@/models/capabilities/video-helpers";

export interface SettingsValues {
    duration: string;
    aspectRatio: string;
    size: string;
    cfgScale: number;
    negativePrompt: string;
    shotType: string;
    style: string;
    expandPrompt: boolean;
    seed: string;
    fieldValues: Record<string, unknown>;
}

export function defaultSettings(model: ModelCapabilities | undefined, variantId?: string): SettingsValues {
    const resolvedVariantId = variantId || (model?.resolution_variant ? model.resolution_variant.options?.[0] : undefined);
    const durations = model ? getDurations(model, resolvedVariantId) : [];
    const ratios = model ? getAspectRatios(model, resolvedVariantId) ?? [] : [];
    const sizes = model ? getSizes(model, resolvedVariantId) ?? [] : [];
    const fieldValues: Record<string, unknown> = {};

    model?.custom_fields?.forEach((field) => {
        if (field.default !== undefined) fieldValues[field.id] = field.default;
    });

    return {
        duration: (model?.duration ? model.duration.default : undefined) ?? durations[0] ?? "",
        aspectRatio: (model?.aspect_ratio ? model.aspect_ratio.default?.[1] : undefined) ?? ratios[0]?.[1] ?? "",
        size: sizes[0]?.[1] ?? "",
        cfgScale: 0.5,
        negativePrompt: "",
        shotType: "single",
        style: "none",
        expandPrompt: false,
        seed: "-1",
        fieldValues,
    };
}
