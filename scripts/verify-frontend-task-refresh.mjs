import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "./test-module-loader.mjs";

const task = (id, status = "IN_PROGRESS", mediaType = "image") => ({
    task_id: id, status, media_type: mediaType, model_id: "synthetic", created_at: new Date(0).toISOString(),
});

test("many active task cards update clocks without opening per-card network streams", () => {
    const effects = [], intervals = [], cleared = [];
    let streams = 0;
    const loader = createModuleLoader({ globals: {
        EventSource: class { constructor() { streams++; } close() {} },
        setInterval: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; },
        clearInterval: timer => cleared.push(timer),
    }, mocks: {
        react: { useEffect: effect => effects.push(effect), useState: initialize => [initialize(), () => {}] },
        swr: { mutate: async () => undefined },
        "swr/infinite": { __esModule: true, default: () => {}, unstable_serialize: () => "history" },
    } });
    const { useTaskRefresh: renderTaskClock } = loader.load("src/features/tasks/hooks/useTaskRefresh.ts");
    for (let index = 0; index < 20; index++) assert.ok(renderTaskClock(task(String(index))) >= 0);
    renderTaskClock(task("finished", "COMPLETED"));
    renderTaskClock(task("failed", "FAILED", "video"));
    const cleanups = effects.map(effect => effect()).filter(Boolean);
    assert.equal(streams, 0, "HTTP/1.1 sockets must remain available for actions and media");
    assert.equal(intervals.length, 20);
    assert.ok(intervals.every(interval => interval.delay === 1_000));
    for (const cleanup of cleanups) cleanup();
    assert.equal(cleared.length, intervals.length);
});

test("shared task history polls active loaded pages and preserves focus, reconnect and explicit refresh", async () => {
    const options = [], invalidations = [];
    const pages = [{ tasks: [task("recent", "COMPLETED")], nextCursor: "older" }, { tasks: [task("older")], nextCursor: null }];
    const loader = createModuleLoader({ mocks: {
        react: { useRef: value => ({ current: value }) },
        swr: { mutate: async key => { invalidations.push(key); } },
        "swr/infinite": { __esModule: true,
            default: (key, fetcher, config) => { options.push(config); return { data: pages, size: 2, mutate: async () => {}, setSize: async () => {} }; },
            unstable_serialize: key => `$inf$${key(0, null)}`,
        },
    } });
    const history = loader.load("src/features/tasks/hooks/useTaskHistory.ts");
    history.useTaskHistory(history.imageHistoryKey);
    const config = options[0];
    assert.equal(config.refreshInterval(pages), 3_000);
    assert.equal(config.revalidateOnFocus, true);
    assert.equal(config.revalidateOnReconnect, true);
    assert.equal(config.refreshInterval([{ tasks: [task("finished", "COMPLETED"), task("failed", "FAILED")], nextCursor: null }]), 0);
    assert.equal(config.refreshInterval([{ tasks: [{ ...task("resolved"), _done: true }], nextCursor: null }]), 0);
    assert.equal(config.refreshInterval(undefined), 0);
    await history.revalidateHistory(history.imageHistoryKey);
    await history.revalidateHistory(history.videoHistoryKey);
    assert.deepEqual(invalidations, ["$inf$/api/image-tasks?limit=20", "$inf$/api/tasks?limit=20"]);
});
