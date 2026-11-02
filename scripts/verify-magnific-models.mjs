import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "./test-module-loader.mjs";

function fixture(response = { data: { task_id: "tsk_magnific", status: "IN_PROGRESS" } }) {
  const calls = [];
  const modules = createModuleLoader({
    env: { MAGNIFIC_API_KEY: "synthetic-magnific-key" },
    globals: { fetch: async (url, init) => { calls.push({ url: String(url), ...init }); return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } }); } },
  });
  return { modules, calls, provider: new (modules.load("src/server/providers/magnific-provider.ts").MagnificProvider)() };
}

test("Magnific registry mirrors the reviewed OpenAPI image/video contracts", () => {
  const caps = fixture().modules.load("src/server/catalog/magnific.ts");
  const all = Object.values(caps.MAGNIFIC_CONTRACTS);
  assert.ok(all.length >= 150);
  assert.ok(all.some(c => c.mediaType === "image") && all.some(c => c.mediaType === "video"));
  for (const [id, contract] of Object.entries(caps.MAGNIFIC_CONTRACTS)) {
    assert.match(id, /^magnific__/); assert.match(contract.path, /^\/v1\/ai\//);
    assert.equal(contract.schema.properties?.webhook_url, undefined);
    if (!contract.synchronous) assert.match(contract.poll ?? "", /\{task-id\}/);
  }
  assert.ok(Object.keys(caps.MAGNIFIC_IMAGE_CAPABILITIES).length >= 45);
  assert.ok(Object.keys(caps.MAGNIFIC_VIDEO_CAPABILITIES).length >= 100);
});

test("Magnific async submit uses current origin and compact task identity", async () => {
  const f = fixture();
  const id = "magnific__text_to_image__nano_banana_2_1";
  const cap = f.modules.load("src/server/catalog/magnific.ts").MAGNIFIC_IMAGE_CAPABILITIES[id];
  assert.ok(cap);
  const result = await f.provider.submit({ mediaType: "image", modelId: id, providerModelId: cap.provider_model_id, capabilities: cap, params: { model_id: id, prompt: "synthetic", field_values: { resolution: "1K", aspect_ratio: "1:1" } }, media: {} });
  assert.equal(result.status, "CREATED");
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].url, /^https:\/\/api\.magnific\.com\//);
  assert.equal(f.calls[0].headers["x-magnific-api-key"], "synthetic-magnific-key");
  assert.equal(JSON.stringify(result.operation).includes("synthetic-magnific-key"), false);
});

test("Magnific schema validation rejects unknown controls before dispatch", async () => {
  const f = fixture();
  const id = "magnific__text_to_image__nano_banana_2_1";
  const cap = f.modules.load("src/server/catalog/magnific.ts").MAGNIFIC_IMAGE_CAPABILITIES[id];
  await assert.rejects(f.provider.submit({ mediaType: "image", modelId: id, providerModelId: cap.provider_model_id, capabilities: cap, params: { model_id: id, prompt: "synthetic", field_values: { unknown: true } }, media: {} }), e => e.code === "ERR_MAGNIFIC_INPUT");
  assert.equal(f.calls.length, 0);
});

test("Magnific custom aliases reuse only the exact reviewed path and its media contract", async () => {
  const f = fixture();
  const catalog = f.modules.load("src/server/catalog/magnific.ts");
  const template = catalog.MAGNIFIC_IMAGE_CAPABILITIES.magnific__text_to_image__nano_banana_2_1;
  const cap = { ...template, id: "my_custom_magnific_alias", catalog_source: "custom" };
  const request = { mediaType: "image", modelId: cap.id, providerModelId: cap.provider_model_id, capabilities: cap, params: { model_id: cap.id, prompt: "synthetic", field_values: { resolution: "1K", aspect_ratio: "1:1" } }, media: {} };
  const result = await f.provider.submit(request);
  assert.equal(result.status, "CREATED");
  assert.equal(f.calls[0].url, `https://api.magnific.com${template.provider_model_id}`);
  assert.ok(catalog.getMagnificContract(template.provider_model_id, "image"));
  assert.equal(catalog.getMagnificContract(template.provider_model_id, "video"), undefined);
  assert.equal(catalog.getMagnificContract("/v1/ai/unreviewed", "image"), undefined);
  const calls = f.calls.length;
  for (const bad of [{ ...request, providerModelId: "/v1/ai/unreviewed" }, { ...request, mediaType: "video" }]) {
    await assert.rejects(f.provider.submit(bad), error => error.code === "ERR_MAGNIFIC_MODEL");
  }
  assert.equal(f.calls.length, calls);
});
