import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "./test-module-loader.mjs";

test("Gateway registry covers every reviewed catalog media model", () => {
  const { GATEWAY_CATALOG, GATEWAY_IMAGE_CAPABILITIES, GATEWAY_VIDEO_CAPABILITIES } = createModuleLoader().load("src/server/catalog/gateway.ts");
  assert.equal(GATEWAY_CATALOG.length, 84);
  assert.equal(Object.keys(GATEWAY_IMAGE_CAPABILITIES).length, 45);
  assert.equal(Object.keys(GATEWAY_VIDEO_CAPABILITIES).length, 39);
});

test("Gateway controls are closed and video contracts preserve catalog constraints", () => {
  const { GATEWAY_CATALOG, GATEWAY_VIDEO_CAPABILITIES } = createModuleLoader().load("src/server/catalog/gateway.ts");
  for (const cap of Object.values(GATEWAY_VIDEO_CAPABILITIES)) {
    assert.equal(cap.provider, "vercel-ai-gateway");
    assert.ok(cap.provider_model_id);
    assert.ok(cap.duration === false || cap.duration.options?.length);
    assert.ok(cap.resolution_variant === false || cap.resolution_variant.options?.length);
    assert.ok(cap.custom_fields.every(field => field.type !== "json" || field.schema));
    const source = GATEWAY_CATALOG.find(model => model.id === cap.provider_model_id);
    if (source?.video?.supported_durations_seconds) assert.deepEqual(cap.duration.options.map(Number), source.video.supported_durations_seconds);
  }
});
