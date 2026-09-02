import { NextResponse } from "next/server";
import { getVideoTasks, initStore } from "@/lib/task-store";

export const runtime = "nodejs";

export async function GET() {
  await initStore();
  const tasks = getVideoTasks();
  return NextResponse.json(tasks);
}
