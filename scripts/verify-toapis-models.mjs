import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "./test-module-loader.mjs";
const fixture = createModuleLoader();
const { buildToapisRequest, ToapisProvider } = fixture.load("src/server/providers/toapis.ts");
const { TOAPIS_CONTRACTS: contracts, TOAPIS_IMAGE_CAPABILITIES: images, TOAPIS_VIDEO_CAPABILITIES: videos, toapisContractId } = fixture.load("src/server/catalog/toapis.ts");
const source = "https://fixtures.example.test/source.png";
const output = "https://fixtures.example.test/result.mp4";
const plain = value => JSON.parse(JSON.stringify(value));
const req = (model, overrides = {}, action) => {
    const c = contracts.find(c => c.model === model && c.action === action);
    assert.ok(c, model);
    const media = { slots: {} }; const fields = {};
    for (const slot of c.slots) if (slot.required) media.slots[slot.id] = Array.from({ length: Math.max(1, slot.min_count ?? 1) }, () => source);
    if (["viduq3", "viduq4-preview"].includes(model)) media.slots.reference_images = [source];
    if (model === "wan2.6-flash") media.slots.first_frame = [source];
    if (action && !["imagine", "blend", "edits"].includes(action)) fields.task_id = "tsk_parent";
    if (["upscale", "variation", "high-variation", "low-variation", "video", "remix-strong", "remix-subtle"].includes(action)) fields.index = 1;
    if (action === "pan") fields.direction = "left";
    return { modelId: toapisContractId(c), providerModelId: model, mediaType: c.mediaType, capabilities: c.mediaType === "image" ? images[toapisContractId(c)] : videos[toapisContractId(c)], params: { model_id: toapisContractId(c), prompt: "Synthetic generation scene", field_values: fields }, media, ...overrides };
};
const fails = (request, code) => assert.throws(() => buildToapisRequest(request), e => e.code === `ERR_TOAPIS_${code}`);
const read = (body, key) => key.split(".").reduce((value, part) => value?.[part], body);

