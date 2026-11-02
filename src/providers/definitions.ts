import type { ProviderId } from "./types";

export type ProviderSecretKind = "api-key" | "google-service-account";

export interface ProviderDefinition {
    id: ProviderId;
    label: string;
    description: string;
    secretKind: ProviderSecretKind;
    mediaTypes: Array<"image" | "video">;
    supportsMultipleConnections: boolean;
    discovery: "built-in" | "provider-api" | "manual";
    envKeys: string[];
    docsUrl: string;
}

export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
    {
        id: "google-ai-studio",
        docsUrl: "https://ai.google.dev/gemini-api/docs",
        label: "Google AI Studio",
        description: "Gemini and Veo through the Gemini API.",
        secretKind: "api-key",
        mediaTypes: ["image", "video"],
        supportsMultipleConnections: true,
        discovery: "provider-api",
        envKeys: ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY"],
    },
    {
        id: "google-vertex",
        docsUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs",
        label: "Google Vertex AI",
        description: "Gemini and Veo through Vertex AI.",
        secretKind: "google-service-account",
        mediaTypes: ["image", "video"],
        supportsMultipleConnections: true,
        discovery: "provider-api",
        envKeys: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_CLOUD_CREDENTIALS"],
    },
    {
        id: "vercel-ai-gateway",
        docsUrl: "https://vercel.com/docs/ai-gateway",
        label: "Vercel AI Gateway",
        description: "A unified gateway for image and video providers.",
        secretKind: "api-key",
        mediaTypes: ["image", "video"],
        supportsMultipleConnections: true,
        discovery: "provider-api",
        envKeys: ["AI_GATEWAY_API_KEY"],
    },
    {
        id: "toapis",
        docsUrl: "https://docs.toapis.com/",
        label: "ToAPIs",
        description: "Documented image, video and Midjourney operations.",
        secretKind: "api-key",
        mediaTypes: ["image", "video"],
        supportsMultipleConnections: true,
        discovery: "manual",
        envKeys: ["TOAPIS_API_KEY"],
    },
    {
        id: "magnific",
        docsUrl: "https://docs.magnific.com/",
        label: "Magnific",
        description: "Magnific image and video APIs.",
        secretKind: "api-key",
        mediaTypes: ["image", "video"],
        supportsMultipleConnections: true,
        discovery: "built-in",
        envKeys: ["MAGNIFIC_API_KEY"],
    },

];

export function getProviderDefinition(id: ProviderId): ProviderDefinition {
    const definition = PROVIDER_DEFINITIONS.find((entry) => entry.id === id);
    if (!definition) throw new Error(`ERR_UNKNOWN_PROVIDER: ${id}`);
    return definition;
}

export function isProviderId(value: unknown): value is ProviderId {
    return typeof value === "string" && PROVIDER_DEFINITIONS.some((entry) => entry.id === value);
}
