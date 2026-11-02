"use client";

import { imageHistoryKey, revalidateHistory, useTaskHistory } from "@/features/tasks/hooks/useTaskHistory";
import type { ImageTask } from "@/types";

export function useImageTasks() {
  return useTaskHistory<ImageTask>(imageHistoryKey);
}

export function revalidateImageTasks() {
  return revalidateHistory(imageHistoryKey);
}
