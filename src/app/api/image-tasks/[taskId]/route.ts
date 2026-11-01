import { NextRequest, NextResponse } from "next/server";
import { deleteTask, getPublicTask, resumeTask } from "@/lib/task-store";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { assertEmptyBody, requestFailure } from "@/lib/request-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ taskId: string }> };

export async function GET(_req: NextRequest, { params }: Context) {
    const denial = guardWorkspaceRequest(_req);
    if (denial) return denial;
    try {
        const task = await getPublicTask((await params).taskId);
        return task && task.media_type === "image"
            ? NextResponse.json(task, { headers: { "Cache-Control": "no-store" } })
            : NextResponse.json({ error: "ERR_TASK_NOT_FOUND" }, { status: 404 });
    } catch { return NextResponse.json({ error: "ERR_TASK_STORAGE_UNAVAILABLE" }, { status: 503 }); }
}

export async function DELETE(_req: NextRequest, { params }: Context) {
    const denial = guardWorkspaceRequest(_req);
    if (denial) return denial;
    try { await assertEmptyBody(_req); }
    catch (error) { return requestFailure(error); }
    try {
        const { taskId } = await params;
        const task = await getPublicTask(taskId);
        if (!task || task.media_type !== "image" || !await deleteTask(taskId)) {
            return NextResponse.json({ error: "ERR_TASK_NOT_FOUND" }, { status: 404 });
        }
        return NextResponse.json({ ok: true });
    } catch { return NextResponse.json({ error: "ERR_TASK_STORAGE_UNAVAILABLE" }, { status: 503 }); }
}

export async function POST(_req: NextRequest, { params }: Context) {
    const denial = guardWorkspaceRequest(_req);
    if (denial) return denial;
    try { await assertEmptyBody(_req); }
    catch (error) { return requestFailure(error); }
    try {
        const { taskId } = await params;
        const task = await getPublicTask(taskId);
        if (!task || task.media_type !== "image") return NextResponse.json({ error: "ERR_TASK_NOT_FOUND" }, { status: 404 });
        const result = await resumeTask(taskId);
        if (result === "missing") return NextResponse.json({ error: "ERR_TASK_NOT_FOUND" }, { status: 404 });
        if (result !== "resumed") return NextResponse.json({ error: "ERR_TASK_NOT_RESUMABLE" }, { status: 409 });
        return NextResponse.json({ task_id: taskId, accepted: true, recovery_required: false }, { status: 202 });
    } catch { return NextResponse.json({ error: "ERR_TASK_STORAGE_UNAVAILABLE" }, { status: 503 }); }
}
