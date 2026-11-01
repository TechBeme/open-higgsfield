import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { createModuleLoader } from "./test-module-loader.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jmO0AAAAASUVORK5CYII=", "base64");
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(24)]);

function transferHarness(options = {}) {
    const state = { dns: 0, requests: 0, incoming: undefined, options: undefined };
    const get = (url, requestOptions, callback) => {
        state.requests++;
        state.url = url.toString();
        state.options = requestOptions;
        const request = new EventEmitter();
        const incoming = new PassThrough();
        state.incoming = incoming;
        incoming.statusCode = options.status ?? 200;
        incoming.headers = options.headers ?? { "content-type": "image/png" };
        const abort = () => { incoming.destroy(new Error("aborted")); request.emit("error", new Error("aborted")); };
        requestOptions.signal.addEventListener("abort", abort, { once: true });
        incoming.once("close", () => requestOptions.signal.removeEventListener("abort", abort));
        queueMicrotask(() => {
            callback(incoming);
            if (!options.stall) incoming.end(options.data ?? png);
        });
        return request;
    };
    const loader = createModuleLoader({
        env: options.env ?? {}, globals: options.globals ?? {},
        mocks: {
            "node:dns/promises": { lookup: async () => { state.dns++; return options.addresses ?? [{ address: "8.8.8.8", family: 4 }]; } },
            "node:https": { get }, "node:http": { get }, ...options.mocks,
        },
    });
    return { state, loader, transfer: loader.load("@/lib/media-transfer"), safe: loader.load("@/lib/safe-url") };
}

test("media GET connects only to checked DNS address while preserving hostname and rejecting redirects", async () => {
    const h = transferHarness();
    assert.deepEqual((await h.transfer.fetchRemoteMedia("https://media.example/image.png")).data, png);
    assert.equal(h.state.dns, 1);
    assert.equal(h.state.url, "https://media.example/image.png");
    h.state.options.lookup("media.example", {}, (error, address, family) => {
        assert.equal(error, null); assert.equal(address, "8.8.8.8"); assert.equal(family, 4);
    });
    h.state.options.lookup("media.example", { all: true }, (error, values) => {
        assert.equal(error, null); assert.equal(values[0].address, "8.8.8.8");
    });
    assert.equal(h.state.options.agent, false);
    assert.equal(h.state.options.headers.Authorization, undefined);
    const redirect = transferHarness({ status: 302 });
    await assert.rejects(redirect.transfer.fetchRemoteMedia("https://media.example/x"), /ERR_MEDIA_REDIRECT/);
    assert.equal(redirect.state.requests, 1); assert.ok(redirect.state.incoming.destroyed);
});

test("no-content media statuses reject through the caller and destroy the response", async () => {
    for (const status of [204, 205]) {
        const h = transferHarness({ status, headers: {}, data: Buffer.alloc(0) });
        await assert.rejects(h.transfer.fetchRemoteMedia("https://media.example/empty"), /ERR_EMPTY_MEDIA/);
        assert.equal(h.state.requests, 1);
        assert.ok(h.state.incoming.destroyed);
    }
    const empty = transferHarness({ data: Buffer.alloc(0) });
    await assert.rejects(empty.transfer.fetchRemoteMedia("https://media.example/empty"), /ERR_EMPTY_MEDIA/);
});

test("native callback header, stream and Response conversion failures reject safely with cleanup", async () => {
    for (const options of [
        { headers: { "content-type": "image/png\ninvalid: secret" } },
        { mocks: { "node:stream": { Readable: { toWeb() { throw new Error("synthetic conversion error"); } } } } },
        { globals: { Response: class { constructor() { throw new Error("synthetic response error"); } } } },
    ]) {
        const h = transferHarness(options);
        await assert.rejects(h.transfer.fetchRemoteMedia("https://media.example/image"), (error) => error.message === "ERR_MEDIA_DOWNLOAD");
        assert.ok(h.state.incoming.destroyed);
    }
});

