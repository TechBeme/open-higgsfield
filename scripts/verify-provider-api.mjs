import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "./test-module-loader.mjs";

function fixture({ denial = null, failStore = false, providerId = "google-ai-studio", fetcher, globals = {} } = {}) {
    const calls = { reads: 0, writes: 0, fetch: 0 };
    const connection = { id: "conn_fixture", providerId, label: "Fixture", enabled: true, secretConfigured: true, secret: "synthetic-key" };
    const read = async value => { calls.reads++; if (failStore) throw new Error("database password=synthetic-sensitive-detail"); return value; };
    const write = async value => { calls.writes++; if (failStore) throw new Error("database password=synthetic-sensitive-detail"); return value; };
    const loader = createModuleLoader({ mocks: {
        "next/server": { NextResponse: Response },
        "@/server/security/workspace-access": {
            guardWorkspaceRequest: () => denial, applyWorkspaceHeaders: response => response,
            accessFailure: (error, status) => Response.json({ error }, { status }),
        },
        "@/server/config/provider-store": {
            listProviderConnections: () => read([connection]), getConnectedProviderIds: () => read(new Set()), connectionFromEnv: () => undefined,
            saveProviderConnection: () => write({ id: connection.id }), deleteProviderConnection: () => write(true),
            getProviderConnection: () => read(connection), resolveProviderConnection: () => read(connection), markProviderConnectionHealth: () => write(undefined),
            listModelOverrides: () => read([]), listDiscoveredModels: () => read([]), saveDiscoveredModels: () => write([]),
            saveCustomModel: () => write({ modelId: "custom" }), setBuiltInModelEnabled: () => write(undefined), deleteCustomModel: () => write(true),
        },
        "@/server/catalog/runtime": { getAllRuntimeCapabilities: () => read([]) },
    }, globals: { fetch: async (...args) => { calls.fetch++; return fetcher ? fetcher(...args) : Response.json({ models: [], data: [] }); }, ...globals } });
    const context = { params: Promise.resolve({ id: connection.id }) };
    return { calls, invoke: (file, method, request) => loader.load(`src/app/api/${file}/route.ts`)[method](request, context) };
}

const jsonRoutes = [
    ["providers", "POST", 96 * 1024, { providerId: "google-ai-studio", label: "Main", secret: "synthetic" }],
    ["providers/[id]", "PATCH", 96 * 1024, { label: "Renamed" }],
    ["catalog", "POST", 256 * 1024, { mediaType: "image", capabilities: {} }],
    ["catalog", "PATCH", 16_384, { mediaType: "image", modelId: "custom", enabled: false }],
    ["catalog", "DELETE", 16_384, { mediaType: "image", modelId: "custom" }],
    ["catalog/discover", "POST", 16_384, { providerId: "google-ai-studio" }],
];
const emptyRoutes = [["providers/[id]", "DELETE"], ["providers/[id]/test", "POST"]];
function request(file, method, options = {}) {
    return new Request(`http://localhost/api/${file.replace("[id]", "conn_fixture")}`, { method, ...options });
}

test("Runware health authenticates with a non-generating model search and detects 200 error envelopes", async () => {
    for (const valid of [true, false]) {
        const f = fixture({ providerId: "runware", fetcher: async (url, init) => {
            assert.equal(url, "https://api.runware.ai/v1");
            assert.equal(init.headers.Authorization, "Bearer synthetic-key");
            const task = JSON.parse(init.body)[0];
            assert.equal(task.taskType, "modelSearch"); assert.equal(task.limit, 1);
            return Response.json(valid ? { data: [{ taskType: "modelSearch", taskUUID: task.taskUUID, results: [], totalResults: 0 }] }
                : { errors: [{ code: "invalidApiKey", message: "synthetic-sensitive" }] });
        } });
        const response = await f.invoke("providers/[id]/test", "POST", request("providers/[id]/test", "POST"));
        assert.equal(response.status, valid ? 200 : 502);
        assert.equal(f.calls.fetch, 1); assert.equal(f.calls.writes, 1);
        assert.ok(!(await response.text()).includes("synthetic-sensitive"));
    }
});

test("provider and catalog JSON routes accept bounded objects and reject malformed input before mutation", async () => {
    for (const [file, method, , valid] of jsonRoutes) {
        const good = fixture();
        const response = await good.invoke(file, method, request(file, method, { headers: { "Content-Type": "application/json" }, body: JSON.stringify(valid) }));
        assert.ok(response.ok, `${method} ${file}`);
        for (const [body, headers, status, code] of [
            ["{", { "Content-Type": "application/json" }, 400, "ERR_INVALID_JSON"],
            ["null", { "Content-Type": "application/json" }, 400, "ERR_REQUEST_INVALID"],
            ["[]", { "Content-Type": "application/json" }, 400, "ERR_REQUEST_INVALID"],
            ["{}", { "Content-Type": "text/plain" }, 415, "ERR_CONTENT_TYPE"],
            ["{}", { "Content-Type": "application/json", "Content-Length": "1" }, 400, "ERR_INVALID_CONTENT_LENGTH"],
        ]) {
            const f = fixture();
            const invalid = await f.invoke(file, method, request(file, method, { headers, body }));
            assert.equal(invalid.status, status, `${method} ${file}`);
            assert.equal((await invalid.json()).error, code);
            assert.equal(f.calls.writes + f.calls.fetch, 0);
        }
    }
});

