import type { CanonicalMediaInputs, CanonicalParams } from "@/models/canonical";
import type { ModelCapabilities } from "@/models/capabilities/types";

export type ProviderId = "magnific" | "google-ai-studio" | "google-vertex" | "vercel-ai-gateway" | "toapis";
export type GenerationStatus = "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "ERROR" | "CANCELLED";

export interface GeneratedAsset {
    data?: Uint8Array;
    url?: string;
    mimeType?: string;
}

export interface ProviderGenerationRequest {
    clientTaskId?: string;
    signal?: AbortSignal;
    mediaType: "image" | "video";
    modelId: string;
    providerModelId: string;
    providerMode?: ModelCapabilities["provider_mode"];
    capabilities: ModelCapabilities;
    params: CanonicalParams;
    media: CanonicalMediaInputs;
    connection?: ProviderConnectionContext;
}

/** A provider connection is resolved server-side and is never sent to the browser. */
export interface ProviderConnectionContext {
    id: string;
    providerId: ProviderId;
    secret?: string;
    metadata: Record<string, unknown>;
}

export type ProviderSubmission = {
    status: "COMPLETED";
    assets: GeneratedAsset[];
    providerTaskId?: string;
} | {
    status: "CREATED" | "IN_PROGRESS";
    operation: unknown;
    providerTaskId?: string;
};

export interface ProviderPollRequest {
    signal?: AbortSignal;
    mediaType: "image" | "video";
    providerModelId: string;
    operation: unknown;
    connection?: ProviderConnectionContext;
}

export type ProviderPollResult = {
    status: "CREATED" | "IN_PROGRESS";
    operation?: unknown;
} | {
    status: "COMPLETED";
    assets: GeneratedAsset[];
    operation?: unknown;
} | {
    status: "FAILED" | "ERROR" | "CANCELLED";
    error: string;
    operation?: unknown;
};

export interface GenerationProvider {
    readonly id: ProviderId;
    submit(request: ProviderGenerationRequest): Promise<ProviderSubmission>;
    poll(request: ProviderPollRequest): Promise<ProviderPollResult>;
}
