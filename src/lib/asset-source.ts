import path from "node:path";
import { Readable } from "node:stream";
import type { AnyTask } from "@/types";
import { assertAssetId, DOWNLOADS_DIR, openLocalMedia, UPLOADS_DIR, validateCloudinaryUrl } from "@/lib/upload";
import { assertInputFileSize, detectMediaMime, fetchRemoteMedia, mediaByteLimit, mediaExtension,
    SERVERLESS_RESPONSE_MAX_BYTES, transferSignal, type TransferOptions } from "@/lib/media-transfer";

type LocalSource = Awaited<ReturnType<typeof openLocalMedia>>;
type ByteSource = { data: Buffer; size: number; mimeType: string };
type Source = (LocalSource | ByteSource | { redirect: string }) & { signal: AbortSignal };

export const PRIVATE_MEDIA_HEADERS = {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin", "Content-Security-Policy": "frame-ancestors 'none'", Vary: "Authorization, Origin",
};

export class AssetError extends Error {
    constructor(message: string, readonly status = 400) { super(message); }
}

export function assetErrorResponse(error: unknown): Response {
    const code = (error as { code?: string })?.code;
    const message = error instanceof Error ? error.message : "";
    const status = error instanceof AssetError ? error.status
        : code === "ENOENT" ? 404
            : message === "ERR_MEDIA_TOO_LARGE" ? 413
                : /^(ERR_UNSUPPORTED_MEDIA_TYPE|ERR_UNSAFE_ASSET_PATH|ERR_INVALID_)/.test(message) ? 400 : 503;
    const safe = /^ERR_[A-Z0-9_]+$/.test(message) ? message : status === 404 ? "ERR_ASSET_NOT_FOUND" : "ERR_ASSET_UNAVAILABLE";
    return Response.json({ error: safe }, { status, headers: PRIVATE_MEDIA_HEADERS });
}

export function taskAssetCount(task: AnyTask): number {
    return task.media_type === "image"
        ? Math.min(16, Math.max(task.result_paths?.length ?? 0, task.result_urls?.length ?? 0))
        : task.video_path || task.video_urls?.length ? 1 : 0;
}

export function assetIndex(value: string | number | null | undefined, count: number): number {
    const text = String(value ?? "0");
    if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new AssetError("ERR_INVALID_INDEX");
    const index = Number(text);
    if (!Number.isSafeInteger(index) || index < 0 || index >= count) throw new AssetError("ERR_INVALID_INDEX");
    return index;
}

function dataUrlSource(value: string): ByteSource {
    const separator = value.indexOf(",");
    const header = value.slice(0, separator);
    const match = /^data:([a-z0-9/+.-]+);base64$/.exec(header);
    if (!match) throw new AssetError("ERR_INVALID_LEGACY_ASSET");
    const encoded = value.slice(separator + 1);
    const maxBytes = mediaByteLimit(match[1]);
    if (!encoded || encoded.length > 4 * Math.ceil(maxBytes / 3)
        || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
        throw new AssetError("ERR_INVALID_LEGACY_ASSET");
    }
    const data = Buffer.from(encoded, "base64");
    if (data.toString("base64") !== encoded) throw new AssetError("ERR_INVALID_LEGACY_ASSET");
    const mimeType = detectMediaMime(data, match[1]);
    assertInputFileSize(data.length, mimeType);
    return { data, size: data.length, mimeType };
}

