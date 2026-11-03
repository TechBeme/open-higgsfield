import type { AnyTask } from "@/types";

export interface GalleryReference { taskId: string; index: number | null }
export type GalleryAction = "delete" | "reorder";
export const GALLERY_DRAG_TYPE = "application/x-open-higgsfield-gallery";
export const galleryKey = (item: GalleryReference) => `${item.taskId}:${item.index ?? "task"}`;
export function galleryIndices(task: AnyTask): Array<number | null> {
    const count = Math.max(task.result_count ?? 0, task.result_urls?.length ?? 0, task.result_paths?.length ?? 0, task.media_type === "video" ? task.video_path ? 1 : task.video_urls?.length ?? 0 : 0);
    return count ? Array.from({ length: Math.min(16, count) }, (_, index) => index).filter(index => !task.gallery?.removed.includes(index)) : [null];
}
export function galleryRank(task: Pick<AnyTask, "created_at" | "gallery">, index: number | null): number {
    const saved = task.gallery?.order[String(index ?? "task")];
    return typeof saved === "number" && Number.isFinite(saved) ? saved : -Date.parse(task.created_at) + (index ?? 0) / 1000;
}
export function galleryTaskRank(task: AnyTask): number {
    return Math.min(...galleryIndices(task).map(index => galleryRank(task, index)));
}
export function moveGalleryItem<T extends GalleryReference>(items: T[], source: string, target: string): T[] {
    const from = items.findIndex(item => galleryKey(item) === source), to = items.findIndex(item => galleryKey(item) === target);
    if (from < 0 || to < 0 || from === to) return items;
    const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}

export function parseGalleryMutation(input: unknown): { action: GalleryAction; mediaType: "image" | "video"; items: GalleryReference[] } {
    const value = input as Record<string, unknown> | null;
    if (!value || !["delete", "reorder"].includes(String(value.action)) || !["image", "video"].includes(String(value.mediaType)) ||
        !Array.isArray(value.items) || !value.items.length || value.items.length > 1000) throw new Error("ERR_GALLERY_INVALID_REQUEST");
    const items = value.items.map(item => {
        if (!item || typeof item !== "object" || typeof item.taskId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(item.taskId) ||
            !(item.index === null || (Number.isInteger(item.index) && item.index >= 0 && item.index < 16))) throw new Error("ERR_GALLERY_INVALID_REQUEST");
        return { taskId: item.taskId as string, index: item.index as number | null };
    });
    if (new Set(items.map(galleryKey)).size !== items.length) throw new Error("ERR_GALLERY_INVALID_REQUEST");
    return { action: value.action as GalleryAction, mediaType: value.mediaType as "image" | "video", items };
}
