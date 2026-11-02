import { NextResponse } from "next/server";
import { deleteProviderConnection, listProviderConnections, saveProviderConnection } from "@/server/config/provider-store";
import { applyWorkspaceHeaders, guardWorkspaceRequest } from "@/server/security/workspace-access";
import { CONNECTION_BODY_MAX_BYTES, providerConfigFailure, readConfigObject } from "@/server/http/provider-config";
import { assertEmptyBody } from "@/server/http/request-limits";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    try {
        const { id } = await context.params;
        const current = (await listProviderConnections()).find((entry) => entry.id === id);
        if (!current) return applyWorkspaceHeaders(NextResponse.json({ error: "ERR_PROVIDER_CONNECTION_NOT_FOUND" }, { status: 404 }));
        const body = await readConfigObject(request, CONNECTION_BODY_MAX_BYTES);
        const connection = await saveProviderConnection({
            id,
            providerId: current.providerId,
            label: typeof body.label === "string" ? body.label : undefined,
            secret: typeof body.secret === "string" ? body.secret : undefined,
            metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata as Record<string, unknown> : undefined,
            enabled: body.enabled === undefined ? undefined : body.enabled === true,
            priority: typeof body.priority === "number" ? body.priority : undefined,
        });
        return applyWorkspaceHeaders(NextResponse.json({ connection }));
    } catch (error) {
        return providerConfigFailure(error, "ERR_PROVIDER_CONNECTION_INVALID");
    }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    try {
        await assertEmptyBody(request);
        const { id } = await context.params;
        return applyWorkspaceHeaders(NextResponse.json({ deleted: await deleteProviderConnection(id) }));
    } catch (error) { return providerConfigFailure(error, "ERR_PROVIDER_CONFIG_UNAVAILABLE", 503); }
}
