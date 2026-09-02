"use client";

import useSWR, { mutate as globalMutate } from "swr";
import type { ImageTask } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useImageTasks() {
  const { data, error, isLoading, mutate } = useSWR<ImageTask[]>("/api/image-tasks", fetcher, {
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

export function revalidateImageTasks() {
  return globalMutate("/api/image-tasks");
}
