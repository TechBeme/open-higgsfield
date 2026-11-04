import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createModuleLoader } from "./test-module-loader.mjs";

const caps = { id: "synthetic", provider: "google-ai-studio", provider_model_id: "synthetic", media_slots: [], prompt_required: true };
const input = (mediaType = "image", media = {}) => ({ mediaType, modelId: "synthetic", capabilities: caps, params: { prompt: "private synthetic prompt" }, media });

async function harness(t, options = {}) {
    const dir = options.dir ?? await fs.mkdtemp(path.join(os.tmpdir(), "workflow-task-"));
    if (!options.dir) t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const state = options.state ?? { submits: 0, polls: 0, attachments: 0, starts: [], links: 0, calls: [], connection: true };
    const clock = options.clock ?? { now: Date.now() };
    class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
    const provider = {
        submit: async request => { state.submits++; state.calls.push(request); return options.submit ? options.submit(request) : { status: "CREATED", operation: { taskId: "synthetic-upstream" } }; },
        poll: async request => { state.polls++; return options.poll ? options.poll(request) : { status: "IN_PROGRESS" }; },
    };
    const connection = { id: "synthetic-connection", providerId: "google-ai-studio", secret: "private-synthetic-credential" };
    let h;
    const loader = createModuleLoader({ env: { TASK_WORKER_MODE: "workflow", OPEN_HIGGSFIELD_STORAGE_DIR: dir }, globals: { Date: Clock }, mocks: {
        "@/server/providers/registry": { resolveProvider: () => ({ provider, providerId: caps.provider, providerModelId: caps.provider_model_id }), getProvider: () => provider },
        "@/server/config/provider-store": { resolveProviderConnection: async () => connection, getProviderConnection: async (_id, options) => {
            if (state.submits === 0) assert.equal(options?.forSubmission, true);
            return state.connection ? connection : undefined;
        }, connectionFromEnv: () => connection },
        "@/server/config/production": { assertGenerationEnabled: () => { if (options.disabled) throw new Error("ERR_GENERATION_DISABLED"); } },
        "@/server/media/generated-assets": { attachGeneratedAssets: async task => {
            state.attachments++;
            if (options.attach) await options.attach(task);
            if (task.media_type === "image") task.result_urls = ["s3://synthetic-bucket/image.png"];
            else task.video_urls = ["s3://synthetic-bucket/video.mp4"];
        } },
        "@/server/media/input-upload": { resolveUrl: async value => { state.links++; return { localUrl: value, remoteUrl: `https://synthetic-media.example/fresh/${state.links}` }; } },
        "workflow": { sleep: async date => { clock.now = date.getTime(); },
            RetryableError: class extends Error { constructor(message, options) { super(message); this.retryAfter = options.retryAfter; } } },
        "workflow/api": { start: async (fn, args) => {
            state.starts.push({ fn, args });
            if (options.start) await options.start(h, args);
            if (options.dispatchFailure) throw new Error("private token and dispatch failure");
            return { runId: "synthetic-workflow" };
        } },
        ...options.mocks,
    } });
    h = { dir, loader, clock, state, store: loader.load("@/server/tasks/store"),
        service: loader.load("@/server/generation/service"), steps: loader.load("@/server/tasks/workflow-steps") };
    return h;
}
const argumentsFor = (h, index = 0) => h.state.starts[index].args[0];
async function due(h, id, extra = {}) {
    const task = await h.store.getTask(id);
    await h.store.updateTask({ ...task, next_poll_at: new Date(h.clock.now - 1).toISOString(), ...extra });
}

for (const mediaType of ["image", "video"]) {
    test(`${mediaType}: admission precedes activation and no provider request runs in the browser request`, async t => {
        const h = await harness(t, { start: async (app, args) => {
            const queued = await app.store.getTask(args[0].taskId);
            assert.equal(queued.lifecycle_phase, "queued"); assert.equal(queued.submission_ready, false);
            assert.ok(await app.steps.advanceGeneration(args[0]) > app.clock.now);
            assert.equal(app.state.submits, 0);
        } });
        const controller = new AbortController();
        const response = await h.service.submitGeneration({ ...input(mediaType), signal: controller.signal });
        assert.equal(response.httpStatus, 202); assert.equal(response.accepted, true); assert.equal(h.state.submits, 0);
        controller.abort(); // The browser has gone away after acceptance.
        const task = await h.store.getTask(response.task_id);
        assert.equal(task.submission_ready, true);
        assert.equal(JSON.stringify(argumentsFor(h)).includes("prompt"), false);
        assert.equal(JSON.stringify(argumentsFor(h)).includes("credential"), false);
        await h.steps.advanceGeneration(argumentsFor(h));
        assert.equal(h.state.submits, 1);
        assert.equal((await h.store.getTask(response.task_id)).lifecycle_phase, "polling");
        assert.equal((await h.store.getTask(response.task_id)).submission_media, undefined);
    });
}

