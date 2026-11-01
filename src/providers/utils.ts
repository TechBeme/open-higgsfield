import type { CanonicalMediaInputs } from "@/models/canonical";
import { fetchRemoteMedia, type TransferOptions } from "@/lib/media-transfer";

export function getMediaUrls(media: CanonicalMediaInputs): string[] {
    const values = Object.values(media.images ?? {}) as unknown[];
    return values.flatMap((value) => Array.isArray(value) ? value : [value])
        .filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function getImageUrl(media: CanonicalMediaInputs, ...keys: string[]): string | undefined {
    for (const key of keys) {
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
