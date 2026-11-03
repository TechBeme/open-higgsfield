import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import Ajv2020 from "ajv/dist/2020.js";
import { createModuleLoader } from "./test-module-loader.mjs";

const taskId = "11111111-1111-4111-8111-111111111111";
const key = "synthetic-runware-key-never-persist";
const image = "https://im.runware.ai/synthetic-image.png";
const video = "https://vm.runware.ai/synthetic-video.mp4";
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(fetcher) {
    const calls = [];
    const modules = createModuleLoader({ env: { RUNWARE_API_KEY: key }, globals: { fetch: async (url, init) => {
        const task = JSON.parse(init.body)[0]; calls.push({ url: String(url), ...init, task });
        return fetcher ? fetcher(task, calls.at(-1), calls.length) : Response.json({ data: [{ taskType: task.taskType, taskUUID: task.taskUUID }] });
    } } });
    const catalog = modules.load("@/server/catalog/runware");
    const providerModule = modules.load("@/server/providers/runware");
    return { modules, calls, ...catalog, ...providerModule, provider: new providerModule.RunwareProvider() };
}
function request(f, slug = "openai-gpt-image-2", fields = {}, media = {}) {
    const modelId = `runware__${slug}`, contract = f.RUNWARE_CONTRACTS[modelId];
    return { clientTaskId: taskId, modelId, providerModelId: contract.air, mediaType: contract.mediaType,
        capabilities: f.runwareCapabilities(modelId, contract), params: { prompt: "A paper boat on a still blue lake at sunrise", field_values: fields }, media };
}
const operation = (mediaType = "image", expectedResults = 1) => ({ version: 1, taskUUID: taskId, model: mediaType === "image" ? "openai:gpt-image@2" : "google:3@2", mediaType, expectedResults });
const poll = (mediaType = "image", expectedResults = 1) => ({ mediaType, providerModelId: operation(mediaType).model, operation: operation(mediaType, expectedResults) });
const catalogFixture = fixture();