test("failed or ambiguous workflow admission never activates or submits a paid request", async t => {
    const h = await harness(t, { dispatchFailure: true });
    const response = await h.service.submitGeneration(input());
    assert.equal(response.accepted, false); assert.equal(response.error, "ERR_WORKFLOW_DISPATCH_FAILED");
    assert.equal(await h.steps.advanceGeneration(argumentsFor(h)), null); assert.equal(h.state.submits, 0);
    assert.equal((await h.store.getTask(response.task_id)).lifecycle_phase, "terminal");
});

test("lost activation response preserves task identity and cannot authorize a second generation", async t => {
    let writes = 0;
    const h = await harness(t, { mocks: { "node:fs/promises": { ...fs, rename: async (...args) => {
        await fs.rename(...args); if (++writes === 2) throw new Error("synthetic response lost after commit");
    } } } });
    const response = await h.service.submitGeneration(input());
    assert.equal(response.httpStatus, 202); assert.equal(response.recovery_required, true);
    await h.steps.advanceGeneration(argumentsFor(h));
    await h.steps.advanceGeneration(argumentsFor(h));
    assert.equal(h.state.submits, 1);
});

test("unactivated tasks expire safely and unrelated revisions do not authorize submission", async t => {
    const h = await harness(t, { start: async (app, args) => {
        const task = await app.store.getTask(args[0].taskId);
        await app.store.updateTask({ ...task, error_message: "synthetic-unrelated-update" });
        throw new Error("synthetic admission lost");
    } });
    const response = await h.service.submitGeneration(input());
    h.clock.now += 65_000;
    await h.steps.advanceGeneration(argumentsFor(h));
    assert.equal(h.state.submits, 0); assert.equal((await h.store.getTask(response.task_id)).lifecycle_phase, "terminal");
});

test("duplicate and concurrent step deliveries submit only once and claim by task ID", async t => {
    const h = await harness(t);
    const [one, two] = await Promise.all([h.service.submitGeneration(input()), h.service.submitGeneration(input("video"))]);
    await Promise.all([h.steps.advanceGeneration(argumentsFor(h, 0)), h.steps.advanceGeneration(argumentsFor(h, 0))]);
    assert.equal(h.state.submits, 1);
    assert.equal((await h.store.getTask(two.task_id)).lifecycle_phase, "queued");
    await h.steps.advanceGeneration(argumentsFor(h, 1));
    assert.equal(h.state.submits, 2); assert.notEqual(one.task_id, two.task_id);
});

