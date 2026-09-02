import { NextRequest, NextResponse } from "next/server";
import { getTask, deleteTask, initStore } from "@/lib/task-store";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  await initStore();
  if (!getTask(taskId)) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  await deleteTask(taskId);
  return NextResponse.json({ ok: true });
}
