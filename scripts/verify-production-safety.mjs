import assert from "node:assert/strict";
import test from "node:test";
import { createRequire, registerHooks } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import { createModuleLoader } from "./test-module-loader.mjs";

const require = createRequire(import.meta.url);
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
// Next's bundler resolves this extensionless import for next-intl in production.
registerHooks({ resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context);
} });
const { NextRequest } = require("next/server");
// The installed Next version retains the Middleware name for this public test helper.
const { unstable_doesMiddlewareMatch: doesProxyMatch } = require("next/experimental/testing/server");
const origin = "https://studio.example.test";
const cronSecret = "synthetic-scheduler-secret-for-local-tests-only";
const baseEnv = { NODE_ENV: "production", APP_ORIGIN: origin,
    DEPLOYMENT_PROFILE: "single-process", TASK_WORKER_MODE: "local", ASSET_STORAGE_MODE: "local",
    OPEN_HIGGSFIELD_STORAGE_DIR: "/tmp/synthetic-workspace-no-real-files" };
const context = { params: Promise.resolve({ taskId: "synthetic-task", filename: "synthetic.png" }) };
const caps = { id: "synthetic", provider: "google-ai-studio", media_slots: [], prompt_required: true };

function request(path = "/api/tasks", options = {}) {
    const { method = "GET", headers, ...rest } = options;
    return new NextRequest(`${origin}${path}`, { method, headers: {
        ...(!["GET", "HEAD", "OPTIONS"].includes(method) ? { origin } : {}), ...headers,
    }, ...rest });
}

function harness(env = {}, extraMocks = {}, globals = {}) {
    const calls = { store: 0, submit: 0, uploads: 0, config: 0, worker: 0, start: 0 };
    const store = async () => { calls.store++; return undefined; };
    const mocks = {
        "@/server/tasks/store": { initStore: store, getTask: store, getPublicTask: store, listTasks: store, deleteTask: store, resumeTask: store },
        "@/server/media/generated-assets": { assertGeneratedStorageConfigured: () => { calls.config++; return "local"; } },
        "@/server/generation/service": { submitGeneration: async () => { calls.submit++; return { httpStatus: 202, task_id: "synthetic-task", accepted: true, recovery_required: false }; } },
        "@/server/media/input-upload": { processImageUpload: async () => { calls.uploads++; }, processFileUpload: async () => { calls.uploads++; }, resolveUrl: async () => { calls.uploads++; } },
        "@/server/media/storage": { saveInputLocally: async () => { calls.uploads++; }, uploadToTmpfiles: async () => { calls.uploads++; } },
        "@/server/catalog/video": { VIDEO_CAPABILITIES: { synthetic: caps } },
        "@/server/catalog/image": { IMAGE_CAPABILITIES: { synthetic: caps } },
        "@/server/tasks/poller": { processDueTasks: async (options) => { calls.worker++; calls.workerOptions = options; return { claimed: 2, processed: 2 }; }, startLocalWorker: () => { calls.start++; } },
        ...extraMocks,
    };
    return { calls, ...createModuleLoader({ env: { ...baseEnv, ...env }, mocks, globals }) };
}

test("workspace access requires no login and retains strict origin checks", () => {
    const access = harness({ CRON_SECRET: cronSecret }).load("@/server/security/workspace-access");
    assert.equal(access.guardWorkspaceRequest(request()), null);
    for (const path of ["/en", "/pt-BR/settings", "/api/providers", "/api/tasks"]) {
        assert.equal(access.guardWorkspaceRequest(request(path)), null);
    }
    for (const suppliedOrigin of ["", "null", "https://evil.test", `${origin}.evil.test`]) {
        const response = access.guardWorkspaceRequest(request("/api/tasks/id", { method: "DELETE", headers: {
            origin: suppliedOrigin, host: "evil.test", "x-forwarded-host": "studio.example.test", "x-forwarded-for": "127.0.0.1",
        } }));
        assert.equal(response.status, 403);
    }
    const missingOrigin = request("/api/tasks/id", { method: "DELETE" }); missingOrigin.headers.delete("origin");
    assert.equal(access.guardWorkspaceRequest(missingOrigin).status, 403);
    for (const site of ["cross-site", "same-site"]) {
        assert.equal(access.guardWorkspaceRequest(request("/api/tasks/id", { method: "POST", headers: { "sec-fetch-site": site } })).status, 403);
    }
    assert.equal(access.guardWorkspaceRequest(request("/api/tasks/id", { method: "POST", headers: { "sec-fetch-site": "same-origin" } })), null);
    assert.equal(access.guardSchedulerRequest(request("/api/internal/process-tasks")).status, 401);
    assert.equal(access.guardSchedulerRequest(request("/api/internal/process-tasks", { headers: { authorization: `Bearer ${cronSecret}` } })), null);
    for (const env of [{ APP_ORIGIN: undefined }, { APP_ORIGIN: "http://localhost:3000" },
        { APP_ORIGIN: `${origin}/` }, { APP_ORIGIN: `${origin}/path` }]) {
        assert.equal(harness(env).load("@/server/security/workspace-access").guardWorkspaceRequest(request()).status, 503);
    }
    const development = harness({ NODE_ENV: "development", APP_ORIGIN: undefined }).load("@/server/security/workspace-access");
    assert.equal(development.guardWorkspaceRequest(new Request("http://localhost:3000/api/tasks")), null);
    assert.equal(development.guardWorkspaceRequest(new Request("http://example.test/api/tasks")), null);
});

