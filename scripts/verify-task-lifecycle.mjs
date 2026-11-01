import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createModuleLoader } from "./test-module-loader.mjs";

const caps = { id: "synthetic", provider: "freepik", provider_model_id: "synthetic", media_slots: [], prompt_required: true };
const input = (mediaType = "image") => ({ mediaType, modelId: "synthetic", capabilities: caps, params: { prompt: "synthetic lamp" }, media: {} });
const fixture = (id, extra = {}) => ({ task_id: id, media_type: "image", model_id: "synthetic", status: "IN_PROGRESS",
    created_at: new Date().toISOString(), provider_id: "freepik", provider_operation: { pollUrl: `/synthetic/${id}` },
    lifecycle_phase: "polling", next_poll_at: new Date(Date.now() - 1_000).toISOString(),
    deadline_at: new Date(Date.now() + 86_400_000).toISOString(), poll_failures: 0,
    lease_token: null, lease_expires_at: null, deleted_at: null, ...extra });

async function harness(t, options = {}) {
    const dir = options.dir ?? await fs.mkdtemp(path.join(os.tmpdir(), "task-lifecycle-"));
    if (!options.dir) t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const state = { submitCalls: 0, pollCalls: 0, attachCalls: 0, failWrites: false, ...options.state };
    const provider = {
        submit: async (request) => { state.submitCalls++; return options.submit ? options.submit(request) : { status: "CREATED", operation: { taskId: "synthetic-operation" } }; },
        poll: async (request) => { state.pollCalls++; return options.poll ? options.poll(request) : { status: "IN_PROGRESS" }; },
    };
    const mocks = {
        "@/providers/registry": { resolveProvider: () => ({ provider, providerId: "freepik", providerModelId: "synthetic" }), getProvider: () => provider },
        "@/lib/generated-assets": { attachGeneratedAssets: async (task, assets, transferOptions) => {
            state.attachCalls++;
            assert.ok(transferOptions.signal);
            if (options.attach) return options.attach(task, assets);
            if (task.media_type === "image") { task.result_paths = ["/synthetic/result.png"]; task.result_urls = ["/api/download/result?index=0"]; }
            else { task.video_path = "/synthetic/result.mp4"; task.video_urls = ["https://synthetic.invalid/result.mp4"]; }
        } },
        "node:fs/promises": { ...fs, rename: (...args) => state.failWrites ? Promise.reject(new Error("synthetic disk failure")) : fs.rename(...args) },
        "next/server": { NextResponse: Response },
        // T5 separately exercises real authorization/configuration. Keep its real body parser here.
        "@/lib/workspace-access": { guardWorkspaceRequest: () => null,
            accessFailure: (error, status) => Response.json({ error, accepted: false, recovery_required: false }, { status }) },
        "@/lib/production-config": { assertGenerationEnabled: () => {} },
        "@/models/capabilities/video": { VIDEO_CAPABILITIES: { synthetic: caps } },
        "@/models/capabilities/image": { IMAGE_CAPABILITIES: { synthetic: caps } },
        "@/models/adapters/video": { getVideoAdapter: () => ({ validate: () => [] }) },
        "@/models/adapters/image": { getImageAdapter: () => ({ validate: () => [] }) },
        "@/lib/upload": { saveInputLocally: async () => { throw new Error("No real uploads in tests"); }, uploadToTmpfiles: async () => { throw new Error("No real uploads in tests"); } },
        "@/lib/media-upload": { processImageUpload: async () => { throw new Error("No real uploads in tests"); } },
        ...options.mocks,
    };
    const loader = createModuleLoader({ env: { OPEN_HIGGSFIELD_STORAGE_DIR: dir, TASK_WORKER_MODE: "external", ...options.env }, mocks, globals: options.globals });
    const store = loader.load("@/lib/task-store");
    if (options.wrapStore) mocks["@/lib/task-store"] = options.wrapStore(store);
    return { dir, state, store, loader, service: loader.load("@/lib/generation-service"), poller: loader.load("@/lib/poller") };
}

