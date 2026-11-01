import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as googleSdk from "@google/genai";
import * as aiSdk from "ai";
import { createModuleLoader } from "./test-module-loader.mjs";

const syntheticKey = "synthetic-provider-test-key";
const mediaUrl = "https://fixtures.example.test/frame.png";
const outputUrl = "https://fixtures.example.test/output.mp4";
const safeMessage = /^ERR_[A-Z0-9_]+$/;
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const plain = value => JSON.parse(JSON.stringify(value));
const requireDependency = createRequire(import.meta.url);
function assertError(error, fields) {
    assert.match(error.code, safeMessage);
    assert.equal(error.message, error.code);
    for (const [key, value] of Object.entries(fields)) assert.equal(error[key], value, key);
    assert.equal(error.message.includes(syntheticKey), false);
    return true;
}
function request(model = "seedance-2-5", overrides = {}) {
    const mediaType = model.startsWith("gpt-") ? "image" : "video";
    return {
        mediaType, modelId: `toapis__${model}`, providerModelId: model, capabilities: {},
        params: { model_id: `toapis__${model}`, prompt: "Synthetic test scene" },
        media: mediaType === "video" ? { images: { first_frame: mediaUrl } } : {},
        clientTaskId: "local-test-id", ...overrides,
    };
}
function toapisFixture({ env = { TOAPIS_API_KEY: syntheticKey }, handler } = {}) {
    const calls = [];
    const fetch = async (url, init) => {
        calls.push({ url: String(url), ...init });
        if (handler) return handler(url, init, calls.length);
        const model = JSON.parse(init.body).model;
        return json({ id: "tsk_synthetic", object: "generation.task", model, status: "pending" });
    };
    const modules = createModuleLoader({ env, globals: { fetch } });
    return { ...modules, calls, provider: new (modules.load("src/providers/toapis.ts").ToapisProvider)() };
}
const operation = model => ({ version: 1, taskId: "tsk_synthetic", mediaType: model.startsWith("gpt-") ? "image" : "video", model, origin: "https://toapis.com" });
const pollRequest = (model = "seedance-2-5", overrides = {}) => ({ mediaType: operation(model).mediaType, providerModelId: model, operation: operation(model), ...overrides });
const taskResponse = (status, extra = {}, model = "seedance-2-5") => ({ id: "tsk_synthetic", object: "generation.task", model, status, ...extra });

test("ToAPIs every advertised image and video ratio/resolution matches its payload contract", async () => {
    const fixture = toapisFixture();
    const { TOAPIS_IMAGE_CAPABILITIES: images, TOAPIS_VIDEO_CAPABILITIES: videos } = fixture.load("src/models/capabilities/toapis.ts");
    assert.equal(Object.keys(images).length, 2);
    assert.equal(Object.keys(videos).length, 4);
    for (const caps of Object.values(images)) {
        for (const ratio of caps.size_ui.aspect_ratios) for (const resolution of caps.size_ui.resolutions) {
            const value = `${ratio.w}:${ratio.h}`;
            await fixture.provider.submit(request(caps.provider_model_id, { params: { prompt: "Synthetic image", aspect_ratio: value, resolution: resolution.id } }));
            const body = JSON.parse(fixture.calls.at(-1).body);
            assert.equal(body.size, value);
            assert.equal(body.resolution, caps.provider_model_id === "gpt-image-2" ? resolution.id.toLowerCase() : resolution.id);
            assert.equal(body.n, 1);
            assert.equal(body.quality, caps.provider_model_id === "gpt-image-2" ? undefined : "high");
            assert.equal(body.client_business_id, undefined);
        }
    }
    for (const caps of Object.values(videos)) {
        for (const [, ratio] of caps.aspect_ratio.options) for (const resolution of caps.resolution_variant.options) {
            const result = await fixture.provider.submit(request(caps.provider_model_id, { params: { prompt: "Synthetic video", aspect_ratio: ratio, resolution, duration: "4" } }));
            const body = JSON.parse(fixture.calls.at(-1).body);
            assert.equal(body.aspect_ratio, caps.provider_model_id === "seedance-2-5" ? "adaptive" : ratio);
            assert.equal(body.generate_audio, false);
            assert.equal(body.duration, 4);
            assert.equal(body.client_business_id, "local-test-id");
            assert.deepEqual(body.image_with_roles, [{ role: "first_frame", url: mediaUrl }]);
            assert.deepEqual(plain(result.operation), operation(caps.provider_model_id));
            assert.equal(JSON.stringify(result.operation).includes(syntheticKey), false);
        }
    }
    assert.equal(Object.keys(fixture.load("src/models/capabilities/video.ts").VIDEO_CAPABILITIES).includes("toapis__seedance-2-5"), true);
    assert.equal(Object.keys(fixture.load("src/models/capabilities/image.ts").IMAGE_CAPABILITIES).includes("toapis__gpt-image-2"), true);
    for (const call of fixture.calls) {
        assert.equal(call.redirect, "error");
        assert.equal(call.method, "POST");
        assert.ok(call.signal instanceof AbortSignal);
        assert.equal(call.headers.Authorization, `Bearer ${syntheticKey}`);
    }
});