test("private, reserved, mapped IPv6, credentialed and mixed-DNS destinations are rejected before GET", async () => {
    const h = transferHarness();
    for (const url of ["http://127.0.0.1/x", "http://2130706433/x", "http://[::1]/x", "http://[::ffff:127.0.0.1]/x",
        "http://[::ffff:7f00:1]/x", "http://[fc00::1]/x", "http://[fe80::1]/x", "http://[2001:db8::1]/x",
        "http://[2002:7f00:1::]/x", "http://169.254.169.254/x", "http://100.64.0.1/x", "http://192.0.2.2/x",
        "http://localhost/x", "http://name.internal/x", "https://user:pass@media.example/x", "https://media.example/x#fragment"]) {
        await assert.rejects(h.transfer.fetchRemoteMedia(url), /ERR_(UNSAFE|INVALID)_MEDIA_URL/);
    }
    assert.equal(h.state.requests, 0);
    assert.equal(h.safe.isPublicAddress("2606:4700::1111"), true);
    const mixed = transferHarness({ addresses: [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }] });
    await assert.rejects(mixed.transfer.fetchRemoteMedia("https://media.example/x"), /ERR_UNSAFE_MEDIA_URL/);
    assert.equal(mixed.state.requests, 0);
});

test("bounded body checks declared and chunked bytes and cancels oversized sources", async () => {
    const { transfer } = transferHarness();
    let cancelled = 0;
    const declared = new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "content-length": "17" } });
    await assert.rejects(transfer.readBoundedResponse(declared, { maxBytes: 16 }), /ERR_MEDIA_TOO_LARGE/);
    assert.equal(cancelled, 1);
    const chunked = new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(8)); controller.enqueue(new Uint8Array(9)); },
        cancel() { cancelled++; },
    }), { headers: { "content-length": "1" } });
    await assert.rejects(transfer.readBoundedResponse(chunked, { maxBytes: 16 }), /ERR_MEDIA_TOO_LARGE/);
    assert.equal(cancelled, 2);
    assert.equal(chunked.body.locked, false);
    assert.deepEqual(await transfer.readBoundedResponse(new Response(png), { maxBytes: png.length }), png);
});

test("stalled body abort and deadline release reader; native GET abort destroys stream and pre-abort does not dispatch", async () => {
    const { transfer } = transferHarness();
    let cancelled = 0;
    const source = new Response(new ReadableStream({ cancel() { cancelled++; } }));
    const controller = new AbortController();
    const pending = transfer.readBoundedResponse(source, { maxBytes: 100, signal: controller.signal });
    controller.abort(new Error("synthetic cancellation"));
    await assert.rejects(pending, /synthetic cancellation/);
    assert.equal(cancelled, 1); assert.equal(source.body.locked, false);
    const timeoutSource = new Response(new ReadableStream({ cancel() { cancelled++; } }));
    const keepalive = setTimeout(() => {}, 100);
    await assert.rejects(transfer.readBoundedResponse(timeoutSource, { maxBytes: 100, signal: AbortSignal.timeout(5) }));
    clearTimeout(keepalive);
    assert.equal(cancelled, 2); assert.equal(timeoutSource.body.locked, false);
    const preAborted = new AbortController(); preAborted.abort();
    const untouched = new Response(new ReadableStream({ cancel() { cancelled++; } }));
    await assert.rejects(transfer.readBoundedResponse(untouched, { maxBytes: 10, signal: preAborted.signal }));
    assert.equal(cancelled, 3); assert.equal(untouched.body.locked, false);
    const h = transferHarness({ stall: true });
    const abort = new AbortController();
    const native = h.transfer.fetchRemoteMedia("https://media.example/x", { signal: abort.signal });
    await new Promise((resolve) => setImmediate(resolve));
    abort.abort(); await assert.rejects(native);
    assert.ok(h.state.incoming.destroyed);
    const never = transferHarness();
    await assert.rejects(never.transfer.fetchRemoteMedia("https://media.example/x", { signal: abort.signal }));
    assert.equal(never.state.dns, 0); assert.equal(never.state.requests, 0);
});