async function due(store, id) {
    const current = await store.getTask(id);
    await store.updateTask({ ...current, next_poll_at: new Date(Date.now() - 1_000).toISOString() });
}

function request(route, media) {
    const body = new FormData(); body.set("model_id", "synthetic"); body.set("prompt", "synthetic lamp");
    if (media === "video") body.set("settings", "{}");
    return new Request(`http://localhost/api/${route}`, { method: "POST", body });
}

test("file mutations serialize, use guarded versions and preserve committed state on write failure", async (t) => {
    const h = await harness(t);
    await Promise.all(Array.from({ length: 12 }, (_, i) => h.store.createTask(fixture(`file-${i}`))));
    assert.equal((await h.store.listTasks("image")).tasks.length, 12);
    const stale = await h.store.getTask("file-0");
    await h.store.updateTask({ ...stale, status: "COMPLETED", lifecycle_phase: "terminal", next_poll_at: null, result_paths: ["/synthetic/result.png"] });
    assert.equal(await h.store.updateTask(stale), undefined);
    await h.store.deleteTask("file-0");
    assert.equal(await h.store.getTask("file-0"), undefined);
    await assert.rejects(h.store.createTask(fixture("file-0")), /ERR_TASK_ID_CONFLICT/);
    const before = await fs.readFile(path.join(h.dir, "tasks_history.json"), "utf8");
    h.state.failWrites = true;
    const row = await h.store.getTask("file-1");
    await assert.rejects(h.store.updateTask({ ...row, error_message: "not committed" }), /ERR_TASK_STORAGE_UNAVAILABLE/);
    assert.equal((await h.store.getTask("file-1")).error_message, undefined);
    assert.equal(await fs.readFile(path.join(h.dir, "tasks_history.json"), "utf8"), before);
});

test("corrupt local history fails closed and legacy arrays normalize without losing output", async (t) => {
    const h = await harness(t);
    await fs.writeFile(path.join(h.dir, "tasks_history.json"), "invalid-json");
    await assert.rejects(h.store.initStore(), /ERR_TASK_HISTORY_CORRUPT/);
    const legacy = fixture("legacy", { status: "COMPLETED", lifecycle_phase: undefined, result_urls: ["data:image/png;base64,AAAA"] });
    await fs.writeFile(path.join(h.dir, "tasks_history.json"), JSON.stringify([legacy]));
    await h.store.initStore();
    assert.equal((await h.store.getTask("legacy")).status, "COMPLETED");
    assert.equal((await h.store.listTasks("image")).tasks[0].result_urls[0], "/api/download/legacy?index=0");
});

