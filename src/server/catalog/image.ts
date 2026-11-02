import "server-only";

/**
 * Image model capabilities — consumed by the frontend to render controls.
 * Migrated from image_models.json to TypeScript.
 */
import { MAGNIFIC_IMAGE_CAPABILITIES } from "@/server/catalog/magnific";
import type { ImageModelCapability } from "@/models/capabilities/types";
import { EXTERNAL_IMAGE_CAPABILITIES } from "@/server/catalog/external";
import { TOAPIS_IMAGE_CAPABILITIES } from "@/server/catalog/toapis";
import { GOOGLE_IMAGE_CAPABILITIES } from "@/server/catalog/google";
import { GATEWAY_IMAGE_CAPABILITIES } from "@/server/catalog/gateway";

export const IMAGE_CAPABILITIES: Record<string, ImageModelCapability> = {
    ...EXTERNAL_IMAGE_CAPABILITIES,
    ...MAGNIFIC_IMAGE_CAPABILITIES,
    ...GOOGLE_IMAGE_CAPABILITIES,
    ...GATEWAY_IMAGE_CAPABILITIES,
    ...TOAPIS_IMAGE_CAPABILITIES,
};

export const IMAGE_CAPABILITIES_LIST = Object.values(IMAGE_CAPABILITIES).filter(c => !c.deprecated)
    .sort((a, b) => (b.sort_key ?? 0) - (a.sort_key ?? 0));

export const IMAGE_CAPABILITY_GROUPS = [...new Set(IMAGE_CAPABILITIES_LIST.map((c) => c.group))];

export function getImageCapabilitiesByGroup(group: string): ImageModelCapability[] {
    return IMAGE_CAPABILITIES_LIST.filter((c) => c.group === group);
}
