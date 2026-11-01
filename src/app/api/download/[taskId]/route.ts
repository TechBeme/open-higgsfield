import { NextRequest } from "next/server";
import { getTask, initStore } from "@/lib/task-store";
import { assertAssetId } from "@/lib/upload";
import { assetErrorResponse, assetIndex, taskAssetCount, taskAssetResponse, PRIVATE_MEDIA_HEADERS } from "@/lib/asset-source";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
    const denial = guardWorkspaceRequest(req);
    if (denial) return denial;
    try {
        const { taskId } = await params;
        assertAssetId(taskId);
        await initStore();
        const task = await getTask(taskId);
        if (!task) return Response.json({ error: "ERR_TASK_NOT_FOUND" }, { status: 404, headers: PRIVATE_MEDIA_HEADERS });
        const count = taskAssetCount(task);
        if (!count) return Response.json({ error: "ERR_ASSET_NOT_FOUND" }, { status: 404, headers: PRIVATE_MEDIA_HEADERS });
        const rawIndex = req.nextUrl.searchParams.get("index");
        if (task.media_type === "image" && rawIndex === null && count > 1) {
            return Response.json({ urls: Array.from({ length: count }, (_, index) => `/api/download/${taskId}?index=${index}`) }, { headers: PRIVATE_MEDIA_HEADERS });
        }
        const index = assetIndex(rawIndex, count);
        const attachment = task.media_type === "image" ? rawIndex === null || req.nextUrl.searchParams.get("download") === "1" : req.nextUrl.searchParams.get("inline") !== "1";
        return await taskAssetResponse(task, index, req, attachment);
    } catch (error) { return assetErrorResponse(error); }
}