test("file cursors cover mixed-case and punctuation IDs with normalized legacy timestamps", async (t) => {
    const h = await harness(t);
    const ids = ["a", "A", "a-", "a_", "Z", "z"];
    const legacy = ids.map((id, index) => fixture(id, { status: "COMPLETED", lifecycle_phase: "terminal", next_poll_at: null,
        created_at: index % 2 ? "2026-01-01T03:00:00+03:00" : "2026-01-01T00:00:00Z", result_urls: ["https://synthetic.invalid/a.png"] }));
    await fs.writeFile(path.join(h.dir, "tasks_history.json"), JSON.stringify(legacy));
    const found = []; let cursor;
    do {
        const page = await h.store.listTasks("image", { limit: 1, cursor });
        found.push(...page.tasks.map((task) => task.task_id)); cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(found, [...ids].sort().reverse());
});

test("submission reserves durably before POST and never dispatches on persistence failure", async (t) => {
    let h;
    h = await harness(t, { submit: async (req) => {
        const stored = await h.store.getTask(req.clientTaskId);
        assert.equal(stored.lifecycle_phase, "submitting");
        assert.ok(stored.lease_token); assert.ok(req.signal);
        return { status: "CREATED", operation: { taskId: "upstream" } };
    } });
    h.state.failWrites = true;
    await assert.rejects(h.service.submitGeneration(input()), /ERR_TASK_STORAGE_UNAVAILABLE/);
    assert.equal(h.state.submitCalls, 0);
    h.state.failWrites = false;
    const result = await h.service.submitGeneration(input());
    assert.equal(result.httpStatus, 202); assert.equal(result.accepted, true);
    assert.equal((await h.store.getTask(result.task_id)).provider_operation.taskId, "upstream");
});

test("lost operation persistence and restart retain uncertainty without replaying POST", async (t) => {
    const h = await harness(t, { wrapStore: (store) => ({ ...store, updateTask: async () => { throw new Error("ERR_TASK_STORAGE_UNAVAILABLE"); } }) });
    const result = await h.service.submitGeneration(input());
    assert.equal(result.recovery_required, true); assert.equal(result.accepted, false);
    const filename = path.join(h.dir, "tasks_history.json");
    const doc = JSON.parse(await fs.readFile(filename, "utf8"));
    doc.tasks[0].lease_expires_at = new Date(Date.now() - 1_000).toISOString();
    doc.tasks[0].next_poll_at = doc.tasks[0].lease_expires_at;
    await fs.writeFile(filename, JSON.stringify(doc));
    const restarted = await harness(t, { dir: h.dir });
    await restarted.poller.processDueTasks({ taskId: result.task_id });
    const recovered = await restarted.store.getTask(result.task_id);
    assert.equal(recovered.lifecycle_phase, "submission_unknown");
    assert.equal(restarted.state.submitCalls, 0); assert.equal(restarted.state.pollCalls, 0);
    assert.equal(await restarted.store.resumeTask(result.task_id), "conflict");
});

test("retryable GET failures persist Retry-After and recover after process restart", async (t) => {
    const h = await harness(t, { poll: async () => { throw Object.assign(new Error("ERR_RATE_LIMIT"), { retryable: true, retryAfterMs: 65_000 }); } });
    await h.store.createTask(fixture("retry"));
    const start = Date.now();
    await h.poller.processDueTasks({ taskId: "retry" });
    const pending = await h.store.getTask("retry");
    assert.equal(pending.lifecycle_phase, "polling"); assert.equal(pending._done, false);
    assert.equal(pending.poll_failures, 1); assert.ok(Date.parse(pending.next_poll_at) >= start + 65_000);
    await due(h.store, "retry");
    const restarted = await harness(t, { dir: h.dir, poll: async () => ({ status: "COMPLETED", assets: [{ url: "https://synthetic.invalid/image.png" }] }) });
    await restarted.poller.processDueTasks({ taskId: "retry" });
    assert.equal((await restarted.store.getTask("retry")).status, "COMPLETED");
    assert.equal(restarted.state.submitCalls, 0);
});

test("network and timeout GET errors retry; only explicit provider task failure is terminal", async (t) => {
    for (const error of [new TypeError("synthetic socket failure"), new DOMException("deadline", "TimeoutError")]) {
        const h = await harness(t, { poll: async () => { throw error; } });
        await h.store.createTask(fixture("transient"));
        await h.poller.processDueTasks({ taskId: "transient" });
        assert.equal((await h.store.getTask("transient")).lifecycle_phase, "polling");
    }
    const failed = await harness(t, { poll: async () => ({ status: "FAILED", error: "ERR_INVALID_PROMPT" }) });
    await failed.store.createTask(fixture("failed")); await failed.poller.processDueTasks({ taskId: "failed" });
    assert.equal((await failed.store.getTask("failed")).lifecycle_phase, "terminal");
    assert.equal((await failed.store.getTask("failed")).error_message, "ERR_INVALID_PROMPT");
});

test("twenty-minute preparation stays pending; observation deadline pauses and safe resume only performs GET", async (t) => {
    const h = await harness(t);
    await h.store.createTask(fixture("long", { created_at: new Date(Date.now() - 21 * 60_000).toISOString() }));
    await h.poller.processDueTasks({ taskId: "long" });
    assert.equal((await h.store.getTask("long")).status, "IN_PROGRESS");
    const long = await h.store.getTask("long");
    await h.store.updateTask({ ...long, next_poll_at: new Date(Date.now() - 1_000).toISOString(), deadline_at: new Date(Date.now() - 500).toISOString() });
    await h.poller.processDueTasks({ taskId: "long" });
    const paused = await h.store.getTask("long");
    assert.equal(paused.lifecycle_phase, "paused"); assert.ok(paused.provider_operation);
    assert.equal(h.state.pollCalls, 1);
    assert.equal(await h.store.resumeTask("long"), "resumed");
    await h.poller.processDueTasks({ taskId: "long" });
    assert.equal(h.state.pollCalls, 2); assert.equal(h.state.submitCalls, 0);
});

test("assets never publish completion early, and async materialization recovers", async (t) => {
    let h; let fail = true;
    h = await harness(t, { poll: async () => ({ status: "COMPLETED", assets: [{ url: "https://synthetic.invalid/image.png" }] }),
        attach: async (task) => {
            const stored = await h.store.getTask(task.task_id);
            assert.equal(stored.status, "IN_PROGRESS"); assert.equal(stored.lifecycle_phase, "materializing");
            if (fail) throw new Error("synthetic asset failure");
            task.result_paths = ["/synthetic/image.png"];
        } });
    await h.store.createTask(fixture("assets")); await h.poller.processDueTasks({ taskId: "assets" });
    assert.equal((await h.store.getTask("assets")).lifecycle_phase, "materializing");
    assert.equal((await h.store.getTask("assets"))._done, false);
    fail = false; await due(h.store, "assets"); await h.poller.processDueTasks({ taskId: "assets" });
    assert.equal((await h.store.getTask("assets")).status, "COMPLETED");
    assert.equal(h.state.submitCalls, 0);
});

test("synchronous byte-only output loss requires attention and never resubmits", async (t) => {
    const h = await harness(t, { submit: async () => ({ status: "COMPLETED", assets: [{ data: new Uint8Array([1]) }] }),
        attach: async () => { throw new Error("synthetic disk failure"); } });
    const result = await h.service.submitGeneration(input());
    assert.equal(result.error, "ERR_ASSET_STORAGE_INCOMPLETE"); assert.equal(result.recovery_required, true);
    assert.equal((await h.store.getTask(result.task_id)).lifecycle_phase, "paused");
    await h.poller.processDueTasks(); assert.equal(h.state.submitCalls, 1);
});

test("deleting a task during attachment fences the late completed output", async (t) => {
    let h;
    h = await harness(t, { poll: async () => ({ status: "COMPLETED", assets: [{ url: "https://synthetic.invalid/result" }] }),
        attach: async (task) => { await h.store.deleteTask(task.task_id); task.result_paths = ["/synthetic/result.png"]; } });
    await h.store.createTask(fixture("deleted")); await h.poller.processDueTasks({ taskId: "deleted" });
    assert.equal(await h.store.getTask("deleted"), undefined);
});

test("final completion storage failure is recoverable after lease expiry and restart", async (t) => {
    let failCompletion = true;
    const h = await harness(t, {
        poll: async () => ({ status: "COMPLETED", assets: [{ url: "https://synthetic.invalid/result" }] }),
        wrapStore: (store) => ({ ...store, updateTask: async (task, options) => {
            if (task.status === "COMPLETED" && failCompletion) throw new Error("ERR_TASK_STORAGE_UNAVAILABLE");
            return store.updateTask(task, options);
        } }),
    });
    await h.store.createTask(fixture("commit-failed"));
    await assert.rejects(h.poller.processDueTasks({ taskId: "commit-failed" }), /ERR_TASK_STORAGE_UNAVAILABLE/);
    assert.equal((await h.store.getTask("commit-failed")).lifecycle_phase, "materializing");
    const file = path.join(h.dir, "tasks_history.json");
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    saved.tasks[0].lease_expires_at = new Date(Date.now() - 1_000).toISOString();
    await fs.writeFile(file, JSON.stringify(saved));
    failCompletion = false;
    const restarted = await harness(t, { dir: h.dir,
        poll: async () => ({ status: "COMPLETED", assets: [{ url: "https://synthetic.invalid/result" }] }) });
    await restarted.poller.processDueTasks({ taskId: "commit-failed" });
    assert.equal((await restarted.store.getTask("commit-failed")).status, "COMPLETED");
    assert.equal(restarted.state.submitCalls, 0);
});

test("an SDK ignoring cancellation cannot publish a late result after the worker budget", async (t) => {
    let finish;
    const h = await harness(t, { poll: () => new Promise((resolve) => { finish = resolve; }) });
    await h.store.createTask(fixture("late"));
    const run = h.poller.processDueTasks({ taskId: "late", budgetMs: 1_000, limit: 1 });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await run;
    assert.equal((await h.store.getTask("late")).lifecycle_phase, "polling");
    finish({ status: "COMPLETED", assets: [{ url: "https://synthetic.invalid/result" }] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await h.store.getTask("late")).status, "IN_PROGRESS");
    assert.equal(h.state.attachCalls, 0);
});

test("cancellation before the dispatch microtask prevents invoking an abort-ignoring provider", async () => {
    const runtime = createModuleLoader().load("@/lib/task-runtime");
    const controller = new AbortController();
    let calls = 0;
    const pending = runtime.withSignal(controller.signal, async () => { calls++; return "billable"; });
    controller.abort(new Error("cancelled before dispatch"));
    await assert.rejects(pending, /cancelled before dispatch/);
    assert.equal(calls, 0);
});

test("worker deadline covers stalled claims and materialization/recovery writes", async (t) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (const stage of ["claim", "materializing", "recovery"]) await t.test(stage, async () => {
        const starts = []; let attachments = 0; let origin;
        const task = { ...fixture("slow-storage"), revision: 2, lease_token: "test", lease_expires_at: new Date(Date.now() + 120_000).toISOString() };
        const loader = createModuleLoader({ env: { TASK_WORKER_MODE: "external" }, mocks: {
            "@/lib/task-store": {
                claimTask: async (_token, _lease, _id, options) => { assert.ok(options.signal); await wait(stage === "claim" ? 1_400 : 10); return task; },
                updateTask: async (value, options) => { assert.ok(options.signal); starts.push(performance.now() - origin); await wait(600); return { ...value, revision: value.revision + 1 }; },
            },
            "@/providers/registry": { getProvider: () => ({ poll: async () => {
                await wait(800); if (stage === "recovery") throw new TypeError("synthetic timeout");
                return { status: "COMPLETED", assets: [{ url: "https://synthetic.invalid/result" }] };
            } }) },
            "@/lib/generated-assets": { attachGeneratedAssets: async () => { attachments++; } },
        } });
        const poller = loader.load("@/lib/poller");
        origin = performance.now();
        const result = await poller.processDueTasks({ budgetMs: 1_000, limit: 1 });
        assert.ok(performance.now() - origin < 1_200, `worker exceeded shared budget in ${stage}`);
        assert.equal(result.processed, 0); assert.equal(attachments, 0);
        await wait(650); // Stalled mocks may finish, but must not trigger another write or asset call.
        assert.equal(starts.length, stage === "claim" ? 0 : 1);
        assert.ok(starts.every((elapsed) => elapsed < 1_000)); assert.equal(attachments, 0);
    });
});

