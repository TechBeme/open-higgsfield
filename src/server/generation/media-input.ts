import "server-only";

import type { ModelCapabilities } from "@/models/capabilities/types";
import type { CanonicalMediaInputs } from "@/models/canonical";
import { inputFile } from "@/server/generation/input";
import { processFileUpload, processImageUpload, resolveUrl } from "@/server/media/input-upload";

export interface PreparedSlot { id: string; kind: "image" | "video" | "audio"; values: Array<File | string> }

/** Check all counts and byte limits before uploading any file. */
export function readModelMedia(form: FormData, model: ModelCapabilities, mode: "image" | "video"): PreparedSlot[] {
    const slots = [...model.media_slots];
    if (mode === "image" && "has_edit_variant" in model && model.has_edit_variant && !slots.some(s => s.id === "reference_images")) {
        slots.push({ id: "reference_images", label: "Reference images", kind: "image", multiple: true, max_count: 14 });
    }
    return slots.map(slot => {
        const files = form.getAll(`${mode === "image" ? "slot" : "file"}_${slot.id}`).filter((v): v is File => v instanceof File && v.size > 0);
        const urls = form.getAll(`url_${slot.id}`).filter((v): v is string => typeof v === "string" && !!v.trim()).map(v => v.trim());
        const values = [...files, ...urls];
        if (values.length < (slot.min_count ?? (slot.required ? 1 : 0)) || values.length > (slot.max_count ?? (slot.multiple ? 256 : 1))) throw new Error("ERR_INVALID_REFERENCE_COUNT");
        if (slot.max_bytes && files.some(f => f.size > slot.max_bytes!)) throw new Error("ERR_MEDIA_TOO_LARGE");
        for (const file of files) if (file.type && !file.type.startsWith(`${slot.kind}/`)) throw new Error("ERR_UNSUPPORTED_MEDIA_TYPE");
        return { id: slot.id, kind: slot.kind, values };
    });
}

export async function uploadModelMedia(slots: PreparedSlot[], signal: AbortSignal): Promise<{ media: CanonicalMediaInputs; localUrls: Record<string, string[]> }> {
    const media: CanonicalMediaInputs = { slots: {}, images: {} };
    const localUrls: Record<string, string[]> = {};
    for (const slot of slots) {
        const remote: string[] = [];
        const local: string[] = [];
        for (const value of slot.values) {
            signal.throwIfAborted();
            const mime = slot.kind === "image" ? "image/jpeg" : slot.kind === "video" ? "video/mp4" : "audio/mpeg";
            // Preserve PNG alpha/masks and vendor-supported image formats.
            const result = typeof value === "string" ? await resolveUrl(value, { signal })
                : slot.kind === "image"
                    ? await processImageUpload(await inputFile(value, mime, signal), { signal })
                    : await processFileUpload(await inputFile(value, mime, signal), value.name, value.type || mime, { signal });
            remote.push(result.remoteUrl); local.push(result.localUrl);
        }
        if (!remote.length) continue;
        media.slots![slot.id] = remote; localUrls[slot.id] = local;
        if (slot.kind === "image") media.images![slot.id] = remote[0];
        else if (slot.kind === "video") media.video ??= remote[0];
        else media.audio ??= remote[0];
    }
    return { media, localUrls };
}
