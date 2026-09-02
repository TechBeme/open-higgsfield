import { NextRequest } from "next/server";
import { getTask } from "@/lib/task-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const task = getTask(taskId);

  if (!task) {
    return new Response(JSON.stringify({ error: "Task not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let sent = 0;
      let lastHeartbeat = Date.now();

      const tick = () => {
        const current = getTask(taskId);
        if (!current) {
          controller.close();
          return;
        }

        const events = current.events ?? [];
        while (sent < events.length) {
          const evt = events[sent];
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
          sent++;
          const done = ["completed", "failed", "timeout", "error"].includes(evt.type);
          if (done) {
            controller.close();
            return;
          }
        }

        if (current._done) {
          controller.close();
          return;
        }

        if (Date.now() - lastHeartbeat > 25_000) {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
          lastHeartbeat = Date.now();
        }

        setTimeout(tick, 500);
      };

      tick();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