test("database schema and claim share cancellation even when the transport ignores it", async (t) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (const stage of ["schema", "claim"]) await t.test(stage, async () => {
        let queries = 0; let polls = 0;
        const loader = createModuleLoader({ env: { DATABASE_URL: "postgres://synthetic.invalid/test", TASK_WORKER_MODE: "external" }, mocks: {
            "@neondatabase/serverless": { neon: () => ({ query: async (sql, _values, options) => {
                queries++; assert.ok(options.fetchOptions.signal);
                if (sql.startsWith("SELECT version") && stage === "claim") return [{ version: 2 }];
                await wait(1_400); return sql.startsWith("SELECT version") ? [{ version: 2 }] : [];
            } }) },
            "@/providers/registry": { getProvider: () => ({ poll: async () => { polls++; return { status: "IN_PROGRESS" }; } }) },
            "@/lib/generated-assets": { attachGeneratedAssets: async () => {} },
        } });
        const poller = loader.load("@/lib/poller"); const started = performance.now();
        await poller.processDueTasks({ budgetMs: 1_000, limit: 1 });
        assert.ok(performance.now() - started < 1_200);
        await wait(500);
        assert.equal(queries, stage === "schema" ? 1 : 2); assert.equal(polls, 0);
    });
});

test("nonretryable observation failure pauses without declaring provider failure", async (t) => {
    const h = await harness(t, { poll: async () => { throw Object.assign(new Error("ERR_PROVIDER_AUTH"), { retryable: false }); } });
    await h.store.createTask(fixture("auth"));
    await h.poller.processDueTasks({ taskId: "auth" });
    const task = await h.store.getTask("auth");
    assert.equal(task.lifecycle_phase, "paused"); assert.equal(task.recovery_required, true);
    assert.ok(task.provider_operation); assert.equal(task.next_poll_at, null);
});