test("public demo serves pages without credentials and rejects writes before downstream work", async () => {
    const env = { APP_DEMO_MODE: "true", GENERATION_ENABLED: "false" };
    const h = harness(env);
    const access = h.load("@/server/security/workspace-access");
    const { default: proxy } = h.load("src/proxy.ts");
    for (const path of ["/en", "/pt-BR/settings", "/es", "/icon.svg", "/api/providers", "/api/catalog", "/api/image-models"]) {
        const response = proxy(request(path, {}));
        assert.notEqual(response.status, 401, path);
        assert.notEqual(response.status, 503, path);
        assert.equal(response.headers.get("www-authenticate"), null, path);
        assert.equal(access.guardWorkspaceRequest(request(path, {})), null);
    }
    for (const [path, method] of [["generate", "POST"], ["generate-image", "POST"], ["providers", "POST"],
        ["providers/[id]", "PATCH"], ["providers/[id]", "DELETE"], ["providers/[id]/test", "POST"],
        ["catalog", "POST"], ["catalog", "PATCH"], ["catalog", "DELETE"], ["catalog/discover", "POST"],
        ["gallery", "PATCH"], ["save-to-gallery", "POST"], ["tasks/[taskId]", "DELETE"],
        ["internal/reconcile-workflows", "POST"]]) {
        const route = h.load(`src/app/api/${path}/route.ts`);
        const response = await route[method](request(`/api/${path}`, { method, body: "unparsed fixture" }), context);
        assert.equal(response.status, 403, `${method} ${path}`);
        assert.equal((await response.json()).error, "ERR_DEMO_READ_ONLY");
        assert.equal(response.headers.get("www-authenticate"), null);
    }
    assert.equal(h.calls.store + h.calls.submit + h.calls.uploads + h.calls.config + h.calls.worker, 0);
    assert.throws(() => h.load("@/server/config/production").assertGenerationEnabled(), /ERR_GENERATION_DISABLED/);
});

test("demo mode fails closed if generation is enabled or demo configuration is invalid", () => {
    for (const env of [{ APP_DEMO_MODE: "true", GENERATION_ENABLED: "true" }, { APP_DEMO_MODE: "true", GENERATION_ENABLED: undefined },
        { APP_DEMO_MODE: "typo" }, { APP_DEMO_MODE: "true", GENERATION_ENABLED: "false", APP_ORIGIN: undefined }]) {
        const access = harness(env).load("@/server/security/workspace-access");
        assert.equal(access.guardWorkspaceRequest(request("/en", {})).status, 503);
    }
});

