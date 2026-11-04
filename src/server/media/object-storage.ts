import "server-only";

import { createHash } from "node:crypto";
import { BlobError, head, issueSignedToken, presignUrl, put } from "@vercel/blob";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { assertInputFileSize, detectMediaMime, mediaExtension, transferSignal, type TransferOptions } from "./transfer";
import { withAbort } from "./safe-url";

export type ObjectStorageMode = "vercel-blob" | "s3";
type Access = "private" | "public";
const INPUT_KEY = /^open-higgsfield\/inputs\/[a-f0-9]{64}\.(?:jpg|jpeg|png|webp|gif|avif|mp4|webm|mov|mp3|wav|m4a|ogg)$/;
const OUTPUT_KEY = /^open-higgsfield\/generated\/[A-Za-z0-9_-]{1,128}\/(?:[0-9]|1[0-5])_[a-f0-9]{64}\.(?:jpg|jpeg|png|webp|gif|avif|mp4|webm|mov)$/;

export function objectStorageMode(): ObjectStorageMode | undefined {
    const mode = process.env.ASSET_STORAGE_MODE;
    return mode === "vercel-blob" || mode === "s3" ? mode : undefined;
}

function accessMode(): Access {
    const access = process.env.ASSET_DELIVERY_MODE ?? "private";
    if (access !== "private" && access !== "public") throw new Error("ERR_ASSET_DELIVERY_CONFIG");
    return access;
}

function printable(value: string | undefined, max: number): value is string {
    return Boolean(value && value.length <= max && !/[\x00-\x20\x7f]/.test(value));
}

function httpsOrigin(value: string): string {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/") throw new Error();
        if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || !url.hostname.includes(".") || /^[0-9.]+$/.test(url.hostname)) throw new Error();
        return url.origin;
    } catch { throw new Error("ERR_OBJECT_STORAGE_ORIGIN"); }
}

export function blobConfiguration() {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const oidcAvailable = Boolean(process.env.VERCEL_OIDC_TOKEN);
    // Vercel's recommended deployment path uses the short-lived OIDC token
    // paired with BLOB_STORE_ID. A static read-write token remains supported
    // for local development and non-Vercel hosts.
    const rawStoreId = process.env.BLOB_STORE_ID ?? /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token ?? "")?.[1];
    const sdkStoreId = rawStoreId?.replace(/^store_/, "");
    const storeId = sdkStoreId?.toLowerCase();
    if ((!printable(token, 4096) && !oidcAvailable) || !storeId || !/^[a-z0-9]{1,64}$/.test(storeId)) throw new Error("ERR_VERCEL_BLOB_NOT_CONFIGURED");
    const access = accessMode();
    return { token, storeId, sdkStoreId, oidcAvailable, access, origin: `https://${storeId}.${access}.blob.vercel-storage.com` };
}

function blobAuth(config: ReturnType<typeof blobConfiguration>) {
    return { storeId: config.sdkStoreId, ...(config.token ? { token: config.token } : {}) };
}

export function s3Configuration() {
    const bucket = process.env.S3_BUCKET;
    const region = process.env.S3_REGION;
    if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes("..") || /^[0-9.]+$/.test(bucket)
        || !region || !/^[A-Za-z0-9_-]{1,64}$/.test(region)) throw new Error("ERR_S3_NOT_CONFIGURED");
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    const sessionToken = process.env.S3_SESSION_TOKEN;
    // Unset keys use the SDK's native AWS credential chain (e.g. IAM role).
    if (Boolean(accessKeyId) !== Boolean(secretAccessKey) || (accessKeyId && (!printable(accessKeyId, 256) || !printable(secretAccessKey, 512)))
        || (sessionToken && !printable(sessionToken, 8192))) throw new Error("ERR_S3_NOT_CONFIGURED");
    const endpoint = process.env.S3_ENDPOINT ? httpsOrigin(process.env.S3_ENDPOINT) : undefined;
    const access = accessMode();
    const publicOrigin = process.env.S3_PUBLIC_BASE_URL ? httpsOrigin(process.env.S3_PUBLIC_BASE_URL) : undefined;
    if (access === "public" && !publicOrigin) throw new Error("ERR_S3_PUBLIC_ORIGIN_REQUIRED");
    if (process.env.S3_FORCE_PATH_STYLE && !["true", "false"].includes(process.env.S3_FORCE_PATH_STYLE)) throw new Error("ERR_S3_NOT_CONFIGURED");
    return { bucket, region, endpoint, access, publicOrigin, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
        credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) } : undefined };
}

