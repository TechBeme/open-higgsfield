import { NextResponse } from "next/server";
import { getImageTasks, initStore } from "@/lib/task-store";

export const runtime = "nodejs";

export async function GET() {
  await initStore();
  const tasks = getImageTasks();
  return NextResponse.json(tasks);
}