test("MIME signatures and size limits reject active content and mismatches", () => {
    const { transfer } = transferHarness();
    assert.equal(transfer.detectMediaMime(png, "image/png; charset=binary"), "image/png");
    assert.equal(transfer.detectMediaMime(mp4, "video/mp4"), "video/mp4");
    assert.throws(() => transfer.detectMediaMime(Buffer.from("<svg>"), "image/svg+xml"), /ERR_UNSUPPORTED_MEDIA_TYPE/);
    assert.throws(() => transfer.detectMediaMime(png, "text/html"), /ERR_UNSUPPORTED_MEDIA_TYPE/);
    assert.throws(() => transfer.assertInputFileSize(20 * 1024 * 1024 + 1, "image/png"), /ERR_MEDIA_TOO_LARGE/);
    transfer.assertInputFileSize(64 * 1024 * 1024, "video/mp4");
    assert.throws(() => transfer.assertInputFileSize(NaN), /ERR_EMPTY_MEDIA/);
});

async function storageHarness(t, options = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "asset-storage-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const loader = createModuleLoader({ env: { OPEN_HIGGSFIELD_STORAGE_DIR: dir, ...options.env },
        globals: options.globals ?? {}, mocks: options.mocks ?? {} });
    return { dir, loader, upload: loader.load("@/lib/upload"), assets: loader.load("@/lib/generated-assets"), source: loader.load("@/lib/asset-source") };
}

const taskFixture = (id = "synthetic", media = "image") => ({ task_id: id, media_type: media,
    model_id: "synthetic", status: "COMPLETED", created_at: new Date(0).toISOString() });

function routeRequest(url, options) {
    const request = new Request(`http://localhost${url}`, options);
    request.nextUrl = new URL(request.url);
    return request;
}

test("immutable local assets preserve byte identity and attach only after all outputs finish", async (t) => {
    const h = await storageHarness(t);
    const task = taskFixture();
    await h.assets.attachGeneratedAssets(task, [{ data: png, mimeType: "image/png" }]);
    const original = task.result_paths[0];
    assert.equal(task.result_urls[0], "/api/download/synthetic?index=0");
    assert.equal(JSON.stringify(task).includes("data:"), false);
    assert.deepEqual(await fs.readFile(original), png);
    await h.assets.attachGeneratedAssets(task, [{ data: png, mimeType: "image/png" }]);
    assert.equal(task.result_paths[0], original);
    await h.assets.attachGeneratedAssets(task, [{ data: Buffer.concat([png, Buffer.from("different")]), mimeType: "image/png" }]);
    assert.notEqual(task.result_paths[0], original);
    assert.deepEqual(await fs.readFile(original), png);
    const incomplete = taskFixture("incomplete");
    await assert.rejects(h.assets.attachGeneratedAssets(incomplete, [{ data: png }, { data: Buffer.from("<html>"), mimeType: "image/png" }]));
    assert.equal(incomplete.result_paths, undefined); assert.equal(incomplete.result_urls, undefined);
    const files = await fs.readdir(path.join(h.dir, "downloads/images"));
    assert.equal(files.some((file) => file.endsWith(".tmp")), false);
    await assert.rejects(h.assets.attachGeneratedAssets(taskFixture("../escape"), [{ data: png }]));
    const video = taskFixture("video", "video");
    await h.assets.attachGeneratedAssets(video, [{ data: mp4, mimeType: "video/mp4" }]);
    assert.ok(video.video_path); assert.equal(video.video_urls[0], "/api/download/video?inline=1");
    assert.match(await h.upload.saveDownload("compatible", ".mp4", mp4), /compatible_0_[a-f0-9]{64}\.mp4$/);
});

