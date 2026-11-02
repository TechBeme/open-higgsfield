import { NextRequest } from "next/server";
import { assetErrorResponse, uploadedAssetResponse } from "@/server/media/asset-source";
import { guardWorkspaceRequest } from "@/server/security/workspace-access";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
    const denial = guardWorkspaceRequest(req);
    if (denial) return denial;
    try { return await uploadedAssetResponse((await params).filename, req); }
    catch (error) { return assetErrorResponse(error); }
}