test("Runware includes every live callable image/video model in the official index snapshot (191 images / 110 videos)", () => {
    const f = catalogFixture;
    assert.equal(Object.keys(f.RUNWARE_IMAGE_CAPABILITIES).length, 191);
    assert.equal(Object.keys(f.RUNWARE_VIDEO_CAPABILITIES).length, 110);
    assert.equal(new Set(Object.values(f.RUNWARE_CONTRACTS).map(c => `${c.mediaType}:${c.air}`)).size, 301);
    const definitions = f.modules.load("@/providers/definitions");
    assert.deepEqual(plain(definitions.getProviderDefinition("runware").envKeys), ["RUNWARE_API_KEY"]);
    assert.equal(f.modules.load("@/server/providers/registry").getProvider("runware").id, "runware");
    assert.match(readFileSync(new URL("../public/providers/runware.svg", import.meta.url), "utf8"), /#afff9f/);
});

test("every Runware model has a compilable official schema and a valid editable custom alias", () => {
    const f = catalogFixture;
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const [id, contract] of Object.entries(f.RUNWARE_CONTRACTS)) {
        assert.match(contract.source, /^https:\/\/runware\.ai\/docs\/models\//);
        assert.match(contract.schemaSha256, /^[a-f0-9]{64}$/);
        assert.equal(contract.operation, contract.schema.properties.taskType.const, id);
        assert.equal(contract.air, contract.schema.properties.model.const, id);
        assert.equal(typeof ajv.compile(contract.schema), "function", id);
        const alias = f.runwareCapabilities(`custom_${id}`, contract);
        assert.doesNotThrow(() => f.modules.load("@/server/catalog/custom-validation").assertCustomModelCapabilities(alias, contract.mediaType), id);
    }
});

// Text-to-image smoke fixtures for the twelve requested models. Reference-only
// editors and utilities are not assumed to accept an empty media payload.
for (const slug of ["xai-grok-imagine-image-2-0", "krea-2-turbo", "alibaba-z-image-turbo", "google-nano-banana-2", "google-nano-banana-2-1", "google-nano-banana-pro",
    "prunaai-p-image-ideogram", "openai-gpt-image-2-5-flare", "openai-gpt-image-2-5-sunburst", "meta-muse-image", "klingai-image-3-0", "klingai-image-o1"]) {
    test(`${slug}: requested model defaults and aliases build valid API requests without paid generation`, () => {
        const f = catalogFixture, req = request(f, slug), contract = f.RUNWARE_CONTRACTS[req.modelId];
        const task = f.buildRunwareRequest(req);
        const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(contract.schema);
        assert.equal(validate(task), true, JSON.stringify(validate.errors));
        assert.equal(task.deliveryMethod, "async"); assert.equal(task.outputType, "URL"); assert.equal(task.model, contract.air);
        assert.equal(task.numberResults, 1); assert.equal(task.taskUUID, taskId);
        const alias = f.runwareCapabilities(`custom_${req.modelId}`, contract);
        assert.deepEqual(plain(f.buildRunwareRequest({ ...req, modelId: alias.id, capabilities: alias })), plain(task));
    });
}

test("image/video utilities use their documented operation and result URL without inference-only fields", async () => {
    for (const [slug, fields, slots, taskType, output] of [
        ["bfl-flux-3-upscaler", {}, { video: [video] }, "upscale", "videoURL"],
        ["real-esrgan", { upscaleFactor: 2 }, { image: [image] }, "upscale", "imageURL"],
        ["bria-rmbg-v2-0", {}, { image: [image] }, "removeBackground", "imageURL"],
        ["controlnet-preprocess-canny", {}, { image: [image] }, "controlNetPreprocess", "guideImageURL"],
        ["mediapipe-face-full", {}, { image: [image] }, "imageMasking", "maskImageURL"],
        ["recraft-v4-vector", {}, {}, "vectorize", "imageURL"],
    ]) {
        let submitted;
        const f = fixture(task => {
            if (task.taskType !== "getResponse") { submitted = task; return Response.json({ data: [{ taskType, taskUUID: taskId }] }); }
            return Response.json({ data: [{ taskType, taskUUID: taskId, status: "success", [output]: taskType === "upscale" && output === "videoURL" ? video : image }] });
        });
        const req = request(f, slug, fields, { slots });
        const accepted = await f.provider.submit(req);
        assert.equal(submitted.taskType, taskType, slug);
        assert.equal(submitted.numberResults, undefined, slug);
        if (!req.capabilities.prompt_supported) assert.equal(submitted.positivePrompt, undefined, slug);
        assert.equal(accepted.operation.expectedResults, 1);
        const result = await f.provider.poll({ mediaType: req.mediaType, providerModelId: req.providerModelId, operation: accepted.operation });
        assert.equal(result.status, "COMPLETED", slug);
        assert.equal(result.assets.length, 1, slug);
        assert.equal(result.assets[0].mimeType, taskType === "vectorize" ? "image/svg+xml" : undefined);
    }
});

test("vector output becomes inert PNG and rejects entities, include directives, excessive pixels and cancellation", async () => {
    const f = catalogFixture.modules.load("@/server/media/vector-output");
    const signal = AbortSignal.timeout(10000);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#afff9f"/><script>alert(1)</script></svg>');
    const png = await f.rasterizeVectorOutput(svg, signal);
    assert.equal(catalogFixture.modules.load("@/server/media/transfer").detectMediaMime(png), "image/png");
    for (const value of [
        '<!DOCTYPE svg [<!ENTITY x "test">]><svg/>',
        '<svg><xi:include href="file:///tmp/synthetic"/></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"/>',
        'not an SVG',
    ]) await assert.rejects(f.rasterizeVectorOutput(Buffer.from(value), signal));
    await assert.rejects(f.rasterizeVectorOutput(svg, AbortSignal.abort()), error => error.name === "AbortError");
});

test("native nested parameters, media slots, ordered frame positions and output size survive mapping", () => {
    const f = fixture();
    const req = request(f, "google-veo-3-1", { duration: 8, resolution: "1080p", "providerSettings.google.generateAudio": false }, { slots: { frameImages: [image, "https://media.example.test/last.png"] } });
    const task = f.buildRunwareRequest(req);
    assert.deepEqual(plain(task.inputs), { frameImages: [image, "https://media.example.test/last.png"] });
    assert.deepEqual(plain(task.providerSettings), { google: { generateAudio: false } });
    assert.equal(task.width, undefined); assert.equal(task.height, undefined); assert.equal(task.resolution, "1080p");
    const timed = f.buildRunwareRequest(request(f, "google-veo-3-1", { duration: 8, "inputs.frameImages": [{ image, frame: "first" }] }));
    assert.deepEqual(plain(timed.inputs.frameImages), [{ image, frame: "first" }]);
    const sized = f.buildRunwareRequest(request(f, "google-nano-banana-2-1", { output_size: "1024x1024", "settings.webSearch": false }));
    assert.equal(sized.width, 1024); assert.equal(sized.height, 1024); assert.equal(sized.settings.webSearch, false);
});

test("documented numeric duration defaults remain explicit and optional expansion modes do not invalidate disabled expansion", () => {
    const f = fixture();
    const seedance = request(f, "bytedance-seedance-2-5");
    assert.equal(f.buildRunwareRequest(seedance).duration, 5);
    assert.equal(f.buildRunwareRequest(request(f, "bytedance-seedance-2-5", { duration: "auto" })).duration, "auto");
    const qwen = f.buildRunwareRequest(request(f, "alibaba-qwen-image-3-0-pro", { "settings.promptExtend": false }));
    assert.equal(qwen.settings.promptExtend, false);
    assert.equal(qwen.settings.promptExtendMode, undefined);
    const explicit = f.buildRunwareRequest(request(f, "alibaba-qwen-image-3-0-pro", { "settings.promptExtendMode": "direct" }));
    assert.equal(explicit.settings.promptExtendMode, "direct");
    assert.throws(() => f.buildRunwareRequest(request(f, "alibaba-qwen-image-3-0-pro", { "settings.promptExtend": false, "settings.promptExtendMode": "direct" })), /ERR_RUNWARE_INVALID_PARAMS/);
});

test("invalid conditional combinations, pixel multiples, area/ratio/count limits and protected fields never dispatch", async () => {
    const f = fixture();
    const bad = [
        request(f, "google-veo-3-1", { output_size: "1280x720" }, { slots: { frameImages: [image] } }),
        request(f, "google-veo-3-1", { duration: 4 }, { slots: { referenceImages: [image] } }),
        request(f, "openai-gpt-image-2", { width: 1001, height: 1024 }),
        request(f, "openai-gpt-image-2", { width: 16, height: 16 }),
        request(f, "openai-gpt-image-2", { width: 3840, height: 1024 * 3 }),
        request(f, "openai-gpt-image-2", {}, { slots: { maskImage: [image] } }),
        request(f, "openai-gpt-image-2", { numberResults: 17 }),
        request(f, "google-veo-3-1", { numberResults: 2 }),
        request(f, "google-veo-3-1", { "inputs.frameImages": [image] }, { slots: { frameImages: [image] } }),
        request(f, "openai-gpt-image-2", {}, { slots: { unexpected: [image] } }),
        ...["webhookURL", "uploadEndpoint", "taskUUID", "model", "deliveryMethod", "outputType", "ttl", "routing", "__proto__"].map(field => request(f, "openai-gpt-image-2", JSON.parse(`{"${field}":"unexpected"}`))),
    ];
    for (const req of bad) await assert.rejects(f.provider.submit(req), error => error.message === "ERR_RUNWARE_INVALID_PARAMS" && !error.submissionUncertain);
    assert.equal(f.calls.length, 0);
});

test("multiple keys and environment credentials never mix; operation carries only durable query identity", async () => {
    const f = fixture();
    const req = request(f);
    const connection = { id: "conn_test", providerId: "runware", secret: "synthetic-saved-key", metadata: {} };
    const accepted = await f.provider.submit({ ...req, connection });
    assert.equal(f.calls[0].url, "https://api.runware.ai/v1"); assert.equal(f.calls[0].method, "POST");
    assert.equal(f.calls[0].headers.Authorization, "Bearer synthetic-saved-key"); assert.equal(f.calls[0].redirect, "error");
    assert.deepEqual(plain(accepted.operation), operation()); assert.equal(accepted.providerTaskId, taskId);
    assert.ok(!JSON.stringify(accepted).includes("synthetic")); assert.ok(!JSON.stringify(accepted).includes(req.params.prompt));
    await assert.rejects(f.provider.submit({ ...req, connection: { ...connection, secret: undefined } }), /ERR_PROVIDER_CONNECTION_NOT_CONFIGURED/);
    await assert.rejects(f.provider.submit({ ...req, connection: { ...connection, providerId: "toapis" } }), /ERR_PROVIDER_CONNECTION_PROVIDER_MISMATCH/);
    assert.equal(f.calls.length, 1);
});

test("async image and video polling is a read-only POST and waits for all image outputs", async () => {
    for (const mediaType of ["image", "video"]) {
        let count = 0;
        const f = fixture(task => { count++; return Response.json({ data: [{ taskType: `${mediaType}Inference`, taskUUID: task.taskUUID,
            ...(count === 1 ? { status: "processing" } : { status: "success", [mediaType === "image" ? "imageURL" : "videoURL"]: mediaType === "image" ? image : video }) }] }); });
        assert.equal((await f.provider.poll(poll(mediaType))).status, "IN_PROGRESS");
        assert.equal((await f.provider.poll(poll(mediaType))).status, "COMPLETED");
        assert.ok(f.calls.every(call => call.task.taskType === "getResponse"));
    }
    let complete = false;
    const f = fixture(() => Response.json({ data: [
        { taskType: "imageInference", taskUUID: taskId, status: "success", imageURL: image },
        ...(complete ? [{ taskType: "imageInference", taskUUID: taskId, status: "success", imageURL: image.replace("image", "image-2") }] : []),
    ] }));
    assert.equal((await f.provider.poll(poll("image", 2))).status, "IN_PROGRESS");
    complete = true; assert.equal((await f.provider.poll(poll("image", 2))).assets.length, 2);
});

test("HTTP, transport and malformed responses preserve submission uncertainty without automatic paid retries", async () => {
    for (const scenario of ["503", "429", "401", "network", "malformed", "mismatch"]) {
        const f = fixture(() => {
            if (scenario === "network") throw new TypeError(key);
            if (scenario === "malformed") return Response.json({});
            if (scenario === "mismatch") return Response.json({ data: [{ taskType: "imageInference", taskUUID: "22222222-2222-4222-8222-222222222222", imageURL: image }] });
            return Response.json({ errors: [{ message: key }] }, { status: Number(scenario), headers: { "retry-after": "60" } });
        });
        await assert.rejects(f.provider.submit(request(f)), error => {
            assert.equal(error.submissionUncertain, ["503", "network", "malformed", "mismatch"].includes(scenario));
            assert.equal(error.retryable, false); assert.ok(!JSON.stringify(error).includes(key)); return true;
        });
        assert.equal(f.calls.length, 1);
    }
    const f = fixture(() => Response.json({}, { status: 429, headers: { "retry-after": "17" } }));
    await assert.rejects(f.provider.poll(poll()), error => error.retryable && error.retryAfterMs === 17000 && !error.submissionUncertain);
});

test("200 error envelopes and partial failures do not become successful generations or leaked diagnostics", async () => {
    for (const phase of ["submit", "poll"]) {
        const f = fixture(() => Response.json({ errors: [{ taskUUID: taskId, status: "error", code: "timeoutProvider", message: key }] }));
        if (phase === "submit") await assert.rejects(f.provider.submit(request(f)), /ERR_RUNWARE_REJECTED/);
        else assert.equal((await f.provider.poll(poll())).error, "ERR_RUNWARE_TASK_FAILED");
    }
    const partial = fixture(() => Response.json({ data: [{ taskType: "imageInference", taskUUID: taskId, status: "success", imageURL: image }], errors: [{ taskUUID: taskId, status: "error", code: "timeoutProvider" }] }));
    await assert.rejects(partial.provider.poll(poll("image", 2)), error => error.code === "ERR_RUNWARE_PARTIAL_RESULT" && !error.retryable);
    let processing = true;
    const mixed = fixture(() => Response.json({
        data: [{ taskType: "imageInference", taskUUID: taskId, ...(processing ? { status: "processing" } : { status: "success", imageURL: image }) }],
        errors: [{ taskUUID: taskId, status: "error", code: "timeoutProvider" }],
    }));
    assert.equal((await mixed.provider.poll(poll("image", 2))).status, "IN_PROGRESS");
    processing = false;
    await assert.rejects(mixed.provider.poll(poll("image", 2)), error => error.code === "ERR_RUNWARE_PARTIAL_RESULT" && !error.retryable);
    assert.ok(mixed.calls.every(call => call.task.taskType === "getResponse"));
    for (const row of [
        { taskType: "imageInference", taskUUID: taskId, status: "success", imageURL: image },
        { taskType: "imageInference", taskUUID: taskId },
    ]) {
        const accepted = fixture(() => Response.json({ data: [row], errors: [{ taskUUID: taskId, code: "serviceOverloaded", retryAfter: 25 }] }));
        await assert.rejects(accepted.provider.submit(request(accepted, "openai-gpt-image-2", { numberResults: 2 })),
            error => error.code === "ERR_RUNWARE_PARTIAL_RESULT" && error.submissionUncertain && !error.retryable);
        await assert.rejects(accepted.provider.poll(poll("image", 2)), error => error.code === "ERR_RUNWARE_PARTIAL_RESULT" && !error.retryable);
        assert.equal(accepted.calls.filter(call => call.task.taskType === "imageInference").length, 1);
    }
    const auth = fixture(() => Response.json({ errors: [{ code: "invalidApiKey", message: key }] }));
    await assert.rejects(auth.provider.poll(poll()), /ERR_RUNWARE_POLL_FAILED/);
    const busy = fixture(() => Response.json({ errors: [{ code: "serviceOverloaded", taskUUID: taskId, retryAfter: 25 }] }));
    await assert.rejects(busy.provider.poll(poll()), error => error.retryable && error.retryAfterMs === 25000);
});

test("malformed operations, UUIDs and output URLs cannot redirect requests or produce completed tasks", async () => {
    const f = fixture();
    for (const change of [{ version: 2 }, { taskUUID: "https://evil.test" }, { mediaType: "video" }, { model: "anything" }, { expectedResults: 99 }]) {
        await assert.rejects(f.provider.poll({ ...poll(), operation: { ...operation(), ...change } }), /ERR_RUNWARE_OPERATION/);
    }
    await assert.rejects(f.provider.submit({ ...request(f), clientTaskId: "not-a-uuid" }), /ERR_RUNWARE_TASK_ID/);
    assert.equal(f.calls.length, 0);
    for (const url of ["http://127.0.0.1/output", "https://user:secret@runware.ai/output", "data:image/png;base64,AQ=="]) {
        const bad = fixture(() => Response.json({ data: [{ taskType: "imageInference", taskUUID: taskId, status: "success", imageURL: url }] }));
        await assert.rejects(bad.provider.poll(poll()), /ERR_RUNWARE_RESPONSE/);
    }
});

test("abort propagates to REST; oversized and stalled response bodies are bounded", async () => {
    const controller = new AbortController(); controller.abort();
    const pre = fixture(); await assert.rejects(pre.provider.submit({ ...request(pre), signal: controller.signal }), error => !error.submissionUncertain);
    assert.equal(pre.calls.length, 0);
    let canceled = false;
    const over = fixture(() => new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { "content-length": String(4 * 1024 * 1024 + 1) } }));
    await assert.rejects(over.provider.poll(poll()), /ERR_RUNWARE_RESPONSE/); assert.equal(canceled, true);
    const abort = new AbortController();
    const stalled = fixture((_task, call) => new Promise((_, reject) => {
        call.signal.addEventListener("abort", () => reject(call.signal.reason), { once: true }); queueMicrotask(() => abort.abort());
    }));
    await assert.rejects(stalled.provider.submit({ ...request(stalled), signal: abort.signal }), error => error.submissionUncertain && !error.retryable);
    assert.equal(stalled.calls.length, 1);
});