export function assertObjectStorageConfigured(): ObjectStorageMode {
    const mode = objectStorageMode();
    if (mode === "vercel-blob") blobConfiguration();
    else if (mode === "s3") s3Configuration();
    else throw new Error("ERR_ASSET_STORAGE_NOT_CONFIGURED");
    return mode;
}

function assertObjectKey(key: string): void {
    if (!INPUT_KEY.test(key) && !OUTPUT_KEY.test(key)) throw new Error("ERR_INVALID_ASSET_ID");
}

export function inputObjectKey(bytes: Buffer, mimeType: string): string {
    return `open-higgsfield/inputs/${createHash("sha256").update(bytes).digest("hex")}${mediaExtension(mimeType)}`;
}

export function inputKeyForFilename(filename: string): string {
    const key = `open-higgsfield/inputs/${filename}`;
    if (!INPUT_KEY.test(key)) throw new Error("ERR_UNSAFE_ASSET_PATH");
    return key;
}

function s3Client(): S3Client {
    const config = s3Configuration();
    return new S3Client({ region: config.region, endpoint: config.endpoint, credentials: config.credentials,
        forcePathStyle: config.forcePathStyle, maxAttempts: 2 });
}

/** Stable private references are persisted; signed URLs are generated only on use. */
export function objectReference(key: string): string {
    assertObjectKey(key);
    if (objectStorageMode() === "vercel-blob") {
        const config = blobConfiguration();
        return `${config.origin}/${key}`;
    }
    if (objectStorageMode() === "s3") return `s3://${s3Configuration().bucket}/${key}`;
    throw new Error("ERR_ASSET_STORAGE_NOT_CONFIGURED");
}

function referenceKey(reference: string): string {
    let url: URL;
    try { url = new URL(reference); } catch { throw new Error("ERR_UNSAFE_ASSET_PATH"); }
    if (url.username || url.password || url.port || url.search || url.hash) throw new Error("ERR_UNSAFE_ASSET_PATH");
    const key = url.pathname.slice(1);
    assertObjectKey(key);
    if (objectStorageMode() === "vercel-blob") {
        if (url.origin !== blobConfiguration().origin) throw new Error("ERR_UNSAFE_ASSET_PATH");
    } else if (objectStorageMode() === "s3") {
        if (url.protocol !== "s3:" || url.hostname !== s3Configuration().bucket) throw new Error("ERR_UNSAFE_ASSET_PATH");
    } else throw new Error("ERR_ASSET_STORAGE_NOT_CONFIGURED");
    return key;
}

export function isStoredObjectReference(reference: string): boolean {
    return reference.startsWith("s3:") || /^https:\/\/[^/]+\.(?:private|public)\.blob\.vercel-storage\.com\//.test(reference);
}

