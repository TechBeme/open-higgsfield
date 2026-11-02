import { NextResponse } from "next/server";
import { getAllRuntimeCapabilities } from "@/server/catalog/runtime";
import { deleteCustomModel, listDiscoveredModels, listModelOverrides, saveCustomModel, setBuiltInModelEnabled } from "@/server/config/provider-store";
import { applyWorkspaceHeaders, guardWorkspaceRequest } from "@/server/security/workspace-access";
import { CATALOG_BODY_MAX_BYTES, providerConfigFailure, readConfigObject } from "@/server/http/provider-config";

export const runtime = "nodejs";

async function snapshot() {
    const [images, videos, overrides, discovered] = await Promise.all([getAllRuntimeCapabilities("image"), getAllRuntimeCapabilities("video"), listModelOverrides(), listDiscoveredModels()]);
    return { images, videos, overrides, discovered };
}

export async function GET(request: Request) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    try { return applyWorkspaceHeaders(NextResponse.json(await snapshot())); }
    catch (error) { return providerConfigFailure(error, "ERR_PROVIDER_CONFIG_UNAVAILABLE", 503); }
}

export async function POST(request: Request) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    try {
        const body = await readConfigObject(request, CATALOG_BODY_MAX_BYTES);
        if (body.mediaType !== "image" && body.mediaType !== "video" || !body.capabilities || typeof body.capabilities !== "object") throw new Error("ERR_CUSTOM_MODEL_INVALID");
        const model = await saveCustomModel({ mediaType: body.mediaType, capabilities: body.capabilities as never, modelId: typeof body.modelId === "string" ? body.modelId : undefined, enabled: body.enabled === true });
        return applyWorkspaceHeaders(NextResponse.json({ model }, { status: 201 }));
    } catch (error) { return providerConfigFailure(error, "ERR_CUSTOM_MODEL_INVALID"); }
}

export async function PATCH(request: Request) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    try {
        const body = await readConfigObject(request);
        if ((body.mediaType !== "image" && body.mediaType !== "video") || typeof body.modelId !== "string" || typeof body.enabled !== "boolean") throw new Error("ERR_MODEL_PREFERENCE_INVALID");
        await setBuiltInModelEnabled(body.modelId, body.mediaType, body.enabled);
        return applyWorkspaceHeaders(NextResponse.json(await snapshot()));
    } catch (error) { return providerConfigFailure(error, "ERR_MODEL_PREFERENCE_INVALID"); }
}

export async function DELETE(request: Request) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    try {
        const body = await readConfigObject(request);
        if ((body.mediaType !== "image" && body.mediaType !== "video") || typeof body.modelId !== "string") throw new Error("ERR_CUSTOM_MODEL_INVALID");
        return applyWorkspaceHeaders(NextResponse.json({ deleted: await deleteCustomModel(body.modelId, body.mediaType) }));
    } catch (error) { return providerConfigFailure(error, "ERR_CUSTOM_MODEL_INVALID"); }
}
