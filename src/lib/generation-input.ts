import { assertInputFileSize } from "@/lib/media-transfer";
import { safeErrorCode, withSignal } from "@/lib/task-runtime";

export function objectValue(value: unknown, code: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
    return value as Record<string, unknown>;
}

export function objectField(form: FormData, key: string, code: string): Record<string, unknown> {
    const raw = form.get(key);
    if (raw === null) return {};
    if (typeof raw !== "string") throw new Error(code);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error(code); }
    return objectValue(value, code);
}

function countField(form: FormData, key: string, maximum: number, code: string): number {
    const raw = form.get(key) ?? "0";
    if (typeof raw !== "string" || !/^(0|[1-9][0-9]*)$/.test(raw) || raw.length > 2 || Number(raw) > maximum) throw new Error(code);
    return Number(raw);
}

export function elementCounts(form: FormData, enabled: boolean): number[] {
    const count = countField(form, "elem_count", enabled ? 6 : 0, "ERR_INVALID_ELEMENT_COUNT");
    // Application limit: six elements, each with one frontal and up to three references.
    return Array.from({ length: count }, (_, i) => countField(form, `elem_${i}_ref_count`, 3, "ERR_INVALID_REFERENCE_COUNT"));
}

export async function inputFile(file: File, mimeType: string, signal: AbortSignal): Promise<Buffer> {
    assertInputFileSize(file.size, mimeType);
    return Buffer.from(await withSignal(signal, () => file.arrayBuffer()));
}

export function preprocessingFailure(error: unknown, signal: AbortSignal): Response {
    const code = safeErrorCode(error, "ERR_MEDIA_PREPROCESSING_FAILED");
    const name = (error as { name?: string })?.name;
    const cancelled = signal.aborted || name === "AbortError" || name === "TimeoutError" ||
        code === "ERR_MEDIA_CANCELLED" || code === "ERR_REQUEST_CANCELLED";
    const oversized = code === "ERR_MEDIA_TOO_LARGE" || code === "ERR_IMAGE_PIXEL_LIMIT";
    return Response.json({ error: cancelled ? "ERR_REQUEST_CANCELLED" : code, accepted: false, recovery_required: false },
        { status: cancelled ? 408 : oversized ? 413 : 400 });
}
