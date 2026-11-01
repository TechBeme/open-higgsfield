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
const password = "synthetic-workspace-password-for-local-tests-only";
const cronSecret = "synthetic-scheduler-secret-for-local-tests-only";
const basic = `Basic ${Buffer.from(`operator:${password}`).toString("base64")}`;
const baseEnv = { NODE_ENV: "production", APP_ORIGIN: origin, APP_ACCESS_USER: "operator", APP_ACCESS_PASSWORD: password,
    DEPLOYMENT_PROFILE: "single-process", TASK_WORKER_MODE: "local", ASSET_STORAGE_MODE: "local",
    OPEN_HIGGSFIELD_STORAGE_DIR: "/tmp/synthetic-workspace-no-real-files" };
const context = { params: Promise.resolve({ taskId: "synthetic-task", filename: "synthetic.png" }) };
const caps = { id: "synthetic", provider: "freepik", media_slots: [], prompt_required: true };

function request(path = "/api/tasks", options = {}) {
    const { authenticated = true, method = "GET", headers, ...rest } = options;
    return new NextRequest(`${origin}${path}`, { method, headers: {
        ...(authenticated ? { authorization: basic } : {}),
        ...(!["GET", "HEAD", "OPTIONS"].includes(method) ? { origin } : {}), ...headers,
    }, ...rest });
}

function harness(env = {}, extraMocks = {}, globals = {}) {
    const calls = { store: 0, submit: 0, uploads: 0, config: 0, worker: 0, start: 0 };
    const store = async () => { calls.store++; return undefined; };
    const mocks = {
        "@/lib/task-store": { initStore: store, getTask: store, getPublicTask: store, listTasks: store, deleteTask: store, resumeTask: store },
        "@/lib/generated-assets": { assertGeneratedStorageConfigured: () => { calls.config++; return "local"; } },
        "@/lib/generation-service": { submitGeneration: async () => { calls.submit++; return { httpStatus: 202, task_id: "synthetic-task", accepted: true, recovery_required: false }; } },
        "@/lib/media-upload": { processImageUpload: async () => { calls.uploads++; }, processFileUpload: async () => { calls.uploads++; }, resolveUrl: async () => { calls.uploads++; } },
        "@/lib/upload": { saveInputLocally: async () => { calls.uploads++; }, uploadToTmpfiles: async () => { calls.uploads++; } },
        "@/models/capabilities/video": { VIDEO_CAPABILITIES: { synthetic: caps } },
        "@/models/capabilities/image": { IMAGE_CAPABILITIES: { synthetic: caps } },
        "@/models/adapters/video": { getVideoAdapter: () => ({ validate: () => [] }) },
        "@/models/adapters/image": { getImageAdapter: () => ({ validate: () => [] }) },
        "@/lib/poller": { processDueTasks: async (options) => { calls.worker++; calls.workerOptions = options; return { claimed: 2, processed: 2 }; }, startLocalWorker: () => { calls.start++; } },
        ...extraMocks,
    };
    return { calls, ...createModuleLoader({ env: { ...baseEnv, ...env }, mocks, globals }) };
}

