import { NextResponse } from "next/server";
import { VIDEO_CAPABILITIES, VIDEO_CAPABILITY_GROUPS } from "@/models/capabilities/video";
import { applyWorkspaceHeaders, guardWorkspaceRequest } from "@/lib/workspace-access";

export async function GET(request: Request) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    return applyWorkspaceHeaders(NextResponse.json({
        models: VIDEO_CAPABILITIES,
        groups: VIDEO_CAPABILITY_GROUPS,
    }));
}
