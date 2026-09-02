import type { AnyTask, ImageTask, VideoTask } from "@/types";
import type { GeneratedAsset } from "@/providers/types";
import { saveDownload } from "@/lib/upload";
import { isDatabaseConfigured } from "@/lib/database";

function extensionFor(mimeType?: string, url?: string): string {
    const mime = mimeType?.toLowerCase() ?? "";
    if (mime.includes("jpeg")) return ".jpg";
    if (mime.includes("png")) return ".png";
    if (mime.includes("webp")) return ".webp";
    if (mime.includes("gif")) return ".gif";
    if (mime.includes("webm")) return ".webm";
    if (mime.includes("quicktime")) return ".mov";
    if (mime.includes("mp4")) return ".mp4";
    const match = url?.match(/\.(png|jpe?g|webp|gif|mp4|webm|mov)(?:\?|$)/i);
    return match ? `.${match[1].toLowerCase().replace("jpeg", "jpg")}` : ".bin";
}

async function materializeAsset(asset: GeneratedAsset): Promise<{ data: Buffer; mimeType?: string; sourceUrl?: string }> {
    if (asset.data) return { data: Buffer.from(asset.data), mimeType: asset.mimeType, sourceUrl: asset.url };
    if (!asset.url) throw new Error("ERR_EMPTY_GENERATED_ASSET");
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`ERR_DOWNLOAD_FAILED: ${response.status}`);
    return {
        data: Buffer.from(await response.arrayBuffer()),
        mimeType: asset.mimeType ?? response.headers.get("content-type") ?? undefined,
        sourceUrl: asset.url,
    };
}

export async function attachGeneratedAssets(task: AnyTask, assets: GeneratedAsset[]): Promise<void> {
    if (assets.length === 0) throw new Error("ERR_NO_GENERATED_ASSETS");

    if (task.media_type === "image") {
        const imageTask = task as ImageTask;
        const paths: string[] = [];
        const urls: string[] = [];
        for (const [index, asset] of assets.entries()) {
            const materialized = await materializeAsset(asset);
            const ext = extensionFor(materialized.mimeType, materialized.sourceUrl);
            paths.push(await saveDownload(task.task_id, `_${index}${ext}`, materialized.data));
            if (isDatabaseConfigured()) {
                const mimeType = materialized.mimeType ?? (ext === ".jpg" ? "image/jpeg" : `image/${ext.slice(1)}`);
                urls.push(`data:${mimeType};base64,${materialized.data.toString("base64")}`);
            }
        }
        imageTask.result_paths = paths;
        imageTask.result_urls = urls.length > 0
            ? urls
            : paths.map((_, index) => `/api/download/${task.task_id}?index=${index}`);
        return;
    }

    const videoTask = task as VideoTask;
    const first = await materializeAsset(assets[0]);
    const ext = extensionFor(first.mimeType, first.sourceUrl);
    videoTask.video_path = await saveDownload(task.task_id, ext === ".bin" ? ".mp4" : ext, first.data);
    videoTask.video_urls = assets.flatMap((asset) => asset.url ? [asset.url] : []);
}