test("real image/video generation routes expose accepted, rejected, uncertain and storage-failure contracts", async (t) => {
    for (const [route, media] of [["generate-image", "image"], ["generate", "video"]]) {
        await t.test(`${media} validation prevents dispatch`, async (t) => {
            const h = await harness(t);
            const body = new FormData(); body.set("model_id", "synthetic");
            const result = await h.loader.load(`src/app/api/${route}/route.ts`).POST(new Request(`http://localhost/api/${route}`, { method: "POST", body }));
            assert.equal(result.status, 400); assert.equal(h.state.submitCalls, 0);
            assert.equal((await result.json()).accepted, false);
        });
        for (const scenario of ["pending", "completed", "rejected", "unknown", "storage"]) {
            await t.test(`${media} ${scenario}`, async (t) => {
                const h = await harness(t, { submit: async () => {
                    if (scenario === "rejected") throw Object.assign(new Error("ERR_INPUT_REJECTED"), { submissionUncertain: false });
                    if (scenario === "unknown") throw new TypeError("synthetic response lost");
                    return scenario === "completed" ? { status: "COMPLETED", assets: [{ data: new Uint8Array([1]) }] }
                        : { status: "CREATED", operation: { taskId: "synthetic-upstream" } };
                } });
                if (scenario === "storage") h.state.failWrites = true;
                const result = await h.loader.load(`src/app/api/${route}/route.ts`).POST(request(route, media));
                const body = await result.json();
                assert.equal(result.status, ({ pending: 202, completed: 200, rejected: 422, unknown: 202, storage: 503 })[scenario]);
                assert.equal(body.accepted, scenario === "pending" || scenario === "completed");
                assert.equal(body.recovery_required, scenario === "unknown");
                if (scenario === "storage") { assert.equal(body.task_id, undefined); assert.equal(h.state.submitCalls, 0); }
                else { assert.ok(body.task_id); assert.ok(await h.store.getTask(body.task_id)); }
                assert.ok(!JSON.stringify(body).includes("synthetic response lost"));
            });
        }
    }
});