function durableRedirect(value: string, task: AnyTask, index: number): string | undefined {
    try {
        const url = new URL(value);
        const cloud = url.pathname.split("/")[1];
        const valid = validateCloudinaryUrl(value, cloud, task.media_type);
        const suffix = valid.pathname.split(`/upload/`)[1].replace(/^v[0-9]+\//, "");
        const expected = new RegExp(`^open-higgsfield/generated/${task.task_id}/${index}_[a-f0-9]{64}\\.[a-z0-9]+$`);
        return expected.test(suffix) ? valid.toString() : undefined;
    } catch { return undefined; }
}

export async function taskAssetSource(task: AnyTask, index: number, options: TransferOptions = {}): Promise<Source> {
    assertAssetId(task.task_id);
    assetIndex(index, taskAssetCount(task));
    const signal = transferSignal(options.signal);
    const local = task.media_type === "image" ? task.result_paths?.[index] : task.video_path;
    if (local) {
        try {
            const source = await openLocalMedia(local, DOWNLOADS_DIR, { signal });
            if (!source.mimeType.startsWith(`${task.media_type}/`)) {
                await source.handle.close();
                throw new AssetError("ERR_UNSUPPORTED_MEDIA_TYPE");
            }
            return source;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const value = (task.media_type === "image" ? task.result_urls?.[index] : task.video_urls?.[index]) ?? "";
    if (value.startsWith("data:")) {
        const source = dataUrlSource(value);
        if (!source.mimeType.startsWith(`${task.media_type}/`)) throw new AssetError("ERR_UNSUPPORTED_MEDIA_TYPE");
        return { ...source, signal };
    }
    if (!value || value.startsWith("/")) throw new AssetError("ERR_ASSET_NOT_FOUND", 404);
    const redirect = durableRedirect(value, task, index);
    if (redirect) return { redirect, signal };
    const maxBytes = process.env.VERCEL ? SERVERLESS_RESPONSE_MAX_BYTES : mediaByteLimit(`${task.media_type}/`);
    try {
        const fetched = await fetchRemoteMedia(value, { signal, maxBytes });
        const mimeType = detectMediaMime(fetched.data, fetched.mimeType);
        if (!mimeType.startsWith(`${task.media_type}/`)) throw new AssetError("ERR_UNSUPPORTED_MEDIA_TYPE");
        return { data: fetched.data, size: fetched.data.length, mimeType, signal };
    } catch (error) {
        if (process.env.VERCEL && (error as Error).message === "ERR_MEDIA_TOO_LARGE") {
            throw new AssetError("ERR_LEGACY_ASSET_REQUIRES_MIGRATION", 413);
        }
        throw error;
    }
}

export function parseByteRange(value: string | null, size: number): { start: number; end: number } | null {
    if (value === null) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(value);
    if (!match || (!match[1] && !match[2])) throw new AssetError("ERR_INVALID_RANGE");
    const first = match[1] ? Number(match[1]) : undefined;
    const last = match[2] ? Number(match[2]) : undefined;
    if ((first !== undefined && !Number.isSafeInteger(first)) || (last !== undefined && !Number.isSafeInteger(last))
        || !size || (first !== undefined && first >= size) || (first === undefined && !last)
        || (first !== undefined && last !== undefined && last < first)) throw new AssetError("ERR_UNSATISFIABLE_RANGE", 416);
    return first === undefined
        ? { start: Math.max(0, size - last!), end: size - 1 }
        : { start: first, end: Math.min(last ?? size - 1, size - 1) };
}

async function sourceResponse(source: Source, request: Request, taskId: string, attachment: boolean): Promise<Response> {
    try {
        source.signal.throwIfAborted();
        if ("redirect" in source) {
            const url = new URL(source.redirect);
            if (attachment) url.pathname = url.pathname.replace("/upload/", `/upload/fl_attachment:${taskId}/`);
            return new Response(null, { status: 307, headers: { ...PRIVATE_MEDIA_HEADERS, Location: url.toString() } });
        }
        let range: ReturnType<typeof parseByteRange>;
        try { range = parseByteRange(request.headers.has("if-range") ? null : request.headers.get("range"), source.size); }
        catch (error) {
            if ("handle" in source) await source.handle.close();
            if (error instanceof AssetError && error.status === 416) {
                return Response.json({ error: error.message }, { status: 416, headers: { ...PRIVATE_MEDIA_HEADERS, "Content-Range": `bytes */${source.size}` } });
            }
            throw error;
        }
        const start = range?.start ?? 0;
        const end = range?.end ?? source.size - 1;
        const length = end - start + 1;
        if (process.env.VERCEL && length > SERVERLESS_RESPONSE_MAX_BYTES) throw new AssetError("ERR_LEGACY_ASSET_REQUIRES_MIGRATION", 413);
        const headers: Record<string, string> = {
            ...PRIVATE_MEDIA_HEADERS, "Content-Type": source.mimeType,
            "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename="${taskId}${mediaExtension(source.mimeType)}"`,
            "Content-Length": String(length), "Accept-Ranges": "bytes",
        };
        if (range) headers["Content-Range"] = `bytes ${start}-${end}/${source.size}`;
        let body: BodyInit;
        if ("handle" in source) {
            const stream = source.handle.createReadStream({ start, end, autoClose: true, signal: source.signal });
            body = Readable.toWeb(stream, { strategy: { highWaterMark: 65_536, size: (chunk: Buffer) => chunk.byteLength } }) as ReadableStream<Uint8Array>;
        } else body = new Uint8Array(source.data.subarray(start, end + 1));
        return new Response(body, { status: range ? 206 : 200, headers });
    } catch (error) {
        if ("handle" in source) await source.handle.close().catch(() => undefined);
        throw error;
    }
}

export async function taskAssetResponse(task: AnyTask, index: number, request: Request, attachment: boolean): Promise<Response> {
    return sourceResponse(await taskAssetSource(task, index, { signal: request.signal }), request, task.task_id, attachment);
}

export async function uploadedAssetResponse(filename: string, request: Request): Promise<Response> {
    const signal = transferSignal(request.signal);
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(filename)) throw new AssetError("ERR_UNSAFE_ASSET_PATH");
    return sourceResponse(await openLocalMedia(path.join(UPLOADS_DIR, filename), UPLOADS_DIR, { signal }), request, path.parse(filename).name, false);
}

export async function reusableTaskAsset(task: AnyTask, index: number, options: TransferOptions = {}): Promise<{ url: string } | { data: Buffer; mimeType: string }> {
    const source = await taskAssetSource(task, index, options);
    if ("redirect" in source) return { url: source.redirect };
    if ("data" in source) return { data: source.data, mimeType: source.mimeType };
    try { return { data: await source.handle.readFile({ signal: source.signal }), mimeType: source.mimeType }; }
    finally { await source.handle.close(); }
}
