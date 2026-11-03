import "server-only";

import { randomUUID } from "node:crypto";
import type { ProviderConnectionContext } from "@/providers/types";
import { readBoundedResponse } from "@/server/media/transfer";
import { createProviderTransport, invalidProviderResponse, providerHttpError, providerObject, ProviderRequestError } from "./request-error";
import { isRunwareAir } from "@/server/catalog/runware";

export const RUNWARE_ENDPOINT = "https://api.runware.ai/v1";
export const isRunwareTaskId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** A single REST attempt. Only the task worker retries observations; generation is never retried here. */
export async function runwarePost(task: Record<string, unknown>, connection: ProviderConnectionContext | undefined, phase: "submit" | "poll", signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (connection && connection.providerId !== "runware") throw new ProviderRequestError("ERR_PROVIDER_CONNECTION_PROVIDER_MISMATCH");
    const key = connection ? connection.secret : process.env.RUNWARE_API_KEY;
    if (!key?.trim()) throw new ProviderRequestError("ERR_PROVIDER_CONNECTION_NOT_CONFIGURED");
    const transport = createProviderTransport("RUNWARE", phase, signal);
    try {
        const response = await transport.fetch(RUNWARE_ENDPOINT, { method: "POST", cache: "no-store",
            headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify([task]) });
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            throw providerHttpError("RUNWARE", phase, response.status, response.headers.get("retry-after"));
        }
        const bytes = await readBoundedResponse(response, { signal: transport.signal, maxBytes: 4 * 1024 * 1024 });
        transport.assertActive();
        return providerObject(JSON.parse(bytes.toString("utf8")), "RUNWARE", phase);
    } catch (error) { throw transport.classify(error); }
}

export function runwareResponseRows(payload: Record<string, unknown>, key: "data" | "errors", phase: "submit" | "poll"): Record<string, unknown>[] {
    if (payload[key] === undefined) return [];
    if (!Array.isArray(payload[key]) || payload[key].length > 1000) throw invalidProviderResponse("RUNWARE", phase);
    return payload[key].map(row => providerObject(row, "RUNWARE", phase));
}

async function searchPage(connection: ProviderConnectionContext, offset: number, limit: number, signal: AbortSignal) {
    const taskUUID = randomUUID();
    const payload = await runwarePost({ taskType: "modelSearch", taskUUID, source: "official", category: "checkpoint", sort: "name", offset, limit }, connection, "poll", signal);
    if (payload.error || runwareResponseRows(payload, "errors", "poll").length) throw new ProviderRequestError("ERR_PROVIDER_DISCOVERY_FAILED");
    const rows = runwareResponseRows(payload, "data", "poll");
    if (rows.length !== 1 || rows[0].taskType !== "modelSearch" || rows[0].taskUUID !== taskUUID
        || !Array.isArray(rows[0].results) || rows[0].results.length > limit
        || !Number.isSafeInteger(rows[0].totalResults) || (rows[0].totalResults as number) < 0) throw new ProviderRequestError("ERR_PROVIDER_DISCOVERY_FAILED");
    return { results: rows[0].results as unknown[], total: rows[0].totalResults as number };
}

export async function testRunwareConnection(connection: ProviderConnectionContext, signal: AbortSignal): Promise<void> {
    await searchPage(connection, 0, 1, signal);
}

export async function discoverRunwareModels(connection: ProviderConnectionContext, signal: AbortSignal) {
    const found = new Map<string, { providerModelId: string; displayName: string; mediaType: "image" | "video" }>();
    const seen = new Set<string>();
    let truncated = false;
    for (let offset = 0; offset < 500; offset += 100) {
        signal.throwIfAborted();
        const { results, total } = await searchPage(connection, offset, 100, signal);
        if (!results.length && offset < total) throw new ProviderRequestError("ERR_PROVIDER_DISCOVERY_FAILED");
        let added = 0;
        for (const item of results) {
            if (!item || typeof item !== "object" || Array.isArray(item)) continue;
            const model = item as Record<string, unknown>;
            if (!isRunwareAir(model.air)) continue;
            if (!seen.has(model.air)) added++;
            seen.add(model.air);
            if (!Array.isArray(model.capabilities) || model.category !== "checkpoint") continue;
            const mediaType = model.capabilities.some(c => typeof c === "string" && /(?:^|:)\w+-to-video$/.test(c)) ? "video"
                : model.capabilities.some(c => typeof c === "string" && /(?:^|:)\w+-to-image$/.test(c)) ? "image" : undefined;
            if (mediaType) found.set(model.air, { providerModelId: model.air, displayName: typeof model.name === "string" ? model.name.slice(0, 300) : model.air, mediaType });
        }
        if (offset > 0 && results.length && !added) throw new ProviderRequestError("ERR_PROVIDER_DISCOVERY_FAILED");
        if (offset + results.length >= total) break;
        if (results.length < 100) throw new ProviderRequestError("ERR_PROVIDER_DISCOVERY_FAILED");
        if (offset === 400) truncated = true;
    }
    signal.throwIfAborted();
    return { models: [...found.values()], truncated };
}
