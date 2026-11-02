import type { ProviderId } from "./types";
import type { ModelCapabilities } from "@/models/capabilities/types";

export interface ProviderConnectionRecord {
    id: string;
    providerId: ProviderId;
    label: string;
    enabled: boolean;
    priority: number;
    metadata: Record<string, unknown>;
    secretConfigured: boolean;
    lastHealth?: "unknown" | "healthy" | "unhealthy";
    lastHealthAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ModelOverride {
    modelId: string;
    mediaType: "image" | "video";
    enabled: boolean;
    source: "discovered" | "custom";
    status: "verified" | "unverified" | "disabled";
    capabilities: ModelCapabilities;
    createdAt: string;
    updatedAt: string;
}

export interface DiscoveredModelRecord {
    id: string;
    providerId: ProviderId;
    providerModelId: string;
    displayName?: string;
    mediaType: "image" | "video" | "unknown";
    status: "unverified" | "reviewed";
    discoveredAt: string;
}
