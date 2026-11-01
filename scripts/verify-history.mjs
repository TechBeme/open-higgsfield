import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "./test-module-loader.mjs";

const fixture = (id, status = "COMPLETED") => ({ task_id: id, status, media_type: "image", model_id: "synthetic", created_at: new Date(0).toISOString() });
function history(fetch = async () => Response.json([])) {
    const calls = [];
    const loader = createModuleLoader({ globals: { fetch }, mocks: {
        react: { useRef: (value) => ({ current: value }) },
        swr: { mutate: async (key) => { calls.push(key); } },
        "swr/infinite": { __esModule: true, default: () => { throw new Error("Hooks require rendered browser acceptance"); }, unstable_serialize: (getKey) => `$inf$${getKey(0, null)}` },
    } });
    return { api: loader.load("@/hooks/useTaskHistory"), calls };
}

test("cursor keys stop at final page and global revalidation targets the native infinite cache", async () => {
    const { api, calls } = history();
    assert.equal(api.imageHistoryKey(0, null), "/api/image-tasks?limit=20");
    assert.equal(api.imageHistoryKey(1, { tasks: [fixture("one")], nextCursor: "cursor_2" }), "/api/image-tasks?limit=20&cursor=cursor_2");
    assert.equal(api.imageHistoryKey(2, { tasks: [], nextCursor: null }), null);
    await api.revalidateHistory(api.imageHistoryKey);
    assert.equal(calls[0], "$inf$/api/image-tasks?limit=20");
});

test("history handles pages and bounded legacy arrays but treats HTTP/schema failures as errors", async () => {
    let response;
    const { api } = history(async () => response);
    response = Response.json({ tasks: [fixture("one")], nextCursor: "cursor" });
    assert.equal((await api.fetchHistoryPage("synthetic")).tasks.length, 1);
    response = Response.json([fixture("legacy")]);
    assert.equal((await api.fetchHistoryPage("synthetic")).nextCursor, null);
    response = Response.json({ error: "storage failed" }, { status: 503 });
    await assert.rejects(api.fetchHistoryPage("synthetic"), /ERR_HISTORY_UNAVAILABLE/);
    for (const body of [{ error: "failure" }, { tasks: [], nextCursor: "unexpected" }, { tasks: [fixture("a")], nextCursor: "bad cursor!" },
        { tasks: [fixture("../bad")], nextCursor: null }, Array.from({ length: 51 }, (_, i) => fixture(`id-${i}`))]) {
        response = Response.json(body);
        await assert.rejects(api.fetchHistoryPage("synthetic"), /ERR_HISTORY_RESPONSE/);
    }
});

test("page merging deduplicates refresh races and preserves current persisted status", () => {
    const { api } = history();
    const merged = api.mergeHistoryPages([{ tasks: [fixture("same"), fixture("new")], nextCursor: "cursor" },
        { tasks: [fixture("same", "IN_PROGRESS"), fixture("old")], nextCursor: null }]);
    assert.deepEqual(Array.from(merged, (task) => task.task_id), ["same", "new", "old"]);
    assert.equal(merged[0].status, "COMPLETED");
    assert.equal(api.isTaskActive(fixture("pending", "IN_PROGRESS")), true);
    assert.equal(api.isTaskActive({ ...fixture("pause", "ERROR"), recovery_required: true }), false);
});
