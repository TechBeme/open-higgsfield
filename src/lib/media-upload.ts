import sharp from "sharp";
import { saveInputLocally, uploadToTmpfiles, resolveLocalUpload, assertAssetId } from "@/lib/upload";
import { assertSafeRemoteUrl } from "@/lib/safe-url";
import { assertInputFileSize, detectMediaMime, IMAGE_MAX_PIXELS, mediaExtension, transferSignal,
    type TransferOptions } from "@/lib/media-transfer";
import { withAbort } from "@/lib/safe-url";

export async function toJpeg(buffer: Buffer, options: TransferOptions = {}): Promise<Buffer> {
    const signal = transferSignal(options.signal);
    assertInputFileSize(buffer.length, "image/jpeg");
    if (!detectMediaMime(buffer).startsWith("image/")) throw new Error("ERR_UNSUPPORTED_MEDIA_TYPE");
    const image = sharp(buffer, { limitInputPixels: IMAGE_MAX_PIXELS, failOn: "error" });
    const abort = () => image.destroy();
    signal.addEventListener("abort", abort, { once: true });
    try {
        const metadata = await withAbort(image.metadata(), signal);
        if (!Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height) || metadata.width <= 0 || metadata.height <= 0
            || !Number.isSafeInteger(metadata.pages ?? 1) || (metadata.pages ?? 1) <= 0
            || !Number.isSafeInteger(metadata.width * metadata.height * (metadata.pages ?? 1))
            || metadata.width * metadata.height * (metadata.pages ?? 1) > IMAGE_MAX_PIXELS) throw new Error("ERR_IMAGE_PIXEL_LIMIT");
        const jpeg = await withAbort(image.jpeg({ quality: 92 }).toBuffer(), signal);
        assertInputFileSize(jpeg.length, "image/jpeg");
        return jpeg;
    } finally { signal.removeEventListener("abort", abort); image.destroy(); }
}

export interface ResolvedMedia { remoteUrl: string; localUrl: string }

export async function processImageUpload(buffer: Buffer, options: TransferOptions = {}): Promise<ResolvedMedia> {
    const signal = transferSignal(options.signal);
    const jpeg = await toJpeg(buffer, { signal });
    const localUrl = await saveInputLocally(jpeg, ".jpg", { signal });
    const remoteUrl = await uploadToTmpfiles(jpeg, "image.jpg", "image/jpeg", { signal });
    return { remoteUrl, localUrl };
}

export async function processFileUpload(buffer: Buffer, _filename: string, mimeType: string, options: TransferOptions = {}): Promise<ResolvedMedia> {
    const signal = transferSignal(options.signal);
    const mime = detectMediaMime(buffer, mimeType);
    assertInputFileSize(buffer.length, mime);
    const ext = mediaExtension(mime);
    const localUrl = await saveInputLocally(buffer, ext, { signal });
    const remoteUrl = await uploadToTmpfiles(buffer, `file${ext}`, mime, { signal });
    return { remoteUrl, localUrl };
}

export async function resolveUrl(url: string, options: TransferOptions = {}): Promise<ResolvedMedia> {
    const signal = transferSignal(options.signal);
    if (url.startsWith("/api/uploaded/")) {
        return { remoteUrl: await resolveLocalUpload(url, { signal }), localUrl: url };
    }
    if (url.startsWith("/api/download/")) {
        const parsed = new URL(url, "https://workspace.invalid");
        const taskId = parsed.pathname.slice("/api/download/".length);
        assertAssetId(taskId);
        const { getTask, initStore } = await import("@/lib/task-store");
        const { assetIndex, taskAssetCount, reusableTaskAsset } = await import("@/lib/asset-source");
        await initStore();
        const task = await getTask(taskId);
        if (!task) throw new Error("ERR_ASSET_NOT_FOUND");
        const source = await reusableTaskAsset(task, assetIndex(parsed.searchParams.get("index"), taskAssetCount(task)), { signal });
        return { remoteUrl: "url" in source ? source.url : await uploadToTmpfiles(source.data, "media", source.mimeType, { signal }), localUrl: url };
    }
    const safeUrl = await assertSafeRemoteUrl(url, { signal });
    return { remoteUrl: safeUrl.toString(), localUrl: safeUrl.toString() };
}
