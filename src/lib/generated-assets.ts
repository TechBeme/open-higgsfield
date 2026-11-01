import path from "node:path";
import { createHash } from "node:crypto";
import type { AnyTask } from "@/types";
import type { GeneratedAsset } from "@/providers/types";
import { assertAssetId, cloudinaryConfiguration, saveDownload, uploadCloudinary } from "@/lib/upload";
import { assertInputFileSize, detectMediaMime, fetchRemoteMedia, mediaExtension, mediaByteLimit,
    transferSignal, type TransferOptions } from "@/lib/media-transfer";

export function assertGeneratedStorageConfigured(): "local" | "cloudinary" {
    const configured = process.env.ASSET_STORAGE_MODE;
    const mode = configured ?? (process.env.NODE_ENV !== "production" && !process.env.DATABASE_URL && !process.env.VERCEL ? "local" : undefined);
    if (mode !== "local" && mode !== "cloudinary") throw new Error("ERR_ASSET_STORAGE_NOT_CONFIGURED");
    if (mode === "local") {
        if (process.env.DATABASE_URL || process.env.VERCEL) throw new Error("ERR_DURABLE_ASSET_STORAGE_REQUIRED");
        if (process.env.NODE_ENV === "production" && (!process.env.OPEN_HIGGSFIELD_STORAGE_DIR || !path.isAbsolute(process.env.OPEN_HIGGSFIELD_STORAGE_DIR))) {
            throw new Error("ERR_PERSISTENT_STORAGE_REQUIRED");
        }
    } else {
        if (process.env.ASSET_DELIVERY_MODE !== "public") throw new Error("ERR_PUBLIC_ASSET_DELIVERY_ACK_REQUIRED");
        cloudinaryConfiguration();
    }
    return mode;
}

async function materializeAsset(asset: GeneratedAsset, mediaType: "image" | "video", signal: AbortSignal) {
    signal.throwIfAborted();
    let data: Buffer;
    let declared = asset.mimeType;
    if (asset.data) {
        assertInputFileSize(asset.data.byteLength, `${mediaType}/`);
        data = Buffer.from(asset.data);
    } else {
        if (!asset.url) throw new Error("ERR_EMPTY_GENERATED_ASSET");
        const fetched = await fetchRemoteMedia(asset.url, { signal, maxBytes: mediaByteLimit(`${mediaType}/`) });
        data = fetched.data;
        declared ??= fetched.mimeType;
    }
    const mimeType = detectMediaMime(data, declared);
    if (!mimeType.startsWith(`${mediaType}/`)) throw new Error("ERR_UNSUPPORTED_MEDIA_TYPE");
    assertInputFileSize(data.length, mimeType);
    return { data, mimeType };
}

export async function attachGeneratedAssets(task: AnyTask, assets: GeneratedAsset[], options: TransferOptions = {}): Promise<void> {
    assertAssetId(task.task_id);
    const mode = assertGeneratedStorageConfigured();
    if (!assets.length || assets.length > 16 || (task.media_type === "video" && assets.length !== 1)) throw new Error("ERR_INVALID_GENERATED_ASSET_COUNT");
    const signal = transferSignal(options.signal);
    const paths: string[] = [];
    const urls: string[] = [];
    for (const [index, asset] of assets.entries()) {
        const { data, mimeType } = await materializeAsset(asset, task.media_type, signal);
        if (mode === "cloudinary") {
            const hash = createHash("sha256").update(data).digest("hex");
            urls.push(await uploadCloudinary(data, `open-higgsfield/generated/${task.task_id}/${index}_${hash}`, mimeType, { signal }));
        } else {
            paths.push(await saveDownload(task.task_id, `_${index}${mediaExtension(mimeType)}`, data, { signal }));
            urls.push(`/api/download/${task.task_id}${task.media_type === "image" ? `?index=${index}` : "?inline=1"}`);
        }
    }
    signal.throwIfAborted();
    if (task.media_type === "image") {
        task.result_paths = paths;
        task.result_urls = urls;
    } else {
        task.video_path = paths[0];
        task.video_urls = urls;
    }
}
