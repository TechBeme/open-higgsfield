import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { resolveSafeRemoteUrl } from "@/lib/safe-url";

export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 64 * 1024 * 1024;
export const SERVERLESS_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
export const TRANSFER_TIMEOUT_MS = 60_000;
export const IMAGE_MAX_PIXELS = 40_000_000;

export type TransferOptions = { signal?: AbortSignal };
export type BoundedOptions = TransferOptions & { maxBytes: number };

export function transferSignal(parent?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(TRANSFER_TIMEOUT_MS);
    const signal = parent ? AbortSignal.any([parent, timeout]) : timeout;
    signal.throwIfAborted();
    return signal;
}

export function mediaByteLimit(mimeType?: string): number {
    return mimeType?.toLowerCase().startsWith("video/") ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
}

export function assertInputFileSize(bytes: number, mimeType?: string): void {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error("ERR_EMPTY_MEDIA");
    if (bytes > mediaByteLimit(mimeType)) throw new Error("ERR_MEDIA_TOO_LARGE");
}

export function boundResponseBody(response: Response, options: BoundedOptions): Response {
    let signal: AbortSignal;
    try { signal = transferSignal(options.signal); }
    catch (error) { void response.body?.cancel(error).catch(() => undefined); throw error; }
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) throw new Error("ERR_INVALID_MEDIA_LIMIT");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > options.maxBytes)) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error("ERR_MEDIA_TOO_LARGE");
    }
    if (!response.body) return response;
    const reader = response.body.getReader();
    let bytes = 0;
    let stopped = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const release = () => {
        signal.removeEventListener("abort", abort);
        try { reader.releaseLock(); } catch { /* Pending reads release in finally. */ }
    };
    const stop = async (reason?: unknown) => {
        if (stopped) return;
        stopped = true;
        signal.removeEventListener("abort", abort);
        try { await reader.cancel(reason); } catch { /* Preserve the transfer error. */ }
        release();
    };
    const abort = () => {
        if (stopped) return;
        controller.error(signal.reason ?? new Error("ERR_MEDIA_CANCELLED"));
        void stop(signal.reason);
    };
    const body = new ReadableStream<Uint8Array>({
        start(value) {
            controller = value;
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) abort();
        },
        async pull(value) {
            try {
                const chunk = await reader.read();
                if (stopped) return;
                if (chunk.done) {
                    stopped = true;
                    release();
                    value.close();
                    return;
                }
                bytes += chunk.value.byteLength;
                if (bytes > options.maxBytes) throw new Error("ERR_MEDIA_TOO_LARGE");
                value.enqueue(chunk.value);
            } catch (error) {
                if (!stopped) { value.error(error); await stop(error); }
            } finally { if (stopped) release(); }
        },
        cancel(reason) { return stop(reason); },
    }, { highWaterMark: 0 });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export async function readBoundedResponse(response: Response, options: BoundedOptions): Promise<Buffer> {
    const bounded = boundResponseBody(response, options);
    const reader = bounded.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    const chunks: Buffer[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks, size);
    } finally { reader.releaseLock(); }
}

export async function fetchRemoteMedia(value: string, options: TransferOptions & { maxBytes?: number } = {}): Promise<{ data: Buffer; mimeType: string }> {
    const signal = transferSignal(options.signal);
    const destination = await resolveSafeRemoteUrl(value, { signal });
    const response = await new Promise<Response>((resolve, reject) => {
        const transport = destination.url.protocol === "https:" ? https : http;
        const request = transport.get(destination.url, {
            signal,
            agent: false,
            headers: { "Accept-Encoding": "identity" },
            // Pin the checked DNS answer, retaining Host, SNI and TLS verification.
            lookup: (_host, lookupOptions, callback) => {
                if (typeof lookupOptions === "object" && lookupOptions.all) {
                    callback(null, [{ address: destination.address, family: destination.family }]);
                } else callback(null, destination.address, destination.family);
            },
        }, (incoming) => {
            const fail = (code: string) => {
                incoming.destroy();
                reject(new Error(code));
            };
            try {
                const status = incoming.statusCode ?? 500;
                if (status < 200 || status >= 300) {
                    fail(status >= 300 && status < 400 ? "ERR_MEDIA_REDIRECT" : "ERR_MEDIA_DOWNLOAD");
                    return;
                }
                if (status === 204 || status === 205) {
                    fail("ERR_EMPTY_MEDIA");
                    return;
                }
                if (incoming.headers["content-encoding"] && incoming.headers["content-encoding"] !== "identity") {
                    fail("ERR_MEDIA_ENCODING");
                    return;
                }
                const headers = new Headers();
                for (const name of ["content-type", "content-length"]) {
                    const value = incoming.headers[name];
                    if (typeof value === "string") headers.set(name, value);
                }
                const body = Readable.toWeb(incoming, { strategy: { highWaterMark: 65_536, size: (chunk: Buffer) => chunk.byteLength } }) as ReadableStream<Uint8Array>;
                resolve(new Response(body, { status, headers }));
            } catch {
                // Native callbacks run after the Promise executor; reject conversion failures here.
                fail("ERR_MEDIA_DOWNLOAD");
            }
        });
        request.on("error", () => reject(new Error(signal.aborted ? "ERR_MEDIA_CANCELLED" : "ERR_MEDIA_DOWNLOAD")));
    });
    const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "application/octet-stream";
    const data = await readBoundedResponse(response, { signal, maxBytes: options.maxBytes ?? mediaByteLimit(mimeType) });
    if (!data.byteLength) throw new Error("ERR_EMPTY_MEDIA");
    return { data, mimeType };
}

const MIME_EXTENSIONS: Record<string, string> = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif",
    "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
    "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mp4": ".m4a", "audio/ogg": ".ogg",
};

export function mediaExtension(mime: string): string {
    const extension = MIME_EXTENSIONS[mime.toLowerCase().split(";")[0].trim()];
    if (!extension) throw new Error("ERR_UNSUPPORTED_MEDIA_TYPE");
    return extension;
}

export function mediaMimeForExtension(extension: string): string {
    const match = Object.entries(MIME_EXTENSIONS).find(([, value]) => value === extension.toLowerCase().replace(".jpeg", ".jpg"));
    if (!match) throw new Error("ERR_UNSUPPORTED_MEDIA_TYPE");
    return match[0];
}

export function detectMediaMime(data: Uint8Array, declared?: string): string {
    const header = Buffer.from(data.subarray(0, 64));
    let mime: string | undefined;
    if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = "image/png";
    else if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) mime = "image/jpeg";
    else if (/^GIF8[79]a/.test(header.toString("ascii", 0, 6))) mime = "image/gif";
    else if (header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP") mime = "image/webp";
    else if (header.toString("ascii", 4, 8) === "ftyp") {
        const brand = header.toString("ascii", 8, 12);
        mime = ["avif", "avis"].includes(brand) ? "image/avif" : brand === "qt  " ? "video/quicktime" : brand === "M4A " ? "audio/mp4" : "video/mp4";
    } else if (header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) mime = "video/webm";
    else if (header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WAVE") mime = "audio/wav";
    else if (header.toString("ascii", 0, 4) === "OggS") mime = "audio/ogg";
    else if (header.toString("ascii", 0, 3) === "ID3" || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)) mime = "audio/mpeg";
    const normalized = declared?.split(";")[0].trim().toLowerCase().replace("audio/x-wav", "audio/wav");
    if (!mime || (normalized && normalized !== "application/octet-stream" && mime !== normalized)) throw new Error("ERR_UNSUPPORTED_MEDIA_TYPE");
    return mime;
}