test("Cloudinary signed native upload uses immutable public IDs and validates returned identity", async (t) => {
    const calls = [];
    const env = { ASSET_STORAGE_MODE: "cloudinary", ASSET_DELIVERY_MODE: "public", CLOUDINARY_CLOUD_NAME: "synthetic-cloud",
        CLOUDINARY_API_KEY: "synthetic-key", CLOUDINARY_API_SECRET: "synthetic-secret", DATABASE_URL: "synthetic-config-only" };
    const fake = async (url, options) => {
        calls.push({ url, options });
        const form = options.body;
        const publicId = form.get("public_id");
        const type = url.includes("/image/") ? "image" : "video";
        return Response.json({ public_id: publicId, resource_type: type, type: "upload", existing: calls.length > 1,
            secure_url: `https://res.cloudinary.com/synthetic-cloud/${type}/upload/v123/${publicId}.${type === "image" ? "png" : "mp4"}` });
    };
    const h = await storageHarness(t, { env, globals: { fetch: fake } });
    const task = taskFixture("cloud");
    await h.assets.attachGeneratedAssets(task, [{ data: png, mimeType: "image/png" }]);
    await h.assets.attachGeneratedAssets(task, [{ data: png, mimeType: "image/png" }]);
    assert.equal(task.result_paths.length, 0); assert.equal(task.result_urls[0].startsWith("https://res.cloudinary.com/"), true);
    assert.equal(JSON.stringify(task).includes("data:"), false);
    assert.equal(calls[0].options.body.get("public_id"), calls[1].options.body.get("public_id"));
    const form = calls[0].options.body;
    assert.equal(form.get("overwrite"), "false"); assert.equal(form.get("type"), "upload");
    assert.ok(form.get("public_id").endsWith(createHash("sha256").update(png).digest("hex")));
    const fields = ["overwrite", "public_id", "timestamp", "type"].map((key) => `${key}=${form.get(key)}`).join("&");
    assert.equal(form.get("signature"), createHash("sha256").update(fields + env.CLOUDINARY_API_SECRET).digest("hex"));
    assert.equal(calls[0].options.redirect, "error"); assert.ok(calls[0].options.signal);
    const response = await h.source.taskAssetResponse(task, 0, new Request("http://localhost/"), true);
    assert.equal(response.status, 307); assert.match(response.headers.get("location"), /\/upload\/fl_attachment:cloud\/v123\//);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const wrong = await storageHarness(t, { env, globals: { fetch: async () => Response.json({ public_id: "other", resource_type: "image", type: "upload", secure_url: "https://attacker.invalid/x" }) } });
    await assert.rejects(wrong.assets.attachGeneratedAssets(taskFixture(), [{ data: png }]), /ERR_CLOUDINARY_RESPONSE/);
});

test("production storage rejects ephemeral/distributed local and requires public delivery acknowledgement", () => {
    for (const env of [{ NODE_ENV: "production" }, { DATABASE_URL: "synthetic" }, { ASSET_STORAGE_MODE: "local", VERCEL: "1" },
        { NODE_ENV: "production", ASSET_STORAGE_MODE: "local" }, { ASSET_STORAGE_MODE: "cloudinary" },
        { ASSET_STORAGE_MODE: "cloudinary", ASSET_DELIVERY_MODE: "private" }]) {
        assert.throws(() => createModuleLoader({ env }).load("@/lib/generated-assets").assertGeneratedStorageConfigured());
    }
    assert.equal(createModuleLoader({ env: { NODE_ENV: "production", ASSET_STORAGE_MODE: "local", OPEN_HIGGSFIELD_STORAGE_DIR: "/tmp/synthetic-persistent" } })
        .load("@/lib/generated-assets").assertGeneratedStorageConfigured(), "local");
});

test("legacy data fallback works when a single attachment's local file is missing, including route indices", async (t) => {
    const state = { task: undefined };
    const h = await storageHarness(t, { mocks: { "@/lib/task-store": { initStore: async () => {}, getTask: async () => state.task } } });
    const task = { ...taskFixture("legacy"), result_paths: [path.join(h.dir, "downloads/images/missing.png")], result_urls: [`data:image/png;base64,${png.toString("base64")}`] };
    state.task = task;
    const route = h.loader.load("src/app/api/download/[taskId]/route.ts");
    const response = await route.GET(routeRequest("/api/download/legacy"), { params: Promise.resolve({ taskId: "legacy" }) });
    assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition"), /^attachment/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    for (const index of ["-1", "0.5", "NaN", "01", "1", "1e0"]) {
        const invalid = await route.GET(routeRequest(`/api/download/legacy?index=${index}`), { params: Promise.resolve({ taskId: "legacy" }) });
        assert.equal(invalid.status, 400);
    }
    task.result_urls.push(task.result_urls[0]);
    const multiple = await route.GET(routeRequest("/api/download/legacy"), { params: Promise.resolve({ taskId: "legacy" }) });
    assert.deepEqual(await multiple.json(), { urls: ["/api/download/legacy?index=0", "/api/download/legacy?index=1"] });
    task.result_urls = ["data:text/html;base64,PGh0bWw+"];
    await assert.rejects(h.source.taskAssetSource(task, 0), /ERR_UNSUPPORTED_MEDIA_TYPE/);
});

