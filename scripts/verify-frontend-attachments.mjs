import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "./test-module-loader.mjs";

const modules = createModuleLoader({ mocks: { "@/server/media/input-upload": {}, "@/server/generation/input": {} } });
const { remapSlotFilesOnModelSwitch, remapVideoAttachmentsOnModelSwitch } = modules.load("src/features/studio/lib/attachment-remap.ts");
const { readModelMedia } = modules.load("src/server/generation/media-input.ts");
const { filesForDropTarget } = modules.load("src/features/studio/lib/attachment-drop-targets.ts");
const imageModels = modules.load("src/server/catalog/image.ts").IMAGE_CAPABILITIES;
const videoModels = modules.load("src/server/catalog/video.ts").VIDEO_CAPABILITIES;
const image = index => new File([`synthetic-${index}`], `${index}.png`, { type: "image/png" });
const role = (id, kind = "image", options = {}) => ({ id, label: id, kind, ...options });
const attachment = (id, roleId, kind = "image") => ({ id, roleId, kind, type: "url", url: `https://fixtures.example.test/${id}` });
const plain = value => JSON.parse(JSON.stringify(value));

test("drop targets accept their declared media kind independently of the generated output", () => {
    const files = [image(0), new File(["video"], "reference.mp4", { type: "video/mp4" }), new File(["audio"], "reference.mp3", { type: "audio/mpeg" })];
    const imageModel = imageModels["google-ai-studio__gemini-3.1-flash-image"];
    const videoSlot = imageModel.media_slots.find(slot => slot.id === "input_video");
    assert.equal(videoSlot.kind, "video");
    assert.deepEqual(Array.from(filesForDropTarget(videoSlot, files)), [files[1]]);
    assert.deepEqual(Array.from(filesForDropTarget({ kind: "audio" }, files)), [files[2]]);
    assert.deepEqual(Array.from(filesForDropTarget({ kind: "image" }, files)), [files[0]]);
});

test("image model switches trim references to the destination catalog contract", () => {
    const previous = imageModels["vercel-ai-gateway__openai__gpt-image-2"];
    const next = imageModels["toapis__qwen-image-3.0-pro"];
    const files = Array.from({ length: 5 }, (_, index) => image(index));
    const input = { reference_images: files };
    const mapped = remapSlotFilesOnModelSwitch(input, previous.media_slots, next.media_slots);
    assert.equal(mapped.reference_images.length, 3);
    assert.equal(input.reference_images.length, 5, "Never mutate the previous model's draft");
    mapped.reference_images.forEach((file, index) => assert.equal(file, files[index]));
    const form = new FormData();
    for (const file of mapped.reference_images) form.append("slot_reference_images", file);
    assert.doesNotThrow(() => readModelMedia(form, next, "image"));
});

test("video model switches retain stable attachment IDs within the destination count limit", () => {
    const previous = videoModels["magnific__video__seedance_2_5_pro_480p"];
    const next = videoModels["toapis__gemini-omni-1.1-flash-preview-vip"];
    const items = Array.from({ length: 5 }, (_, index) => attachment(`reference-${index}`, "reference_images"));
    const mapped = remapVideoAttachmentsOnModelSwitch(items, previous.media_slots, next.media_slots);
    assert.equal(mapped.length, 3);
    assert.deepEqual(Array.from(mapped, item => item.id), items.slice(0, 3).map(item => item.id));
    assert.equal(items.length, 5);
    const form = new FormData();
    for (const item of mapped) form.append(`url_${item.roleId}`, item.url);
    assert.doesNotThrow(() => readModelMedia(form, next, "video"));
});

test("converging image slots share the destination limit and keep source order", () => {
    const files = Array.from({ length: 4 }, (_, index) => image(index));
    const mapped = remapSlotFilesOnModelSwitch({ front: files.slice(0, 2), back: files.slice(2) },
        [role("front", "image", { multiple: true }), role("back", "image", { multiple: true })],
        [role("references", "image", { multiple: true, max_count: 3 })]);
    assert.equal(mapped.references.length, 3);
    mapped.references.forEach((file, index) => assert.equal(file, files[index]));
});

test("a full fallback slot cannot overflow or absorb incompatible media", () => {
    const previous = [role("start"), role("other"), role("references", "image", { multiple: true }), role("clip", "video"), role("sound", "audio")];
    const next = [role("start"), role("references", "image", { multiple: true, max_count: 2 }), role("clip", "video"), role("sound", "audio")];
    const items = [attachment("ref-1", "references"), attachment("ref-2", "references"), attachment("start", "start"),
        attachment("excess", "other"), attachment("video", "clip", "video"), attachment("audio", "sound", "audio")];
    const mapped = remapVideoAttachmentsOnModelSwitch(items, previous, next);
    assert.deepEqual(Array.from(mapped, item => item.id), ["ref-1", "ref-2", "start", "video", "audio"]);
    assert.equal(mapped.filter(item => item.roleId === "references").length, 2);
    assert.deepEqual(plain(mapped.filter(item => item.kind !== "image")), items.slice(-2));
    assert.equal(remapVideoAttachmentsOnModelSwitch([attachment("audio", "sound", "audio")], previous, [role("image")]).length, 0);
});

test("model switches apply the server's default single and multiple limits", () => {
    const files = Array.from({ length: 260 }, (_, index) => image(index));
    for (const [options, limit] of [[{}, 1], [{ multiple: true }, 256], [{ multiple: true, max_count: 1 }, 1]]) {
        const slots = [role("references", "image", options)];
        assert.equal(remapSlotFilesOnModelSwitch({ references: files }, slots, slots).references.length, limit);
        const items = files.map((file, index) => ({ id: String(index), roleId: "references", kind: "image", type: "file", file }));
        assert.equal(remapVideoAttachmentsOnModelSwitch(items, slots, slots).length, limit);
    }
});

test("an unchanged slot identity wins over labels without changing retained item IDs", () => {
    const previous = [role("reference", "video")];
    const next = [role("different", "video", { label: "reference" }), role("reference", "video", { label: "Renamed reference" })];
    const item = attachment("stable-id", "reference", "video");
    assert.deepEqual(plain(remapVideoAttachmentsOnModelSwitch([item], previous, next)), [item]);
});