test("real SSE route reads refreshed durable status, omits media bodies and cleans up on cancellation", async (t) => {
    const timers = []; const cleared = [];
    const h = await harness(t, { globals: { setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: (id) => cleared.push(id) } });
    await h.store.createTask(fixture("sse"));
    const handler = h.loader.load("src/app/api/events/[taskId]/route.ts");
    const response = await handler.GET(new Request("http://localhost/api/events/sse"), { params: Promise.resolve({ taskId: "sse" }) });
    const reader = response.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /"type":"status"/);
    const current = await h.store.getTask("sse");
    await h.store.updateTask({ ...current, status: "COMPLETED", lifecycle_phase: "terminal", next_poll_at: null,
        result_urls: ["data:image/png;base64,AAAA"] });
    await reader.read(); // heartbeat
    await timers.shift()();
    const completion = new TextDecoder().decode((await reader.read()).value);
    assert.match(completion, /"type":"completed"/); assert.ok(!completion.includes("data:image"));
    assert.equal((await reader.read()).done, true);
    await h.store.createTask(fixture("cancel"));
    const cancelResponse = await handler.GET(new Request("http://localhost/api/events/cancel"), { params: Promise.resolve({ taskId: "cancel" }) });
    await cancelResponse.body.cancel();
    assert.ok(cleared.length >= 2);
});