test("fresh process recovers the queued request without credentials or provider links in event payloads", async t => {
    const h = await harness(t);
    const local = "/api/uploaded/synthetic.jpg";
    const response = await h.service.submitGeneration(input("image", { slots: { reference: [local] }, images: { reference: local } }));
    const publicTask = await h.store.getPublicTask(response.task_id);
    assert.equal(JSON.stringify(publicTask).includes("submission_media"), false);
    const restarted = await harness(t, { dir: h.dir, state: h.state, clock: h.clock });
    await restarted.steps.advanceGeneration(argumentsFor(h));
    assert.equal(h.state.submits, 1); assert.equal(h.state.links, 1, "duplicate input references share a refreshed link");
    assert.match(h.state.calls[0].media.images.reference, /^https:\/\/synthetic-media.example\/fresh\//);
    assert.equal(JSON.stringify(await restarted.store.getTask(response.task_id)).includes("/fresh/"), false);
});

test("unknown submit outcome is paused and never resubmitted after any restart/retry", async t => {
    const h = await harness(t, { submit: async () => { throw new Error("synthetic lost HTTP response"); } });
    const response = await h.service.submitGeneration(input());
    assert.equal(await h.steps.advanceGeneration(argumentsFor(h)), null);
    assert.equal((await h.store.getTask(response.task_id)).lifecycle_phase, "submission_unknown");
    h.clock.now += 600_000;
    await h.steps.advanceGeneration(argumentsFor(h));
    assert.equal(h.state.submits, 1); assert.equal(await h.store.resumeTask(response.task_id), "conflict");
});

test("crash after durable submit boundary leaves an unknown outcome, never another POST", async t => {
    const h = await harness(t);
    const response = await h.service.submitGeneration(input());
    const claimed = await h.store.claimTask("synthetic-crashed-worker", 300_000, response.task_id);
    await h.store.updateTask({ ...claimed, lifecycle_phase: "submitting", submission_media: undefined, submission_ready: undefined }, { releaseLease: false });
    h.clock.now += 300_001;
    await h.steps.advanceGeneration(argumentsFor(h));
    assert.equal(h.state.submits, 0); assert.equal((await h.store.getTask(response.task_id)).lifecycle_phase, "submission_unknown");
});

test("synchronous completion stores outputs in background, and rejected NSFW requests remain terminal", async t => {
    for (const rejected of [false, true]) {
        const h = await harness(t, { submit: async () => {
            if (rejected) throw Object.assign(new Error("ERR_PROVIDER_CONTENT_REJECTED"), { submissionUncertain: false });
            return { status: "COMPLETED", assets: [{ data: Buffer.from("synthetic") }] };
        } });
        const response = await h.service.submitGeneration(input());
        assert.equal(await h.steps.advanceGeneration(argumentsFor(h)), null);
        const task = await h.store.getTask(response.task_id);
        assert.equal(task.lifecycle_phase, "terminal"); assert.equal(task.status, rejected ? "ERROR" : "COMPLETED");
        assert.equal(h.state.attachments, rejected ? 0 : 1); assert.equal(h.state.submits, 1);
    }
});

test("disabled keys and generation kill switch stop queued tasks before provider submission", async t => {
    for (const disabled of [false, true]) {
        const h = await harness(t, { disabled });
        const response = await h.service.submitGeneration(input());
        h.state.connection = disabled;
        await h.steps.advanceGeneration(argumentsFor(h));
        assert.equal(h.state.submits, 0); assert.equal((await h.store.getTask(response.task_id)).lifecycle_phase, "terminal");
    }
});

test("asynchronous completion, retry-after and storage retry use the original provider operation", async t => {
    let failStorage = true;
    let polling = 0;
    const h = await harness(t, { poll: async () => {
        if (++polling === 1) throw Object.assign(new Error("ERR_RATE_LIMIT"), { retryAfterMs: 90_000 });
        return { status: "COMPLETED", assets: [] };
    }, attach: async () => { if (failStorage) throw new Error("ERR_S3_UPLOAD"); } });
    const response = await h.service.submitGeneration(input());
    await h.steps.advanceGeneration(argumentsFor(h));
    h.clock.now += 12_001;
    const next = await h.steps.advanceGeneration(argumentsFor(h));
    assert.ok(next >= h.clock.now + 90_000); assert.equal(h.state.submits, 1);
    h.clock.now = next + 1;
    await h.steps.advanceGeneration(argumentsFor(h));
    assert.equal((await h.store.getTask(response.task_id)).lifecycle_phase, "materializing");
    failStorage = false; h.clock.now += 400_000;
    assert.equal(await h.steps.advanceGeneration(argumentsFor(h)), null);
    assert.equal((await h.store.getTask(response.task_id)).status, "COMPLETED"); assert.equal(h.state.submits, 1);
});

test("manual resume arms observation before changing state, and never submits generation again", async t => {
    const h = await harness(t);
    const response = await h.service.submitGeneration(input());
    await h.steps.advanceGeneration(argumentsFor(h));
    await due(h, response.task_id, { lifecycle_phase: "paused", status: "ERROR", next_poll_at: null });
    assert.equal(await h.store.resumeTask(response.task_id), "resumed");
    assert.equal(h.state.starts.length, 2);
    await h.steps.advanceGeneration(argumentsFor(h, 1));
    assert.equal(h.state.submits, 1); assert.equal(h.state.polls, 1);
    await h.store.deleteTask(response.task_id);
    assert.equal(await h.steps.advanceGeneration(argumentsFor(h, 1)), null);
});

test("bounded run and adaptive sleeps avoid busy polling and preserve safe expiry", async t => {
    const h = await harness(t);
    const intervals = [0, 120_000, 600_000, 3_600_000, 86_400_000].map(age => h.steps.workflowPollInterval(new Date(h.clock.now - age).toISOString(), h.clock.now));
    assert.deepEqual(intervals, [10_000, 20_000, 30_000, 120_000, 600_000]);
    const result = await h.service.submitGeneration(input());
    h.clock.now = argumentsFor(h).expiresAt;
    await h.state.starts[0].fn(argumentsFor(h));
    assert.equal((await h.store.getTask(result.task_id)).lifecycle_phase, "terminal"); assert.equal(h.state.submits, 0);
    assert.equal((await h.store.getTask(result.task_id)).error_message, "ERR_GENERATION_QUEUE_EXPIRED");
});

test("SDK security overrides preserve each reviewed minimatch consumer's actual API", () => {
    const rootRequire = createRequire(import.meta.url);
    for (const consumer of ["@vercel/queue", "@oclif/core", "@swc/cli", "filelist"]) {
        const require = createRequire(rootRequire.resolve(consumer));
        const mm = require("minimatch");
        assert.equal(require("minimatch/package.json").version, "11.0.1");
        assert.equal(mm.minimatch("src/workflows/generation.ts", "src/**/*.ts"), true);
        assert.deepEqual(mm.match(["image.png", "video.mp4"], "*.png"), ["image.png"]);
    }
});


test("finalization reclaims expired leases and distinguishes unsubmitted, unknown and observed tasks", async t => {
    for (const phase of ["queued", "submitting", "polling"]) {
        const h = await harness(t);
        const result = await h.service.submitGeneration(input());
        const owner = await h.store.claimTask("expired-owner", 60_000, result.task_id);
        await h.store.updateTask({ ...owner, lifecycle_phase: phase,
            ...(phase === "polling" ? { provider_operation: { taskId: "synthetic-operation" } } : {}) }, { releaseLease: false });
        h.clock.now = argumentsFor(h).expiresAt;
        await h.steps.expireGeneration(result.task_id);
        const task = await h.store.getTask(result.task_id);
        assert.equal(task.lifecycle_phase, phase === "queued" ? "terminal" : phase === "submitting" ? "submission_unknown" : "paused");
        assert.equal(task.error_message, phase === "queued" ? "ERR_GENERATION_QUEUE_EXPIRED" : phase === "submitting" ? "ERR_SUBMISSION_OUTCOME_UNKNOWN" : "ERR_POLLING_PAUSED_UPSTREAM_STATUS_UNKNOWN");
        assert.equal(task.lease_token, null); assert.equal(h.state.submits, 0);
    }
});

test("finalization waits for a live owner instead of fencing an in-flight request", async t => {
    const h = await harness(t);
    const result = await h.service.submitGeneration(input());
    h.clock.now = argumentsFor(h).expiresAt;
    const owner = await h.store.claimTask("live-owner", 30_000, result.task_id);
    await assert.rejects(h.steps.expireGeneration(result.task_id), error => error.message === "ERR_TASK_FINALIZATION_BUSY"
        && error.retryAfter.getTime() > Date.parse(owner.lease_expires_at));
    assert.equal((await h.store.getTask(result.task_id)).lease_token, "live-owner");
    h.clock.now += 31_000;
    await h.steps.expireGeneration(result.task_id);
    assert.equal((await h.store.getTask(result.task_id)).lifecycle_phase, "terminal");
    assert.equal(h.state.submits, 0);
});

test("an older Workflow cannot expire a manually renewed observation deadline", async t => {
    const h = await harness(t);
    const result = await h.service.submitGeneration(input());
    const task = await h.store.getTask(result.task_id);
    const renewed = await h.store.updateTask({ ...task, lifecycle_phase: "polling", provider_operation: { taskId: "synthetic-operation" },
        deadline_at: new Date(argumentsFor(h).expiresAt + 86_400_000).toISOString() });
    h.clock.now = argumentsFor(h).expiresAt;
    await h.steps.expireGeneration(result.task_id);
    const current = await h.store.getTask(result.task_id);
    assert.equal(current.lifecycle_phase, "polling"); assert.equal(current.revision, renewed.revision);
    assert.equal(h.state.submits, 0);
});