export async function uploadObject(bytes: Buffer, key: string, mimeType: string, options: TransferOptions = {}): Promise<string> {
    const signal = transferSignal(options.signal);
    signal.throwIfAborted();
    assertObjectKey(key);
    const mime = detectMediaMime(bytes, mimeType);
    assertInputFileSize(bytes.length, mime);
    if (!key.endsWith(mediaExtension(mime)) || !key.includes(createHash("sha256").update(bytes).digest("hex"))) throw new Error("ERR_ASSET_CONTENT_CONFLICT");
    const mode = assertObjectStorageConfigured();
    try {
        if (mode === "vercel-blob") {
            const config = blobConfiguration();
            try {
                const result = await withAbort(put(key, bytes, { ...blobAuth(config), access: config.access, addRandomSuffix: false,
                    allowOverwrite: false, contentType: mime, abortSignal: signal }), signal);
                if (result.pathname.replace(/^\//, "") !== key || result.url !== objectReference(key)) throw new Error("ERR_VERCEL_BLOB_RESPONSE");
            } catch (error) {
                // Blob exposes duplicate writes through its base error rather
                // than a dedicated exists class. Reconcile an uncertain write
                // only if HEAD confirms the exact immutable content identity.
                if (!(error instanceof BlobError) || signal.aborted) throw error;
                const existing = await withAbort(head(objectReference(key), { ...blobAuth(config), abortSignal: signal }), signal);
                if (existing.size !== bytes.length || existing.contentType !== mime) throw new Error("ERR_ASSET_CONTENT_CONFLICT");
            }
        } else {
            const client = s3Client();
            try {
                await withAbort(client.send(new PutObjectCommand({ Bucket: s3Configuration().bucket, Key: key, Body: bytes,
                    ContentType: mime, CacheControl: "private,max-age=0,no-store", IfNoneMatch: "*" }), { abortSignal: signal }), signal);
            } catch (error) {
                // Identical content has an identical immutable key. Conditional writes
                // prevent overlapping/recovered workers from replacing an object.
                if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode !== 412) throw error;
                const existing = await withAbort(client.send(new HeadObjectCommand({ Bucket: s3Configuration().bucket, Key: key }), { abortSignal: signal }), signal);
                if (existing.ContentLength !== bytes.length || existing.ContentType !== mime) throw new Error("ERR_ASSET_CONTENT_CONFLICT");
            } finally { client.destroy(); }
        }
        signal.throwIfAborted();
        return objectReference(key);
    } catch (error) {
        if (signal.aborted) throw new Error("ERR_MEDIA_CANCELLED");
        if (error instanceof Error && /^ERR_[A-Z0-9_]+$/.test(error.message)) throw error;
        throw new Error(mode === "vercel-blob" ? "ERR_VERCEL_BLOB_UPLOAD" : "ERR_S3_UPLOAD");
    }
}

export async function storedObjectUrl(reference: string, options: TransferOptions & { providerReference?: boolean; attachment?: boolean } = {}): Promise<string> {
    const signal = transferSignal(options.signal);
    signal.throwIfAborted();
    const key = referenceKey(reference);
    const expiresIn = options.providerReference ? 86_400 : 900;
    try {
        if (objectStorageMode() === "vercel-blob") {
            const config = blobConfiguration();
            if (config.access === "public") {
                const url = new URL(reference);
                if (options.attachment) url.searchParams.set("download", "1");
                return url.toString();
            }
            const validUntil = Date.now() + expiresIn * 1_000;
            const token = await withAbort(issueSignedToken({ ...blobAuth(config), pathname: key, operations: ["get"], validUntil, abortSignal: signal }), signal);
            const result = await withAbort(presignUrl(token, { operation: "get", pathname: key, access: "private", validUntil }), signal);
            const url = new URL(result.presignedUrl);
            if (url.origin !== config.origin || url.pathname !== `/${key}`) throw new Error("ERR_VERCEL_BLOB_RESPONSE");
            // The CDN's documented download flag does not widen delegation scope.
            if (options.attachment) url.searchParams.set("download", "1");
            return url.toString();
        }
        const config = s3Configuration();
        if (config.access === "public" && !options.attachment) return `${config.publicOrigin}/${key}`;
        const client = s3Client();
        try {
            return await withAbort(getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key,
                ...(options.attachment ? { ResponseContentDisposition: `attachment; filename="${key.split("/").at(-1)}"` } : {}) }), { expiresIn }), signal);
        } finally { client.destroy(); }
    } catch (error) {
        if (signal.aborted) throw new Error("ERR_MEDIA_CANCELLED");
        if (error instanceof Error && /^ERR_[A-Z0-9_]+$/.test(error.message)) throw error;
        throw new Error("ERR_ASSET_UNAVAILABLE");
    }
}
