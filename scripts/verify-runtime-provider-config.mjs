import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createModuleLoader } from "./test-module-loader.mjs";

test("runtime provider connections encrypt secrets and round-robin equal-priority keys", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "open-higgsfield-provider-config-"));
    try {
        const loader = createModuleLoader({ env: {
            OPEN_HIGGSFIELD_STORAGE_DIR: directory,
            PROVIDER_CONFIG_ENCRYPTION_KEY: "synthetic-provider-config-key-32-characters",
        } });
        const store = loader.load("src/server/config/provider-store.ts");
        const first = await store.saveProviderConnection({ providerId: "vercel-ai-gateway", label: "first", secret: "secret-first", priority: 10 });
        const second = await store.saveProviderConnection({ providerId: "vercel-ai-gateway", label: "second", secret: "secret-second", priority: 10 });
        const raw = await fs.readFile(path.join(directory, "provider-runtime-config.json"), "utf8");
        assert.equal(raw.includes("secret-first"), false);
        assert.equal(raw.includes("secret-second"), false);
        assert.equal((await store.selectProviderConnection("vercel-ai-gateway")).id, first.id);
        assert.equal((await store.selectProviderConnection("vercel-ai-gateway")).id, second.id);
        assert.equal((await store.selectProviderConnection("vercel-ai-gateway")).secret, "secret-first");
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test("custom models stay disabled until explicitly enabled", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "open-higgsfield-model-config-"));
    try {
        const env = { OPEN_HIGGSFIELD_STORAGE_DIR: directory, PROVIDER_CONFIG_ENCRYPTION_KEY: "synthetic-provider-config-key-32-characters" };
        const loader = createModuleLoader({ env });
        const store = loader.load("src/server/config/provider-store.ts");
        const catalog = loader.load("src/server/catalog/runtime.ts");
        const capabilities = { id: "custom_gateway_image", label: "Custom Gateway Image", family: "Custom", variant: "", group: "Custom", provider: "vercel-ai-gateway", provider_model_id: "vendor/image-new", prompt_required: true, duration: false, aspect_ratio: false, size: false, resolution_variant: false, negative_prompt: false, cfg_scale: false, style: false, shot_type: false, prompt_expansion: false, elements: false, media_slots: [], custom_fields: [] };
        await store.saveCustomModel({ mediaType: "image", capabilities, enabled: false });
        assert.equal((await catalog.getRuntimeCapabilities("image")).custom_gateway_image, undefined);
        await store.setBuiltInModelEnabled("custom_gateway_image", "image", true);
        assert.equal((await catalog.getRuntimeCapabilities("image")).custom_gateway_image?.catalog_source, "custom");
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test("editing a Magnific connection preserves its encrypted key and rejects unconfigured keys", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "open-higgsfield-edit-key-"));
    try {
        const loader = createModuleLoader({ env: {
            OPEN_HIGGSFIELD_STORAGE_DIR: directory,
            PROVIDER_CONFIG_ENCRYPTION_KEY: "synthetic-provider-config-key-32-characters",
        } });
        const store = loader.load("src/server/config/provider-store.ts");
        await assert.rejects(store.saveProviderConnection({ providerId: "magnific", label: "Missing key" }), /ERR_PROVIDER_SECRET_REQUIRED/);
        const original = await store.saveProviderConnection({ providerId: "magnific", label: "Personal", secret: "synthetic-magnific-key" });
        await store.saveProviderConnection({ id: original.id, providerId: "magnific", label: "Renamed", enabled: false, priority: 20 });
        const saved = (await store.listProviderConnections()).find((entry) => entry.id === original.id);
        assert.equal(saved.label, "Renamed");
        assert.equal(saved.enabled, false);
        assert.equal(saved.priority, 20);
        assert.equal(saved.secretConfigured, true);
        assert.equal(saved.secret, undefined);
        assert.equal(await store.getProviderConnection(original.id), undefined);
        await store.saveProviderConnection({ id: original.id, providerId: "magnific", label: "Renamed", enabled: true });
        assert.equal((await store.getProviderConnection(original.id)).secret, "synthetic-magnific-key");
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test("removed Freepik connections and custom models cannot reenter the runtime catalog", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "open-higgsfield-retired-provider-"));
    try {
        const capabilities = { id: "retired_custom", label: "Retired", provider: "freepik", provider_model_id: "old", family: "Old", group: "Old", prompt_required: true, media_slots: [], custom_fields: [] };
        await fs.writeFile(path.join(directory, "provider-runtime-config.json"), JSON.stringify({ version: 1,
            connections: [{ id: "retired_connection", providerId: "freepik", enabled: true, priority: 10 }],
            modelOverrides: [{ modelId: capabilities.id, mediaType: "image", source: "custom", enabled: true, capabilities }],
            discoveredModels: [{ id: "retired_candidate", providerId: "freepik" }],
        }));
        const loader = createModuleLoader({ env: { OPEN_HIGGSFIELD_STORAGE_DIR: directory, FREEPIK_API_KEY: "synthetic-retired-key" } });
        const store = loader.load("src/server/config/provider-store.ts");
        const definitions = loader.load("src/providers/definitions.ts");
        const catalog = loader.load("src/server/catalog/runtime.ts");
        assert.equal(definitions.isProviderId("freepik"), false);
        assert.equal(definitions.PROVIDER_DEFINITIONS.length, 5);
        assert.deepEqual(Array.from(await store.listProviderConnections()), []);
        assert.equal(await store.getProviderConnection("retired_connection"), undefined);
        assert.equal(await store.selectProviderConnection("freepik"), undefined);
        assert.equal(store.connectionFromEnv("freepik"), undefined);
        assert.equal(store.connectionFromEnv("magnific"), undefined, "old key must not be used for Magnific");
        assert.equal((await store.listDiscoveredModels()).length, 0);
        await assert.rejects(store.saveProviderConnection({ providerId: "freepik", label: "Old", secret: "synthetic" }), /ERR_PROVIDER_CONNECTION_INVALID/);
        await assert.rejects(store.saveCustomModel({ mediaType: "image", capabilities }), /ERR_CUSTOM_MODEL_INVALID/);
        for (const mediaType of ["image", "video"]) {
            const all = await catalog.getAllRuntimeCapabilities(mediaType);
            const runtime = await catalog.getRuntimeCapabilityList(mediaType);
            assert.ok(all.length > 0);
            assert.equal(runtime.length, 0, "retired credentials cannot connect current providers");
            assert.ok(all.every(model => definitions.isProviderId(model.provider)));
            assert.ok(runtime.every(model => definitions.isProviderId(model.provider)));
            assert.equal(await catalog.getRuntimeCapability(mediaType, "retired_custom"), undefined);
        }
        assert.equal(catalog.getBuiltInCapability("image", "v1__ai__text_to_image__flux_2_pro"), undefined);
        assert.equal(catalog.getBuiltInCapability("video", "kling-v3-pro"), undefined);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});


