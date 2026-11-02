import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "./test-module-loader.mjs";

test("a failed catalog retry settles while keeping SWR's visible error state", async () => {
    const failure = new Error("ERR_MODEL_CATALOG_UNAVAILABLE");
    let retryCount = 0;
    const state = { data: undefined, error: failure, isLoading: false, mutate: async () => { retryCount++; throw failure; } };
    const loader = createModuleLoader({ mocks: {
        react: { useMemo: compute => compute() },
        swr: { __esModule: true, default: () => state },
    } });
    const { useRuntimeModels } = loader.load("src/features/catalog/hooks/useRuntimeModels.ts");
    const catalog = useRuntimeModels("image");
    await assert.doesNotReject(catalog.refresh());
    assert.equal(retryCount, 1);
    assert.equal(catalog.error, failure);
    assert.equal(catalog.models.length, 0);

    const model = { id: "synthetic", group: "Synthetic", provider: "google-ai-studio" };
    state.mutate = async () => { state.data = { models: [model] }; state.error = undefined; };
    await useRuntimeModels("image").refresh();
    const recovered = useRuntimeModels("image");
    assert.equal(recovered.error, undefined);
    assert.equal(recovered.byId.synthetic, model);
    assert.equal(recovered.models.length, 1);
});

test("catalog request failures still reject at the SWR fetch boundary", async () => {
    const fetchers = [];
    const loader = createModuleLoader({ globals: { fetch: async () => Response.json({ error: "Unavailable" }, { status: 503 }) }, mocks: {
        react: { useMemo: compute => compute() },
        swr: { __esModule: true, default: (url, fetcher) => { fetchers.push([url, fetcher]); return { mutate: async () => undefined }; } },
    } });
    const { useRuntimeModels } = loader.load("src/features/catalog/hooks/useRuntimeModels.ts");
    useRuntimeModels("image");
    useRuntimeModels("video");
    assert.deepEqual(fetchers.map(([url]) => url), ["/api/image-models", "/api/models"]);
    for (const [url, fetcher] of fetchers) await assert.rejects(fetcher(url), /ERR_MODEL_CATALOG_UNAVAILABLE/);
});
