"use client";

import { useRef } from "react";
import useSWRInfinite, { unstable_serialize } from "swr/infinite";
import { mutate as globalMutate } from "swr";
import type { AnyTask } from "@/types";

export interface HistoryPage<T extends AnyTask = AnyTask> { tasks: T[]; nextCursor: string | null }

export function createHistoryKey(endpoint: string) {
    return (pageIndex: number, previous: HistoryPage | null) => {
        if (pageIndex > 0 && !previous?.nextCursor) return null;
        return `${endpoint}?limit=20${pageIndex > 0 ? `&cursor=${encodeURIComponent(previous!.nextCursor!)}` : ""}`;
    };
}

export const imageHistoryKey = createHistoryKey("/api/image-tasks");
export const videoHistoryKey = createHistoryKey("/api/tasks");

export async function fetchHistoryPage<T extends AnyTask>(url: string): Promise<HistoryPage<T>> {
    const response = await fetch(url);
    if (!response.ok) throw new Error("ERR_HISTORY_UNAVAILABLE");
    const value = await response.json();
    const page = Array.isArray(value) ? { tasks: value, nextCursor: null } : value;
    if (!page || !Array.isArray(page.tasks) || page.tasks.length > 50
        || !page.tasks.every((task: AnyTask) => task && typeof task.task_id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(task.task_id)
            && ["image", "video"].includes(task.media_type))
        || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(page.nextCursor)))
        || (page.nextCursor !== null && !page.tasks.length)) throw new Error("ERR_HISTORY_RESPONSE");
    return page;
}

export function mergeHistoryPages<T extends AnyTask>(pages?: HistoryPage<T>[]): T[] {
    const seen = new Set<string>();
    return (pages ?? []).flatMap((page) => page.tasks).filter((task) => {
        if (seen.has(task.task_id)) return false;
        seen.add(task.task_id);
        return true;
    });
}

export function isTaskActive(task: AnyTask): boolean {
    return !task._done && !["COMPLETED", "FAILED", "ERROR", "CANCELLED"].includes(task.status ?? task.freepik_status ?? "CREATED");
}

export function useTaskHistory<T extends AnyTask>(key: ReturnType<typeof createHistoryKey>) {
    const loadingMore = useRef(false);
    const { data, error, isLoading, isValidating, mutate, size, setSize } = useSWRInfinite<HistoryPage<T>>(key, fetchHistoryPage<T>, {
        refreshInterval: (pages) => mergeHistoryPages(pages).some(isTaskActive) ? 3_000 : 0,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        revalidateAll: true,
    });
    const hasMore = Boolean(data?.at(-1)?.nextCursor);
    const isLoadingMore = !error && (isLoading || size > (data?.length ?? 0));
    const loadMore = async () => {
        if (loadingMore.current || isLoadingMore || isValidating || !hasMore) return;
        loadingMore.current = true;
        try { await setSize((current) => current + 1); }
        catch { /* SWR exposes the failure through error; keep loaded pages visible. */ }
        finally { loadingMore.current = false; }
    };
    return { tasks: mergeHistoryPages(data), error, isLoading, mutate, loadMore, hasMore, isLoadingMore };
}

export function revalidateHistory(key: ReturnType<typeof createHistoryKey>) {
    return globalMutate(unstable_serialize(key)).catch(() => undefined);
}