test("actual proxy covers APIs with extensions, image optimization and locale routing without scheduler redirects", () => {
    const loader = harness({ CRON_SECRET: cronSecret });
    const { default: proxy, config } = loader.load("src/proxy.ts");
    for (const path of ["/", "/en", "/pt-BR", "/es", "/es/settings", "/es/manifest.webmanifest", "/api/generate", "/api/uploaded/file.png", "/api/download/task.id", "/_next/image?url=private"]) {
        assert.equal(doesProxyMatch({ config, nextConfig: {}, url: `${origin}${path}` }), true, path);
        assert.ok(proxy(request(path)).status < 400, path);
    }
    assert.equal(doesProxyMatch({ config, nextConfig: {}, url: `${origin}/_next/static/chunks/app.js` }), false);
    assert.equal(doesProxyMatch({ config, nextConfig: {}, url: `${origin}/.well-known/workflow/v1/flow` }), false);
    for (const path of ["/.well-known/other", "/api/internal/reconcile-workflows", "/api/.well-known/workflow/secret"]) {
        assert.equal(doesProxyMatch({ config, nextConfig: {}, url: `${origin}${path}` }), true);
    }
    const localized = proxy(request("/", { headers: { "accept-language": "pt-BR" } }));
    assert.equal(localized.status, 307);
    assert.match(localized.headers.get("location"), /\/pt-BR$/);
    assert.equal(localized.headers.get("cache-control"), "private, no-store");
    assert.match(localized.headers.get("vary"), /Origin/);
    assert.equal(proxy(request("/api/health", {})).headers.get("x-middleware-next"), "1");
    const scheduler = proxy(request("/api/internal/process-tasks", { headers: { authorization: `Bearer ${cronSecret}` } }));
    assert.equal(scheduler.headers.get("x-middleware-next"), "1");
    assert.equal(scheduler.headers.get("location"), null);
});

test("development supports configured origins and validates write origins without a login", () => {
    for (const configuredOrigin of [undefined, "http://localhost:3000", origin]) {
        const access = harness({ NODE_ENV: "development", APP_ORIGIN: configuredOrigin }).load("@/server/security/workspace-access");
        for (const requestOrigin of ["http://localhost:3000", origin]) {
            assert.equal(access.guardWorkspaceRequest(new Request(`${requestOrigin}/api/tasks`)), null);
            const write = new Request(`${requestOrigin}/api/tasks`, { method: "POST", headers: { origin: configuredOrigin ?? requestOrigin } });
            assert.equal(access.guardWorkspaceRequest(write), null);
        }
    }
});

test("write routes reject foreign origins before downstream work", async () => {
    for (const [path, method] of [["generate", "POST"], ["generate-image", "POST"], ["gallery", "PATCH"],
        ["tasks/[taskId]", "POST"], ["tasks/[taskId]", "DELETE"], ["image-tasks/[taskId]", "POST"],
        ["image-tasks/[taskId]", "DELETE"], ["internal/reconcile-workflows", "POST"], ["save-to-gallery", "POST"]]) {
        const h = harness();
        const route = h.load(`src/app/api/${path}/route.ts`);
        const response = await route[method](request(`/api/${path}`, { method, headers: { origin: "https://evil.test" } }), context);
        assert.equal(response.status, 403, `${method} ${path}`);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(h.calls.store + h.calls.submit + h.calls.uploads + h.calls.config + h.calls.worker, 0, path);
    }
});

test("production generation defaults disabled before upload/store/provider and valid explicit enablement works", async () => {
    for (const path of ["generate", "generate-image"]) {
        const h = harness();
        const response = await h.load(`src/app/api/${path}/route.ts`).POST(request(`/api/${path}`, { method: "POST", body: "not parsed" }));
        assert.equal(response.status, 503);
        assert.equal((await response.json()).error, "ERR_GENERATION_DISABLED");
        assert.equal(h.calls.store + h.calls.submit + h.calls.uploads + h.calls.config, 0);
        const enabled = harness({ GENERATION_ENABLED: "true" });
        const form = new FormData(); form.set("model_id", "synthetic"); form.set("prompt", "synthetic fixture");
        const accepted = await enabled.load(`src/app/api/${path}/route.ts`).POST(request(`/api/${path}`, { method: "POST", body: form }));
        assert.equal(accepted.status, 202);
        assert.equal(enabled.calls.submit, 1);
    }
});

