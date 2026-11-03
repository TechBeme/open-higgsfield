import "server-only";

import type { AnyTask } from "@/types";
import { galleryIndices, type GalleryAction, type GalleryReference } from "@/lib/gallery";
import type { TaskRecord } from "./record";

export interface GalleryPatch { id: string; revision: number; gallery: NonNullable<AnyTask["gallery"]>; remove: boolean }

/** Prepare narrow metadata patches; asset positions stay immutable so sibling URLs never shift. */
export function galleryPatches(rows: Map<string, TaskRecord>, action: GalleryAction, mediaType: "image" | "video", items: GalleryReference[], now: number): GalleryPatch[] {
    const patches = new Map<string, GalleryPatch>();
    for (const [position, item] of items.entries()) {
        const task = rows.get(item.taskId);
        if (!task || task.deleted_at) {
            if (action === "delete") continue; // Deletion is idempotent, including a repeated batch.
            throw new Error("ERR_GALLERY_CONFLICT");
        }
        if (task.media_type !== mediaType) throw new Error("ERR_GALLERY_INVALID_REQUEST");
        if (action === "reorder" && ["CREATED", "IN_PROGRESS"].includes(task.status ?? task.freepik_status ?? "CREATED")) throw new Error("ERR_GALLERY_CONFLICT");
        const indices = galleryIndices(task);
        if (!indices.includes(item.index) && !(action === "delete" && item.index !== null && task.gallery?.removed.includes(item.index))) throw new Error("ERR_GALLERY_CONFLICT");
        const patch = patches.get(item.taskId) ?? { id: item.taskId, revision: task.revision, gallery: structuredClone(task.gallery ?? { removed: [], order: {} }), remove: false };
        if (action === "delete") {
            if (item.index === null) patch.remove = true;
            else {
                patch.gallery.removed = [...new Set([...patch.gallery.removed, item.index])];
                delete patch.gallery.order[String(item.index)];
                if (indices.every(index => index !== null && patch.gallery.removed.includes(index))) patch.remove = true;
            }
        } else patch.gallery.order[String(item.index ?? "task")] = -now + position / 1000;
        patches.set(item.taskId, patch);
    }
    return [...patches.values()];
}
