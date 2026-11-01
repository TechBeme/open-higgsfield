import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { STORAGE_ROOT } from "@/lib/storage-paths";
import { withAbort } from "@/lib/safe-url";
import { assertInputFileSize, detectMediaMime, fetchRemoteMedia, mediaExtension, mediaMimeForExtension,
    readBoundedResponse, transferSignal, type TransferOptions } from "@/lib/media-transfer";

export const UPLOADS_DIR = path.join(STORAGE_ROOT, "uploads");
export const DOWNLOADS_DIR = path.join(STORAGE_ROOT, "downloads");
export const DOWNLOADS_IMAGES_DIR = path.join(DOWNLOADS_DIR, "images");
export const DOWNLOADS_VIDEOS_DIR = path.join(DOWNLOADS_DIR, "videos");

export function assertAssetId(value: string): void {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("ERR_INVALID_TASK_ID");
}

export function cloudinaryConfiguration() {
    let cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    let apiKey = process.env.CLOUDINARY_API_KEY;
    let apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (process.env.CLOUDINARY_URL) {
        try {
            const parsed = new URL(process.env.CLOUDINARY_URL);
            if (parsed.protocol !== "cloudinary:" || parsed.pathname || parsed.port || parsed.search || parsed.hash) throw new Error();
            cloudName = parsed.hostname;
            apiKey = decodeURIComponent(parsed.username);
            apiSecret = decodeURIComponent(parsed.password);
        } catch { throw new Error("ERR_CLOUDINARY_NOT_CONFIGURED"); }
    }
    if (!cloudName || !/^[a-zA-Z0-9_-]{1,100}$/.test(cloudName) || !apiKey || !apiSecret
        || apiKey.length > 256 || apiSecret.length > 512 || /[\x00-\x1f\x7f]/.test(apiKey + apiSecret)) {
        throw new Error("ERR_CLOUDINARY_NOT_CONFIGURED");
    }
    return { cloudName, apiKey, apiSecret };
}

export function validateCloudinaryUrl(value: string, cloudName: string, resourceType: string, publicId?: string): URL {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("ERR_CLOUDINARY_RESPONSE"); }
    const prefix = `/${cloudName}/${resourceType}/upload/`;
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || url.port || url.username || url.password
        || url.search || url.hash || !url.pathname.startsWith(prefix)) throw new Error("ERR_CLOUDINARY_RESPONSE");
    const suffix = url.pathname.slice(prefix.length);
    if (!/^v[0-9]+\/[A-Za-z0-9_/-]+\.(?:jpg|jpeg|png|webp|gif|avif|mp4|webm|mov|mp3|wav|m4a|ogg)$/.test(suffix)
        || suffix.includes("..") || (publicId && suffix.replace(/^v[0-9]+\//, "").replace(/\.[^.]+$/, "") !== publicId)) {
        throw new Error("ERR_CLOUDINARY_RESPONSE");
    }
    return url;
}

export async function uploadCloudinary(buffer: Buffer, publicId: string, mimeType: string, options: TransferOptions = {}): Promise<string> {
    const signal = transferSignal(options.signal);
    const mime = detectMediaMime(buffer, mimeType);
    assertInputFileSize(buffer.length, mime);
    if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(publicId) || publicId.length > 240) throw new Error("ERR_INVALID_ASSET_ID");
    const { cloudName, apiKey, apiSecret } = cloudinaryConfiguration();
    const resourceType = mime.startsWith("image/") ? "image" : "video";
    const parameters: Record<string, string> = {
        overwrite: "false", public_id: publicId, timestamp: String(Math.floor(Date.now() / 1000)), type: "upload",
    };
    const signed = Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&");
    const signature = createHash("sha256").update(signed + apiSecret).digest("hex");
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), `media${mediaExtension(mime)}`);
    form.append("api_key", apiKey);
    form.append("signature", signature);
    for (const [key, value] of Object.entries(parameters)) form.append(key, value);
    let response: Response;
    try {
        response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
            method: "POST", body: form, redirect: "error", signal,
        });
    } catch { throw new Error(signal.aborted ? "ERR_MEDIA_CANCELLED" : "ERR_CLOUDINARY_UPLOAD"); }
    const bytes = await readBoundedResponse(response, { maxBytes: 65_536, signal });
    if (!response.ok) throw new Error("ERR_CLOUDINARY_UPLOAD");
    let result: { secure_url?: string; public_id?: string; resource_type?: string; type?: string };
    try { result = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("ERR_CLOUDINARY_RESPONSE"); }
    if (result.public_id !== publicId || result.resource_type !== resourceType || result.type !== "upload" || typeof result.secure_url !== "string") {
        throw new Error("ERR_CLOUDINARY_RESPONSE");
    }
    return validateCloudinaryUrl(result.secure_url, cloudName, resourceType, publicId).toString();
}

export async function uploadToTmpfiles(buffer: Buffer, _filename: string, mimeType: string, options: TransferOptions = {}): Promise<string> {
    const hash = createHash("sha256").update(buffer).digest("hex");
    return uploadCloudinary(buffer, `open-higgsfield/inputs/${hash}`, mimeType, options);
}