test("deployment profile rejects ephemeral/file and unconfigured external execution", () => {
    assert.equal(harness().load("@/server/config/production").assertRuntimeConfiguration().workerMode, "local");
    for (const env of [{ DEPLOYMENT_PROFILE: undefined }, { DEPLOYMENT_PROFILE: "distributed" }, { VERCEL: "1" },
        { TASK_WORKER_MODE: "external" }, { TASK_WORKER_MODE: "bad" }, { TASK_OBSERVATION_TIMEOUT_MS: "2" },
        { GENERATION_ENABLED: "yes" }, { DATABASE_URL: "synthetic", TASK_WORKER_MODE: "external", CRON_SECRET: cronSecret },
        { DATABASE_URL: "synthetic", TASK_WORKER_MODE: "external", CRON_SECRET: "short", TASK_SCHEDULER_CONFIGURED: "true" }]) {
        assert.throws(() => harness(env).load("@/server/config/production").assertRuntimeConfiguration(), /ERR_/);
    }
    const config = harness({ VERCEL: "1", DEPLOYMENT_PROFILE: "distributed", DATABASE_URL: "synthetic", TASK_WORKER_MODE: "external",
        TASK_SCHEDULER_CONFIGURED: "true", CRON_SECRET: cronSecret }).load("@/server/config/production").assertRuntimeConfiguration();
    assert.equal(config.workerMode, "external");
    assert.throws(() => harness({}, { "@/server/media/generated-assets": { assertGeneratedStorageConfigured() { throw new Error("ERR_STORAGE_CONFIG"); } } })
        .load("@/server/config/production").assertRuntimeConfiguration(), /ERR_STORAGE_CONFIG/);
});

test("actual generation handlers reject bad origins and oversized bodies without upload or submission", async () => {
    for (const path of ["generate", "generate-image"]) {
        const h = harness({ GENERATION_ENABLED: "true" });
        const route = h.load(`src/app/api/${path}/route.ts`);
        const forbidden = await route.POST(request(`/api/${path}`, { method: "POST", body: "unparsed", headers: { origin: "https://evil.test" } }));
        assert.equal(forbidden.status, 403);
        assert.equal(h.calls.config + h.calls.submit + h.calls.store + h.calls.uploads, 0);
        const oversized = await route.POST(request(`/api/${path}`, { method: "POST", body: "x".repeat(4 * 1024 * 1024 + 1),
            headers: { "content-type": "multipart/form-data; boundary=synthetic" } }));
        assert.equal(oversized.status, 413);
        assert.equal(h.calls.submit + h.calls.store + h.calls.uploads, 0);
    }
});

test("actual task resume/delete permits empty bodies and rejects content before storage", async () => {
    for (const path of ["tasks", "image-tasks"]) {
        for (const method of ["POST", "DELETE"]) {
            const h = harness();
            const handler = h.load(`src/app/api/${path}/[taskId]/route.ts`)[method];
            assert.equal((await handler(request(`/api/${path}/task`, { method, body: "{}" }), context)).status, 400);
            assert.equal(h.calls.store, 0);
            assert.equal((await handler(request(`/api/${path}/task`, { method }), context)).status, 404);
            assert.equal(h.calls.store, 1);
        }
    }
});

test("bounded multipart and JSON count real bytes, validate parts and cancel oversized streams", async () => {
    const limits = harness().load("@/server/http/request-limits");
    const form = new FormData(); form.set("prompt", "synthetic"); form.set("file", new File(["png"], "fixture.png"));
    assert.equal((await limits.readGenerationForm(request("/api/generate", { method: "POST", body: form }))).get("prompt"), "synthetic");
    await assert.rejects(limits.readGenerationForm(request("/api/generate", { method: "POST", body: "x" })), (e) => e.status === 415);
    const tooMany = new FormData(); for (let i = 0; i < 129; i++) tooMany.append(`field_${i}`, "x");
    await assert.rejects(limits.readGenerationForm(request("/api/generate", { method: "POST", body: tooMany })), /ERR_FORM_LIMIT/);
    const files = new FormData(); for (let i = 0; i < limits.GENERATION_MAX_FILES; i++) files.append("files", new File(["x"], `${i}.png`));
    assert.equal((await limits.readGenerationForm(request("/api/generate", { method: "POST", body: files }))).getAll("files").length, limits.GENERATION_MAX_FILES);
    files.append("files", new File(["x"], "excess.png"));
    await assert.rejects(limits.readGenerationForm(request("/api/generate", { method: "POST", body: files })), /ERR_FORM_LIMIT/);
    const field = new FormData(); field.set("prompt", "x".repeat(65537));
    await assert.rejects(limits.readGenerationForm(request("/api/generate", { method: "POST", body: field })), /ERR_FORM_LIMIT/);
    for (const declared of [undefined, "1", String(limits.GENERATION_BODY_MAX_BYTES + 1)]) {
        let cancelled = false;
        const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(limits.GENERATION_BODY_MAX_BYTES + 1)); }, cancel() { cancelled = true; } });
        await assert.rejects(limits.readGenerationForm(request("/api/generate", { method: "POST", body: stream, duplex: "half",
            headers: { "content-type": "multipart/form-data; boundary=synthetic", ...(declared ? { "content-length": declared } : {}) } })), (e) => e.status === 413);
        assert.equal(cancelled, true);
    }
    assert.equal((await limits.readBoundedJson(request("/api/gallery", { method: "POST", headers: { "content-type": "application/json" }, body: '{"ok":true}' }))).ok, true);
    await assert.rejects(limits.readBoundedJson(request("/api/gallery", { method: "POST", headers: { "content-type": "application/json", "content-length": "1" }, body: "{}" })), /ERR_INVALID_CONTENT_LENGTH/);
    await assert.rejects(limits.readBoundedJson(request("/api/gallery", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(17000) })), /ERR_REQUEST_TOO_LARGE/);
    await assert.rejects(limits.readBoundedJson(request("/api/gallery", { method: "POST", headers: { "content-type": "application/json" }, body: "{" })), /ERR_INVALID_JSON/);
    await limits.assertEmptyBody(request("/api/tasks/id", { method: "POST" }));
    await limits.assertEmptyBody(request("/api/tasks/id", { method: "DELETE" }));
    await assert.rejects(limits.assertEmptyBody(request("/api/tasks/id", { method: "POST", body: "x" })), /ERR_UNEXPECTED_BODY/);
});

