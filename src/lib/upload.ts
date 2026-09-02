import fs from "fs/promises";
import path from "path";
import { STORAGE_ROOT } from "@/lib/storage-paths";

function shortId() {
    return Math.random().toString(36).slice(2, 16);
}

const UPLOADS_DIR = path.join(STORAGE_ROOT, "uploads");
const DOWNLOADS_DIR = path.join(STORAGE_ROOT, "downloads");
const DOWNLOADS_IMAGES_DIR = path.join(DOWNLOADS_DIR, "images");
const DOWNLOADS_VIDEOS_DIR = path.join(DOWNLOADS_DIR, "videos");

// Ensure dirs exist when this module is first imported
(async () => {
    await fs.mkdir(UPLOADS_DIR, { recursive: true }).catch(() => { });
    await fs.mkdir(DOWNLOADS_IMAGES_DIR, { recursive: true }).catch(() => { });
    await fs.mkdir(DOWNLOADS_VIDEOS_DIR, { recursive: true }).catch(() => { });
})();

export async function uploadToTmpfiles(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    return uploadToCloudinary(buffer, filename, mimeType);
}

async function uploadToCloudinary(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    let cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    let apiKey = process.env.CLOUDINARY_API_KEY;
    let apiSecret = process.env.CLOUDINARY_API_SECRET;

    // Support single CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
    const cloudinaryUrl = process.env.CLOUDINARY_URL;
    if (cloudinaryUrl) {
        const m = cloudinaryUrl.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
        if (m) { apiKey = m[1]; apiSecret = m[2]; cloudName = m[3]; }
    }

    if (!cloudName || !apiKey || !apiSecret) {
        throw new Error("ERR_CLOUDINARY_NOT_CONFIGURED");
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = "flow-ai-studio";

    // Generate SHA-1 signature: sign "folder=...&timestamp=..." + apiSecret
    const { createHash } = await import("crypto");
    const signStr = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = createHash("sha1").update(signStr).digest("hex");

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
    formData.append("file", blob, filename);
    formData.append("api_key", apiKey);
    formData.append("timestamp", String(timestamp));
    formData.append("folder", folder);
    formData.append("signature", signature);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
        method: "POST",
        body: formData,
    });
    const data = await res.json() as { secure_url?: string; error?: { message: string } };
    if (!res.ok || !data.secure_url) {
        throw new Error(`ERR_CLOUDINARY_UPLOAD: ${data.error?.message ?? res.status}`);
    }
    return data.secure_url;
}

export async function saveInputLocally(buffer: Buffer, ext: string): Promise<string> {
    const filename = `${shortId()}${ext}`;
    await fs.writeFile(path.join(UPLOADS_DIR, filename), buffer);
    return `/api/uploaded/${filename}`;
}

export async function readLocalUpload(filename: string): Promise<Buffer> {
    const safe = path.basename(filename);
    return fs.readFile(path.join(UPLOADS_DIR, safe));
}

export async function saveDownload(taskId: string, suffix: string, buffer: Buffer): Promise<string> {
    const isVideo = /\.(mp4|webm|mov)$/i.test(suffix);
    const dir = isVideo ? DOWNLOADS_VIDEOS_DIR : DOWNLOADS_IMAGES_DIR;
    const filePath = path.join(dir, `${taskId}${suffix}`);
    await fs.writeFile(filePath, buffer);
    return filePath;
}

export async function readDownload(filePath: string): Promise<Buffer> {
    return fs.readFile(filePath);
}

export async function downloadUrl(url: string, taskId: string, index: number): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ERR_DOWNLOAD_FAILED: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "";
    const ext = contentType.includes("jpeg") ? ".jpg"
        : contentType.includes("png") ? ".png"
            : contentType.includes("webp") ? ".webp"
                : contentType.includes("mp4") ? ".mp4"
                    : ".bin";
    return saveDownload(taskId, `_${index}${ext}`, buffer);
}

export async function resolveLocalUpload(url: string): Promise<string> {
    if (url.startsWith("/api/uploaded/")) {
        const filename = url.replace("/api/uploaded/", "");
        const buffer = await readLocalUpload(filename);
        const ext = path.extname(filename).toLowerCase();
        const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
            : ext === ".png" ? "image/png"
                : ext === ".mp4" ? "video/mp4"
                    : ext === ".mp3" ? "audio/mpeg"
                        : "application/octet-stream";
        return uploadToTmpfiles(buffer, path.basename(filename), mime);
    }
    return url;
}

export { UPLOADS_DIR, DOWNLOADS_DIR, DOWNLOADS_IMAGES_DIR, DOWNLOADS_VIDEOS_DIR };