test("async video responses implement correct full/range/suffix/If-Range behavior and close handles on cancellation", async (t) => {
    const handles = [];
    const h = await storageHarness(t, { mocks: { "node:fs/promises": { ...fs, open: async (...args) => {
        const handle = await fs.open(...args); handles.push(handle); return handle;
    } } } });
    const task = taskFixture("range", "video");
    await h.assets.attachGeneratedAssets(task, [{ data: mp4 }]);
    for (const [range, start, end] of [["bytes=0-3", 0, 3], ["bytes=4-", 4, mp4.length - 1], ["bytes=-4", mp4.length - 4, mp4.length - 1],
        ["bytes=-999", 0, mp4.length - 1], [`bytes=2-${mp4.length}`, 2, mp4.length - 1]]) {
        const response = await h.source.taskAssetResponse(task, 0, new Request("http://localhost/", { headers: { range } }), false);
        assert.equal(response.status, 206); assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${mp4.length}`);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp4.subarray(start, end + 1));
    }
    for (const range of ["bytes=999-", "bytes=4-3", "bytes=-0", "bytes=99999999999999999999-"]) {
        const response = await h.source.taskAssetResponse(task, 0, new Request("http://localhost/", { headers: { range } }), false);
        assert.equal(response.status, 416); assert.equal(response.headers.get("content-range"), `bytes */${mp4.length}`);
    }
    for (const range of ["", "items=0-3", "bytes=0-1,3-4", "bytes=-", "bytes= 0-3"]) assert.throws(() => h.source.parseByteRange(range, 10), /ERR_INVALID_RANGE/);
    assert.throws(() => h.source.parseByteRange("bytes=0-", 0), /ERR_UNSATISFIABLE_RANGE/);
    const full = await h.source.taskAssetResponse(task, 0, new Request("http://localhost/", { headers: { range: "bytes=1-2", "if-range": "unmatched" } }), false);
    assert.equal(full.status, 200); assert.deepEqual(Buffer.from(await full.arrayBuffer()), mp4);
    const response = await h.source.taskAssetResponse(task, 0, new Request("http://localhost/"), false);
    await response.body.cancel();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(handles.every((handle) => handle.fd === -1));
});

test("local and uploaded streams retain the operation deadline through an unconsumed response", async (t) => {
    const h = await storageHarness(t);
    const large = Buffer.concat([png, Buffer.alloc(1024 * 1024)]);
    const task = taskFixture("deadline");
    await h.assets.attachGeneratedAssets(task, [{ data: large }]);
    const uploaded = await h.upload.saveInputLocally(large, ".png");
    const handles = [];
    const controls = [];
    const deadlines = [];
    const loader = createModuleLoader({
        env: { OPEN_HIGGSFIELD_STORAGE_DIR: h.dir },
        globals: { AbortSignal: class extends AbortSignal {
            static timeout(ms) {
                deadlines.push(ms);
                const control = new AbortController(); controls.push(control);
                return control.signal;
            }
        } },
        mocks: { "node:fs/promises": { ...fs, open: async (...args) => {
            const handle = await fs.open(...args); handles.push(handle); return handle;
        } } },
    });
    const source = loader.load("@/lib/asset-source");
    for (const getResponse of [
        () => source.taskAssetResponse(task, 0, new Request("http://localhost/"), false),
        () => source.uploadedAssetResponse(uploaded.split("/").at(-1), new Request("http://localhost/")),
    ]) {
        const before = controls.length;
        const response = await getResponse();
        assert.equal(controls.length - before, 1, "opening and streaming share one operation deadline");
        assert.equal(deadlines.at(-1), 60_000);
        setTimeout(() => controls.at(-1).abort(new DOMException("synthetic expiry", "TimeoutError")), 5);
        await new Promise((resolve) => setTimeout(resolve, 30));
        await assert.rejects(response.arrayBuffer());
        assert.equal(handles.at(-1).fd, -1, "unconsumed local stream closes its file on expiry");
    }
    const controller = new AbortController();
    const interrupted = await source.taskAssetResponse(task, 0, new Request("http://localhost/", { signal: controller.signal }), false);
    controller.abort(); await assert.rejects(interrupted.arrayBuffer());
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(handles.every((handle) => handle.fd === -1));
    await assert.rejects(source.taskAssetResponse(task, 0, new Request("http://localhost/", { headers: { range: "bytes=invalid" } }), false));
    assert.ok(handles.every((handle) => handle.fd === -1), "early range errors close the opened file");
});

test("expiry while local open is pending closes a late descriptor", async (t) => {
    const h = await storageHarness(t);
    const uploaded = await h.upload.saveInputLocally(png, ".png");
    const handles = [];
    const control = new AbortController();
    let started;
    const opening = new Promise((resolve) => { started = resolve; });
    let finishOpen;
    const release = new Promise((resolve) => { finishOpen = resolve; });
    const loader = createModuleLoader({ env: { OPEN_HIGGSFIELD_STORAGE_DIR: h.dir }, mocks: {
        "node:fs/promises": { ...fs, open: async (...args) => {
            started(); await release;
            const handle = await fs.open(...args); handles.push(handle); return handle;
        } },
    } });
    const pending = loader.load("@/lib/upload").openLocalMedia(path.join(h.dir, "uploads", uploaded.split("/").at(-1)), path.join(h.dir, "uploads"), { signal: control.signal });
    await opening;
    control.abort(); await assert.rejects(pending);
    finishOpen();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(handles.length, 1); assert.equal(handles[0].fd, -1);
});

test("UI attachment URLs retain the image index and request attachment delivery for image and video previews", async (t) => {
    const state = { task: undefined };
    const h = await storageHarness(t, { mocks: { "@/lib/task-store": { initStore: async () => {}, getTask: async () => state.task } } });
    const { attachmentUrl } = h.loader.load("@/lib/download-url");
    const route = h.loader.load("src/app/api/download/[taskId]/route.ts");
    for (const media of ["image", "video"]) {
        const id = `attachment-${media}`;
        const url = `https://res.cloudinary.com/synthetic/${media}/upload/v1/open-higgsfield/generated/${id}/0_${"a".repeat(64)}.${media === "image" ? "png" : "mp4"}`;
        state.task = { ...taskFixture(id, media), ...(media === "image" ? { result_urls: [url] } : { video_urls: [url] }) };
        const preview = `/api/download/${id}?${media === "image" ? "index=0" : "inline=1"}`;
        const previewResponse = await route.GET(routeRequest(preview), { params: Promise.resolve({ taskId: id }) });
        assert.equal(previewResponse.headers.get("location").includes("fl_attachment"), false);
        const href = attachmentUrl(preview);
        assert.equal(new URL(href, "http://localhost").searchParams.get("download"), "1");
        assert.equal(new URL(href, "http://localhost").searchParams.has("inline"), false);
        const downloaded = await route.GET(routeRequest(href), { params: Promise.resolve({ taskId: id }) });
        assert.equal(downloaded.status, 307);
        assert.equal(downloaded.headers.get("location").includes(`/fl_attachment:${id}/`), true);
    }
    assert.equal(attachmentUrl("/api/download/task?index=3&inline=1"), "/api/download/task?index=3&download=1");
    assert.equal(attachmentUrl("/api/download/task?index=3&download=1"), "/api/download/task?index=3&download=1");
});