test("Seedance 2.5 accepts 50 multipart references while rejecting per-slot excess before uploads", async () => {
    const catalog = createModuleLoader();
    const capability = catalog.load("@/server/catalog/toapis").TOAPIS_VIDEO_CAPABILITIES["toapis__seedance-2-5"];
    const { buildToapisRequest } = catalog.load("@/server/providers/toapis");
    let uploads = 0, submissions = 0;
    const upload = async () => { uploads++; return { remoteUrl: `https://fixtures.example.test/${uploads}`, localUrl: `/api/uploaded/${uploads}` }; };
    const h = harness({ GENERATION_ENABLED: "true" }, {
        "@/server/catalog/runtime": { getRuntimeCapability: async (mediaType, id) => mediaType === "video" && id === capability.id ? capability : undefined },
        "@/server/media/input-upload": { processImageUpload: upload, processFileUpload: upload },
        "@/server/generation/service": { submitGeneration: async input => {
            const { body } = buildToapisRequest({ ...input, providerModelId: capability.provider_model_id });
            assert.equal(body.image_with_roles.length, 30);
            assert.equal(body.video_with_roles.length, 10);
            assert.equal(body.audio_with_roles.length, 10);
            submissions++;
            return { httpStatus: 202, accepted: true, task_id: "synthetic-50-references" };
        } },
    });
    const form = new FormData();
    form.set("model_id", capability.id); form.set("prompt", "Synthetic reference test");
    for (const [kind, count, extension] of [["image", 30, "png"], ["video", 10, "mp4"], ["audio", 10, "mpeg"]]) {
        for (let i = 0; i < count; i++) form.append(`file_reference_${kind}s`, new File(["synthetic"], `${i}.${extension}`, { type: `${kind}/${extension}` }));
    }
    const handler = h.load("src/app/api/generate/route.ts").POST;
    const accepted = await handler(request("/api/generate", { method: "POST", body: form }));
    assert.equal(accepted.status, 202, await accepted.text());
    assert.equal(uploads, 50); assert.equal(submissions, 1);
    form.append("file_reference_images", new File(["synthetic"], "excess.png", { type: "image/png" }));
    const rejected = await handler(request("/api/generate", { method: "POST", body: form }));
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error, "ERR_INVALID_REFERENCE_COUNT");
    assert.equal(uploads, 50); assert.equal(submissions, 1);
});

test("body abort and timeout unblock a stalled reader and cancel it", async () => {
    for (const timeout of [false, true]) {
        let cancelled = false;
        const controller = new AbortController();
        const stream = new ReadableStream({ cancel() { cancelled = true; } });
        const globals = timeout ? { AbortSignal: class extends AbortSignal { static timeout(ms) { assert.equal(ms, 30000); return AbortSignal.timeout(5); } } } : {};
        const limits = harness({}, {}, globals).load("@/server/http/request-limits");
        const pending = limits.readBoundedJson(request("/api/gallery", { method: "POST", signal: controller.signal,
            headers: { "content-type": "application/json" }, body: stream, duplex: "half" }));
        const keepAlive = setTimeout(() => controller.abort(), 50);
        if (!timeout) controller.abort();
        try { await assert.rejects(pending, (e) => e.status === 408); }
        finally { clearTimeout(keepAlive); }
        assert.equal(cancelled, true);
    }
});

