import { accessFailure } from "@/lib/workspace-access";

export const GENERATION_BODY_MAX_BYTES = 4 * 1024 * 1024;
const BODY_TIMEOUT_MS = 30_000;

export class RequestLimitError extends Error {
    constructor(public readonly code: string, public readonly status: number) { super(code); }
}

export function requestFailure(error: unknown): Response {
    if (error instanceof RequestLimitError) return accessFailure(error.code, error.status);
    const code = error instanceof Error && /^ERR_[A-Z0-9_]+$/.test(error.message) ? error.message : "ERR_REQUEST_INVALID";
    return accessFailure(code, code === "ERR_REQUEST_INVALID" ? 400 : 503);
}

async function readBody(request: Request, maxBytes: number, parent?: AbortSignal): Promise<Uint8Array> {
    const declared = request.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
        throw new RequestLimitError("ERR_INVALID_CONTENT_LENGTH", 400);
    }
    if (declared !== null && Number(declared) > maxBytes) {
        void request.body?.cancel().catch(() => {});
        throw new RequestLimitError("ERR_REQUEST_TOO_LARGE", 413);
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(BODY_TIMEOUT_MS), ...(parent ? [parent] : [])]);
    if (signal.aborted) {
        void request.body?.cancel().catch(() => {});
        throw new RequestLimitError("ERR_REQUEST_CANCELLED", 408);
    }
    if (!request.body) return new Uint8Array();
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    try {
        while (true) {
            if (signal.aborted) throw new RequestLimitError("ERR_REQUEST_CANCELLED", 408);
            const { value, done } = await reader.read();
            if (signal.aborted) throw new RequestLimitError("ERR_REQUEST_CANCELLED", 408);
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) throw new RequestLimitError("ERR_REQUEST_TOO_LARGE", 413);
            chunks.push(value);
        }
        if (declared !== null && Number(declared) !== size) throw new RequestLimitError("ERR_INVALID_CONTENT_LENGTH", 400);
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return bytes;
    } catch (error) {
        void reader.cancel().catch(() => {});
        if (error instanceof RequestLimitError) throw error;
        throw new RequestLimitError("ERR_REQUEST_INVALID", 400);
    } finally {
        signal.removeEventListener("abort", abort);
        reader.releaseLock();
    }
}

export async function readGenerationForm(request: Request, options: { signal?: AbortSignal } = {}): Promise<FormData> {
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data\s*;/i.test(contentType) || !/\bboundary=(?:"[^"]{1,200}"|[^;\s]{1,200})(?:\s*;|$)/i.test(contentType)) {
        throw new RequestLimitError("ERR_CONTENT_TYPE", 415);
    }
    const bytes = await readBody(request, GENERATION_BODY_MAX_BYTES, options.signal);
    let form: FormData;
    try { form = await new Response(bytes as BodyInit, { headers: { "Content-Type": contentType } }).formData(); }
    catch { throw new RequestLimitError("ERR_INVALID_FORM_DATA", 400); }
    let parts = 0;
    let files = 0;
    for (const [key, value] of form) {
        if (++parts > 128 || !/^[a-zA-Z0-9_]{1,128}$/.test(key)) throw new RequestLimitError("ERR_FORM_LIMIT", 400);
        if (typeof value === "string") {
            if (new TextEncoder().encode(value).byteLength > 65_536) throw new RequestLimitError("ERR_FORM_LIMIT", 413);
        } else if (++files > 16) throw new RequestLimitError("ERR_FORM_LIMIT", 413);
    }
    return form;
}

export async function readBoundedJson(request: Request, maxBytes = 16_384): Promise<unknown> {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
        throw new RequestLimitError("ERR_CONTENT_TYPE", 415);
    }
    const bytes = await readBody(request, maxBytes);
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new RequestLimitError("ERR_INVALID_JSON", 400); }
}

export async function assertEmptyBody(request: Request): Promise<void> {
    try { await readBody(request, 0); }
    catch (error) {
        if (error instanceof RequestLimitError && error.status === 413) throw new RequestLimitError("ERR_UNEXPECTED_BODY", 400);
        throw error;
    }
}