test("generation preprocessing rejects invalid JSON/counts and classifies failures without dispatch", async (t) => {
    const mediaCaps = { ...caps, elements: true, media_slots: [{ id: "reference", kind: "image", label: "Reference" }] };
    const catalog = { "@/models/capabilities/video": { VIDEO_CAPABILITIES: { synthetic: mediaCaps } },
        "@/models/capabilities/image": { IMAGE_CAPABILITIES: { synthetic: mediaCaps } } };
    for (const [route, field] of [["generate", "settings"], ["generate-image", "field_values"]]) {
        for (const raw of ["null", "[]", "42", '"string"', "{malformed", ...(field === "settings" ? ['{"fieldValues":null}'] : [])]) {
            const h = await harness(t, { mocks: catalog }); const form = new FormData();
            form.set("model_id", "synthetic"); form.set("prompt", "synthetic"); form.set(field, raw);
            const response = await h.loader.load(`src/app/api/${route}/route.ts`).POST(new Request(`http://localhost/api/${route}`, { method: "POST", body: form }));
            assert.equal(response.status, 400); assert.equal((await response.json()).recovery_required, false); assert.equal(h.state.submitCalls, 0);
        }
    }
    for (const values of [{ elem_count: "1000" }, { elem_count: "Infinity" }, { elem_count: "1e3" }, { elem_count: "-1" },
        { elem_count: "1.5" }, { elem_count: "2", elem_1_ref_count: "1000" }, { elem_count: "1", elem_0_ref_count: "4" }]) {
        let uploads = 0;
        const h = await harness(t, { mocks: { ...catalog, "@/lib/media-upload": { processImageUpload: async () => { uploads++; return { remoteUrl: "https://synthetic.invalid/a" }; } } } });
        const form = new FormData(); form.set("model_id", "synthetic"); form.set("prompt", "synthetic");
        form.set("file_reference", new File(["x"], "synthetic.png", { type: "image/png" }));
        for (const [key, value] of Object.entries(values)) form.set(key, value);
        const response = await h.loader.load("src/app/api/generate/route.ts").POST(new Request("http://localhost/api/generate", { method: "POST", body: form }));
        assert.equal(response.status, 400); assert.equal(uploads, 0); assert.equal(h.state.submitCalls, 0);
    }
    for (const [code, status] of [["private raw failure", 400], ["ERR_MEDIA_TOO_LARGE", 413], ["ERR_MEDIA_CANCELLED", 408]]) {
        const h = await harness(t, { mocks: { ...catalog, "@/lib/upload": { saveInputLocally: async () => { throw new Error(code); } } } });
        const form = new FormData(); form.set("model_id", "synthetic"); form.set("prompt", "synthetic");
        form.set("slot_reference", new File(["x"], "synthetic.png", { type: "image/png" }));
        const response = await h.loader.load("src/app/api/generate-image/route.ts").POST(new Request("http://localhost/api/generate-image", { method: "POST", body: form }));
        assert.equal(response.status, status); assert.equal(h.state.submitCalls, 0);
        const body = await response.json(); assert.equal(body.accepted, false); assert.equal(body.recovery_required, false);
        assert.ok(!JSON.stringify(body).includes("private raw failure"));
    }
});