function contained(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function openLocalMedia(filePath: string, root: string, options: TransferOptions = {}) {
    const signal = options.signal ?? transferSignal();
    signal.throwIfAborted();
    if (!path.isAbsolute(filePath) || !contained(path.resolve(root), path.resolve(filePath))) throw new Error("ERR_UNSAFE_ASSET_PATH");
    const [realRoot, realFile] = await withAbort(Promise.all([fs.realpath(root), fs.realpath(filePath)]), signal);
    if (!contained(realRoot, realFile)) throw new Error("ERR_UNSAFE_ASSET_PATH");
    const opening = fs.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let handle: Awaited<typeof opening>;
    try { handle = await withAbort(opening, signal); }
    catch (error) {
        // fs.open cannot be cancelled; close a descriptor that arrives after expiry.
        void opening.then((lateHandle) => lateHandle.close()).catch(() => undefined);
        throw error;
    }
    const abort = () => { void handle.close().catch(() => undefined); };
    signal.addEventListener("abort", abort, { once: true });
    if ("once" in handle && typeof handle.once === "function") {
        handle.once("close", () => signal.removeEventListener("abort", abort));
    }
    try {
        signal.throwIfAborted();
        const stat = await withAbort(handle.stat(), signal);
        if (!stat.isFile()) throw new Error("ERR_UNSAFE_ASSET_PATH");
        const prefix = Buffer.alloc(64);
        const { bytesRead } = await withAbort(handle.read(prefix, 0, prefix.length, 0), signal);
        const mimeType = detectMediaMime(prefix.subarray(0, bytesRead), mediaMimeForExtension(path.extname(filePath)));
        assertInputFileSize(stat.size, mimeType);
        signal.throwIfAborted();
        return { handle, size: stat.size, mimeType, signal };
    } catch (error) { await handle.close(); throw error; }
}

async function atomicMediaWrite(filePath: string, buffer: Buffer, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
        await handle.writeFile(buffer, { signal });
        await handle.sync();
        await handle.close();
        signal.throwIfAborted();
        try { await fs.link(temporary, filePath); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            const existing = await openLocalMedia(filePath, filePath.startsWith(UPLOADS_DIR + path.sep) ? UPLOADS_DIR : DOWNLOADS_DIR, { signal });
            try {
                const bytes = await existing.handle.readFile({ signal });
                if (!bytes.equals(buffer)) throw new Error("ERR_ASSET_CONTENT_CONFLICT");
            } finally { await existing.handle.close(); }
        }
        const directory = await fs.open(path.dirname(filePath), "r");
        try { await directory.sync(); } finally { await directory.close(); }
    } finally {
        await handle.close().catch(() => undefined);
        await fs.unlink(temporary).catch(() => undefined);
    }
}

export async function saveInputLocally(buffer: Buffer, ext: string, options: TransferOptions = {}): Promise<string> {
    const signal = transferSignal(options.signal);
    const mime = detectMediaMime(buffer, mediaMimeForExtension(ext));
    assertInputFileSize(buffer.length, mime);
    const filename = `${createHash("sha256").update(buffer).digest("hex")}${mediaExtension(mime)}`;
    await atomicMediaWrite(path.join(UPLOADS_DIR, filename), buffer, signal);
    return `/api/uploaded/${filename}`;
}

export async function readLocalUpload(filename: string, options: TransferOptions = {}): Promise<Buffer> {
    const signal = transferSignal(options.signal);
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(filename)) throw new Error("ERR_UNSAFE_ASSET_PATH");
    const file = await openLocalMedia(path.join(UPLOADS_DIR, filename), UPLOADS_DIR, { signal });
    try { return await file.handle.readFile({ signal }); } finally { await file.handle.close(); }
}

export async function saveDownload(taskId: string, suffix: string, buffer: Buffer, options: TransferOptions = {}): Promise<string> {
    assertAssetId(taskId);
    if (!/^_[0-9]{1,2}\.[a-z0-9]+$/.test(suffix) && !/^\.[a-z0-9]+$/.test(suffix)) throw new Error("ERR_INVALID_ASSET_ID");
    const mime = detectMediaMime(buffer, mediaMimeForExtension(suffix.startsWith("_") ? path.extname(suffix) : suffix));
    assertInputFileSize(buffer.length, mime);
    const signal = transferSignal(options.signal);
    const dir = mime.startsWith("video/") ? DOWNLOADS_VIDEOS_DIR : DOWNLOADS_IMAGES_DIR;
    const index = suffix.startsWith("_") ? suffix.slice(0, suffix.indexOf(".")) : "_0";
    const hash = createHash("sha256").update(buffer).digest("hex");
    const filePath = path.join(dir, `${taskId}${index}_${hash}${mediaExtension(mime)}`);
    await atomicMediaWrite(filePath, buffer, signal);
    return filePath;
}

export async function readDownload(filePath: string, options: TransferOptions = {}): Promise<Buffer> {
    const signal = transferSignal(options.signal);
    const file = await openLocalMedia(filePath, DOWNLOADS_DIR, { signal });
    try { return await file.handle.readFile({ signal }); } finally { await file.handle.close(); }
}

export async function downloadUrl(url: string, taskId: string, index: number, options: TransferOptions = {}): Promise<string> {
    if (!Number.isInteger(index) || index < 0 || index > 15) throw new Error("ERR_INVALID_INDEX");
    const media = await fetchRemoteMedia(url, options);
    const mime = detectMediaMime(media.data, media.mimeType);
    return saveDownload(taskId, `_${index}${mediaExtension(mime)}`, media.data, options);
}

export async function resolveLocalUpload(url: string, options: TransferOptions = {}): Promise<string> {
    if (!url.startsWith("/api/uploaded/")) return url;
    const filename = url.slice("/api/uploaded/".length);
    const buffer = await readLocalUpload(filename, options);
    return uploadToTmpfiles(buffer, filename, mediaMimeForExtension(path.extname(filename)), options);
}