test("discovery pages official checkpoints, preserves AIR IDs and filters unsupported modalities", async () => {
    const f = fixture(task => {
        assert.equal(task.taskType, "modelSearch"); assert.equal(task.source, "official"); assert.equal(task.category, "checkpoint");
        const results = Array.from({ length: task.offset === 0 ? 100 : 1 }, (_, i) => ({ air: `vendor:model@${task.offset + i}`, name: `Model ${i}`, category: "checkpoint", capabilities: [i % 2 ? "io:text-to-video" : "io:text-to-image"] }));
        if (task.offset === 0) results[0].capabilities = ["io:text-to-text"];
        return Response.json({ data: [{ taskType: "modelSearch", taskUUID: task.taskUUID, results, totalResults: 101 }] });
    });
    const client = f.modules.load("@/server/providers/runware-client");
    const result = await client.discoverRunwareModels({ id: "conn", providerId: "runware", secret: key, metadata: {} }, AbortSignal.timeout(5000));
    assert.equal(result.models.length, 100); assert.equal(result.truncated, false);
    assert.equal(result.models[0].mediaType, "video"); assert.match(result.models[0].providerModelId, /@/);
    assert.deepEqual(f.calls.map(call => call.task.offset), [0, 100]);
});

test("discovery/health rejects 200 errors, repeated pages and mismatched identity without generation", async () => {
    for (const mode of ["errors", "identity", "repeat"]) {
        const f = fixture(task => {
            if (mode === "errors") return Response.json({ errors: [{ message: key }] });
            return Response.json({ data: [{ taskType: "modelSearch", taskUUID: mode === "identity" ? taskId : task.taskUUID, totalResults: 201,
                results: Array.from({ length: 100 }, (_, i) => ({ air: `vendor:model@${i}`, category: "checkpoint", capabilities: ["io:text-to-image"] })) }] });
        });
        const client = f.modules.load("@/server/providers/runware-client"), connection = { id: "conn", providerId: "runware", secret: key, metadata: {} };
        await assert.rejects(client.discoverRunwareModels(connection, AbortSignal.timeout(5000)), /ERR_PROVIDER_DISCOVERY_FAILED/);
        assert.ok(f.calls.every(call => call.task.taskType === "modelSearch"));
    }
});