test("Studio lists only models from providers with enabled credentials", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "open-higgsfield-visible-models-"));
    try {
        const loader = createModuleLoader({ env: {
            OPEN_HIGGSFIELD_STORAGE_DIR: directory,
            PROVIDER_CONFIG_ENCRYPTION_KEY: "synthetic-provider-config-key-32-characters",
        } });
        const store = loader.load("src/server/config/provider-store.ts");
        const catalog = loader.load("src/server/catalog/runtime.ts");
        const definitions = loader.load("src/providers/definitions.ts");
        for (const media of ["image", "video"]) {
            assert.equal((await catalog.getRuntimeCapabilityList(media)).length, 0);
            assert.ok((await catalog.getAllRuntimeCapabilities(media)).length > 0, "settings still expose disconnected models");
        }
        for (const { id: providerId } of definitions.PROVIDER_DEFINITIONS) {
            const first = await store.saveProviderConnection({ providerId, label: "Disabled", secret: "synthetic-hidden-key", enabled: false });
            assert.equal((await store.getConnectedProviderIds()).has(providerId), false);
            const second = await store.saveProviderConnection({ providerId, label: "Active", secret: "synthetic-active-key", enabled: true });
            for (const media of ["image", "video"]) {
                const models = await catalog.getRuntimeCapabilityList(media);
                assert.ok(models.length > 0, `${providerId} has ${media} models`);
                assert.ok(models.every(model => model.provider === providerId));
                assert.equal(JSON.stringify(models).includes("synthetic-active-key"), false);
                const model = models[0];
                await store.setBuiltInModelEnabled(model.id, media, false);
                assert.equal((await catalog.getRuntimeCapabilityList(media)).some(entry => entry.id === model.id), false);
                await store.setBuiltInModelEnabled(model.id, media, true);
            }
            await store.saveProviderConnection({ id: second.id, providerId, label: "Disabled too", enabled: false });
            for (const media of ["image", "video"]) assert.equal((await catalog.getRuntimeCapabilityList(media)).length, 0);
            await store.saveProviderConnection({ id: first.id, providerId, label: "Re-enabled", enabled: true });
            assert.equal((await store.getConnectedProviderIds()).has(providerId), true);
            await store.saveProviderConnection({ id: first.id, providerId, label: "Disabled", enabled: false });
        }
        const custom = { ...(await catalog.getAllRuntimeCapabilities("image"))[0], id: "disconnected_custom", catalog_source: "custom", provider: "vercel-ai-gateway", provider_model_id: "test/image" };
        await store.saveCustomModel({ mediaType: "image", capabilities: custom, enabled: true });
        assert.equal((await catalog.getRuntimeCapabilityList("image")).some(model => model.id === custom.id), false);
        await store.saveProviderConnection({ providerId: "vercel-ai-gateway", label: "Custom account", secret: "synthetic-custom-key" });
        assert.equal((await catalog.getRuntimeCapabilityList("image")).some(model => model.id === custom.id), true);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("disabled saved connections override environment keys; keyless entries never connect", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "open-higgsfield-env-models-"));
    try {
        const loader = createModuleLoader({ env: {
            OPEN_HIGGSFIELD_STORAGE_DIR: directory,
            PROVIDER_CONFIG_ENCRYPTION_KEY: "synthetic-provider-config-key-32-characters",
            GEMINI_API_KEY: "synthetic-env-key",
        } });
        const store = loader.load("src/server/config/provider-store.ts");
        const catalog = loader.load("src/server/catalog/runtime.ts");
        assert.deepEqual(Array.from(await store.getConnectedProviderIds()), ["google-ai-studio"]);
        for (const media of ["image", "video"]) {
            const models = await catalog.getRuntimeCapabilityList(media);
            assert.ok(models.length > 0);
            assert.ok(models.every(model => model.provider === "google-ai-studio"));
        }
        const saved = await store.saveProviderConnection({ providerId: "google-ai-studio", label: "Off", secret: "synthetic-saved-key", enabled: false });
        assert.equal((await store.getConnectedProviderIds()).size, 0);
        for (const media of ["image", "video"]) assert.equal((await catalog.getRuntimeCapabilityList(media)).length, 0);
        await store.deleteProviderConnection(saved.id);
        assert.equal((await store.getConnectedProviderIds()).has("google-ai-studio"), true);
        await fs.writeFile(path.join(directory, "provider-runtime-config.json"), JSON.stringify({ version: 1,
            connections: [{ id: "keyless", providerId: "toapis", enabled: true, label: "Missing", priority: 10 }],
            modelOverrides: [], discoveredModels: [],
        }));
        assert.equal((await store.getConnectedProviderIds()).has("toapis"), false);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("submission connection resolution respects disabled keys and never masks corrupt configuration", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "open-higgsfield-resolve-connection-"));
    try {
        const loader = createModuleLoader({ env: {
            OPEN_HIGGSFIELD_STORAGE_DIR: directory,
            PROVIDER_CONFIG_ENCRYPTION_KEY: "synthetic-provider-config-key-32-characters",
            GEMINI_API_KEY: "synthetic-environment-credential",
        } });
        const store = loader.load("@/server/config/provider-store");
        const fromEnvironment = await store.resolveProviderConnection("google-ai-studio");
        assert.equal(fromEnvironment.id, "env:google-ai-studio");
        assert.equal((await store.getProviderConnection(fromEnvironment.id)).secret, fromEnvironment.secret, "polling recovers the pinned environment connection");
        const saved = await store.saveProviderConnection({ providerId: "google-ai-studio", label: "Saved", secret: "synthetic-saved-credential" });
        assert.equal((await store.resolveProviderConnection("google-ai-studio")).id, saved.id);
        await store.saveProviderConnection({ id: saved.id, providerId: "google-ai-studio", label: "Off", enabled: false });
        await assert.rejects(store.resolveProviderConnection("google-ai-studio"), /ERR_PROVIDER_CONNECTION_NOT_CONFIGURED/);
        // Existing .env jobs retain their identity even when new saved connections exist.
        assert.equal((await store.getProviderConnection(fromEnvironment.id)).id, fromEnvironment.id);
        await fs.writeFile(path.join(directory, "provider-runtime-config.json"), "not-json");
        await assert.rejects(store.resolveProviderConnection("google-ai-studio"), /ERR_PROVIDER_CONFIG_CORRUPT/);
        assert.equal(await store.getProviderConnection("env:unknown-provider"), undefined);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("custom contracts reject malformed nested controls and reserved IDs before any write", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "open-higgsfield-invalid-contract-"));
    try {
        const loader = createModuleLoader({ env: { OPEN_HIGGSFIELD_STORAGE_DIR: directory } });
        const store = loader.load("src/server/config/provider-store.ts");
        const builtIns = loader.load("src/server/catalog/image.ts").IMAGE_CAPABILITIES;
        const original = Object.values(builtIns)[0];
        const valid = { ...original, id: "custom_valid_contract", catalog_source: "custom" };
        await store.saveCustomModel({ mediaType: "image", capabilities: valid });
        const before = await fs.readFile(path.join(directory, "provider-runtime-config.json"), "utf8");
        const invalid = [
            { ...valid, media_slots: [null] },
            { ...valid, media_slots: [{ id: "reference-images", label: "Reference", kind: "image" }] },
            { ...valid, media_slots: [{ id: "x".repeat(124), label: "Reference", kind: "image" }] },
            { ...valid, custom_fields: [null] },
            { ...valid, custom_fields: [{ id: "bad", label: "Bad", type: "select", options: [null] }] },
            { ...valid, custom_fields: [{ id: "bad", label: "Bad", type: "text", pattern: "[" }] },
            { ...valid, custom_fields: [{ id: "bad", label: "Bad", type: "json", schema: { type: "object", properties: { nested: null } } }] },
            { ...valid, custom_fields: [{ id: "bad", label: "Bad", type: "json", schema: { $ref: "https://example.test/schema" } }] },
            { ...valid, custom_fields: [original.custom_fields[0], original.custom_fields[0]] },
            { ...valid, media_slots: [{ id: "same", label: "Same", kind: "image" }, { id: "same", label: "Same", kind: "image" }] },
            { ...valid, duration: { options: [null] } },
            { ...valid, id: original.id },
            { ...valid, id: "__proto__" },
            { ...valid, id: "constructor" },
        ];
        let nested = { type: "string" };
        for (let index = 0; index < 30; index++) nested = { type: "array", items: nested };
        invalid.push({ ...valid, custom_fields: [{ id: "deep", label: "Deep", type: "json", schema: nested }] });
        for (const capabilities of invalid) {
            await assert.rejects(store.saveCustomModel({ mediaType: "image", capabilities, enabled: true }), /ERR_CUSTOM_MODEL_INVALID/);
            assert.equal(await fs.readFile(path.join(directory, "provider-runtime-config.json"), "utf8"), before);
        }
        const catalog = loader.load("src/server/catalog/runtime.ts");
        assert.equal((await catalog.getRuntimeCapability("image", original.id)).provider_model_id, original.provider_model_id);
        for (const modelId of ["__proto__", "constructor", "toString", "nonexistent"]) {
            assert.equal(await catalog.getRuntimeCapability("image", modelId), undefined);
            assert.equal(catalog.getBuiltInCapability("image", modelId), undefined);
            assert.equal(catalog.isBuiltInCapability("image", modelId), false);
            await assert.rejects(store.setBuiltInModelEnabled(modelId, "image", true), /ERR_MODEL_PREFERENCE_INVALID/);
            assert.equal(await fs.readFile(path.join(directory, "provider-runtime-config.json"), "utf8"), before);
        }
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("custom provider contracts cannot advertise an endpoint or action without a reviewed adapter", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "open-higgsfield-custom-adapter-"));
    try {
        const loader = createModuleLoader({ env: { OPEN_HIGGSFIELD_STORAGE_DIR: directory } });
        const store = loader.load("src/server/config/provider-store.ts");
        const templates = loader.load("src/server/catalog/image.ts").IMAGE_CAPABILITIES;
        for (const provider of ["magnific", "toapis"]) {
            const template = Object.values(templates).find(model => model.provider === provider);
            await assert.rejects(store.saveCustomModel({ mediaType: "image", capabilities: { ...template, id: "unknown_adapter", catalog_source: "custom", provider_model_id: "new/unreviewed-model" } }), /ERR_CUSTOM_MODEL_ADAPTER_REQUIRED/);
        }
        const midjourney = templates.toapis__midjourney__upscale;
        for (const action of [undefined, "unreviewed-action"]) {
            await assert.rejects(store.saveCustomModel({ mediaType: "image", capabilities: { ...midjourney, id: "unknown_action", catalog_source: "custom", provider_action: action } }), /ERR_CUSTOM_MODEL_ADAPTER_REQUIRED/);
        }
        await assert.rejects(fs.access(path.join(directory, "provider-runtime-config.json")), error => error.code === "ENOENT");
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("all built-in contracts remain valid templates for custom models", () => {
    const loader = createModuleLoader();
    const { assertCustomModelCapabilities } = loader.load("src/server/catalog/custom-validation.ts");
    let count = 0;
    for (const [mediaType, file, key] of [["image", "image", "IMAGE_CAPABILITIES"], ["video", "video", "VIDEO_CAPABILITIES"]]) {
        for (const model of Object.values(loader.load(`src/server/catalog/${file}.ts`)[key]).filter(model => !model.deprecated)) {
            assert.doesNotThrow(() => assertCustomModelCapabilities({ ...model, id: `custom_template_${count++}`, catalog_source: "custom" }, mediaType), `${model.id}: template rejected`);
        }
    }
    assert.ok(count >= 367);
});

test("invalid historical custom contracts fail closed without mutation and can be explicitly removed", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "open-higgsfield-invalid-history-"));
    try {
        const loader = createModuleLoader({ env: { OPEN_HIGGSFIELD_STORAGE_DIR: directory } });
        const store = loader.load("src/server/config/provider-store.ts");
        const catalog = loader.load("src/server/catalog/runtime.ts");
        const fixture = { version: 1, connections: [], discoveredModels: [], modelOverrides: [{ modelId: "historical_bad", mediaType: "image", source: "custom", enabled: true, capabilities: { provider: "google-ai-studio", custom_fields: [null] } }] };
        const file = path.join(directory, "provider-runtime-config.json");
        await fs.writeFile(file, JSON.stringify(fixture));
        await assert.rejects(catalog.getAllRuntimeCapabilities("image"), /ERR_PROVIDER_CONFIG_CORRUPT/);
        await assert.rejects(catalog.getRuntimeCapabilities("image"), /ERR_PROVIDER_CONFIG_CORRUPT/);
        assert.equal(await fs.readFile(file, "utf8"), JSON.stringify(fixture));
        assert.equal(await store.deleteCustomModel("historical_bad", "image"), true);
        assert.ok((await catalog.getAllRuntimeCapabilities("image")).length > 0);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