test("ToAPIs every documented catalog entry constructs a whitelisted request", () => {
    assert.ok(contracts.length >= 100);
    assert.equal(new Set(contracts.map(toapisContractId)).size, contracts.length);
    assert.equal(contracts.length, Object.keys(images).length + Object.keys(videos).length);
    for (const c of contracts) {
        assert.match(c.source, /^https:\/\/docs\.toapis\.com\/docs\/en\/api-reference\//);
        const request = req(c.model, {}, c.action);
        const { body, path } = buildToapisRequest(request);
        assert.equal(body.model, c.model);
        assert.equal(body.prompt, request.params.prompt);
        assert.match(path, c.model === "midjourney" ? /^midjourney\/generations\/[a-z-]+$/ : /^(images|videos)\/generations$/);
        assert.equal(JSON.stringify(body).includes("apiKey"), false);
        const caps = request.capabilities;
        assert.equal(caps.provider_model_id, c.model);
        assert.equal(caps.media_slots.length, c.slots.length);
        assert.equal(new Set(c.slots.map(slot => slot.id)).size, c.slots.length, `${c.model}: duplicate reference controls`);
        const invalid = req(c.model, {}, c.action);
        invalid.params.field_values.unknown_vendor_parameter = true;
        fails(invalid, "UNSUPPORTED_PARAMETER");
    }
});

test("ToAPIs model-specific references do not leak into sibling contracts or duplicate request media", () => {
    const h3 = contracts.find(c => c.model === "MiniMax-H3");
    const max = contracts.find(c => c.model === "MiniMax-H3-Max");
    const turbo = contracts.find(c => c.model === "MiniMax-H3-Max-Turbo");
    assert.notEqual(h3.slots, max.slots);
    assert.notEqual(max.slots, turbo.slots);
    assert.deepEqual(plain(turbo.slots.map(slot => slot.id)), ["first_frame", "last_frame"]);
    assert.ok(contracts.find(c => c.model === "gpt-4o-image").slots.some(slot => slot.id === "mask"));
    for (const model of ["grok-4-1-image", "grok-4-2-image"]) assert.ok(!contracts.find(c => c.model === model).slots.some(slot => slot.id === "mask"));
    for (const model of [h3, max]) {
        assert.equal(model.slots.length, 5);
        const input = req(model.model);
        input.media.slots.reference_images = [source];
        const { body } = buildToapisRequest(input);
        assert.equal(body.image_with_roles.length, 1);
        assert.equal(body.image_with_roles[0].role, "reference_image");
    }
});

test("custom Midjourney aliases preserve the reviewed action independently of their local ID", () => {
    for (const action of ["upscale", "variation", "pan"]) {
        const original = req("midjourney", {}, action);
        const alias = { ...original, modelId: "my_custom_action", capabilities: { ...original.capabilities, id: "my_custom_action", catalog_source: "custom" } };
        assert.equal(alias.capabilities.provider_action, action);
        assert.equal(buildToapisRequest(alias).path, `midjourney/generations/${action}`);
        fails({ ...alias, capabilities: { ...alias.capabilities, provider_action: "unsupported-action" } }, "UNSUPPORTED_MODEL");
    }
});

test("ToAPIs every advertised ratio, resolution and duration is validated", () => {
    let cases = 0;
    for (const c of contracts) {
        for (const [key, values] of [["aspect_ratio", c.ratios], ["resolution", c.resolutions], ["duration", c.durations]]) for (const value of values ?? []) {
            const request = req(c.model, {}, c.action);
            request.params[key] = String(value);
            if (key === "aspect_ratio" && ["match_input_image", "auto", "adaptive"].includes(value)) {
                const reference = c.slots.find(slot => slot.id === "reference_images") ?? c.slots.find(slot => slot.kind === "image");
                assert.ok(reference, `${c.model}: adaptive ratio needs a supported image input`);
                request.media.slots[reference.id] = [source];
            }
            if (c.model.startsWith("MiniMax-Hailuo") && key === "resolution") { request.params.duration = "6"; if (value === "512P") request.media.slots.first_frame = [source]; }
            if (c.model.startsWith("gemini-omni") && key === "resolution" && value === "1080p") request.params.aspect_ratio = "16:9";
            const result = buildToapisRequest(request);
            const path = key === "aspect_ratio" ? c.ratioField ?? "aspect_ratio" : key === "resolution" ? c.resolutionField ?? "resolution" : c.durationField ?? "duration";
            // Turbo has no reference mode: adaptive output inherits its first frame's ratio.
            const inheritedRatio = c.model === "MiniMax-H3-Max-Turbo" && key === "aspect_ratio" && value === "adaptive";
            assert.equal(read(result.body, path), inheritedRatio ? undefined : key === "duration" ? value : String(value), `${c.model} ${key} ${value}`);
            cases++;
        }
    }
    assert.ok(cases > 500);
});

test("ToAPIs role arrays preserve multiple images, videos and audios", () => {
    const request = req("seedance-2-mini", { media: { slots: { reference_images: [source, source + "?2"], reference_videos: ["https://fixtures.example.test/a.mp4"], reference_audios: ["https://fixtures.example.test/a.mp3"] } } });
    const { body } = buildToapisRequest(request);
    assert.deepEqual(plain(body.image_with_roles), [{ url: source, role: "reference_image" }, { url: source + "?2", role: "reference_image" }]);
    assert.equal(body.video_with_roles[0].role, "reference_video");
    assert.equal(body.audio_with_roles[0].role, "reference_audio");
    request.media.slots.first_frame = [source]; fails(request, "MEDIA_MODE_CONFLICT");
    delete request.media.slots.first_frame;
    request.media.slots.reference_images = Array(10).fill(source); fails(request, "UNSUPPORTED_MEDIA");
    delete request.media.slots.reference_images; delete request.media.slots.reference_videos; fails(request, "VISUAL_REFERENCE_REQUIRED");
    const image = req("gemini-3-pro-image-preview", { media: { slots: { reference_images: [source, source + "?2"] } } });
    assert.deepEqual(plain(buildToapisRequest(image).body.image_urls), [{ url: source }, { url: source + "?2" }]);
});

test("ToAPIs documented fields enforce scalar bounds, enums and closed structured schemas", () => {
    for (const c of contracts) for (const f of c.fields) {
        if (f.required) continue;
        for (const bad of f.type === "checkbox" ? ["false", 1] : f.type === "number" ? ["1", NaN, Infinity, ...(f.minimum !== undefined ? [f.minimum - 1] : []), ...(f.maximum !== undefined ? [f.maximum + 1] : []), ...(f.step === 1 ? [1.5] : [])] : f.type === "select" ? ["unlisted_option", {}] : f.type === "text" ? [42, {}] : [{ unexpected: "value" }]) {
            const request = req(c.model, {}, c.action); request.params.field_values[f.id] = bad;
            assert.throws(() => buildToapisRequest(request), e => /^ERR_TOAPIS_/.test(e.code), `${c.model} ${f.id} ${JSON.stringify(bad)}`);
        }
    }
    const r = req("gemini-3.1-flash-image-official");
    r.params.field_values = { "metadata.temperature": 0, "metadata.topP": 0.8, "metadata.thinkingConfig.thinkingBudget": 24576, "metadata.safetySettings": [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" }], "metadata.imageOutputOptions.mimeType": "image/jpeg", "metadata.imageOutputOptions.compressionQuality": 80 };
    const body = buildToapisRequest(r).body;
    assert.equal(body.metadata.temperature, 0); assert.equal(body.metadata.imageOutputOptions.compressionQuality, 80);
    r.params.field_values["metadata.safetySettings"][0].extra = true; fails(r, "PARAMETER");
    const q = req("qwen-image-3.0"); q.params.field_values = { custom_size: "1024*1024" };
    assert.equal(buildToapisRequest(q).body.size, "1024*1024");
    q.params.field_values.custom_size = "99*99"; fails(q, "SIZE");
});

test("ToAPIs invalid media and conditional paid request combinations are rejected", () => {
    for (const value of ["http://example.com/image.png", "https://localhost/image.png", "https://127.0.0.1/a", "https://user:pass@example.com/a", "data:image/png;base64,AAAA"]) fails(req("gpt-image-2", { media: { slots: { reference_images: [value] } } }), "MEDIA_URL");
    fails(req("gpt-image-2-official", { media: { slots: { mask: [source] } } }), "MASK_REQUIRES_IMAGE");
    fails(req("seedance-2", { media: { slots: { first_frame: [source] } }, params: { prompt: "Scene", field_values: { tools: [{ type: "web_search" }] } } }), "TOOLS_TEXT_ONLY");
    fails(req("doubao-seedream-4-5", { media: { slots: { reference_images: Array(10).fill(source) } }, params: { prompt: "Scene", field_values: { n: 6 } } }), "OUTPUT_LIMIT");
    fails(req("kling-v2-6", { params: { prompt: "Scene", field_values: { audio: true, mode: "std" } } }), "AUDIO_MODE");
    fails(req("MiniMax-Hailuo-2.3", { params: { prompt: "Scene", resolution: "1080P", duration: "10" } }), "RESOLUTION");
    const kling = req("kling-4.0", { media: { slots: { last_frame: [source] } } });
    assert.equal(buildToapisRequest(kling).body.image_with_roles[0].role, "last_frame");
    kling.media.slots.reference_images = [source]; fails(kling, "MEDIA_MODE_CONFLICT");
    fails(req("wan2.6-flash", { media: {} }), "MEDIA_REQUIRED");
    fails(req("grok-video-1.5", { media: { slots: { reference_images: [source] } }, params: { prompt: "Scene", resolution: "1080p" } }), "MEDIA_MODE_CONFLICT");
});

test("ToAPIs Seedance2.5 draft, edit and extension contracts", () => {
    const draft = req("seedance-2-5", { params: { prompt: "Scene", field_values: { draft: true } } });
    assert.equal(buildToapisRequest(draft).body.resolution, "480p");
    const final = req("seedance-2-5", { params: { prompt: "", field_values: { draft_task_id: "tsk_draft", output_format: "mov" } } });
    assert.equal(buildToapisRequest(final).body.resolution, "1080p");
    final.params.prompt = "Do not repeat inputs"; fails(final, "DRAFT_CONFLICT");
    const edit = req("seedance-2-5", { params: { prompt: "Edit scene", duration: "-1", field_values: { video_operation: "edit" } }, media: { slots: { reference_videos: [output] } } });
    assert.equal(buildToapisRequest(edit).body.aspect_ratio, "adaptive");
    edit.params.duration = "4"; fails(edit, "DURATION");
    const ext = req("seedance-2.5-ext", { params: { prompt: "Scene", duration: "15" }, media: { slots: { reference_videos: [output] } } });
    fails(ext, "DURATION");
});

test("ToAPIs extensions/remix and Midjourney actions use exact documented paths", () => {
    const sora = req("sora-2-official", { params: { prompt: "Change colors", field_values: { task_action: "remix", video_id: "tsk_parent" } } });
    assert.equal(buildToapisRequest(sora).path, "videos/tsk_parent/remix");
    assert.equal(buildToapisRequest(sora).body.duration, undefined);
    const grok = req("grok-imagine-video-official", { params: { prompt: "Continue scene", duration: "6", field_values: { task_action: "extend" } }, media: { slots: { source_video: [output] } } });
    assert.equal(buildToapisRequest(grok).path, "videos/extend");
    for (const c of contracts.filter(c => c.model === "midjourney")) assert.equal(buildToapisRequest(req(c.model, {}, c.action)).path, `midjourney/generations/${c.action}`);
});

const response = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
test("ToAPIs HTTP submission uses official origin, single POST and credential-free durable operation", async () => {
    for (const model of ["gpt-image-2", "gpt-image-2.5-flare-official", "seedance-2-5"]) {
        const calls = [];
        const provider = new ToapisProvider({ apiKey: "synthetic-test-only", fetcher: async (url, init) => { calls.push({ url, init }); return response({ id: "tsk_new", model, object: "generation.task", status: "pending" }); } });
        const result = await provider.submit(req(model));
        assert.equal(calls.length, 1); assert.equal(calls[0].init.method, "POST"); assert.equal(calls[0].init.redirect, "error");
        assert.equal(new URL(calls[0].url).origin, model.endsWith("official") ? "https://api.toapis.com" : "https://toapis.com");
        assert.equal(JSON.stringify(result.operation).includes("synthetic-test-only"), false);
        assert.equal(result.operation.maxOutputs, 1);
    }
});

test("ToAPIs polling supports multi-output, formats and restart-safe legacy operation identities", async () => {
    const model = "gpt-image-2-official";
    let payload = { id: "tsk_poll", model, object: "generation.task", status: "completed", result: { type: "image", data: [{ url: source, format: "png" }, { url: source + "?2", format: "png" }] } };
    const provider = new ToapisProvider({ apiKey: "synthetic-test-only", fetcher: async () => response(payload) });
    const request = { mediaType: "image", providerModelId: model, operation: { version: 2, taskId: "tsk_poll", mediaType: "image", model, origin: "https://toapis.com", maxOutputs: 2 } };
    assert.equal((await provider.poll(request)).assets.length, 2);
    request.operation.maxOutputs = 1; await assert.rejects(provider.poll(request));
    payload.result.data.length = 1; request.operation.version = 1; delete request.operation.maxOutputs;
    assert.equal((await provider.poll(request)).status, "COMPLETED");
    payload.id = "wrong"; await assert.rejects(provider.poll(request), e => e.code === "ERR_TOAPIS_TASK_IDENTITY");
    payload.id = "tsk_poll"; request.operation.origin = "https://evil.example.test"; await assert.rejects(provider.poll(request), e => e.code === "ERR_TOAPIS_OPERATION");
});

test("ToAPIs Midjourney MODAL preserves a recoverable pending task", async () => {
    const provider = new ToapisProvider({ apiKey: "synthetic-test-only", fetcher: async () => response({ id: "tsk_modal", model: "midjourney", object: "generation.task", status: "MODAL" }) });
    const result = await provider.poll({ mediaType: "image", providerModelId: "midjourney", operation: { version: 2, taskId: "tsk_modal", model: "midjourney", action: "inpaint", mediaType: "image", origin: "https://toapis.com", maxOutputs: 4 } });
    assert.equal(result.status, "IN_PROGRESS"); assert.equal(result.operation.actionRequired, "mask"); assert.equal(result.operation.taskId, "tsk_modal");
});
