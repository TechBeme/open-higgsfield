import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "./test-module-loader.mjs";

function fixture({ connection, environmentConnection, denial = null, fetcher } = {}) {
    const calls = { fetch: [], connections: 0, selections: 0, env: 0, saves: [] };
    const loader = createModuleLoader({
        mocks: {
            "next/server": { NextResponse: Response },
            "@/server/security/workspace-access": { guardWorkspaceRequest: () => denial, applyWorkspaceHeaders: response => response, accessFailure: (error, status) => Response.json({ error }, { status }) },
            "@/server/config/provider-store": {
                getProviderConnection: async () => { calls.connections++; return connection; },
                resolveProviderConnection: async () => { calls.selections++; if (!connection) calls.env++; return connection ?? environmentConnection; },
                saveDiscoveredModels: async (providerId, models) => { calls.saves.push({ providerId, models }); return models; },
            },
        },
        globals: { fetch: async (url, init) => {
            calls.fetch.push({ url, ...init });
            if (fetcher) return fetcher(url, init, calls.fetch.length);
            return Response.json({ data: [{ id: "vendor/image-model", owned_by: "vendor" }], models: [{ name: "models/gemini-test", displayName: "Gemini Test" }] });
        } },
    });
    const post = (body, options = {}) => loader.load("src/app/api/catalog/discover/route.ts").POST(new Request("http://localhost/api/catalog/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...options }));
    return { calls, post };
}

test("Gateway discovery uses the public model catalog without reading or sending credentials", async () => {
    const f = fixture({ connection: { providerId: "google-ai-studio", secret: "synthetic-must-not-send" } });
    const response = await f.post({ providerId: "vercel-ai-gateway", connectionId: "irrelevant" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.discovered[0].providerModelId, "vendor/image-model");
    assert.equal(f.calls.fetch.length, 1);
    assert.equal(f.calls.fetch[0].url, "https://ai-gateway.vercel.sh/v1/models");
    assert.equal(new Headers(f.calls.fetch[0].headers).has("Authorization"), false);
    assert.equal(f.calls.connections + f.calls.selections + f.calls.env, 0);
    assert.equal(f.calls.saves[0].providerId, "vercel-ai-gateway");
});

test("Runware discovery verifies connection ownership and persists AIR identifiers and media types", async () => {
    for (const providerId of ["google-ai-studio", "runware"]) {
        const f = fixture({ connection: { id: "conn_runware", providerId, secret: "synthetic-runware-key" }, fetcher: async (url, init) => {
            assert.equal(url, "https://api.runware.ai/v1");
            assert.equal(init.headers.Authorization, "Bearer synthetic-runware-key");
            const task = JSON.parse(init.body)[0];
            assert.equal(task.taskType, "modelSearch");
            return Response.json({ data: [{ taskUUID: task.taskUUID, taskType: task.taskType, totalResults: 1,
                results: [{ air: "bfl:flux@3-image", name: "FLUX 3 Image", category: "checkpoint", capabilities: ["io:text-to-image"] }] }] });
        } });
        const response = await f.post({ providerId: "runware", connectionId: "conn_runware" });
        if (providerId !== "runware") {
            assert.equal(response.status, 400); assert.equal(f.calls.fetch.length + f.calls.saves.length, 0);
        } else {
            assert.equal(response.status, 200);
            assert.equal(f.calls.saves[0].models[0].providerModelId, "bfl:flux@3-image");
            assert.equal(f.calls.saves[0].models[0].mediaType, "image");
            assert.equal((await response.json()).status, "unverified");
        }
    }
    const missing = fixture();
    assert.equal((await missing.post({ providerId: "runware" })).status, 400);
    assert.equal(missing.calls.fetch.length + missing.calls.saves.length, 0);
});

test("Google discovery without a configured key fails before any provider request", async () => {
    const f = fixture();
    const response = await f.post({ providerId: "google-ai-studio" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "ERR_PROVIDER_CONNECTION_NOT_CONFIGURED");
    assert.equal(f.calls.fetch.length, 0);
    assert.equal(f.calls.saves.length, 0);
});

test("Google discovery resolves saved or environment connections when no ID is supplied", async () => {
    for (const source of ["connection", "environmentConnection"]) {
        const f = fixture({ [source]: { providerId: "google-ai-studio", secret: "synthetic-google-key" } });
        const response = await f.post({ providerId: "google-ai-studio" });
        assert.equal(response.status, 200);
        assert.equal(f.calls.fetch[0].headers["x-goog-api-key"], "synthetic-google-key");
        assert.equal(f.calls.saves[0].providerId, "google-ai-studio");
    }
});

test("Google discovery never sends another provider's secret", async () => {
    const f = fixture({ connection: { providerId: "vercel-ai-gateway", secret: "synthetic-gateway-key" } });
    const response = await f.post({ providerId: "google-ai-studio", connectionId: "other-provider" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "ERR_PROVIDER_CONNECTION_PROVIDER_MISMATCH");
    assert.equal(f.calls.fetch.length, 0);
});

test("manual discovery needs no credentials and performs no provider request", async () => {
    const f = fixture();
    const response = await f.post({ providerId: "magnific" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "manual");
    assert.equal(f.calls.fetch.length + f.calls.connections + f.calls.selections + f.calls.env + f.calls.saves.length, 0);
});

test("discovery keeps the workspace access guard", async () => {
    const f = fixture({ denial: Response.json({ error: "unauthorized" }, { status: 401 }) });
    assert.equal((await f.post({ providerId: "vercel-ai-gateway" })).status, 401);
    assert.equal(f.calls.fetch.length + f.calls.saves.length, 0);
});

test("Google discovery follows encoded page tokens with one shared deadline and deduplicates IDs", async () => {
    const token = "opaque +/= token?";
    const f = fixture({ connection: { providerId: "google-ai-studio", secret: "synthetic-google-key" }, fetcher: async (_url, _init, call) => Response.json(call === 1
        ? { models: [{ name: "models/first", displayName: "First" }], nextPageToken: token }
        : { models: [{ name: "models/second" }, { name: "models/first", displayName: "First" }] }) });
    const response = await f.post({ providerId: "google-ai-studio" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.models.map(model => model.id), ["first", "second"]);
    assert.equal(body.truncated, false);
    assert.equal(f.calls.fetch.length, 2);
    assert.equal(new URL(f.calls.fetch[0].url).searchParams.get("pageSize"), "100");
    assert.equal(new URL(f.calls.fetch[1].url).searchParams.get("pageToken"), token);
    assert.equal(f.calls.fetch[0].signal, f.calls.fetch[1].signal);
    assert.ok(f.calls.fetch.every(call => !call.url.includes("synthetic-google-key")));
    assert.equal(f.calls.saves.length, 1);
    assert.deepEqual(Array.from(f.calls.saves[0].models, model => model.providerModelId), ["first", "second"]);
});

test("Google discovery never saves partial results after failed, malformed or cyclic pagination", async () => {
    for (const kind of ["http", "invalid", "repeat", "too-many-pages"]) {
        const f = fixture({ connection: { providerId: "google-ai-studio", secret: "synthetic-google-key" }, fetcher: async (_url, _init, call) => {
            if (call > 1 && kind === "http") return Response.json({ error: "private-provider-detail" }, { status: 503 });
            if (call > 1 && kind === "invalid") return Response.json({ models: {} });
            return Response.json({ models: [{ name: "models/model-" + call }], nextPageToken: kind === "too-many-pages" ? "page-" + call : "repeated" });
        } });
        const response = await f.post({ providerId: "google-ai-studio" });
        assert.equal(response.status, 502, kind);
        assert.equal((await response.json()).error, "ERR_PROVIDER_DISCOVERY_FAILED");
        assert.equal(f.calls.saves.length, 0);
        assert.equal(f.calls.fetch.length, kind === "too-many-pages" ? 20 : 2);
    }
});

test("Google discovery caps accepted models and reports truncation", async () => {
    const f = fixture({ connection: { providerId: "google-ai-studio", secret: "synthetic-google-key" }, fetcher: async () => Response.json({ models: Array.from({ length: 501 }, (_, index) => ({ name: "models/model-" + index })) }) });
    const response = await f.post({ providerId: "google-ai-studio" });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.models.length, 500);
    assert.equal(body.truncated, true);
    assert.equal(f.calls.saves[0].models.length, 500);
});

test("discovery propagates cancellation without persisting a partial snapshot", async () => {
    for (const providerId of ["google-ai-studio", "vercel-ai-gateway"]) {
        const controller = new AbortController();
        const f = fixture({ connection: { providerId, secret: "synthetic-key" }, fetcher: async () => { controller.abort(); return Response.json({ models: [], data: [] }); } });
        const response = await f.post({ providerId }, { signal: controller.signal });
        assert.equal(response.status, 408);
        assert.equal((await response.json()).error, "ERR_REQUEST_CANCELLED");
        assert.equal(f.calls.saves.length, 0);
    }
});

test("discovery cancels rejected or oversized upstream responses without saving data", async () => {
    for (const providerId of ["google-ai-studio", "vercel-ai-gateway"]) for (const status of [200, 401, 503]) {
        let cancelled = 0;
        const f = fixture({ connection: { providerId, secret: "synthetic-key" }, fetcher: async () => new Response(new ReadableStream({
            start(controller) { if (status === 200) controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)); },
            cancel() { cancelled++; },
        }), { status }) });
        const response = await f.post({ providerId });
        assert.equal(response.status, 502);
        assert.equal((await response.json()).error, "ERR_PROVIDER_DISCOVERY_FAILED");
        assert.equal(cancelled, 1);
        assert.equal(f.calls.saves.length, 0);
    }
});
