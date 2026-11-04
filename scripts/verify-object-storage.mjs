import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as blobSdk from "@vercel/blob";
import sharp from "sharp";
import { createModuleLoader } from "./test-module-loader.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jmO0AAAAASUVORK5CYII=", "base64");
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(24)]);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const { BlobError } = blobSdk;
const blobEnv = { ASSET_STORAGE_MODE: "vercel-blob", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_Synthetic123_fixture", VERCEL: "1" };
const blobOidcEnv = { ASSET_STORAGE_MODE: "vercel-blob", BLOB_STORE_ID: "store_Synthetic123", VERCEL: "1", VERCEL_OIDC_TOKEN: "synthetic-oidc-token" };
const s3Env = { ASSET_STORAGE_MODE: "s3", S3_BUCKET: "synthetic-media", S3_REGION: "us-east-1",
    S3_ACCESS_KEY_ID: "synthetic-key", S3_SECRET_ACCESS_KEY: "synthetic-secret", VERCEL: "1" };
const fixture = (media = "image", id = "synthetic") => ({ task_id: id, media_type: media, status: "COMPLETED", model_id: "synthetic", created_at: new Date(0).toISOString() });

function harness(env = blobEnv, options = {}) {
    const calls = { put: [], head: [], issue: [], presign: [], s3: [], get: [], destroy: 0 };
    class PutObjectCommand { constructor(input) { this.input = input; } }
    class HeadObjectCommand { constructor(input) { this.input = input; } }
    class GetObjectCommand { constructor(input) { this.input = input; } }
    class S3Client {
        constructor(config) { calls.config = config; }
        async send(command, request) {
            calls.s3.push({ command, request });
            if (options.stall) return new Promise(() => {});
            if (options.failure) throw new Error("synthetic-private-key-do-not-leak");
            if (options.duplicate && command instanceof PutObjectCommand) throw { $metadata: { httpStatusCode: 412 } };
            return { ContentLength: options.conflict ? 1 : png.length, ContentType: "image/png" };
        }
        destroy() { calls.destroy++; }
    }
    const origin = `https://synthetic123.${env.ASSET_DELIVERY_MODE ?? "private"}.blob.vercel-storage.com`;
    const loader = createModuleLoader({ env, mocks: {
        "node:fs/promises": { open() { throw new Error("Object storage must never touch local disk"); }, mkdir() { throw new Error("Object storage must never touch local disk"); } },
        "@vercel/blob": {
            BlobError,
            put: async (key, bytes, config) => {
                calls.put.push({ key, bytes, config });
                if (options.stall) return new Promise(() => {});
                if (options.failure) throw new Error("synthetic-private-key-do-not-leak");
                if (options.duplicate) throw new BlobError("synthetic duplicate or uncertain write");
                return { pathname: key, url: `${options.badOrigin ? "https://attacker.example" : origin}/${key}` };
            },
            head: async (...args) => { calls.head.push(args); return { size: options.conflict ? 1 : png.length, contentType: "image/png" }; },
            issueSignedToken: async config => { calls.issue.push(config); return { synthetic: true }; },
            presignUrl: async (token, config) => {
                calls.presign.push({ token, config });
                return { presignedUrl: `${origin}/${config.pathname}?synthetic-signature=${config.validUntil}` };
            },
        },
        "@aws-sdk/client-s3": { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand },
        "@aws-sdk/s3-request-presigner": { getSignedUrl: async (client, command, config) => {
            calls.get.push({ command, config });
            if (options.failure) throw new Error("synthetic-private-key-do-not-leak");
            return `https://synthetic-s3.example/${command.input.Key}?synthetic-signature=${config.expiresIn}${command.input.ResponseContentDisposition ? "&attachment=1" : ""}`;
        } },
        ...options.mocks,
    } });
    return { calls, loader, storage: loader.load("@/server/media/object-storage"), assets: loader.load("@/server/media/generated-assets"), source: loader.load("@/server/media/asset-source") };
}

test("Blob/S3 production configuration is explicit, private by default and validated before work", () => {
    for (const env of [blobEnv, blobOidcEnv, { ...blobOidcEnv, VERCEL_OIDC_TOKEN: undefined }, s3Env]) assert.equal(harness(env).assets.assertGeneratedStorageConfigured(), env.ASSET_STORAGE_MODE);
    assert.equal(harness({ ...blobEnv, BLOB_STORE_ID: "store_Synthetic123" }).storage.blobConfiguration().storeId, "synthetic123");
    for (const env of [
        { ASSET_STORAGE_MODE: "vercel-blob" }, { ...blobEnv, ASSET_DELIVERY_MODE: "invalid" },
        { ...s3Env, S3_BUCKET: "../escape" }, { ...s3Env, S3_SECRET_ACCESS_KEY: "" },
        { ...s3Env, S3_ENDPOINT: "http://127.0.0.1" }, { ...s3Env, S3_ENDPOINT: "https://user:pass@example.com" },
        { ...s3Env, ASSET_DELIVERY_MODE: "public" }, { ...s3Env, S3_FORCE_PATH_STYLE: "yes" },
    ]) assert.throws(() => harness(env).assets.assertGeneratedStorageConfigured(), /ERR_/);
});

test("Vercel Blob OIDC uses the connected store without requiring a static read-write token", async () => {
    const h = harness(blobOidcEnv); const task = fixture("image", "oidc");
    await h.assets.attachGeneratedAssets(task, [{ data: png, mimeType: "image/png" }]);
    assert.equal(h.calls.put[0].config.storeId, "Synthetic123");
    assert.equal(h.calls.put[0].config.token, undefined);
    await h.source.taskAssetResponse(task, 0, new Request("http://localhost/"), false);
    assert.equal(h.calls.issue.at(-1).storeId, "Synthetic123");
    assert.equal(h.calls.issue.at(-1).token, undefined);
});

test("private Blob outputs persist stable references, scoped signing happens only at read/reuse/download", async () => {
    const h = harness(); const task = fixture();
    await h.assets.attachGeneratedAssets(task, [{ data: png, mimeType: "image/png" }]);
    assert.equal(task.result_paths.length, 0);
    assert.equal(task.result_urls[0], `https://synthetic123.private.blob.vercel-storage.com/open-higgsfield/generated/synthetic/0_${digest(png)}.png`);
    assert.equal(h.calls.issue.length, 0);
    assert.equal(h.calls.put[0].config.access, "private");
    assert.equal(h.calls.put[0].config.allowOverwrite, false);
    assert.equal(h.calls.put[0].config.addRandomSuffix, false);
    assert.equal(h.calls.put[0].config.contentType, "image/png");
    const before = Date.now();
    const response = await h.source.taskAssetResponse(task, 0, new Request("http://localhost/"), false);
    assert.equal(response.status, 307); assert.match(response.headers.get("location"), /synthetic-signature/);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const delegation = h.calls.issue.at(-1);
    assert.deepEqual(Array.from(delegation.operations), ["get"]);
    assert.equal(delegation.pathname, h.calls.put[0].key);
    assert.ok(delegation.validUntil >= before + 900_000 && delegation.validUntil <= Date.now() + 900_000);
    const download = await h.source.taskAssetResponse(task, 0, new Request("http://localhost/"), true);
    assert.equal(new URL(download.headers.get("location")).searchParams.get("download"), "1");
    assert.ok(!download.headers.get("location").includes("fl_attachment"));
    const reuse = await h.source.reusableTaskAsset(task, 0);
    assert.ok(new URL(reuse.url).searchParams.has("synthetic-signature"));
    assert.ok(h.calls.issue.at(-1).validUntil >= before + 86_400_000);
    assert.ok(!JSON.stringify(task).includes("signature"));
    assert.ok(!JSON.stringify(task).includes(blobEnv.BLOB_READ_WRITE_TOKEN));
    const publicTask = h.loader.load("@/server/tasks/record").publicTask(task);
    assert.ok(!JSON.stringify(publicTask).includes("blob.vercel-storage.com"));
});

test("private S3 uses native commands, immutable writes, ranged CDN delivery and fresh signed reuse", async () => {
    const h = harness(s3Env); const task = fixture("video");
    const video = Buffer.concat([mp4, Buffer.alloc(5 * 1024 * 1024)]);
    await h.assets.attachGeneratedAssets(task, [{ data: video, mimeType: "video/mp4" }]);
    assert.equal(task.video_path, undefined); assert.match(task.video_urls[0], /^s3:\/\/synthetic-media\//);
    const upload = h.calls.s3[0];
    assert.equal(upload.command.input.IfNoneMatch, "*"); assert.equal(upload.command.input.ContentType, "video/mp4");
    assert.ok(upload.request.abortSignal);
    const response = await h.source.taskAssetResponse(task, 0, new Request("http://localhost/", { headers: { range: "bytes=0-999" } }), false);
    assert.equal(response.status, 307); assert.equal(response.body, null);
    assert.equal(h.calls.get.at(-1).config.expiresIn, 900);
    const attachment = await h.source.taskAssetResponse(task, 0, new Request("http://localhost/"), true);
    assert.ok(attachment.headers.get("location").includes("attachment=1"));
    assert.match(h.calls.get.at(-1).command.input.ResponseContentDisposition, /^attachment;/);
    await h.source.reusableTaskAsset(task, 0); assert.equal(h.calls.get.at(-1).config.expiresIn, 86_400);
    assert.equal(h.calls.destroy, 4);
});

test("output store, bucket, task, index, media and path isolation rejects before signing/network", async () => {
    for (const env of [blobEnv, s3Env]) {
        const h = harness(env); const task = fixture();
        await h.assets.attachGeneratedAssets(task, [{ data: png, mimeType: "image/png" }]);
        const ref = task.result_urls[0];
        for (const value of [ref.replace("synthetic-media", "another-bucket").replace("synthetic123", "anotherstore"),
            ref.replace("generated/synthetic/", "generated/other/"), ref.replace("/0_", "/1_"), ref.replace(".png", ".mp4"), `${ref}?injected=1`, `${ref}#fragment`]) {
            await assert.rejects(h.source.taskAssetSource({ ...task, result_urls: [value] }, 0), /ERR_(UNSAFE|INVALID)_ASSET/);
        }
        await assert.rejects(h.source.taskAssetSource({ ...task, gallery: { removed: [0] } }, 0), /ERR_ASSET_NOT_FOUND/);
        assert.equal(h.calls.get.length + h.calls.issue.length, 0);
    }
});

test("duplicate content is reused only with the expected size and MIME, no overwrites", async () => {
    for (const env of [blobEnv, s3Env]) {
        const h = harness(env, { duplicate: true });
        await h.assets.attachGeneratedAssets(fixture(), [{ data: png, mimeType: "image/png" }]);
        assert.equal(env === blobEnv ? h.calls.head.length : h.calls.s3.length, env === blobEnv ? 1 : 2);
        const conflict = harness(env, { duplicate: true, conflict: true });
        await assert.rejects(conflict.assets.attachGeneratedAssets(fixture(), [{ data: png, mimeType: "image/png" }]), /ERR_ASSET_CONTENT_CONFLICT/);
    }
});

test("failed and cancelled uploads never publish partial task outputs or leak credentials", async () => {
    for (const env of [blobEnv, s3Env]) {
        const failure = harness(env, { failure: true }); const task = fixture();
        await assert.rejects(failure.assets.attachGeneratedAssets(task, [{ data: png, mimeType: "image/png" }]), /^Error: ERR_(VERCEL_BLOB|S3)_UPLOAD$/);
        assert.equal(task.result_urls, undefined);
        const h = harness(env); const partial = fixture();
        await assert.rejects(h.assets.attachGeneratedAssets(partial, [{ data: png }, { data: Buffer.from("<html>"), mimeType: "image/png" }]));
        assert.equal(partial.result_urls, undefined);
        const stalled = harness(env, { stall: true }); const controller = new AbortController();
        const pending = stalled.assets.attachGeneratedAssets(fixture(), [{ data: png }], { signal: controller.signal });
        await new Promise(resolve => setImmediate(resolve)); controller.abort();
        await assert.rejects(pending, /ERR_MEDIA_CANCELLED/);
        const badIdentity = harness(blobEnv, { badOrigin: true });
        await assert.rejects(badIdentity.assets.attachGeneratedAssets(fixture(), [{ data: png }]), /ERR_VERCEL_BLOB_RESPONSE/);
    }
});

test("remote reference inputs use stable app URLs and fresh provider URLs without local disk", async () => {
    for (const env of [blobEnv, s3Env]) {
        const h = harness(env); const input = h.loader.load("@/server/media/input-upload");
        const result = await input.processFileUpload(mp4, "untrusted.exe", "video/mp4");
        assert.equal(result.localUrl, `/api/uploaded/${digest(mp4)}.mp4`);
        assert.match(result.remoteUrl, /^https:\/\//);
        const response = await h.source.uploadedAssetResponse(`${digest(mp4)}.mp4`, new Request("http://localhost/"));
        assert.equal(response.status, 307);
        await input.resolveUrl(result.localUrl);
        assert.equal(h.calls.put.length + h.calls.s3.length, 1);
        const decodable = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#c0ffee" } }).png().toBuffer();
        const image = await input.processImageUpload(decodable);
        assert.match(image.localUrl, /^\/api\/uploaded\/[a-f0-9]{64}\.jpg$/);
        const imageUpload = env === blobEnv ? h.calls.put.at(-1).config.contentType : h.calls.s3.at(-1).command.input.ContentType;
        assert.equal(imageUpload, "image/jpeg");
        await assert.rejects(input.resolveUrl("/api/uploaded/../../escape.mp4"), /ERR_UNSAFE_ASSET_PATH/);
        await assert.rejects(h.source.uploadedAssetResponse("arbitrary.mp4", new Request("http://localhost/")), /ERR_UNSAFE_ASSET_PATH/);
    }
});

test("actual media routes authenticate before reading tasks or issuing private links", async () => {
    const env = { ...blobEnv, NODE_ENV: "production", APP_ORIGIN: "https://studio.example.com",
        APP_ACCESS_USER: "synthetic", APP_ACCESS_PASSWORD: "synthetic-test-password-32-characters" };
    let reads = 0;
    const task = fixture();
    const h = harness(env, { mocks: { "@/server/tasks/store": { initStore: async () => {}, getTask: async () => { reads++; return task; } } } });
    await h.assets.attachGeneratedAssets(task, [{ data: png }]);
    const route = h.loader.load("src/app/api/download/[taskId]/route.ts");
    const uploadRoute = h.loader.load("src/app/api/uploaded/[filename]/route.ts");
    const request = authorized => {
        const value = new Request("https://studio.example.com/api/download/synthetic?index=0", {
            headers: authorized ? { Authorization: `Basic ${Buffer.from(`${env.APP_ACCESS_USER}:${env.APP_ACCESS_PASSWORD}`).toString("base64")}` } : {},
        });
        value.nextUrl = new URL(value.url); return value;
    };
    assert.equal((await route.GET(request(false), { params: Promise.resolve({ taskId: "synthetic" }) })).status, 401);
    assert.equal((await uploadRoute.GET(request(false), { params: Promise.resolve({ filename: `${digest(png)}.png` }) })).status, 401);
    assert.equal(reads, 0); assert.equal(h.calls.issue.length, 0);
    assert.equal((await route.GET(request(true), { params: Promise.resolve({ taskId: "synthetic" }) })).status, 307);
    assert.equal(reads, 1); assert.equal(h.calls.issue.length, 1);
});

test("public delivery requires explicit configuration and downloads keep native flags", async () => {
    const blob = harness({ ...blobEnv, ASSET_DELIVERY_MODE: "public" }); const task = fixture();
    await blob.assets.attachGeneratedAssets(task, [{ data: png }]);
    const response = await blob.source.taskAssetResponse(task, 0, new Request("http://localhost/"), true);
    assert.equal(new URL(response.headers.get("location")).searchParams.get("download"), "1"); assert.equal(blob.calls.issue.length, 0);
    const s3 = harness({ ...s3Env, ASSET_DELIVERY_MODE: "public", S3_PUBLIC_BASE_URL: "https://media.example.com" });
    const other = fixture(); await s3.assets.attachGeneratedAssets(other, [{ data: png }]);
    assert.match((await s3.source.reusableTaskAsset(other, 0)).url, /^https:\/\/media.example.com\/open-higgsfield\//);
    assert.equal(s3.calls.get.length, 0);
});

test("S3 real SDK signs scoped requests with synthetic credentials, no network calls", async () => {
    const loader = createModuleLoader({ env: s3Env }); const storage = loader.load("@/server/media/object-storage");
    const key = storage.inputObjectKey(png, "image/png");
    const url = new URL(await storage.storedObjectUrl(storage.objectReference(key), { attachment: true }));
    assert.equal(url.hostname, "synthetic-media.s3.us-east-1.amazonaws.com");
    assert.equal(url.pathname, `/${key}`); assert.equal(url.searchParams.get("X-Amz-Expires"), "900");
    assert.equal(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    assert.match(url.searchParams.get("response-content-disposition"), /^attachment;/);
});

test("Blob real SDK signs an exact private path using synthetic delegation, no network calls", async () => {
    const key = `open-higgsfield/inputs/${digest(png)}.png`;
    const validUntil = Date.now() + 86_400_000;
    const token = { clientSigningToken: "synthetic-signing-material-only", validUntil,
        delegationToken: `${Buffer.from(JSON.stringify({ storeId: "store_Synthetic123", pathname: key, operations: ["get"], validUntil })).toString("base64url")}.synthetic` };
    const loader = createModuleLoader({ env: blobEnv, mocks: {
        "@vercel/blob": { ...blobSdk, issueSignedToken: async () => token },
    } });
    const storage = loader.load("@/server/media/object-storage");
    const url = new URL(await storage.storedObjectUrl(storage.objectReference(key), { attachment: true }));
    assert.equal(url.hostname, "synthetic123.private.blob.vercel-storage.com");
    assert.equal(url.pathname, `/${key}`);
    assert.ok(url.searchParams.has("vercel-blob-signature"));
    assert.equal(url.searchParams.get("download"), "1");
    assert.ok(!url.toString().includes(blobEnv.BLOB_READ_WRITE_TOKEN));
    await assert.rejects(blobSdk.presignUrl(token, { operation: "get", pathname: `${key}.other`, access: "private" }), /does not match/);
});
