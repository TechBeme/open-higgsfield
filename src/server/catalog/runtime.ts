import "server-only";

import { IMAGE_CAPABILITIES } from "@/server/catalog/image";
import type { ImageModelCapability } from "@/models/capabilities/types";
import { VIDEO_CAPABILITIES } from "@/server/catalog/video";
import type { ModelCapabilities } from "@/models/capabilities/types";
import { getConnectedProviderIds, listModelOverrides } from "@/server/config/provider-store";

export type RuntimeMediaType = "image" | "video";

function builtIns(mediaType: RuntimeMediaType): Record<string, ModelCapabilities> {
    return mediaType === "image" ? IMAGE_CAPABILITIES : VIDEO_CAPABILITIES;
}

export async function getRuntimeCapabilities(mediaType: RuntimeMediaType): Promise<Record<string, ModelCapabilities>> {
    const result: Record<string, ModelCapabilities> = Object.fromEntries(Object.entries(builtIns(mediaType)).map(([id, capability]) => [id, {
        ...capability,
        catalog_source: "builtin",
        catalog_status: capability.deprecated ? "disabled" : "verified",
    }]));
    const overrides = await listModelOverrides();
    for (const override of overrides.filter((entry) => entry.mediaType === mediaType)) {
        if (override.source === "custom") {
            if (override.enabled) result[override.modelId] = { ...override.capabilities, catalog_source: "custom", catalog_status: override.status };
            else delete result[override.modelId];
            continue;
        }
        if (Object.hasOwn(result, override.modelId) && !override.enabled) delete result[override.modelId];
    }
    return result;
}

export async function getRuntimeCapability(mediaType: RuntimeMediaType, modelId: string): Promise<ModelCapabilities | undefined> {
    const capabilities = await getRuntimeCapabilities(mediaType);
    return Object.hasOwn(capabilities, modelId) ? capabilities[modelId] : undefined;
}

export async function getRuntimeCapabilityList(mediaType: RuntimeMediaType): Promise<ModelCapabilities[]> {
    const [capabilities, connected] = await Promise.all([getRuntimeCapabilities(mediaType), getConnectedProviderIds()]);
    return Object.values(capabilities).filter((capability) => connected.has(capability.provider) && !capability.deprecated && capability.catalog_status !== "disabled");
}

export async function getAllRuntimeCapabilities(mediaType: RuntimeMediaType): Promise<ModelCapabilities[]> {
    const result: Record<string, ModelCapabilities> = Object.fromEntries(Object.entries(builtIns(mediaType)).map(([id, capability]) => [id, {
        ...capability,
        catalog_source: "builtin",
        catalog_status: capability.deprecated ? "disabled" : "verified",
    }]));
    for (const override of await listModelOverrides()) {
        if (override.mediaType !== mediaType) continue;
        if (override.source === "custom") result[override.modelId] = { ...override.capabilities, catalog_source: "custom", catalog_status: override.enabled ? override.status : "disabled" };
        else if (Object.hasOwn(result, override.modelId)) result[override.modelId] = { ...result[override.modelId], catalog_status: override.enabled ? "verified" : "disabled" };
    }
    return Object.values(result).filter((capability) => !capability.deprecated);
}

export function getBuiltInCapability(mediaType: RuntimeMediaType, modelId: string): ModelCapabilities | undefined {
    return Object.hasOwn(builtIns(mediaType), modelId) ? builtIns(mediaType)[modelId] : undefined;
}

export function isBuiltInCapability(mediaType: RuntimeMediaType, modelId: string): boolean {
    return Object.hasOwn(builtIns(mediaType), modelId);
}

export function asImageCapability(capability: ModelCapabilities): ImageModelCapability {
    return capability as ImageModelCapability;
}
