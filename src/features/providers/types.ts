import type { ModelCapabilities } from "@/models/capabilities/types";

export type MediaType = "image" | "video";
export type { ProviderDefinition } from "@/providers/definitions";
export interface CatalogResponse {
    images: ModelCapabilities[];
    videos: ModelCapabilities[];
    overrides: Array<{ modelId: string; mediaType: MediaType; enabled: boolean; status: string }>;
    discovered: Array<{ id: string; providerId: string; providerModelId: string; displayName?: string; status: string }>;
}
export interface CatalogModel { model: ModelCapabilities; mediaType: MediaType; }
