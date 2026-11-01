"use client";

import { revalidateHistory, useTaskHistory, videoHistoryKey } from "@/hooks/useTaskHistory";
import type { VideoTask } from "@/types";

export function useVideoTasks() {
  return useTaskHistory<VideoTask>(videoHistoryKey);
}

export function revalidateVideoTasks() {
  return revalidateHistory(videoHistoryKey);
}
