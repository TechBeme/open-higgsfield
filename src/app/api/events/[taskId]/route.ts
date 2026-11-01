import { NextRequest } from "next/server";
import { getPublicTask } from "@/lib/task-store";
import { taskEvent } from "@/lib/task-record";
import { guardWorkspaceRequest } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
    const denial = guardWorkspaceRequest(req);
    if (denial) return denial;
    const { taskId } = await params;
    let first;
    try { first = await getPublicTask(taskId); }
    catch { return Response.json({ error: "ERR_TASK_STORAGE_UNAVAILABLE" }, { status: 503 }); }
    if (!first) return Response.json({ error: "ERR_TASK_NOT_FOUND" }, { status: 404 });
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop = () => {};
    let cancelStream = () => {};
    const stream = new ReadableStream({
        start(controller) {
            let closed = false;
            let revision: number | undefined;
            const deadline = Date.now() + 25_000;
            cancelStream = () => {
                if (closed) return;
                closed = true;
                if (timer) clearTimeout(timer);
                req.signal.removeEventListener("abort", stop);
            };
            stop = () => {
                if (closed) return;
                cancelStream();
                controller.close();
            };
            req.signal.addEventListener("abort", stop, { once: true });
            const tick = async () => {
                if (closed || req.signal.aborted) { stop(); return; }
                try {
                    const current = first ?? await getPublicTask(taskId);
                    first = undefined;
                    if (closed) return;
                    if (!current) { stop(); return; }
                    if (revision !== current.revision) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(taskEvent(current))}\n\n`));
                        revision = current.revision;
                    }
                    if (current._done || Date.now() >= deadline) { stop(); return; }
                    controller.enqueue(encoder.encode(": keepalive\n\n"));
                    timer = setTimeout(tick, 1_500);
                } catch { stop(); }
            };
            void tick();
        },
        cancel() { cancelStream(); },
    });
    return new Response(stream, { headers: {
        "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store",
        "X-Accel-Buffering": "no", Connection: "keep-alive",
    } });
}
