import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createModuleLoader } from "./test-module-loader.mjs";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWO4+t8dK2IYWhIAylSGwYMD4fAAAAAASUVORK5CYII=";
const fixture = (id, count = 2, created_at = "2026-01-01T00:00:00Z") => ({ task_id: id, model_id: "synthetic", media_type: "image", created_at, status: "COMPLETED", lifecycle_phase: "terminal", result_urls: Array(count).fill(png), next_poll_at: null, deadline_at: null, poll_failures: 0, lease_token: null, lease_expires_at: null, deleted_at: null });
const plain = value => JSON.parse(JSON.stringify(value));
async function harness(t, options = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gallery-regression-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const loader = createModuleLoader({ env: { OPEN_HIGGSFIELD_STORAGE_DIR: dir, NODE_ENV: "development" }, mocks: { "next/server": { NextResponse: Response }, ...options.mocks } });
    return { loader, dir, store: loader.load("@/server/tasks/store"), gallery: loader.load("@/lib/gallery"), route: loader.load("src/app/api/gallery/route.ts") };
}
function request(body, headers = {}) { return new Request("http://localhost:3120/api/gallery", { method: "PATCH", headers: { origin: "http://127.0.0.1:3120", host: "127.0.0.1:3120", "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); }

test("gallery route deletes one result, preserves sibling URLs and makes only the removed result unavailable", async t => {
    const h = await harness(t);
    await h.store.createTask(fixture("siblings"));
    const input = { action: "delete", mediaType: "image", items: [{ taskId: "siblings", index: 0 }] };
    const response = await h.route.PATCH(request(input));
    assert.equal(response.status, 200, await response.clone().text());
    const task = await h.store.getTask("siblings");
    assert.equal(task.result_urls.length, 2);
    assert.equal(task.result_urls[1], png);
    assert.deepEqual(plain(h.gallery.galleryIndices(await h.store.getPublicTask("siblings"))), [1]);
    const assets = h.loader.load("@/server/media/asset-source");
    await assert.rejects(assets.taskAssetSource(task, 0), /ERR_ASSET_NOT_FOUND/);
    assert.ok((await assets.taskAssetSource(task, 1)).data.length > 0);
    assert.equal((await h.route.PATCH(request(input))).status, 200, "Repeated removal is idempotent");
    assert.equal((await h.route.PATCH(request({ ...input, items: [{ taskId: "siblings", index: 1 }] }))).status, 200);
    assert.equal(await h.store.getTask("siblings"), undefined);
    assert.equal((await h.route.PATCH(request(input))).status, 200);
    const saved = JSON.parse(await fs.readFile(path.join(h.dir, "tasks_history.json"), "utf8"));
    assert.equal(saved.tasks.find(task => task.task_id === "siblings").result_urls, undefined, "Removing the final output clears the stored media payload");
});

test("bulk deletion is atomic across generations and supports failed tasks without outputs", async t => {
    const h = await harness(t);
    await h.store.createTask(fixture("one")); await h.store.createTask(fixture("two"));
    await h.store.createTask({ ...fixture("failed", 0), status: "ERROR" });
    const bad = { action: "delete", mediaType: "image", items: [{ taskId: "one", index: 0 }, { taskId: "two", index: 15 }] };
    assert.equal((await h.route.PATCH(request(bad))).status, 409);
    assert.equal((await h.store.getTask("one")).gallery, undefined);
    const good = { ...bad, items: [{ taskId: "one", index: 0 }, { taskId: "two", index: 1 }, { taskId: "failed", index: null }] };
    assert.equal((await h.route.PATCH(request(good))).status, 200);
    assert.deepEqual(plain(h.gallery.galleryIndices(await h.store.getPublicTask("one"))), [1]);
    assert.deepEqual(plain(h.gallery.galleryIndices(await h.store.getPublicTask("two"))), [0]);
    assert.equal(await h.store.getTask("failed"), undefined);
    await h.store.createTask({ ...fixture("video", 0), media_type: "video", video_urls: ["https://example.test/synthetic.mp4"] });
    const video = { action: "delete", mediaType: "image", items: [{ taskId: "video", index: 0 }] };
    assert.equal((await h.route.PATCH(request(video))).status, 400, "Image actions cannot delete video assets");
    assert.ok(await h.store.getTask("video"));
    assert.equal((await h.route.PATCH(request({ ...video, mediaType: "video" }))).status, 200);
    assert.equal(await h.store.getTask("video"), undefined);
});

test("custom ordering persists across restart, pagination and new generations without renumbering assets", async t => {
    const h = await harness(t);
    for (const [id, date] of [["old", "2025-01-01"], ["mid", "2025-02-01"], ["new", "2025-03-01"]]) await h.store.createTask(fixture(id, 2, date));
    const ordered = [{ taskId: "old", index: 1 }, { taskId: "mid", index: 0 }, { taskId: "new", index: 1 }, { taskId: "old", index: 0 }];
    assert.equal((await h.route.PATCH(request({ action: "reorder", mediaType: "image", items: ordered }))).status, 200);
    const reloaded = createModuleLoader({ env: { OPEN_HIGGSFIELD_STORAGE_DIR: h.dir } }).load("@/server/tasks/store");
    const first = await reloaded.listTasks("image", { limit: 1 });
    assert.equal(first.tasks[0].task_id, "old");
    const next = await reloaded.listTasks("image", { limit: 1, cursor: first.nextCursor });
    assert.equal(next.tasks[0].task_id, "mid");
    const tasks = (await reloaded.listTasks("image", { limit: 50 })).tasks;
    const entries = tasks.flatMap(task => h.gallery.galleryIndices(task).map(index => ({ task, index })));
    entries.sort((a, b) => h.gallery.galleryRank(a.task, a.index) - h.gallery.galleryRank(b.task, b.index));
    assert.equal(entries[0].task.task_id, "old"); assert.equal(entries[0].index, 1);
    await reloaded.createTask(fixture("fresh", 1, new Date(Date.now() + 1000).toISOString()));
    assert.equal((await reloaded.listTasks("image", { limit: 1 })).tasks[0].task_id, "fresh");
});

test("reordering cannot invalidate a running provider submission or partially change terminal siblings", async t => {
    const h = await harness(t);
    await h.store.createTask(fixture("finished"));
    await h.store.createTask({ ...fixture("active", 0), status: "IN_PROGRESS", lifecycle_phase: "submitting" });
    const before = (await h.store.getTask("active")).revision;
    const response = await h.route.PATCH(request({ action: "reorder", mediaType: "image", items: [{ taskId: "finished", index: 0 }, { taskId: "active", index: null }] }));
    assert.equal(response.status, 409);
    assert.equal((await h.store.getTask("finished")).gallery, undefined);
    assert.equal((await h.store.getTask("active")).revision, before);
});

test("gallery validates bounded selections and enforces origin before touching storage", async t => {
    const h = await harness(t);
    const body = { action: "delete", mediaType: "image", items: [{ taskId: "missing", index: null }] };
    assert.equal((await h.route.PATCH(request(body, { origin: "https://evil.test" }))).status, 403);
    assert.equal((await h.route.PATCH(request(body, { "sec-fetch-site": "cross-site" }))).status, 403);
    for (const changes of [{ items: [] }, { action: "purge" }, { mediaType: "audio" }, { items: [{ taskId: "../path", index: 0 }] }, { items: [{ taskId: "ok", index: -1 }] }, { items: [body.items[0], body.items[0]] }, { items: Array(1001).fill(body.items[0]) }]) {
        assert.equal((await h.route.PATCH(request({ ...body, ...changes }))).status, 400);
    }
    assert.equal((await h.route.PATCH(request(body))).status, 200);
    assert.throws(() => h.gallery.parseGalleryMutation({ ...body, items: [{ taskId: "missing", index: "0" }] }), /ERR_GALLERY_INVALID_REQUEST/);
});

test("loopback Host correction is confined to unpinned development and never trusts forwarded headers", () => {
    const access = createModuleLoader({ env: { NODE_ENV: "development" } }).load("@/server/security/workspace-access");
    assert.equal(access.guardWorkspaceRequest(request({})), null);
    for (const headers of [{ host: "evil.test" }, { origin: "http://127.0.0.1:9000" }, { host: "localhost:3120" }, { host: "localhost:3120", "x-forwarded-host": "127.0.0.1:3120" }]) assert.equal(access.guardWorkspaceRequest(request({}, headers)).status, 403);
    const pinned = createModuleLoader({ env: { NODE_ENV: "development", APP_ORIGIN: "http://localhost:3120" } }).load("@/server/security/workspace-access");
    assert.equal(pinned.guardWorkspaceRequest(request({})).status, 403);
});
