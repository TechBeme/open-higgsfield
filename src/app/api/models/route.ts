import { NextResponse } from "next/server";
import { getRuntimeCapabilityList } from "@/server/catalog/runtime";
import { applyWorkspaceHeaders, guardWorkspaceRequest } from "@/server/security/workspace-access";

export async function GET(request: Request) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    const models = await getRuntimeCapabilityList("video");
    return applyWorkspaceHeaders(NextResponse.json({
        models: Object.fromEntries(models.map((model) => [model.id, model])),
        model_list: models,
        groups: [...new Set(models.map((model) => model.group))],
    }));
}