test("uploaded route rejects traversal, symlinks and legacy active content while serving bounded safe files", async (t) => {
    const h = await storageHarness(t);
    const local = await h.upload.saveInputLocally(png, ".png");
    const filename = local.split("/").at(-1);
    const route = h.loader.load("src/app/api/uploaded/[filename]/route.ts");
    const safe = await route.GET(routeRequest(local), { params: Promise.resolve({ filename }) });
    assert.equal(safe.status, 200); assert.deepEqual(Buffer.from(await safe.arrayBuffer()), png);
    assert.equal(safe.headers.get("cache-control"), "private, no-store");
    for (const name of ["../secret.png", "nested/file.png", "secret.html"]) {
        if (name === "secret.html") await fs.writeFile(path.join(h.dir, "uploads", name), "<html>secret</html>");
        const response = await route.GET(routeRequest("/api/uploaded/x"), { params: Promise.resolve({ filename: name }) });
        assert.equal(response.status, 400);
    }
    const outside = path.join(h.dir, "outside.png"); await fs.writeFile(outside, png);
    await fs.symlink(outside, path.join(h.dir, "uploads/link.png"));
    const symlink = await route.GET(routeRequest("/api/uploaded/link.png"), { params: Promise.resolve({ filename: "link.png" }) });
    assert.equal(symlink.status, 400);
});

