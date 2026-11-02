import { NextResponse } from "next/server";
import { getProviderConnection, markProviderConnectionHealth } from "@/server/config/provider-store";
import { applyWorkspaceHeaders, guardWorkspaceRequest } from "@/server/security/workspace-access";
import { providerConfigFailure } from "@/server/http/provider-config";
import { assertEmptyBody, RequestLimitError } from "@/server/http/request-limits";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    try {
        await assertEmptyBody(request);
        const { id } = await context.params;
        const connection = await getProviderConnection(id);
        signal.throwIfAborted();
        if (!connection?.secret) return applyWorkspaceHeaders(NextResponse.json({ status: "unconfigured", error: "ERR_PROVIDER_CONNECTION_NOT_CONFIGURED" }, { status: 400 }));
        if (connection.providerId === "vercel-ai-gateway" || connection.providerId === "google-ai-studio") {
            const gateway = connection.providerId === "vercel-ai-gateway";
            const headers: Record<string, string> = { Accept: "application/json", ...(gateway ? { Authorization: `Bearer ${connection.secret}` } : { "x-goog-api-key": connection.secret }) };
            const response = await fetch(gateway ? "https://ai-gateway.vercel.sh/v1/models" : "https://generativelanguage.googleapis.com/v1beta/models", { headers, signal, cache: "no-store" });
            // Health only needs the status; release the unused model-list stream.
            await response.body?.cancel().catch(() => undefined);
            signal.throwIfAborted();
            const status = response.ok ? "healthy" : "unhealthy";
            await markProviderConnectionHealth(id, status).catch(() => undefined);
            return applyWorkspaceHeaders(NextResponse.json({ status, status_code: response.status }, { status: response.ok ? 200 : 502 }));
        }
        return applyWorkspaceHeaders(NextResponse.json({ status: "configured", message: "No non-billable model-list health endpoint is defined for this provider." }));
    } catch (error) { return providerConfigFailure(signal.aborted ? new RequestLimitError("ERR_REQUEST_CANCELLED", 408) : error, "ERR_PROVIDER_HEALTH_FAILED", 502); }
}
