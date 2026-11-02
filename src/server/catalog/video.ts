import "server-only";

/**
 * Video model capabilities — consumed by the frontend to render controls.
 */
import { MAGNIFIC_VIDEO_CAPABILITIES } from "@/server/catalog/magnific";
import type { ModelCapabilities } from "@/models/capabilities/types";
import { EXTERNAL_VIDEO_CAPABILITIES } from "@/server/catalog/external";
import { TOAPIS_VIDEO_CAPABILITIES } from "@/server/catalog/toapis";
import { GOOGLE_VIDEO_CAPABILITIES } from "@/server/catalog/google";
import { GATEWAY_VIDEO_CAPABILITIES } from "@/server/catalog/gateway";

export const VIDEO_CAPABILITIES: Record<string, ModelCapabilities> = {
    ...EXTERNAL_VIDEO_CAPABILITIES,
    ...MAGNIFIC_VIDEO_CAPABILITIES,
    ...GOOGLE_VIDEO_CAPABILITIES,
    ...GATEWAY_VIDEO_CAPABILITIES,
    ...TOAPIS_VIDEO_CAPABILITIES,
};

/** Ordered list of group IDs for display */
export const VIDEO_CAPABILITY_GROUPS = [
    "Magnific", "Google AI Studio", "Google Vertex AI", "Vercel AI Gateway", "ToAPIs",
];

/** Get all capabilities for models in a given group */
export function getVideoCapabilitiesByGroup(group: string): ModelCapabilities[] {
    return Object.values(VIDEO_CAPABILITIES).filter((c) => c.group === group && !c.deprecated);
}

/** Get unique families within a group */
export function getVideoFamilies(group: string): string[] {
    const families = new Set<string>();
    getVideoCapabilitiesByGroup(group).forEach((c) => families.add(c.family));
    return [...families];
}

/** Get all unique groups that exist in capabilities */
export function getVideoGroups(): string[] {
    const existing = new Set(Object.values(VIDEO_CAPABILITIES).map((c) => c.group));
    return VIDEO_CAPABILITY_GROUPS.filter((g) => existing.has(g)).concat(
        [...existing].filter((g) => !VIDEO_CAPABILITY_GROUPS.includes(g))
    );
}