test("actual defaultSettings used by CommandBar selects adaptive, and switching models resets a fixed ratio", async () => {
    const fixture = toapisFixture();
    const source = fs.readFileSync(new URL("../src/components/studio/SettingsPanel.tsx", import.meta.url), "utf8");
    const parsed = ts.createSourceFile("SettingsPanel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "defaultSettings");
    assert.ok(declaration);
    const code = ts.transpileModule(declaration.getText(parsed), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const helpers = fixture.load("src/models/capabilities/video-helpers.ts");
    const context = { ...helpers, exports: {} };
    vm.runInNewContext(code, context);
    const caps = fixture.load("src/models/capabilities/toapis.ts").TOAPIS_VIDEO_CAPABILITIES;
    for (const name of ["seedance-2-5", "seedance-2", "seedance-2-5"]) {
        const settings = context.exports.defaultSettings(caps[`toapis__${name}`]);
        const expected = name === "seedance-2-5" ? "adaptive" : "16:9";
        assert.equal(settings.aspectRatio, expected);
        await fixture.provider.submit(request(name, { params: { prompt: "Synthetic", aspect_ratio: settings.aspectRatio, duration: settings.duration } }));
        assert.equal(JSON.parse(fixture.calls.at(-1).body).aspect_ratio, expected);
    }
});

test("actual VideoModelPill renders every registered video model including all four ToAPIs choices", () => {
    const capabilities = createModuleLoader().load("src/models/capabilities/video.ts");
    const source = fs.readFileSync(new URL("../src/components/command-bar/VideoModelPill.tsx", import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const component = { exports: {} };
    const require = name => {
        if (name === "@/models/capabilities/video") return capabilities;
        if (name === "./PillPopover") return { PillPopover: ({ children }) => createElement("div", null, children) };
        return requireDependency(name);
    };
    vm.runInNewContext("(function(require,module,exports){" + code + "\n})", {})(require, component, component.exports);
    const markup = renderToStaticMarkup(createElement(component.exports.VideoModelPill, {
        modelId: "toapis__seedance-2-5", variantId: "720p", attachments: [], onModelChange() {},
    }));
    const labels = Array.from(markup.matchAll(/<button\b[^>]*>[\s\S]*?<span class="truncate">([^<]+)<\/span>/g), match => match[1]);
    for (const model of ["seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2-5"]) {
        assert.ok(labels.includes(`${model} - ToAPIs`), `actual picker must render ${model}`);
    }
    const { VIDEO_CAPABILITIES, VIDEO_CAPABILITY_GROUPS, getVideoCapabilitiesByGroup } = capabilities;
    const models = Object.values(VIDEO_CAPABILITIES);
    const enumeratedIds = VIDEO_CAPABILITY_GROUPS.flatMap(getVideoCapabilitiesByGroup).map(model => model.id);
    assert.deepEqual([...enumeratedIds].sort(), Object.keys(VIDEO_CAPABILITIES).sort(), "each registered ID must occur exactly once in picker enumeration");
    assert.deepEqual(labels.sort(), models.map(model => model.label).sort(), "the real component must render all registered model buttons");
    for (const group of new Set(models.map(model => model.group))) assert.ok(VIDEO_CAPABILITY_GROUPS.includes(group), `missing group ${group}`);
    assert.equal(labels.filter(label => label.endsWith(" - ToAPIs")).length, 4);
});

test("ToAPIs invalid input and missing credentials reject without dispatch or uncertainty", async () => {
    const noKey = toapisFixture({ env: {} });
    await assert.rejects(noKey.provider.submit(request()), e => assertError(e, { submissionUncertain: false, retryable: false }));
    assert.equal(noKey.calls.length, 0);
    for (const origin of ["http://toapis.com", "https://toapis.com:443", "https://toapis.com/v1", "https://evil.test", "https://toapis.com?x=1", "https://user:pass@toapis.com"]) {
        const fixture = toapisFixture({ env: { TOAPIS_API_KEY: syntheticKey, TOAPIS_BASE_URL: origin } });
        await assert.rejects(fixture.provider.submit(request()), e => assertError(e, { code: "ERR_TOAPIS_ORIGIN", submissionUncertain: false }));
        assert.equal(fixture.calls.length, 0);
    }
    const fixture = toapisFixture();
    const invalid = [
        request("bad-model"), request("seedance-2-5", { params: { prompt: "x", aspect_ratio: "16:9" } }),
        request("seedance-2", { params: { prompt: "x", aspect_ratio: "adaptive" } }),
        request("seedance-2", { params: { prompt: "x", duration: "5" } }),
        request("seedance-2-mini", { params: { prompt: "x", resolution: "1080p" } }),
        request("seedance-2-fast", { params: { prompt: "x", generate_audio: true } }),
        request("seedance-2-5", { media: {} }), request("gpt-image-2", { media: { images: { first_frame: mediaUrl } } }),
        request("gpt-image-2", { params: { prompt: "x", resolution: "8K" } }),
        request("seedance-2-5", { media: { images: { first_frame: mediaUrl }, video: outputUrl } }),
        ...["https://user:pass@example.test/x", "http://example.test/x", "https://127.0.0.1/x", "https://[::1]/x", "https://example.test/" + "x".repeat(2048)].map(url => request("seedance-2-5", { media: { images: { first_frame: url } } })),
    ];
    for (const value of invalid) await assert.rejects(fixture.provider.submit(value), e => assertError(e, { submissionUncertain: false, retryable: false }));
    assert.equal(fixture.calls.length, 0);
});

test("ToAPIs persisted operations are validated before GET", async () => {
    const fixture = toapisFixture({ handler: () => json(taskResponse("queued")) });
    const op = JSON.parse(JSON.stringify(operation("seedance-2-5")));
    assert.equal((await fixture.provider.poll(pollRequest("seedance-2-5", { operation: op }))).status, "IN_PROGRESS");
    assert.equal(fixture.calls[0].method, "GET");
    assert.match(fixture.calls[0].url, /\/videos\/generations\/tsk_synthetic$/);
    for (const change of [{ version: 2 }, { taskId: "../x" }, { taskId: "" }, { taskId: "x".repeat(201) }, { origin: "https://elsewhere.test" }, { model: "seedance-2" }, { mediaType: "image" }]) {
        await assert.rejects(fixture.provider.poll(pollRequest("seedance-2-5", { operation: { ...op, ...change } })), e => assertError(e, { retryable: false }));
    }
    assert.equal(fixture.calls.length, 1);
});

test("ToAPIs known statuses and malformed completion remain distinct", async () => {
    for (const status of ["pending", "queued", "in_progress", "failed"]) {
        const fixture = toapisFixture({ handler: () => json(taskResponse(status, { error: { message: syntheticKey } })) });
        const result = await fixture.provider.poll(pollRequest());
        assert.equal(result.status, status === "failed" ? "FAILED" : "IN_PROGRESS");
        if (status === "failed") assert.equal(result.error, "ERR_TOAPIS_TASK_FAILED");
    }
    for (const model of ["gpt-image-2", "seedance-2-5"]) {
        const fixture = toapisFixture({ handler: () => json(taskResponse("completed", { result: { type: operation(model).mediaType, data: [{ url: outputUrl }] } }, model)) });
        const result = await fixture.provider.poll(pollRequest(model));
        assert.equal(result.status, "COMPLETED");
        assert.equal(result.assets[0].url, outputUrl);
    }
    const bad = [
        taskResponse("unknown"), taskResponse("completed", { id: "different" }),
        taskResponse("completed", { result: { type: "image", data: [{ url: outputUrl }] } }),
        taskResponse("completed", { result: { type: "video", data: [] } }),
        taskResponse("completed", { result: { type: "video", data: [{ url: outputUrl }, { url: outputUrl }] } }),
        taskResponse("completed", { result: { type: "video", data: [{ url: "https://u:p@example.test/x" }] } }),
        taskResponse("completed", { result: { type: "video", data: [{ url: outputUrl, format: "mov" }] } }),
    ];
    for (const response of bad) {
        const fixture = toapisFixture({ handler: () => json(response) });
        await assert.rejects(fixture.provider.poll(pollRequest()), e => assertError(e, { retryable: false, submissionUncertain: false }));
    }
});

test("ToAPIs transient queries preserve Retry-After; submit is one attempt and uncertain where appropriate", async () => {
    for (const status of [408, 429, 500, 503]) {
        const fixture = toapisFixture({ handler: () => json({ secret: syntheticKey }, status, { "retry-after": "37" }) });
        await assert.rejects(fixture.provider.poll(pollRequest()), e => assertError(e, { retryable: true, retryAfterMs: 37_000, submissionUncertain: false }));
        assert.equal(fixture.calls.length, 1);
        await assert.rejects(fixture.provider.submit(request()), e => assertError(e, { retryable: false, submissionUncertain: status !== 429 }));
        assert.equal(fixture.calls.length, 2);
    }
    const date = new Date(Date.now() + 45_000).toUTCString();
    const fixture = toapisFixture({ handler: () => json({}, 503, { "retry-after": date }) });
    await assert.rejects(fixture.provider.poll(pollRequest()), e => {
        assertError(e, { retryable: true }); assert.ok(e.retryAfterMs > 42_000 && e.retryAfterMs <= 45_000); return true;
    });
    for (const status of [400, 401, 403, 404, 422]) {
        const other = toapisFixture({ handler: () => json({}, status) });
        await assert.rejects(other.provider.poll(pollRequest()), e => assertError(e, { retryable: false }));
        await assert.rejects(other.provider.submit(request()), e => assertError(e, { retryable: false, submissionUncertain: false }));
    }
    for (const handler of [() => { throw new TypeError("lost response with " + syntheticKey); }, () => new Response("bad JSON"), () => json({})]) {
        const other = toapisFixture({ handler });
        await assert.rejects(other.provider.submit(request()), e => assertError(e, { submissionUncertain: true, retryable: false }));
        assert.equal(other.calls.length, 1);
    }
});

test("ToAPIs propagates pre-abort and in-flight abort/timeout without replay", async () => {
    const pre = toapisFixture();
    await assert.rejects(pre.provider.submit(request("seedance-2-5", { signal: AbortSignal.abort() })), e => assertError(e, { submissionUncertain: false }));
    assert.equal(pre.calls.length, 0);
    for (const phase of ["submit", "poll"]) for (const name of ["AbortError", "TimeoutError"]) {
        const controller = new AbortController();
        const fixture = toapisFixture({ handler: (_url, init) => new Promise((resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
            queueMicrotask(() => controller.abort(new DOMException("synthetic", name)));
        }) });
        await assert.rejects(phase === "submit" ? fixture.provider.submit(request("seedance-2-5", { signal: controller.signal })) : fixture.provider.poll(pollRequest("seedance-2-5", { signal: controller.signal })),
            e => assertError(e, { retryable: phase === "poll", submissionUncertain: phase === "submit" }));
        assert.equal(fixture.calls.length, 1);
    }
});

function sdkFixture(kind, handler, mocks = {}) {
    const calls = [];
    const env = { GEMINI_API_KEY: syntheticKey, GOOGLE_CLOUD_PROJECT: "synthetic-project", AI_GATEWAY_API_KEY: syntheticKey };
    const fetch = async (input, init) => {
        const call = { url: String(input instanceof Request ? input.url : input), method: init?.method ?? (input instanceof Request ? input.method : "GET"), ...init };
        calls.push(call);
        return handler(call, calls.length);
    };
    const modules = createModuleLoader({ env, globals: { fetch, Uint8Array }, mocks: { "@google/genai": googleSdk, ai: aiSdk, ...mocks } });
    const provider = kind === "gateway" ? new (modules.load("src/providers/vercel-ai-gateway.ts").VercelAiGatewayProvider)()
        : new (modules.load("src/providers/google.ts").GoogleProvider)(kind === "vertex" ? "google-vertex" : "google-ai-studio");
    return { ...modules, calls, provider };
}
function sdkRequest(kind, overrides = {}) {
    const mediaType = kind === "interactions" ? "image" : "video";
    return { mediaType, modelId: "synthetic", providerModelId: mediaType === "image" ? "gemini-3-pro-image-preview" : kind === "gateway" ? "google/veo-3.1-generate-preview" : "veo-3.1-generate-preview",
        capabilities: {}, params: { model_id: "synthetic", prompt: "Synthetic scene" }, media: {}, ...overrides };
}

for (const engine of ["native", "interactions", "gateway"]) {
    for (const fault of ["503", "network", "abort"]) {
        test(`installed ${engine} SDK: ${fault} dispatches once, forwards cancellation and never replays`, async () => {
            const controller = new AbortController();
            const fixture = sdkFixture(engine, call => {
                assert.equal(call.redirect, "error");
                assert.ok(call.signal instanceof AbortSignal);
                if (fault === "503") return json({ error: { code: 503, message: syntheticKey, type: "internal_server_error" } }, 503, { "retry-after": "11" });
                if (fault === "network") throw new TypeError("synthetic response lost");
                return new Promise((resolve, reject) => {
                    call.signal.addEventListener("abort", () => reject(call.signal.reason), { once: true });
                    queueMicrotask(() => controller.abort());
                });
            });
            await assert.rejects(fixture.provider.submit(sdkRequest(engine, { signal: controller.signal })), e => assertError(e, { submissionUncertain: true, retryable: false }));
            assert.equal(fixture.calls.length, 1, "the real SDK must not repeat the request");
            assert.equal(fixture.calls[0].method, "POST");
            if (engine === "native") assert.equal(JSON.parse(fixture.calls[0].body).parameters?.generateAudio, undefined);
        });
    }
}

test("installed Google and Gateway status requests preserve HTTP retry metadata rather than returning failed", async () => {
    for (const kind of ["native", "gateway"]) {
        const fixture = sdkFixture(kind, () => json({ error: { code: 429, message: syntheticKey } }, 429, { "retry-after": "60" }));
        const op = kind === "gateway" ? { jobId: "synthetic-job" } : { name: "models/veo-3.1-generate-preview/operations/test-id" };
        await assert.rejects(fixture.provider.poll({ mediaType: "video", providerModelId: "google/veo-3.1-generate-preview", operation: op }),
            e => assertError(e, { retryable: true, retryAfterMs: 60_000, submissionUncertain: false }));
        assert.equal(fixture.calls.length, 1);
        assert.equal(fixture.calls[0].method, kind === "gateway" ? "POST" : "GET");
    }
});

test("installed Vertex status uses a read-only POST and its custom fetch enforces cancellation", async () => {
    class LocalGoogleGenAI extends googleSdk.GoogleGenAI {
        constructor(options) {
            super({ ...options, googleAuthOptions: { authClient: { getRequestHeaders: async () => new Headers({ authorization: `Bearer ${syntheticKey}` }) } } });
        }
    }
    for (const fault of ["503", "abort"]) {
        const controller = new AbortController();
        const fixture = sdkFixture("vertex", call => {
            if (fault === "503") return json({ error: { code: 503, message: syntheticKey } }, 503, { "retry-after": "12" });
            return new Promise((resolve, reject) => {
                call.signal.addEventListener("abort", () => reject(call.signal.reason), { once: true });
                queueMicrotask(() => controller.abort());
            });
        }, { "@google/genai": { ...googleSdk, GoogleGenAI: LocalGoogleGenAI } });
        await assert.rejects(fixture.provider.poll({ mediaType: "video", providerModelId: "veo-3.1-generate-001",
            operation: { name: "projects/synthetic-project/locations/us-central1/publishers/google/models/veo-3.1-generate-001/operations/test-id" }, signal: controller.signal }),
        error => assertError(error, { retryable: true, submissionUncertain: false, ...(fault === "503" ? { retryAfterMs: 12_000 } : {}) }));
        assert.equal(fixture.calls.length, 1);
        assert.equal(fixture.calls[0].method, "POST");
        assert.match(fixture.calls[0].url, /:fetchPredictOperation$/);
        if (fault === "abort") assert.equal(fixture.calls[0].signal.aborted, true);
    }
});

test("Google and Gateway invalid operations and missing keys are non-uncertain with zero calls", async () => {
    for (const kind of ["native", "gateway"]) {
        const fixture = sdkFixture(kind, () => { throw new Error("Unexpected fetch"); });
        for (const operation of [null, {}, [], ""]) {
            await assert.rejects(fixture.provider.poll({ mediaType: "video", operation }), error => assertError(error, { retryable: false, submissionUncertain: false }));
        }
        assert.equal(fixture.calls.length, 0);
        delete fixture.context.process.env.GEMINI_API_KEY;
        delete fixture.context.process.env.AI_GATEWAY_API_KEY;
        await assert.rejects(fixture.provider.submit(sdkRequest(kind)), error => assertError(error, { retryable: false, submissionUncertain: false }));
        assert.equal(fixture.calls.length, 0);
    }
});

test("installed SDK malformed successful status responses pause instead of inventing task failure", async () => {
    for (const kind of ["native", "gateway"]) {
        const fixture = sdkFixture(kind, () => json({}));
        await assert.rejects(fixture.provider.poll({ mediaType: "video", providerModelId: "google/veo-3.1-generate-preview",
            operation: kind === "gateway" ? { jobId: "synthetic" } : { name: "models/veo/operations/synthetic" } }),
        error => assertError(error, { retryable: false, submissionUncertain: false }));
        assert.equal(fixture.calls.length, 1);
    }
});

test("actual video route carries adaptive from FormData into the real ToAPIs payload", async () => {
    const calls = [];
    let provider;
    const modules = createModuleLoader({ env: { TOAPIS_API_KEY: syntheticKey }, globals: { fetch: async (url, init) => {
        calls.push({ url, ...init }); return json(taskResponse("queued"));
    } }, mocks: {
        "next/server": { NextResponse: { json: (body, init) => json(body, init?.status) } },
        "@/lib/media-upload": { resolveUrl: async url => ({ remoteUrl: url }) },
        "@/lib/generation-service": { submitGeneration: async input => {
            const submitted = await provider.submit({ ...input, providerModelId: input.capabilities.provider_model_id, clientTaskId: "local-test-id" });
            return { task_id: submitted.providerTaskId, httpStatus: 202, accepted: true, recovery_required: false };
        } },
    } });
    provider = new (modules.load("src/providers/toapis.ts").ToapisProvider)();
    const route = modules.load("src/app/api/generate/route.ts");
    const body = new FormData();
    body.set("model_id", "toapis__seedance-2-5"); body.set("prompt", "Synthetic scene");
    body.set("settings", JSON.stringify({ duration: "4", aspectRatio: "adaptive" }));
    body.set("variant_id", "720p"); body.set("url_first_frame", mediaUrl);
    const response = await route.POST(new Request("http://localhost/api/generate", { method: "POST", body, headers: { origin: "http://localhost" } }));
    assert.equal(response.status, 202);
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].body).aspect_ratio, "adaptive");
});

test("Retry-After parsing keeps long provider delays and rejects malformed values", () => {
    const { parseRetryAfter } = createModuleLoader().load("src/providers/request-error.ts");
    assert.equal(parseRetryAfter("86400"), 86_400_000);
    assert.equal(parseRetryAfter("0"), 0);
    assert.equal(parseRetryAfter("-1"), undefined);
    assert.equal(parseRetryAfter("not-a-date"), undefined);
    assert.equal(parseRetryAfter(null), undefined);
});

test("Google persists only query identity for inline outputs and resumes from compact or legacy operations", async () => {
    const name = "models/veo/operations/synthetic-inline";
    const inline = Buffer.alloc(4096, 1).toString("base64");
    let state = "completed";
    const fixture = sdkFixture("native", () => json({
        name, done: state !== "pending", metadata: { raw_secret: syntheticKey, signed_url: outputUrl },
        ...(state === "failed" ? { error: { code: 3, message: syntheticKey } } : {
            response: { generateVideoResponse: { generatedSamples: [{ video: { encodedVideo: inline, encoding: "video/mp4" } }] } },
        }),
    }));
    const accepted = await fixture.provider.submit(sdkRequest("native"));
    assert.deepEqual(plain(accepted.operation), { name });
    assert.equal(accepted.status, "IN_PROGRESS");
    const legacy = { name, response: { generatedVideos: [{ video: { videoBytes: inline } }] },
        metadata: { secret: syntheticKey }, _fromAPIResponse: "legacy-untrusted-field" };
    for (const previous of [JSON.parse(JSON.stringify(accepted.operation)), legacy]) {
        for (const status of ["pending", "failed", "completed"]) {
            state = status;
            const result = await fixture.provider.poll({ mediaType: "video", providerModelId: "veo", operation: previous });
            assert.deepEqual(plain(result.operation), { name });
            assert.ok(Buffer.byteLength(JSON.stringify(result.operation)) < 100);
            assert.equal(result.status, status === "pending" ? "IN_PROGRESS" : status === "failed" ? "FAILED" : "COMPLETED");
            if (status === "completed") assert.equal(result.assets[0].data.byteLength, 4096);
        }
    }
    assert.equal(fixture.calls.filter(call => call.method === "POST").length, 1, "restart/query never re-submits");
    assert.equal(fixture.calls.filter(call => call.method === "GET").length, 6);
});

for (const scenario of ["success", "empty", "declared-oversize", "chunked-oversize", "stalled-abort", "deadline-abort"]) {
    test(`installed Google download + real transfer helper: ${scenario} is bounded and cleans its temp file`, async () => {
        const name = "models/veo/operations/synthetic-download";
        const uuid = `t3-${process.pid}-${scenario}`;
        const tempPath = `/tmp/google-video-${uuid}.mp4`;
        assert.equal(fs.existsSync(tempPath), false);
        const controller = new AbortController();
        const bytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
        let canceled = false;
        let chunks = 0;
        const fixture = sdkFixture("native", call => {
            if (!call.url.includes(":download")) return json({ name, done: true,
                response: { generateVideoResponse: { generatedSamples: [{ video: {
                    uri: "https://generativelanguage.googleapis.com/v1beta/files/syntheticfile:download?alt=media", encoding: "video/mp4",
                } }] } },
            });
            const url = new URL(call.url);
            assert.equal(url.origin, "https://generativelanguage.googleapis.com");
            assert.equal(call.method, "GET");
            assert.equal(call.redirect, "error");
            assert.equal(new Headers(call.headers).get("x-goog-api-key"), syntheticKey);
            if (scenario === "success") return new Response(bytes, { headers: { "content-type": "video/mp4", "content-length": String(bytes.length) } });
            if (scenario === "empty") return new Response(null);
            if (scenario === "declared-oversize") return new Response(new ReadableStream({ cancel() { canceled = true; } }),
                { headers: { "content-length": String(64 * 1024 * 1024 + 1) } });
            if (scenario === "chunked-oversize") return new Response(new ReadableStream({
                pull(stream) { chunks++; stream.enqueue(Buffer.alloc(1024 * 1024)); },
                cancel() { canceled = true; },
            }, { highWaterMark: 0 }));
            return new Response(new ReadableStream({
                pull() {
                    queueMicrotask(() => controller.abort(new DOMException("synthetic body stop", scenario === "deadline-abort" ? "TimeoutError" : "AbortError")));
                    return new Promise(() => {});
                }, cancel() { canceled = true; },
            }, { highWaterMark: 0 }));
        }, { crypto: { randomUUID: () => uuid } });
        const pending = fixture.provider.poll({ mediaType: "video", providerModelId: "veo", operation: { name }, signal: controller.signal });
        if (scenario === "success") {
            const result = await pending;
            assert.equal(result.status, "COMPLETED");
            assert.deepEqual(Buffer.from(result.assets[0].data), bytes);
            assert.deepEqual(plain(result.operation), { name });
        } else {
            await assert.rejects(pending, error => assertError(error, { submissionUncertain: false,
                retryable: scenario === "stalled-abort" || scenario === "deadline-abort" }));
            assert.equal(canceled, scenario !== "empty");
            if (scenario === "chunked-oversize") assert.ok(chunks >= 65 && chunks <= 66, "cancel as soon as the 64 MiB cap is crossed");
        }
        assert.equal(fixture.calls.length, 2, "one status query and one download, no retries");
        assert.equal(fs.existsSync(tempPath), false);
    });
}

test("all Google submission paths set their own no-retry options and media/poll cancellation", async () => {
    const seen = [];
    const downloads = [];
    class GoogleGenAI {
        constructor(options) { seen.push({ type: "client", options }); }
        interactions = { create: async (body, options) => { seen.push({ type: "interaction", options }); return { output_image: { data: "AQ==", mime_type: "image/png" } }; } };
        models = {
            generateContent: async body => { seen.push({ type: "content", options: body.config }); return { candidates: [{ content: { parts: [{ inlineData: { data: "AQ==" } }] } }] }; },
            generateVideos: async body => { seen.push({ type: "video", options: body.config, body }); return { name: "models/veo/operations/task" }; },
        };
        operations = { getVideosOperation: async body => { seen.push({ type: "poll", options: body.config }); return { name: body.operation.name, done: false }; } };
    }
    const fixture = sdkFixture("native", () => { throw new Error("Unexpected network"); }, {
        "@google/genai": { GoogleGenAI, GenerateVideosOperation: class {} },
        "./utils": { getMediaUrls: () => [mediaUrl], getImageUrl: () => mediaUrl, toSerializable: plain,
            fetchMedia: async (url, options) => { downloads.push(options); return { data: Buffer.from([1]), mimeType: "image/png" }; } },
    });
    const Provider = fixture.load("src/providers/google.ts").GoogleProvider;
    const controller = new AbortController();
    await new Provider("google-ai-studio").submit(sdkRequest("interactions", { signal: controller.signal }));
    await new Provider("google-vertex").submit(sdkRequest("interactions", { signal: controller.signal }));
    await new Provider("google-ai-studio").submit(sdkRequest("native", { signal: controller.signal }));
    await new Provider("google-vertex").submit(sdkRequest("native", { signal: controller.signal, params: { prompt: "Synthetic", field_values: { generate_audio: false } } }));
    await new Provider("google-vertex").poll({ mediaType: "video", operation: { name: "projects/p/locations/us/models/veo/operations/task" }, signal: controller.signal });
    for (const call of seen) {
        if (call.type === "interaction") { assert.equal(call.options.retries.strategy, "none"); assert.equal(call.options.timeout_ms, 180_000); }
        else { assert.equal(call.options.httpOptions.retryOptions.attempts, 1); assert.equal(call.options.httpOptions.timeout, call.type === "poll" || call.type === "client" && call.options.httpOptions.timeout === 20_000 ? 20_000 : 180_000); }
    }
    controller.abort();
    for (const call of seen.filter(call => call.type !== "client")) assert.equal((call.options.signal ?? call.options.abortSignal).aborted, true);
    for (const options of downloads) assert.equal(options.signal.aborted, true);
    const videos = seen.filter(call => call.type === "video");
    assert.equal(videos[0].options.generateAudio, undefined);
    assert.equal(videos[1].options.generateAudio, false);
    for (const video of videos) { assert.ok(video.body.source.prompt); assert.equal(video.body.prompt, undefined); assert.equal(video.body.image, undefined); }
    const caps = fixture.load("src/models/capabilities/external.ts").EXTERNAL_VIDEO_CAPABILITIES;
    assert.equal(caps["google-ai-studio__veo-3.1-generate-preview"].custom_fields.some(field => field.id === "generate_audio"), false);
    assert.equal(caps["google-vertex__veo-3.1-generate-001"].custom_fields.some(field => field.id === "generate_audio"), true);
});

test("Gateway image and language-image paths explicitly disable retries and carry the bounded signal", async () => {
    const seen = [];
    const fakeAi = {
        createGateway: options => ({ imageModel: id => ({ id, options }), languageModel: id => ({ id, options }) }),
        generateImage: async options => { seen.push(options); return { images: [{ uint8Array: Buffer.from([1]), mediaType: "image/png" }] }; },
        generateText: async options => { seen.push(options); return { files: [{ uint8Array: Buffer.from([1]), mediaType: "image/png" }] }; },
    };
    const fixture = sdkFixture("gateway", () => { throw new Error("Unexpected fetch"); }, { ai: fakeAi });
    const controller = new AbortController();
    for (const providerMode of ["image-model", "language-image"]) {
        await fixture.provider.submit(sdkRequest("gateway", { mediaType: "image", providerMode, signal: controller.signal }));
    }
    assert.equal(seen.length, 2);
    for (const call of seen) { assert.equal(call.maxRetries, 0); assert.ok(call.abortSignal instanceof AbortSignal); }
    assert.equal(seen[1].timeout.totalMs, 180_000);
    controller.abort();
    assert.equal(seen.every(call => call.abortSignal.aborted), true);
});

test("Freepik existing adapter preserves status/error semantics and validates operations", async () => {
    const calls = [];
    let response = json({ data: { task_id: "test-id" } });
    const modules = createModuleLoader({ env: { FREEPIK_API_KEY: syntheticKey }, globals: { fetch: async (url, init) => { calls.push({ url, ...init }); return response; } },
        mocks: { "@/models/adapters/image": { getImageAdapter: () => ({ process: () => ({ endpoint: { post_path: "/v1/ai/mystic", poll_path: "/v1/ai/mystic/{task_id}" }, payload: {} }) }) },
            "@/models/adapters/video": { getVideoAdapter: () => undefined } } });
    const provider = new (modules.load("src/providers/freepik.ts").FreepikProvider)();
    const accepted = await provider.submit(request("gpt-image-2"));
    const poll = { mediaType: "image", operation: accepted.operation };
    assert.equal(calls[0].redirect, "error");
    assert.equal(accepted.providerTaskId, "test-id");
    response = json({ data: { status: "COMPLETED", generated: [outputUrl] } });
    assert.equal((await provider.poll(poll)).status, "COMPLETED");
    response = json({ data: { status: "FAILED", error: { message: syntheticKey } } });
    assert.equal((await provider.poll(poll)).error, "ERR_FREEPIK_TASK_FAILED");
    response = json({}, 503, { "retry-after": "9" });
    await assert.rejects(provider.poll(poll), e => assertError(e, { retryable: true, retryAfterMs: 9000, submissionUncertain: false }));
    response = json({ data: { status: "COMPLETED", generated: [] } });
    await assert.rejects(provider.poll(poll), e => assertError(e, { retryable: false }));
    const before = calls.length;
    for (const pollUrl of ["https://evil.test/x", "/v1/ai/../x", "/v1/ai/x?secret=1"]) {
        await assert.rejects(provider.poll({ ...poll, operation: { pollUrl } }), e => assertError(e, { retryable: false }));
    }
    assert.equal(calls.length, before);
    response = json({}, 503);
    await assert.rejects(provider.submit(request("gpt-image-2")), e => assertError(e, { submissionUncertain: true }));
    assert.equal(calls.length, before + 1);
});
