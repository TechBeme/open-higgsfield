import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/task-store";
import { downloadUrl } from "@/lib/upload";

export async function POST(req: NextRequest) {
    const body = await req.json() as { task_id?: string; image_index?: number };
    const { task_id, image_index } = body;

    if (!task_id) {
        return NextResponse.json({ error: "ERR_MISSING_TASK_ID" }, { status: 400 });
    }

    const task = getTask(task_id);
    if (!task || task.media_type !== "image") {
        return NextResponse.json({ error: "ERR_TASK_NOT_FOUND" }, { status: 404 });
    }

    const urls = task.result_urls ?? [];
    const idx = image_index ?? 0;
    if (idx < 0 || idx >= urls.length) {
        return NextResponse.json({ error: "ERR_INVALID_INDEX" }, { status: 400 });
    }

    const savedPath = await downloadUrl(urls[idx], task_id, idx);
    return NextResponse.json({ path: savedPath });
}