test("scheduler authenticates before worker work and fixes budget, input and failure behavior", async () => {
    const env = { DATABASE_URL: "synthetic", TASK_WORKER_MODE: "external", TASK_SCHEDULER_CONFIGURED: "true", CRON_SECRET: cronSecret };
    const h = harness(env);
    const route = h.load("src/app/api/internal/process-tasks/route.ts");
    assert.equal((await route.GET(request("/api/internal/process-tasks"))).status, 401);
    assert.equal(h.calls.worker + h.calls.config, 0);
    const auth = { authorization: `Bearer ${cronSecret}` };
    assert.equal((await route.GET(request("/api/internal/process-tasks?limit=50", { headers: auth }))).status, 400);
    assert.equal((await route.GET(request("/api/internal/process-tasks", { method: "HEAD", headers: auth }))).status, 405);
    assert.equal(h.calls.worker, 0);
    const result = await route.GET(request("/api/internal/process-tasks", { headers: auth }));
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { claimed: 2, processed: 2 });
    assert.equal(h.calls.workerOptions.limit, 10);
    assert.equal(h.calls.workerOptions.budgetMs, 50000);
    const failed = harness(env, { "@/server/tasks/poller": { processDueTasks() { throw new Error("sensitive upstream failure"); } } });
    const response = await failed.load("src/app/api/internal/process-tasks/route.ts").GET(request("/api/internal/process-tasks", { headers: auth }));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sensitive/);
});

