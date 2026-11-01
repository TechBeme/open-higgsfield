import { NextRequest, NextResponse } from "next/server";
import { listTasks } from "@/lib/task-store";
import { safeErrorCode } from "@/lib/task-runtime";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const denial = guardWorkspaceRequest(req);
    if (denial) return denial;
    const params = req.nextUrl.searchParams;
    try {
        const page = await listTasks("image", {
            limit: params.has("limit") ? Number(params.get("limit")) : undefined,
            cursor: params.get("cursor") ?? undefined,
        });
        return NextResponse.json(params.has("limit") || params.has("cursor") ? page : page.tasks,
            { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        const invalid = safeErrorCode(error) === "ERR_INVALID_PAGINATION";
        return NextResponse.json({ error: invalid ? "ERR_INVALID_PAGINATION" : "ERR_TASK_STORAGE_UNAVAILABLE" }, { status: invalid ? 400 : 503 });
    }
}
