"use client";

import useSWR from "swr";
import { useMemo } from "react";
import type { ImageModelCapability } from "@/models/capabilities/types";
import type { ModelCapabilities } from "@/models/capabilities/types";

const fetcher = async (url: string) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("ERR_MODEL_CATALOG_UNAVAILABLE");
    return response.json() as Promise<{ models: ModelCapabilities[] | Record<string, ModelCapabilities>; model_list?: ModelCapabilities[]; groups: string[] }>;
};

const EMPTY_MODELS: ModelCapabilities[] = [];

export function useRuntimeModels(mediaType: "image" | "video") {
    const { data, error, isLoading, mutate } = useSWR(`/api/${mediaType === "image" ? "image-models" : "models"}`, fetcher, { revalidateOnMount: true });
    // Never expose the static catalog before the server has checked active connections.
    const models = useMemo(() => data ? Array.isArray(data.models) ? data.models : data.model_list ?? Object.values(data.models) : EMPTY_MODELS, [data]);
    const byId = useMemo(() => Object.fromEntries(models.map((model) => [model.id, model])) as Partial<Record<string, ModelCapabilities>>, [models]);
    // SWR keeps the fetch error in state; a retry button must not also reject globally.
    const refresh = () => mutate().catch(() => undefined);
    return { models, byId, groups: [...new Set(models.map((model) => model.group))], error, isLoading, refresh };
}

export function asImageModel(capability: ModelCapabilities): ImageModelCapability;
export function asImageModel(capability: ModelCapabilities | undefined): ImageModelCapability | undefined;
export function asImageModel(capability: ModelCapabilities | undefined): ImageModelCapability | undefined {
    return capability as ImageModelCapability | undefined;
}
