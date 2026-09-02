"use client";

import useSWR, { mutate as globalMutate } from "swr";
import type { VideoTask } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useVideoTasks() {
  const { data, error, isLoading, mutate } = useSWR<VideoTask[]>("/api/tasks", fetcher, {
    refreshInterval: (data) => data?.some((t) => !t._done) ? 3000 : 0,
    revalidateOnFocus: false,
  });

  return {
    tasks: data ?? [],
    isLoading,
    error,
    mutate,
  };
}

export function revalidateVideoTasks() {
  return globalMutate("/api/tasks");
}
