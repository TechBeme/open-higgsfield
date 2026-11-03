import { NextResponse } from "next/server";
import { getProviderConnection, resolveProviderConnection, saveDiscoveredModels } from "@/server/config/provider-store";
import { isProviderId } from "@/providers/definitions";
import type { ProviderId } from "@/providers/types";
import { applyWorkspaceHeaders, guardWorkspaceRequest } from "@/server/security/workspace-access";
import { providerConfigFailure, readConfigObject } from "@/server/http/provider-config";
import { RequestLimitError } from "@/server/http/request-limits";
import { readBoundedResponse } from "@/server/media/transfer";
import { discoverRunwareModels } from "@/server/providers/runware-client";

export const runtime = "nodejs";

function boundedId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9_.:/-]+$/.test(value);
}

async function discoveryPayload(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
    try {
        const bytes = await readBoundedResponse(response, { signal, maxBytes: 4 * 1024 * 1024 });
        const value = JSON.parse(bytes.toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        return value;
    } catch { throw new RequestLimitError("ERR_PROVIDER_DISCOVERY_FAILED", 502); }
}

export async function POST(request: Request) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    let signal: AbortSignal | undefined;
    try {
        const body = await readConfigObject(request);
        if (!isProviderId(body.providerId)) throw new Error("ERR_UNKNOWN_PROVIDER");
        const providerId = body.providerId as ProviderId;
        if (providerId !== "google-ai-studio" && providerId !== "vercel-ai-gateway" && providerId !== "runware") return applyWorkspaceHeaders(NextResponse.json({ providerId, status: "manual", models: [], message: "This provider exposes no safe generic model-list contract. Use the built-in catalog or add a reviewed capability contract." }));
        signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
        if (providerId === "runware") {
            const connection = typeof body.connectionId === "string" ? await getProviderConnection(body.connectionId) : await resolveProviderConnection(providerId);
            if (connection && connection.providerId !== providerId) throw new Error("ERR_PROVIDER_CONNECTION_PROVIDER_MISMATCH");
            if (!connection?.secret) throw new Error("ERR_PROVIDER_CONNECTION_NOT_CONFIGURED");
            const { models, truncated } = await discoverRunwareModels(connection, signal);
            signal.throwIfAborted();
            const discovered = await saveDiscoveredModels(providerId, models);
            return applyWorkspaceHeaders(NextResponse.json({ providerId, status: "unverified", models, discovered, truncated }));
        }
        if (providerId === "google-ai-studio") {
            const connection = typeof body.connectionId === "string" ? await getProviderConnection(body.connectionId)
                : await resolveProviderConnection(providerId);
            if (connection && connection.providerId !== providerId) throw new Error("ERR_PROVIDER_CONNECTION_PROVIDER_MISMATCH");
            if (!connection?.secret) throw new Error("ERR_PROVIDER_CONNECTION_NOT_CONFIGURED");
            const found = new Map<string, { id: string; display_name?: string; status: "unverified" }>();
            const seenTokens = new Set<string>();
            let pageToken: string | undefined;
            let truncated = false;
            for (let page = 0; page < 20; page++) {
                signal.throwIfAborted();
                const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
                url.searchParams.set("pageSize", "100");
                if (pageToken) url.searchParams.set("pageToken", pageToken);
                const response = await fetch(url.toString(), { headers: { Accept: "application/json", "x-goog-api-key": connection.secret }, signal, cache: "no-store" });
                if (!response.ok) {
                    await response.body?.cancel().catch(() => undefined);
                    signal.throwIfAborted();
                    return applyWorkspaceHeaders(NextResponse.json({ error: "ERR_PROVIDER_DISCOVERY_FAILED", status_code: response.status }, { status: 502 }));
                }
                const payload = await discoveryPayload(response, signal);
                if (!Array.isArray(payload.models)) throw new RequestLimitError("ERR_PROVIDER_DISCOVERY_FAILED", 502);
                for (const entry of payload.models) {
                    const value = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
                    const name = typeof value.name === "string" ? value.name.replace(/^models\//, "") : undefined;
                    if (!boundedId(name)) continue;
                    if (found.size === 500 && !found.has(name)) { truncated = true; break; }
                    found.set(name, { id: name, display_name: typeof value.displayName === "string" ? value.displayName.slice(0, 300) : undefined, status: "unverified" });
                }
                const next = payload.nextPageToken;
                if (next === undefined || next === "") break;
                if (typeof next !== "string" || next.length > 4096 || seenTokens.has(next)) throw new RequestLimitError("ERR_PROVIDER_DISCOVERY_FAILED", 502);
                seenTokens.add(next);
                if (found.size === 500) { truncated = true; break; }
                if (page === 19) throw new RequestLimitError("ERR_PROVIDER_DISCOVERY_FAILED", 502);
                pageToken = next;
            }
            signal.throwIfAborted();
            const models = [...found.values()];
            const discovered = await saveDiscoveredModels(providerId, models.map(model => ({ providerModelId: model.id, displayName: model.display_name })));
            return applyWorkspaceHeaders(NextResponse.json({ providerId, status: "unverified", models, discovered, truncated }));
        }
        // The Gateway model catalog is public; generation still requires a connection.
        const response = await fetch("https://ai-gateway.vercel.sh/v1/models", { headers: { Accept: "application/json" }, signal, cache: "no-store" });
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            signal.throwIfAborted();
            return applyWorkspaceHeaders(NextResponse.json({ error: "ERR_PROVIDER_DISCOVERY_FAILED", status_code: response.status }, { status: 502 }));
        }
        const payload = await discoveryPayload(response, signal);
        if (!Array.isArray(payload.data)) throw new RequestLimitError("ERR_PROVIDER_DISCOVERY_FAILED", 502);
        const raw = payload.data;
        const models = raw.slice(0, 500).map((entry) => {
            const value = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
            return boundedId(value.id) ? { id: value.id, owned_by: typeof value.owned_by === "string" ? value.owned_by.slice(0, 300) : undefined, status: "unverified" as const } : undefined;
        }).filter(Boolean);
        signal.throwIfAborted();
        const discovered = await saveDiscoveredModels(providerId, models.filter(Boolean).map((model) => ({ providerModelId: model!.id, displayName: model!.owned_by })));
        return applyWorkspaceHeaders(NextResponse.json({ providerId, status: "unverified", models, discovered }));
    } catch (error) { return providerConfigFailure(signal?.aborted ? new RequestLimitError("ERR_REQUEST_CANCELLED", 408) : error, "ERR_PROVIDER_DISCOVERY_FAILED"); }
}