test("Vercel legacy full responses fail before emission above 4 MiB, while local full and small ranges work", async (t) => {
    const large = Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]);
    const local = await storageHarness(t);
    const task = taskFixture("large");
    await local.assets.attachGeneratedAssets(task, [{ data: large }]);
    const localResponse = await local.source.taskAssetResponse(task, 0, new Request("http://localhost/"), false);
    assert.equal((await localResponse.arrayBuffer()).byteLength, large.length);
    const serverless = createModuleLoader({ env: { OPEN_HIGGSFIELD_STORAGE_DIR: local.dir, VERCEL: "1" } }).load("@/lib/asset-source");
    await assert.rejects(serverless.taskAssetResponse(task, 0, new Request("http://localhost/"), false), /ERR_LEGACY_ASSET_REQUIRES_MIGRATION/);
    const slice = await serverless.taskAssetResponse(task, 0, new Request("http://localhost/", { headers: { range: "bytes=0-10" } }), false);
    assert.equal(slice.status, 206); assert.equal((await slice.arrayBuffer()).byteLength, 11);
    const inline = { ...taskFixture("inline"), result_urls: [`data:image/png;base64,${large.toString("base64")}`] };
    await assert.rejects(serverless.taskAssetResponse(inline, 0, new Request("http://localhost/"), false), /ERR_LEGACY_ASSET_REQUIRES_MIGRATION/);
    const remote = transferHarness({ env: { VERCEL: "1" }, data: large });
    const source = remote.loader.load("@/lib/asset-source");
    await assert.rejects(source.taskAssetResponse({ ...taskFixture(), result_urls: ["https://media.example/legacy.png"] }, 0, new Request("http://localhost/"), false), /ERR_LEGACY_ASSET_REQUIRES_MIGRATION/);
    assert.ok(remote.state.incoming.destroyed);
});

test("gallery accepts strict index and returns an application reference without self-fetch or local paths", async (t) => {
    const task = { ...taskFixture("gallery"), result_urls: [`data:image/png;base64,${png.toString("base64")}`] };
    const h = await storageHarness(t, { mocks: { "@/lib/task-store": { initStore: async () => {}, getTask: async () => task } } });
    const route = h.loader.load("src/app/api/save-to-gallery/route.ts");
    const request = (value) => routeRequest("/api/save-to-gallery", { method: "POST", body: JSON.stringify(value), headers: { "content-type": "application/json", origin: "http://localhost" } });
    const result = await route.POST(request({ task_id: "gallery" }));
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { saved: true, url: "/api/download/gallery?index=0" });
    for (const image_index of [0.5, -1, "0", null]) assert.equal((await route.POST(request({ task_id: "gallery", image_index }))).status, 400);
    assert.equal((await route.POST(request({ task_id: "../escape" }))).status, 400);
    assert.equal((await route.POST(request({ task_id: "gallery", padding: "x".repeat(17_000) }))).status, 413);
});

test("Sharp rejects excessive compressed dimensions and malformed metadata before JPEG conversion", async () => {
    const huge = Buffer.from(png);
    huge.writeUInt32BE(40_000_001, 16); huge.writeUInt32BE(1, 20);
    let crc = 0xffffffff;
    for (const byte of huge.subarray(12, 29)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    huge.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
    const real = createModuleLoader().load("@/lib/media-upload");
    await assert.rejects(real.toJpeg(huge), /pixel|limit/i);
    let converted = false;
    let metadata;
    const fake = createModuleLoader({ mocks: { sharp: () => ({
        metadata: async () => metadata,
        jpeg() { converted = true; return this; }, destroy() {},
    }) } }).load("@/lib/media-upload");
    for (metadata of [{ width: undefined, height: 2 }, { width: -1, height: 2 }, { width: 1, height: 1, pages: NaN },
        { width: 1, height: 1, pages: 0 }, { width: 10_000, height: 4_000, pages: 2 }]) {
        await assert.rejects(fake.toJpeg(png), /ERR_IMAGE_PIXEL_LIMIT/);
    }
    assert.equal(converted, false);
});
