import { NextResponse } from "next/server";
import { IMAGE_CAPABILITIES_LIST, IMAGE_CAPABILITY_GROUPS } from "@/models/capabilities/image";
import { applyWorkspaceHeaders, guardWorkspaceRequest } from "@/lib/workspace-access";

export async function GET(request: Request) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    return applyWorkspaceHeaders(NextResponse.json({
        models: IMAGE_CAPABILITIES_LIST,
        groups: IMAGE_CAPABILITY_GROUPS,
    }));
}
