import "server-only";

import type { CanonicalMediaInputs } from "@/models/canonical";
import { fetchRemoteMedia, type TransferOptions } from "@/server/media/transfer";

export function getMediaUrls(media: CanonicalMediaInputs): string[] {
    if (media.slots && Object.keys(media.slots).length > 0) {
        return Object.values(media.slots).flatMap(values => values.filter(value => typeof value === "string" && value.length > 0));
    }
    const values = Object.values(media.images ?? {}) as unknown[];
    return values.flatMap((value) => Array.isArray(value) ? value : [value])
        .filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function getMediaSlot(media: CanonicalMediaInputs, id: string): string[] {
    if (media.slots?.[id]) return media.slots[id];
    const value = (media.images as Record<string, unknown> | undefined)?.[id];
    if (typeof value === "string" && value) return [value];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && !!item);
    if (id === "video" && media.video) return [media.video];
    if (id === "audio" && media.audio) return [media.audio];
    return [];
}

export function getImageUrl(media: CanonicalMediaInputs, ...keys: string[]): string | undefined {
    for (const key of keys) {
        if (media.slots?.[key]?.[0]) return media.slots[key][0];
        const value = (media.images as Record<string, unknown> | undefined)?.[key];
        if (typeof value === "string" && value) return value;
        if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
    return undefined;
}

export async function fetchMedia(url: string, options: TransferOptions = {}): Promise<{ data: Uint8Array; mimeType: string }> {
    return fetchRemoteMedia(url, options);
}

export function toSerializable(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value, (key, item) => {
        if (key === "sdkHttpResponse" || key.startsWith("_")) return undefined;
        return item;
    }));
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try { return JSON.stringify(error); } catch { return "ERR_PROVIDER"; }
}