test("Runware upload preparation preserves image format and checks provider byte/reference limits", async () => {
    const calls = [];
    const m = createModuleLoader({ mocks: { "@/server/media/input-upload": {
        processFileUpload: async (_bytes, _name, mime) => { calls.push(mime); return { remoteUrl: image, localUrl: "/api/uploaded/test.png" }; },
        processImageUpload: async () => { throw new Error("Mask alpha must not be converted to JPEG"); },
    } } });
    const cap = m.load("@/server/catalog/runware").RUNWARE_IMAGE_CAPABILITIES["runware__openai-gpt-image-2"];
    const { readModelMedia, uploadModelMedia } = m.load("@/server/generation/media-input");
    const form = new FormData();
    form.append("slot_maskImage", new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jmO0AAAAASUVORK5CYII=", "base64")], "mask.png", { type: "image/png" }));
    const prepared = readModelMedia(form, cap, "image");
    await uploadModelMedia(prepared, AbortSignal.timeout(5000)); assert.deepEqual(calls, ["image/png"]);
    const small = { ...cap, media_slots: [{ ...cap.media_slots.find(slot => slot.id === "maskImage"), max_bytes: 1 }] };
    assert.throws(() => readModelMedia(form, small, "image"), /ERR_MEDIA_TOO_LARGE/);
});

test("Runware AIR discovery persists without activating unknown models; disabled keys hide all Runware models", async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "runware-config-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const m = createModuleLoader({ env: { OPEN_HIGGSFIELD_STORAGE_DIR: dir, PROVIDER_CONFIG_ENCRYPTION_KEY: "synthetic-encryption-key-for-tests-32-characters", RUNWARE_API_KEY: key } });
    const store = m.load("@/server/config/provider-store"), catalog = m.load("@/server/catalog/runtime");
    assert.equal((await catalog.getRuntimeCapabilityList("image")).filter(c => c.provider === "runware").length, 191);
    assert.equal((await catalog.getRuntimeCapabilityList("video")).filter(c => c.provider === "runware").length, 110);
    await store.saveDiscoveredModels("runware", [{ providerModelId: "new:model@1.0", displayName: "New model", mediaType: "image" }]);
    assert.equal((await store.listDiscoveredModels())[0].providerModelId, "new:model@1.0");
    assert.ok(!(await catalog.getRuntimeCapabilityList("image")).some(c => c.provider_model_id === "new:model@1.0"));
    const conn = await store.saveProviderConnection({ providerId: "runware", label: "Runware", secret: "synthetic-saved-runware" });
    await store.saveProviderConnection({ id: conn.id, providerId: "runware", enabled: false });
    assert.equal((await catalog.getRuntimeCapabilityList("image")).filter(c => c.provider === "runware").length, 0);
    assert.equal((await catalog.getRuntimeCapabilityList("video")).filter(c => c.provider === "runware").length, 0);
    const disk = await fs.readFile(path.join(dir, "provider-runtime-config.json"), "utf8");
    assert.ok(!disk.includes("synthetic-saved-runware"));
});