test("every upload path checks declared size before arrayBuffer and forwards the entry signal", async (t) => {
    for (const [route, key, values, extraCaps] of [
        ["generate", "file_reference", {}, {}],
        ["generate", "file_elem_0_frontal", { elem_count: "1" }, {}],
        ["generate", "file_elem_0_ref_0", { elem_count: "1", elem_0_ref_count: "1" }, {}],
        ["generate-image", "slot_reference", {}, {}],
        ["generate-image", "slot_reference_images", {}, { has_edit_variant: true }],
    ]) {
        const form = new FormData(); form.set("model_id", "synthetic"); form.set("prompt", "synthetic");
        for (const [name, value] of Object.entries(values)) form.set(name, value);
        const file = new File(["x"], "synthetic.png", { type: "image/png" });
        Object.defineProperty(file, "size", { value: 21 * 1024 * 1024 });
        let reads = 0; file.arrayBuffer = async () => { reads++; return new ArrayBuffer(1); }; form.set(key, file);
        const capabilities = { ...caps, elements: true, media_slots: [{ id: "reference", kind: "image" }], ...extraCaps };
        const h = await harness(t, { mocks: {
            "@/models/capabilities/video": { VIDEO_CAPABILITIES: { synthetic: capabilities } },
            "@/models/capabilities/image": { IMAGE_CAPABILITIES: { synthetic: capabilities } },
            // T5's 4MiB body guard is tested separately; exercise the decoded-file boundary directly.
            "@/lib/request-limits": { readGenerationForm: async () => form, requestFailure: () => { throw new Error("unexpected entry failure"); } },
        } });
        const response = await h.loader.load(`src/app/api/${route}/route.ts`).POST(new Request(`http://localhost/api/${route}`, { method: "POST" }));
        assert.equal(response.status, 413); assert.equal(reads, 0); assert.equal(h.state.submitCalls, 0);
    }
});

test("valid slot, element and reference preprocessing forwards one request signal", async (t) => {
    const signals = [];
    const imageUpload = async (_buffer, options) => { signals.push(options.signal); return { remoteUrl: "https://synthetic.invalid/image" }; };
    const h = await harness(t, { mocks: {
        "@/models/capabilities/video": { VIDEO_CAPABILITIES: { synthetic: { ...caps, elements: true, media_slots: [{ id: "reference", kind: "image" }] } } },
        "@/lib/media-upload": { processImageUpload: imageUpload, resolveUrl: async (_url, options) => { signals.push(options.signal); return { remoteUrl: "https://synthetic.invalid/existing" }; } },
    } });
    const form = new FormData(); form.set("model_id", "synthetic"); form.set("prompt", "synthetic");
    form.set("elem_count", "1"); form.set("elem_0_ref_count", "2");
    for (const name of ["file_reference", "file_elem_0_frontal", "file_elem_0_ref_0"]) form.set(name, new File(["x"], "synthetic.png", { type: "image/png" }));
    form.set("url_elem_0_ref_1", "https://synthetic.invalid/existing");
    const response = await h.loader.load("src/app/api/generate/route.ts").POST(new Request("http://localhost/api/generate", { method: "POST", body: form }));
    assert.equal(response.status, 202); assert.equal(signals.length, 4);
    assert.ok(signals[0] instanceof AbortSignal); assert.ok(signals.every((signal) => signal === signals[0] && !signal.aborted));
    const task = await h.store.getTask((await response.json()).task_id);
    assert.ok(Date.parse(task.next_poll_at) >= Date.parse(task.created_at) + 10_000);
});
