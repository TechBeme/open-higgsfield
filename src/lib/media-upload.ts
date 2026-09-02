/**
 * Media upload utilities — shared between video and image route handlers.
 */
import sharp from "sharp";
import { saveInputLocally, uploadToTmpfiles, resolveLocalUpload } from "@/lib/upload";
import { assertSafeRemoteUrl } from "@/lib/safe-url";

/** Convert an image buffer to JPEG format */
export async function toJpeg(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer).jpeg({ quality: 92 }).toBuffer();
}

export interface ResolvedMedia {
    /** Remote URL suitable for API calls */
    remoteUrl: string;
    /** Local URL for display/reuse */
    localUrl: string;
}

/** Process an image file: convert to JPEG, save locally, upload remotely */
export async function processImageUpload(buffer: Buffer): Promise<ResolvedMedia> {
    const jpeg = await toJpeg(buffer);
    const localUrl = await saveInputLocally(jpeg, ".jpg");
    const remoteUrl = await uploadToTmpfiles(jpeg, "image.jpg", "image/jpeg");
    return { remoteUrl, localUrl };
}

/** Process a generic file: save locally, upload remotely */
export async function processFileUpload(
    buffer: Buffer,
    filename: string,
    mimeType: string
): Promise<ResolvedMedia> {
    const ext = filename.includes(".") ? `.${filename.split(".").pop()}` : ".bin";
    const localUrl = await saveInputLocally(buffer, ext);
    const remoteUrl = await uploadToTmpfiles(buffer, `file${ext}`, mimeType);
    return { remoteUrl, localUrl };
}

/** Resolve a URL that may be a local upload reference to a remote URL */
export async function resolveUrl(url: string): Promise<ResolvedMedia> {
    if (url.startsWith("/api/uploaded/") || url.startsWith("/api/download/")) {
        const remoteUrl = await resolveLocalUpload(url);
        return { remoteUrl, localUrl: url };
    }
    const safeUrl = await assertSafeRemoteUrl(url);
    return { remoteUrl: safeUrl.toString(), localUrl: safeUrl.toString() };
}
