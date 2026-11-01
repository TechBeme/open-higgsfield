"use client";

import { imageHistoryKey, revalidateHistory, useTaskHistory } from "@/hooks/useTaskHistory";
import type { ImageTask } from "@/types";

export function useImageTasks() {
  return useTaskHistory<ImageTask>(imageHistoryKey);
}

export function revalidateImageTasks() {
  return revalidateHistory(imageHistoryKey);
}