test("startup is once per Node instance, skips builds/Edge and external mode never starts a timer", async () => {
    const local = harness({ NEXT_RUNTIME: "nodejs" });
    const register = local.load("src/instrumentation.ts").register;
    await Promise.all([register(), register()]);
    assert.equal(local.calls.start, 1); assert.equal(local.calls.store, 1);
    for (const env of [{ NEXT_RUNTIME: "edge" }, { NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-build" }]) {
        const h = harness(env); await h.load("src/instrumentation.ts").register();
        assert.equal(h.calls.config + h.calls.store + h.calls.start, 0);
    }
    const external = harness({ NEXT_RUNTIME: "nodejs", DATABASE_URL: "synthetic", TASK_WORKER_MODE: "external", TASK_SCHEDULER_CONFIGURED: "true", CRON_SECRET: cronSecret });
    await external.load("src/instrumentation.ts").register();
    assert.equal(external.calls.store, 1); assert.equal(external.calls.start, 0);
    await assert.rejects(harness({ NEXT_RUNTIME: "nodejs", APP_ORIGIN: undefined }).load("src/instrumentation.ts").register(), /ERR_STARTUP_CONFIGURATION_OR_STORAGE/);
    const storageFailure = harness({ NEXT_RUNTIME: "nodejs" }, { "@/server/tasks/store": { initStore() { throw new Error("private database error"); } } });
    await assert.rejects(storageFailure.load("src/instrumentation.ts").register(), /^Error: ERR_STARTUP_CONFIGURATION_OR_STORAGE$/);
    const readiness = await external.load("src/app/api/ready/route.ts").GET(request("/api/ready"));
    assert.equal((await readiness.json()).scheduler_heartbeat, "unverified");
});

test("submission parser preserves recovery on 202, task IDs on rejection and lost/malformed outcomes", async () => {
    const { parseSubmissionResponse, unknownSubmission } = harness().load("@/features/studio/lib/client-submission");
    for (const status of [200, 202]) {
        const result = await parseSubmissionResponse(Response.json({ task_id: "task", accepted: true, recovery_required: false }, { status }));
        assert.equal(result.accepted, true); assert.equal(result.needsReview, false); assert.equal(result.taskId, "task");
    }
    for (const error of ["ERR_SUBMISSION_OUTCOME_UNKNOWN", "ERR_ASSET_STORAGE_INCOMPLETE"]) {
        const result = await parseSubmissionResponse(Response.json({ task_id: "task", accepted: false, recovery_required: true, error }, { status: 202 }));
        assert.equal(result.needsReview, true); assert.equal(result.error, error); assert.equal(result.taskId, "task");
    }
    const rejected = await parseSubmissionResponse(Response.json({ task_id: "task", accepted: false, recovery_required: false, error: "ERR_PROVIDER_REJECTED" }, { status: 422 }));
    assert.equal(rejected.needsReview, false); assert.equal(rejected.taskId, "task");
    const preflight = await parseSubmissionResponse(Response.json({ accepted: false, recovery_required: false, error: "ERR_TASK_STORAGE_UNAVAILABLE" }, { status: 503 }));
    assert.equal(preflight.needsReview, false); assert.equal(preflight.taskId, undefined);
    for (const response of [new Response("not json", { status: 502 }), Response.json({}), Response.json({ task_id: "task", accepted: true }, { status: 202 })]) {
        assert.equal((await parseSubmissionResponse(response)).needsReview, true);
    }
    assert.equal(unknownSubmission().needsReview, true);
});


test("Workflow production requires the Vercel world and readiness does not claim execution proof", async () => {
    const env = { VERCEL: "1", VERCEL_DEPLOYMENT_ID: "synthetic-deployment", DEPLOYMENT_PROFILE: "distributed",
        DATABASE_URL: "synthetic", TASK_WORKER_MODE: "workflow" };
    assert.equal(harness(env).load("@/server/config/production").assertRuntimeConfiguration().workerMode, "workflow");
    assert.equal(harness({ ...env, TASK_WORKER_MODE: undefined }).load("@/server/config/production").assertRuntimeConfiguration().workerMode, "workflow");
    for (const invalid of [{ VERCEL_DEPLOYMENT_ID: undefined }, { WORKFLOW_TARGET_WORLD: "local" }, { VERCEL: undefined }]) {
        assert.throws(() => harness({ ...env, ...invalid }).load("@/server/config/production").assertRuntimeConfiguration(), /ERR_WORKFLOW_CONFIG/);
    }
    const ready = await harness(env).load("src/app/api/ready/route.ts").GET(request("/api/ready"));
    const result = await ready.json();
    assert.equal(result.ready, true); assert.equal(result.scheduler_heartbeat, "not_applicable");
    assert.equal(result.workflow_execution, "unverified");
});

test("Workflow recovery validates origin, bounds pagination and redacts infrastructure failures", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `synthetic-task-${String(i).padStart(2, "0")}`);
    let scans = 0; let starts = 0; let cursor;
    const env = { VERCEL: "1", VERCEL_DEPLOYMENT_ID: "synthetic-deployment", DEPLOYMENT_PROFILE: "distributed",
        DATABASE_URL: "synthetic", TASK_WORKER_MODE: "workflow", CRON_SECRET: cronSecret };
    const mocks = {
        "@/server/tasks/store": { listWorkflowCandidateIds: async after => { scans++; cursor = after; return ids; }, getTask: async id => ({ task_id: id }) },
        "@/server/tasks/workflow-dispatch": { startTaskWorkflow: async () => { starts++; } },
    };
    const h = harness(env, mocks);
    const route = h.load("src/app/api/internal/reconcile-workflows/route.ts");
    assert.equal((await route.POST(request("/api/internal/reconcile-workflows", { method: "POST", headers: { origin: "https://evil.test" } }))).status, 403);
    assert.equal((await route.POST(request("/api/internal/reconcile-workflows", { method: "POST", body: "{}" }))).status, 400);
    for (const query of ["?limit=50", "?after=", "?after=x&after=y", "?after=bad%2Fid"]) {
        assert.equal((await route.POST(request(`/api/internal/reconcile-workflows${query}`, { method: "POST" }))).status, 400);
    }
    assert.equal(scans + starts, 0);
    const accepted = await route.POST(request("/api/internal/reconcile-workflows?after=previous-id", { method: "POST" }));
    assert.equal(accepted.status, 200); assert.equal(cursor, "previous-id"); assert.equal(starts, 20);
    assert.deepEqual(await accepted.json(), { started: 20, nextCursor: ids.at(-1) });
    const failed = harness(env, { ...mocks, "@/server/tasks/workflow-dispatch": { startTaskWorkflow: async () => { throw new Error("private upstream token"); } } });
    const response = await failed.load("src/app/api/internal/reconcile-workflows/route.ts").POST(request("/api/internal/reconcile-workflows", { method: "POST" }));
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private upstream token/);
    const wrongMode = await harness({}, mocks).load("src/app/api/internal/reconcile-workflows/route.ts").POST(request("/api/internal/reconcile-workflows", { method: "POST" }));
    assert.equal(wrongMode.status, 503);
});
