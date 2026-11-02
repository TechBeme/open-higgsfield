import { NextResponse } from "next/server";
import { getProviderDefinition, PROVIDER_DEFINITIONS, isProviderId } from "@/providers/definitions";
import { connectionFromEnv, getConnectedProviderIds, listProviderConnections, saveProviderConnection } from "@/server/config/provider-store";
import { applyWorkspaceHeaders, guardWorkspaceRequest } from "@/server/security/workspace-access";
import { CONNECTION_BODY_MAX_BYTES, providerConfigFailure, readConfigObject } from "@/server/http/provider-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    try {
        const [connections, connectedIds] = await Promise.all([listProviderConnections(), getConnectedProviderIds()]);
        return applyWorkspaceHeaders(NextResponse.json({ providers: PROVIDER_DEFINITIONS, connections,
            connectedProviderIds: [...connectedIds],
            environmentProviderIds: PROVIDER_DEFINITIONS.filter(provider => connectionFromEnv(provider.id)).map(provider => provider.id),
        }));
    } catch (error) {
        return providerConfigFailure(error, "ERR_PROVIDER_CONFIG_UNAVAILABLE", 503);
    }
}

export async function POST(request: Request) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    try {
        const body = await readConfigObject(request, CONNECTION_BODY_MAX_BYTES);
        const providerId = body.providerId;
        if (!isProviderId(providerId)) throw new Error("ERR_UNKNOWN_PROVIDER");
        getProviderDefinition(providerId);
        const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata as Record<string, unknown> : {};
        const connection = await saveProviderConnection({
            id: typeof body.id === "string" ? body.id : undefined,
            providerId,
            label: typeof body.label === "string" ? body.label : "",
            secret: typeof body.secret === "string" ? body.secret : undefined,
            metadata,
            enabled: body.enabled === undefined ? true : body.enabled === true,
            priority: typeof body.priority === "number" ? body.priority : undefined,
        });
        return applyWorkspaceHeaders(NextResponse.json({ connection }, { status: 200 }));
    } catch (error) {
        return providerConfigFailure(error, "ERR_PROVIDER_CONNECTION_INVALID");
    }
}
