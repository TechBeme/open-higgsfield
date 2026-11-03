import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { createModuleLoader } from "./test-module-loader.mjs";

const media = createModuleLoader().load("src/features/studio/lib/media-transfer.ts");
const identity = createModuleLoader().load("src/lib/submission-identity.ts");
const transfer = (data = {}, files = []) => ({ files, types: Object.keys(data), getData: type => data[type] ?? "" });

test("drag payloads preserve generated result indexes and reject executable or credentialed URLs", () => {
    const origin = "https://studio.example.test";
    assert.equal(media.safeReferenceUrl(`${origin}/api/download/task-1?index=3&inline=1`, origin), "/api/download/task-1?index=3&inline=1");
    assert.equal(media.safeReferenceUrl("/api/uploaded/input.png", origin), "/api/uploaded/input.png");
    for (const value of ["javascript:alert(1)", "data:image/svg+xml,test", "file:///tmp/image.png", "http://remote.test/a.png", "https://user:password@example.test/a.png"]) {
        assert.equal(media.safeReferenceUrl(value, origin), null);
    }
    const data = transfer({ [media.STUDIO_MEDIA_TYPE]: JSON.stringify({ kind: "image", url: "/api/download/result?index=2" }) });
    const files = media.readMediaTransfer(data, origin);
    assert.equal(files.length, 1);
    assert.equal(files[0].name, "/api/download/result?index=2");
    assert.equal(files[0].type, "image/png");
    assert.ok(media.isUrlReference(files[0]));
});

test("external URI drags deduplicate references, ignore comments and prefer actual uploaded files", () => {
    const data = transfer({ "text/uri-list": "# image\r\nhttps://images.example.test/a.png\r\nhttps://images.example.test/a.png\r\njavascript:invalid" });
    assert.ok(media.hasMediaTransfer(data));
    const files = media.readMediaTransfer(data, "https://studio.example.test");
    assert.equal(files.length, 1);
    assert.equal(files[0].name, "https://images.example.test/a.png");
    const file = new File(["image"], "image.png", { type: "image/png" });
    assert.equal(media.readMediaTransfer({ ...data, files: [file] }, "https://studio.example.test")[0], file);
    assert.equal(media.isUrlReference(file), false);
    assert.equal(media.hasMediaTransfer(transfer({ "text/plain": "a prompt" })), false);
});

test("submission correlation accepts only bounded UUIDs and never arbitrary client state", () => {
    const form = new FormData();
    form.set("client_submission_id", "12345678-1234-4123-8123-123456789abc");
    assert.equal(identity.submissionIdentity(form).clientSubmissionId, form.get("client_submission_id"));
    for (const invalid of ["", "x".repeat(10000), "../task", "12345678-1234-1123-8123-123456789abc"]) {
        form.set("client_submission_id", invalid);
        assert.equal(identity.submissionIdentity(form).clientSubmissionId, undefined);
    }
});

function backgroundFixture() {
    const calls = [];
    let refreshes = 0;
    const modules = createModuleLoader({
        mocks: { react: { useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() } },
        globals: { crypto: webcrypto, fetch: (url, options) => new Promise((resolve, reject) => calls.push({ url, ...options, resolve, reject })) },
    });
    const api = modules.load("src/features/studio/lib/background-submissions.ts");
    const send = (mode, prompt) => {
        const body = new FormData(); body.set("prompt", prompt);
        return api.submitInBackground({ mode, model: `Synthetic ${mode}`, prompt }, body, () => refreshes++);
    };
    return { api, calls, send, refreshes: () => refreshes };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("image and video submissions start immediately, run concurrently and finish out of order", async () => {
    const { api, calls, send, refreshes } = backgroundFixture();
    const first = send("image", "first prompt");
    const second = send("video", "second prompt");
    assert.equal(calls.length, 2);
    assert.equal(api.useBackgroundSubmissions().length, 2);
    assert.equal(calls[0].url, "/api/generate-image");
    assert.equal(calls[1].url, "/api/generate");
    assert.equal(calls[0].body.get("client_submission_id"), first);
    assert.equal(calls[1].body.get("client_submission_id"), second);
    calls[1].resolve(Response.json({ task_id: "second-task", accepted: true, recovery_required: false }, { status: 202 }));
    await tick();
    assert.equal(api.useBackgroundSubmissions().find(item => item.id === second).outcome.accepted, true);
    assert.equal(api.useBackgroundSubmissions().find(item => item.id === first).outcome, undefined);
    calls[0].resolve(Response.json({ error: "ERR_INVALID_FIELD_VALUES", accepted: false, recovery_required: false }, { status: 400 }));
    await tick();
    assert.equal(api.useBackgroundSubmissions().find(item => item.id === first).outcome.error, "ERR_INVALID_FIELD_VALUES");
    assert.equal(refreshes(), 2);
    api.dismissSubmission(first);
    assert.equal(api.useBackgroundSubmissions().length, 1);
});

test("unknown outcomes remain request-specific, never retry automatically and do not block another request", async () => {
    const { api, calls, send } = backgroundFixture();
    const first = send("image", "uncertain prompt");
    calls[0].reject(new TypeError("network failure"));
    await tick();
    assert.equal(api.useBackgroundSubmissions().find(item => item.id === first).outcome.needsReview, true);
    send("image", "independent new prompt");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.get("prompt"), "independent new prompt");
    calls[1].resolve(new Response("malformed JSON", { status: 200 }));
    await tick();
    assert.equal(api.useBackgroundSubmissions().every(item => item.outcome.needsReview), true);
    assert.equal(calls.length, 2, "No automatic retries of either billable POST");
});
