import { NextRequest } from "next/server";
import { getTask, initStore } from "@/lib/task-store";
import { assertAssetId } from "@/lib/upload";
import { assetErrorResponse, assetIndex, taskAssetCount, taskAssetSource, PRIVATE_MEDIA_HEADERS } from "@/lib/asset-source";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { readBoundedJson, requestFailure } from "@/lib/request-limits";

export async function POST(req: NextRequest) {
    const denial = guardWorkspaceRequest(req);
    if (denial) return denial;
    let body: unknown;
    try { body = await readBoundedJson(req, 16_384); }
    catch (error) { return requestFailure(error); }
    try {
        if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "ERR_INVALID_REQUEST" }, { status: 400, headers: PRIVATE_MEDIA_HEADERS });
        const { task_id, image_index } = body as { task_id?: string; image_index?: number };
        assertAssetId(task_id);
        if (image_index !== undefined && typeof image_index !== "number") return Response.json({ error: "ERR_INVALID_INDEX" }, { status: 400, headers: PRIVATE_MEDIA_HEADERS });
        await initStore();
        const task = await getTask(task_id);
        if (!task || task.media_type !== "image") return Response.json({ error: "ERR_TASK_NOT_FOUND" }, { status: 404, headers: PRIVATE_MEDIA_HEADERS });
        const index = assetIndex(image_index, taskAssetCount(task));
        const source = await taskAssetSource(task, index, { signal: req.signal });
        if ("handle" in source) await source.handle.close();
        return Response.json({ saved: true, url: `/api/download/${task_id}?index=${index}` }, { headers: PRIVATE_MEDIA_HEADERS });
    } catch (error) { return assetErrorResponse(error); }
}