test("provider configuration limits real streamed bytes even with a false or absent length", async () => {
    for (const [file, method, limit] of jsonRoutes) for (const declared of [undefined, "1", String(limit + 1)]) {
        let cancelled = false;
        const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(limit + 1)); }, cancel() { cancelled = true; } });
        const f = fixture();
        const response = await f.invoke(file, method, request(file, method, { body: stream, duplex: "half", headers: { "Content-Type": "application/json", ...(declared ? { "Content-Length": declared } : {}) } }));
        assert.equal(response.status, 413, `${method} ${file}`);
        assert.equal((await response.json()).error, "ERR_REQUEST_TOO_LARGE");
        assert.equal(cancelled, true);
        assert.equal(f.calls.writes + f.calls.fetch, 0);
    }
});

test("aborted settings requests cancel their body and never mutate provider state", async () => {
    for (const [file, method] of jsonRoutes) {
        let cancelled = false;
        const controller = new AbortController();
        const stream = new ReadableStream({ cancel() { cancelled = true; } });
        const f = fixture();
        const pending = f.invoke(file, method, request(file, method, { signal: controller.signal, body: stream, duplex: "half", headers: { "Content-Type": "application/json" } }));
        controller.abort();
        const response = await pending;
        assert.equal(response.status, 408, `${method} ${file}`);
        assert.equal(cancelled, true);
        assert.equal(f.calls.writes + f.calls.fetch, 0);
    }
});

test("provider deletion and health tests require an empty body", async () => {
    for (const [file, method] of emptyRoutes) {
        const valid = fixture();
        assert.equal((await valid.invoke(file, method, request(file, method))).status, 200);
        const invalid = fixture();
        const response = await invalid.invoke(file, method, request(file, method, { body: "unexpected" }));
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error, "ERR_UNEXPECTED_BODY");
        assert.equal(invalid.calls.reads + invalid.calls.writes + invalid.calls.fetch, 0);
    }
});

test("provider health tests release unused bodies for successful and failed credentials", async () => {
    for (const providerId of ["google-ai-studio", "vercel-ai-gateway"]) for (const status of [200, 401]) {
        let cancelled = 0;
        const f = fixture({ providerId, fetcher: async (url, init) => {
            assert.equal(new URL(url).hostname, providerId === "google-ai-studio" ? "generativelanguage.googleapis.com" : "ai-gateway.vercel.sh");
            assert.equal(init.signal.aborted, false);
            return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status });
        } });
        const response = await f.invoke("providers/[id]/test", "POST", request("providers/[id]/test", "POST"));
        assert.equal(response.status, status === 200 ? 200 : 502);
        assert.equal((await response.json()).status, status === 200 ? "healthy" : "unhealthy");
        assert.equal(cancelled, 1);
        assert.equal(f.calls.writes, 1);
    }
});

test("provider health propagates client cancellation and deadlines without changing health", async () => {
    for (const providerId of ["google-ai-studio", "vercel-ai-gateway"]) for (const timeout of [false, true]) {
        const controller = new AbortController();
        let fetchEntered;
        const entered = new Promise(resolve => { fetchEntered = resolve; });
        let cancelled = 0;
        const f = fixture({ providerId,
            globals: timeout ? { AbortSignal: class extends AbortSignal { static timeout(ms) { assert.ok([10_000, 30_000].includes(ms)); return AbortSignal.timeout(ms === 10_000 ? 5 : ms); } } } : {},
            fetcher: async (_url, init) => new Promise((_, reject) => {
                assert.equal(init.signal.aborted, false);
                init.signal.addEventListener("abort", () => { cancelled++; reject(init.signal.reason); }, { once: true });
                fetchEntered();
            }),
        });
        const pending = f.invoke("providers/[id]/test", "POST", request("providers/[id]/test", "POST", { signal: controller.signal }));
        const keepAlive = setTimeout(() => controller.abort(), 1000);
        try {
            await entered;
            if (!timeout) controller.abort();
            const response = await pending;
            assert.equal(response.status, 408);
            assert.equal((await response.json()).error, "ERR_REQUEST_CANCELLED");
            assert.equal(cancelled, 1);
            assert.equal(f.calls.fetch, 1); assert.equal(f.calls.writes, 0);
        } finally { clearTimeout(keepAlive); }
    }
});

test("settings request policy runs before reading bodies or accessing storage", async () => {
    for (const [file, method] of [...jsonRoutes, ...emptyRoutes]) {
        const f = fixture({ denial: Response.json({ error: "ERR_DEMO_READ_ONLY" }, { status: 403 }) });
        const req = request(file, method, { body: "private request bytes" });
        assert.equal((await f.invoke(file, method, req)).status, 403);
        assert.equal(req.bodyUsed, false);
        assert.equal(f.calls.reads + f.calls.writes + f.calls.fetch, 0);
    }
});

test("provider and catalog storage failures expose canonical errors without internal details", async () => {
    for (const [file, method, body] of [["providers", "GET"], ["catalog", "GET"], ["providers/[id]", "DELETE"], ["providers", "POST", { providerId: "google-ai-studio", label: "Main", secret: "synthetic" }]]) {
        const f = fixture({ failStore: true });
        const response = await f.invoke(file, method, request(file, method, body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}));
        assert.equal(response.status, 503);
        const text = await response.text();
        assert.doesNotMatch(text, /password|sensitive|database/);
        assert.match(JSON.parse(text).error, /^ERR_[A-Z_]+$/);
    }
});
