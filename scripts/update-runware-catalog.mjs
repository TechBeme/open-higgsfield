import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// The public index is the source of truth. Every live model with a callable AIR
// and an image/video capability is included. This covers generation models and
// documented image/video utilities (upscalers, background removal, masks,
// vectorizers and preprocessors) without inventing a request shape.
const mediaCapabilities = new Set(["text-to-image", "image-to-image", "video-to-image", "text-to-video", "image-to-video", "video-to-video", "audio-to-video"]);
const sourceRoot = "https://runware.ai/docs/models";
const local = process.argv[2];
async function document(name) {
    if (local) {
        const flat = resolve(local, name.replaceAll("/schema.json", ".json"));
        try { return JSON.parse(await readFile(flat, "utf8")); } catch { return JSON.parse(await readFile(resolve(local, name), "utf8")); }
    }
    const response = await fetch(`${sourceRoot}/${name}`, { signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (!response.ok) throw new Error(`Runware schema fetch failed: ${response.status} (${name})`);
    return response.json();
}

// Keep validation keywords intact. Editorial descriptions belong to the linked official docs.
function compact(schema) {
    if (Array.isArray(schema)) return schema.map(compact);
    if (!schema || typeof schema !== "object") return schema;
    return Object.fromEntries(Object.entries(schema).filter(([key]) => !["description", "title", "examples", "$id", "$schema"].includes(key))
        .map(([key, value]) => [key, ["default", "const", "enum"].includes(key) ? value : key === "properties"
            ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, compact(child)])) : compact(value)]));
}

const index = await document("index.json");
const entries = index.filter(model => model.status === "live" && typeof model.air === "string" && model.air
    && Array.isArray(model.capabilities) && model.capabilities.some(capability => mediaCapabilities.has(capability)));
const contracts = {};
const failures = [];
let cursor = 0;
async function worker() {
    for (;;) {
        const entry = entries[cursor++];
        if (!entry) return;
        try {
            const doc = await document(`${entry.id}/schema.json`);
            const schema = doc?.components?.schemas?.RequestBody?.items;
            const taskType = schema?.properties?.taskType?.const;
            const image = entry.capabilities.some(capability => ["text-to-image", "image-to-image", "video-to-image"].includes(capability));
            const video = entry.capabilities.some(capability => ["text-to-video", "image-to-video", "video-to-video", "audio-to-video"].includes(capability));
            if (!schema || typeof taskType !== "string" || !schema.properties?.model || schema.properties.model.const !== entry.air || image === video) throw new Error("unsupported request schema");
            if (JSON.stringify(schema).includes('"$ref"')) throw new Error("unresolved references");
            const responseProperties = doc?.components?.schemas?.ResponseBody?.properties?.data?.items?.properties;
            const outputUrls = Object.keys(responseProperties ?? {}).filter(key => key.endsWith("URL"));
            const accepts = (property, value) => property?.const === value || property?.enum?.includes(value) || property?.oneOf?.some(part => part.const === value);
            if (outputUrls.length !== 1 || !["imageURL", "videoURL", "guideImageURL", "maskImageURL"].includes(outputUrls[0])
                || !accepts(schema.properties.deliveryMethod, "async") || !accepts(schema.properties.outputType, "URL")) throw new Error("unsupported response/delivery schema");
            contracts[`runware__${entry.id}`] = {
                label: entry.name, air: entry.air, mediaType: image ? "image" : "video", operation: taskType,
                outputUrlField: outputUrls[0],
                source: `${sourceRoot}/${entry.id}`, schemaSha256: createHash("sha256").update(JSON.stringify(schema)).digest("hex"),
                schema: compact(schema),
            };
        } catch (error) { failures.push({ id: entry.id, reason: error instanceof Error ? error.message : "unknown" }); }
    }
}
await Promise.all(Array.from({ length: 8 }, worker));
if (failures.length) throw new Error(`Failed to load ${failures.length} indexed media models: ${failures.map(entry => `${entry.id} (${entry.reason})`).join(", ")}`);
const ordered = Object.fromEntries(Object.entries(contracts).sort(([, left], [, right]) => left.mediaType.localeCompare(right.mediaType) || left.label.localeCompare(right.label) || left.air.localeCompare(right.air)));
const target = new URL("../src/server/catalog/runware-contracts-data.ts", import.meta.url);
// A JSON payload avoids inferring/transpiling hundreds of thousands of schema
// property expressions in every server/test worker. Request validation still
// compiles the full schema for the selected model.
await writeFile(target, `import "server-only";\nimport type { RunwareContract } from "./runware";\n\n// Generated from official Runware model schemas. Refresh with scripts/update-runware-catalog.mjs.\n// Retrieved ${new Date().toISOString().slice(0, 10)}. Validation keywords are preserved; editorial annotations are omitted.\nconst contracts: Record<string, RunwareContract> = JSON.parse(${JSON.stringify(JSON.stringify(ordered))});\nexport default contracts;\n`);
console.log(`Updated ${Object.keys(ordered).length} Runware contracts (${Object.values(ordered).filter(contract => contract.mediaType === "image").length} image, ${Object.values(ordered).filter(contract => contract.mediaType === "video").length} video).`);