test("Basic access, strict configuration, origin and credential-role boundaries", () => {
    const access = harness({ CRON_SECRET: cronSecret }).load("@/lib/workspace-access");
    assert.equal(access.guardWorkspaceRequest(request()), null);
    for (const authorization of ["", "Basic broken", "Basic !!!", `Basic ${Buffer.from("operator:wrong").toString("base64")}`, `Bearer ${cronSecret}`, "x".repeat(5000)]) {
        assert.equal(access.guardWorkspaceRequest(request("/api/tasks", { headers: { authorization } })).status, 401);
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
    for (const env of [{ APP_ACCESS_PASSWORD: undefined }, { APP_ACCESS_PASSWORD: "short" }, { APP_ACCESS_USER: "bad:user" },
        { APP_ORIGIN: undefined }, { APP_ORIGIN: "http://localhost:3000" }, { APP_ORIGIN: `${origin}/` }, { APP_ORIGIN: `${origin}/path` }]) {
        assert.equal(harness(env).load("@/lib/workspace-access").guardWorkspaceRequest(request()).status, 503);
    }
    const development = harness({ NODE_ENV: "development", APP_ORIGIN: undefined, APP_ACCESS_USER: undefined, APP_ACCESS_PASSWORD: undefined }).load("@/lib/workspace-access");
    assert.equal(development.guardWorkspaceRequest(new Request("http://localhost:3000/api/tasks")), null);
    assert.equal(development.guardWorkspaceRequest(new Request("http://example.test/api/tasks")).status, 403);
});

test("actual proxy covers APIs with extensions, image optimization and locale routing without scheduler redirects", () => {
    const loader = harness({ CRON_SECRET: cronSecret });
    const { default: proxy, config } = loader.load("src/proxy.ts");
    for (const path of ["/", "/en", "/pt-BR", "/api/generate", "/api/uploaded/file.png", "/api/download/task.id", "/_next/image?url=private", "/api/internal/process-tasks"]) {
        assert.equal(doesProxyMatch({ config, nextConfig: {}, url: `${origin}${path}` }), true, path);
        assert.equal(proxy(request(path, { authenticated: false })).status, 401, path);
    }
    assert.equal(doesProxyMatch({ config, nextConfig: {}, url: `${origin}/_next/static/chunks/app.js` }), false);
    const localized = proxy(request("/", { headers: { "accept-language": "pt-BR" } }));
    assert.equal(localized.status, 307);
    assert.match(localized.headers.get("location"), /\/pt-BR$/);
    assert.equal(localized.headers.get("cache-control"), "private, no-store");
    assert.match(localized.headers.get("vary"), /Authorization/);
    assert.equal(proxy(request("/api/health", { authenticated: false })).headers.get("x-middleware-next"), "1");
    const scheduler = proxy(request("/api/internal/process-tasks", { headers: { authorization: `Bearer ${cronSecret}` } }));
    assert.equal(scheduler.headers.get("x-middleware-next"), "1");
    assert.equal(scheduler.headers.get("location"), null);
});

test("credential-free development requires loopback configuration and request even with APP_ORIGIN set", async () => {
    const localOrigins = ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000", "https://localhost:3443"];
    for (const configuredOrigin of [undefined, ...localOrigins, origin]) {
        const h = harness({ NODE_ENV: "development", APP_ORIGIN: configuredOrigin, APP_ACCESS_USER: undefined, APP_ACCESS_PASSWORD: undefined });
        const access = h.load("@/lib/workspace-access");
        for (const requestOrigin of [...localOrigins, origin]) {
            for (const method of ["GET", "POST"]) {
                const candidate = new Request(`${requestOrigin}/api/tasks`, { method, headers: { origin: configuredOrigin ?? requestOrigin } });
                const rejection = access.guardWorkspaceRequest(candidate);
                const expected = configuredOrigin === origin ? 503 : requestOrigin === origin ? 403 : null;
                assert.equal(rejection?.status ?? null, expected, `${configuredOrigin} ${requestOrigin} ${method}`);
            }
        }
        const handlerResponse = await h.load("src/app/api/tasks/route.ts").GET(new NextRequest(`${origin}/api/tasks`));
        assert.equal(handlerResponse.status, configuredOrigin === origin ? 503 : 403);
        assert.equal(h.calls.store, 0);
    }
    const authenticated = harness({ NODE_ENV: "development" }).load("@/lib/workspace-access");
    assert.equal(authenticated.guardWorkspaceRequest(request()), null);
    assert.equal(authenticated.guardWorkspaceRequest(request("/api/tasks", { method: "POST" })), null);
    assert.equal(authenticated.guardWorkspaceRequest(request("/api/tasks", { authenticated: false })).status, 401);
});

test("every real protected route denies unauthorized requests before downstream work", async () => {
    const paths = [
        ["generate", "POST"], ["generate-image", "POST"], ["tasks", "GET"], ["image-tasks", "GET"],
        ["tasks/[taskId]", "GET"], ["tasks/[taskId]", "POST"], ["tasks/[taskId]", "DELETE"],
        ["image-tasks/[taskId]", "GET"], ["image-tasks/[taskId]", "POST"], ["image-tasks/[taskId]", "DELETE"],
        ["events/[taskId]", "GET"], ["download/[taskId]", "GET"], ["uploaded/[filename]", "GET"],
        ["save-to-gallery", "POST"], ["models", "GET"], ["image-models", "GET"], ["ready", "GET"],
    ];
    for (const [path, method] of paths) {
        const h = harness();
        const route = h.load(`src/app/api/${path}/route.ts`);
        const response = await route[method](request(`/api/${path}`, { method, authenticated: false }), context);
        assert.equal(response.status, 401, `${method} ${path}`);
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
    assert.equal(harness().load("@/lib/production-config").assertRuntimeConfiguration().workerMode, "local");
    for (const env of [{ DEPLOYMENT_PROFILE: undefined }, { DEPLOYMENT_PROFILE: "distributed" }, { VERCEL: "1" },
        { TASK_WORKER_MODE: "external" }, { TASK_WORKER_MODE: "bad" }, { TASK_OBSERVATION_TIMEOUT_MS: "2" },
        { GENERATION_ENABLED: "yes" }, { DATABASE_URL: "synthetic", TASK_WORKER_MODE: "external", CRON_SECRET: cronSecret },
        { DATABASE_URL: "synthetic", TASK_WORKER_MODE: "external", CRON_SECRET: password, TASK_SCHEDULER_CONFIGURED: "true" }]) {
        assert.throws(() => harness(env).load("@/lib/production-config").assertRuntimeConfiguration(), /ERR_/);
    }
    const config = harness({ VERCEL: "1", DEPLOYMENT_PROFILE: "distributed", DATABASE_URL: "synthetic", TASK_WORKER_MODE: "external",
        TASK_SCHEDULER_CONFIGURED: "true", CRON_SECRET: cronSecret }).load("@/lib/production-config").assertRuntimeConfiguration();
    assert.equal(config.workerMode, "external");
    assert.throws(() => harness({}, { "@/lib/generated-assets": { assertGeneratedStorageConfigured() { throw new Error("ERR_STORAGE_CONFIG"); } } })
        .load("@/lib/production-config").assertRuntimeConfiguration(), /ERR_STORAGE_CONFIG/);
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
    const limits = harness().load("@/lib/request-limits");
    const form = new FormData(); form.set("prompt", "synthetic"); form.set("file", new File(["png"], "fixture.png"));
    assert.equal((await limits.readGenerationForm(request("/api/generate", { method: "POST", body: form }))).get("prompt"), "synthetic");
    await assert.rejects(limits.readGenerationForm(request("/api/generate", { method: "POST", body: "x" })), (e) => e.status === 415);
    const tooMany = new FormData(); for (let i = 0; i < 129; i++) tooMany.append(`field_${i}`, "x");
    await assert.rejects(limits.readGenerationForm(request("/api/generate", { method: "POST", body: tooMany })), /ERR_FORM_LIMIT/);
    const files = new FormData(); for (let i = 0; i < 17; i++) files.append("files", new File(["x"], `${i}.png`));
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

test("body abort and timeout unblock a stalled reader and cancel it", async () => {
    for (const timeout of [false, true]) {
        let cancelled = false;
        const controller = new AbortController();
        const stream = new ReadableStream({ cancel() { cancelled = true; } });
        const globals = timeout ? { AbortSignal: class extends AbortSignal { static timeout(ms) { assert.equal(ms, 30000); return AbortSignal.timeout(5); } } } : {};
        const limits = harness({}, {}, globals).load("@/lib/request-limits");
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
    const failed = harness(env, { "@/lib/poller": { processDueTasks() { throw new Error("sensitive upstream failure"); } } });
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
    await assert.rejects(harness({ NEXT_RUNTIME: "nodejs", APP_ACCESS_PASSWORD: undefined }).load("src/instrumentation.ts").register(), /ERR_STARTUP_CONFIGURATION_OR_STORAGE/);
    const storageFailure = harness({ NEXT_RUNTIME: "nodejs" }, { "@/lib/task-store": { initStore() { throw new Error("private database error"); } } });
    await assert.rejects(storageFailure.load("src/instrumentation.ts").register(), /^Error: ERR_STARTUP_CONFIGURATION_OR_STORAGE$/);
    const readiness = await external.load("src/app/api/ready/route.ts").GET(request("/api/ready"));
    assert.equal((await readiness.json()).scheduler_heartbeat, "unverified");
});

test("submission parser preserves recovery on 202, task IDs on rejection and lost/malformed outcomes", async () => {
    const { parseSubmissionResponse, unknownSubmission } = harness().load("@/lib/client-submission");
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