for (const mediaType of ["image", "video"]) test(`Runware ${mediaType}: durable worker resumes after restart with the original encrypted connection`, async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "runware-lifecycle-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const calls = [];
    const env = { OPEN_HIGGSFIELD_STORAGE_DIR: dir, TASK_WORKER_MODE: "external", PROVIDER_CONFIG_ENCRYPTION_KEY: "synthetic-encryption-key-for-tests-32-characters" };
    const config = { env, globals: { fetch: async (_url, init) => {
        const task = JSON.parse(init.body)[0]; calls.push({ task, key: init.headers.Authorization });
        return Response.json({ data: [{ taskUUID: task.taskUUID, taskType: `${mediaType}Inference`, ...(task.taskType === "getResponse"
            ? { status: "success", [mediaType === "image" ? "imageURL" : "videoURL"]: mediaType === "image" ? image : video } : {}) }] });
    } }, mocks: { "@/server/media/generated-assets": { attachGeneratedAssets: async (task, assets) => {
        assert.equal(assets.length, 1);
        if (mediaType === "image") { task.result_paths = ["/synthetic/output.png"]; task.result_urls = [image]; }
        else { task.video_path = "/synthetic/output.mp4"; task.video_urls = [video]; }
    } } } };
    const first = createModuleLoader(config), store = first.load("@/server/config/provider-store");
    const original = await store.saveProviderConnection({ providerId: "runware", label: "Original", secret: "synthetic-original-key", priority: 1 });
    await store.saveProviderConnection({ providerId: "runware", label: "Second", secret: "synthetic-second-key", priority: 2 });
    const f = catalogFixture, req = request(f, mediaType === "image" ? "openai-gpt-image-2" : "google-veo-3-1");
    const submitted = await first.load("@/server/generation/service").submitGeneration({ mediaType, modelId: req.modelId, capabilities: req.capabilities, params: req.params, media: {} });
    assert.equal(submitted.accepted, true); assert.equal(submitted.httpStatus, 202);
    await store.saveProviderConnection({ id: original.id, providerId: "runware", priority: 9 });
    const tasks = first.load("@/server/tasks/store"), task = await tasks.getTask(submitted.task_id);
    assert.equal(task.provider_connection_id, original.id); assert.equal(task.provider_task_id, submitted.task_id);
    await tasks.updateTask({ ...task, next_poll_at: new Date(Date.now() - 1000).toISOString() });
    const restarted = createModuleLoader(config);
    assert.equal((await restarted.load("@/server/tasks/poller").processDueTasks({ limit: 1, taskId: submitted.task_id })).processed, 1);
    const completed = await restarted.load("@/server/tasks/store").getTask(submitted.task_id);
    assert.equal(completed.status, "COMPLETED");
    assert.deepEqual(calls.map(c => c.task.taskType), [`${mediaType}Inference`, "getResponse"]);
    assert.ok(calls.every(c => c.key === "Bearer synthetic-original-key"));
});
