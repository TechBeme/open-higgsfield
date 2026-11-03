import "server-only";

import { randomUUID } from "node:crypto";
import Ajv2020 from "ajv/dist/2020";
import type { ValidateFunction } from "ajv";
import { getRunwareContract, runwareCapabilities, runwareDimensionPairs, type RunwareConstraint, type RunwareContract } from "@/server/catalog/runware";
import { parseModelFields, validateModelMedia } from "@/models/parameter-schema";
import type { GeneratedAsset, GenerationProvider, ProviderGenerationRequest, ProviderPollRequest, ProviderPollResult, ProviderSubmission } from "@/providers/types";
import { invalidProviderResponse, ProviderRequestError, publicMediaUrl } from "./request-error";
import { isRunwareTaskId, runwarePost, runwareResponseRows } from "./runware-client";
import { getMediaSlot } from "./utils";

const ajv = new Ajv2020({ strict: false, validateFormats: false, ownProperties: true });
const validators = new Map<string, ValidateFunction>();
function validator(contract: RunwareContract) {
    let validate = validators.get(contract.air);
    if (!validate) { validate = ajv.compile(contract.schema); validators.set(contract.air, validate); }
    return validate;
}
const invalidParams = () => new ProviderRequestError("ERR_RUNWARE_INVALID_PARAMS");
const valueAt = (obj: Record<string, unknown>, path: string): unknown => path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, obj);
function setAt(obj: Record<string, unknown>, path: string, value: unknown) {
    const parts = path.split(".");
    let target = obj;
    for (const key of parts.slice(0, -1)) { target[key] ??= {}; target = target[key] as Record<string, unknown>; }
    target[parts.at(-1)!] = value;
}

/** Numeric/file-count extensions to JSON Schema. File duration/codec constraints remain provider-validated. */
function validConstraints(task: Record<string, unknown>, contract: RunwareContract): boolean {
    return ((contract.schema["x-constraints"] ?? []) as RunwareConstraint[]).every(rule => {
        if (rule.when?.present?.some(key => valueAt(task, key) === undefined) || rule.when?.absent?.some(key => valueAt(task, key) !== undefined)) return true;
        const values = rule.parameters.map(path => valueAt(task, path));
        let value: number;
        if (["area", "ratio"].includes(rule.operation) && rule.parameters.join(",") === "width,height" && values.every(v => typeof v === "number")) {
            value = rule.operation === "area" ? (values[0] as number) * (values[1] as number) : (values[0] as number) / (values[1] as number);
        } else if (rule.operation === "fileCount") value = values.reduce<number>((count, item) => count + (Array.isArray(item) ? item.length : item ? 1 : 0), 0);
        else return true;
        return (rule.minimum === undefined || value >= rule.minimum) && (rule.maximum === undefined || value <= rule.maximum)
            && (!rule.allowed || rule.allowed.includes(value));
    });
}

export function buildRunwareRequest(request: ProviderGenerationRequest): Record<string, unknown> {
    const contract = getRunwareContract(request.providerModelId, request.mediaType);
    if (!contract) throw new ProviderRequestError("ERR_CUSTOM_MODEL_ADAPTER_REQUIRED");
    const taskUUID = request.clientTaskId ?? randomUUID();
    if (!isRunwareTaskId(taskUUID)) throw new ProviderRequestError("ERR_RUNWARE_TASK_ID");
    const caps = runwareCapabilities(request.modelId, contract);
    const { values, errors } = parseModelFields(caps, request.params.field_values ?? {});
    if (errors.length || validateModelMedia(caps, request.media).length) throw invalidParams();
    const properties = contract.schema.properties ?? {};
    const task: Record<string, unknown> = { taskType: contract.operation, taskUUID, model: contract.air };
    // These fields are common to Runware operations, but utility operations
    // intentionally omit numberResults and some delivery options. Only send a
    // value when the official schema exposes it.
    if (properties.deliveryMethod) task.deliveryMethod = "async";
    if (properties.outputType) task.outputType = Array.isArray(properties.outputType.enum) && !properties.outputType.enum.includes("URL")
        ? properties.outputType.enum[0] : "URL";
    if (properties.numberResults) task.numberResults = 1;
    if (properties.positivePrompt && request.params.prompt) task.positivePrompt = request.params.prompt;
    for (const [key, value] of Object.entries(values)) {
        if (key === "output_size") {
            const [width, height] = String(value).split("x").map(Number);
            task.width = width; task.height = height;
        } else if (key === "duration" && typeof value === "string" && /^\d+$/.test(value)) task.duration = Number(value);
        else setAt(task, key, value);
    }
    for (const key of Object.keys(request.media.slots ?? {})) if (!caps.media_slots.some(slot => slot.id === key)) throw invalidParams();
    for (const slot of caps.media_slots) {
        const urls = getMediaSlot(request.media, slot.id);
        if (!urls.length) continue;
        if (valueAt(task, `inputs.${slot.id}`) !== undefined) throw invalidParams();
        const safe = urls.map(url => publicMediaUrl(url, "ERR_RUNWARE_INPUT"));
        setAt(task, `inputs.${slot.id}`, slot.multiple ? safe : safe[0]);
    }
    const compiled = validator(contract);
    const validate = (body: Record<string, unknown>): boolean => compiled(body);
    // Models that derive dimensions from references must receive no explicit dimensions.
    // For text-only models requiring them, select a valid preset without changing user-supplied settings.
    if (task.width === undefined && task.height === undefined && task.resolution === undefined && !validate(task)) {
        const props = contract.schema.properties!;
        const presets = runwareDimensionPairs(contract.schema);
        const candidates = presets.length ? presets : [[1024, 1024], [1280, 720], [props.width?.default, props.height?.default]];
        for (const [width, height] of candidates) {
            if (typeof width !== "number" || typeof height !== "number") continue;
            const candidate = { ...task, width, height };
            if (validate(candidate) && validConstraints(candidate, contract)) { task.width = width; task.height = height; break; }
        }
    }
    if (!validate(task) || !validConstraints(task, contract)) throw invalidParams();
    return task;
}

interface RunwareOperation { version: 1; taskUUID: string; model: string; mediaType: "image" | "video"; expectedResults: number }
function operationOf(request: ProviderPollRequest): RunwareOperation {
    const op = request.operation as Partial<RunwareOperation> | null;
    if (!op || op.version !== 1 || !isRunwareTaskId(op.taskUUID) || op.mediaType !== request.mediaType || op.model !== request.providerModelId
        || !Number.isInteger(op.expectedResults) || op.expectedResults! < 1 || op.expectedResults! > (request.mediaType === "video" ? 1 : 16)) throw new ProviderRequestError("ERR_RUNWARE_OPERATION");
    return { version: 1, taskUUID: op.taskUUID, model: op.model!, mediaType: op.mediaType, expectedResults: op.expectedResults! };
}

function readResult(payload: Record<string, unknown>, op: RunwareOperation, phase: "submit" | "poll"): ProviderPollResult {
    const contract = getRunwareContract(op.model, op.mediaType);
    if (!contract) throw invalidProviderResponse("RUNWARE", phase);
    const taskType = contract.operation;
    const data = runwareResponseRows(payload, "data", phase);
    const errors = runwareResponseRows(payload, "errors", phase);
    if (payload.error || (!data.length && !errors.length)) throw invalidProviderResponse("RUNWARE", phase);
    if (data.some(row => row.taskUUID !== op.taskUUID || row.taskType !== taskType)
        || errors.some(row => row.taskUUID !== undefined && row.taskUUID !== op.taskUUID)) throw invalidProviderResponse("RUNWARE", phase);
    if (errors.length) {
        if (errors.some(row => typeof row.code !== "string" || !row.code || row.code.length > 200)) throw invalidProviderResponse("RUNWARE", phase);
        if (errors.every(row => row.taskUUID === op.taskUUID && row.status === "error") && data.some(row => row.status === "processing")) {
            return { status: "IN_PROGRESS", operation: op };
        }
        // A batch with accepted work cannot be classified as a rejected submission.
        if (data.length) throw new ProviderRequestError("ERR_RUNWARE_PARTIAL_RESULT", { submissionUncertain: phase === "submit" });
        const transient = errors.some(error => ["serviceOverloaded", "rateLimitExceeded", "providerRateLimitExceeded"].includes(String(error.code)));
        if (transient) {
            const waits = errors.map(e => e.retryAfter).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
            throw new ProviderRequestError("ERR_RUNWARE_RATE_LIMITED", { retryable: phase === "poll", retryAfterMs: waits.length ? Math.max(...waits) * 1000 : undefined });
        }
        if (phase === "submit") throw new ProviderRequestError("ERR_RUNWARE_REJECTED");
        if (errors.some(row => row.taskUUID === op.taskUUID && row.status === "error")) return { status: "FAILED", error: "ERR_RUNWARE_TASK_FAILED", operation: op };
        // An observation error (auth, task not found, malformed lookup) is not evidence of a failed generation.
        throw new ProviderRequestError("ERR_RUNWARE_POLL_FAILED");
    }
    if (data.some(row => row.status === "error")) {
        if (data.some(row => row.status === "processing")) return { status: "IN_PROGRESS", operation: op };
        if (data.some(row => row[contract.outputUrlField])) throw new ProviderRequestError("ERR_RUNWARE_PARTIAL_RESULT", { submissionUncertain: phase === "submit" });
        return { status: "FAILED", error: "ERR_RUNWARE_TASK_FAILED", operation: op };
    }
    const assets: GeneratedAsset[] = [];
    const seen = new Set<string>();
    let processing = false;
    for (const row of data) {
        const url = row[contract.outputUrlField];
        if (row.status === "processing" || phase === "submit" && row.status === undefined && url === undefined) { processing = true; continue; }
        if (row.status !== undefined && row.status !== "success" || typeof url !== "string") throw invalidProviderResponse("RUNWARE", phase);
        let safe: string;
        try { safe = publicMediaUrl(url, "ERR_RUNWARE_OUTPUT"); } catch { throw invalidProviderResponse("RUNWARE", phase); }
        if (seen.has(safe)) throw invalidProviderResponse("RUNWARE", phase);
        seen.add(safe); assets.push({ url: safe, ...(contract.operation === "vectorize" ? { mimeType: "image/svg+xml" } : {}) });
    }
    if (data.length > op.expectedResults || assets.length > op.expectedResults) throw invalidProviderResponse("RUNWARE", phase);
    if (!processing && assets.length === op.expectedResults) return { status: "COMPLETED", assets, operation: op };
    return { status: "IN_PROGRESS", operation: op };
}

export class RunwareProvider implements GenerationProvider {
    readonly id = "runware" as const;
    async submit(request: ProviderGenerationRequest): Promise<ProviderSubmission> {
        const task = buildRunwareRequest(request);
        const operation: RunwareOperation = { version: 1, taskUUID: String(task.taskUUID), model: request.providerModelId, mediaType: request.mediaType, expectedResults: Number(task.numberResults ?? 1) };
        const payload = await runwarePost(task, request.connection, "submit", request.signal);
        const result = readResult(payload, operation, "submit");
        if (result.status === "COMPLETED") return { status: "COMPLETED", assets: result.assets, providerTaskId: operation.taskUUID };
        if (result.status !== "IN_PROGRESS") throw new ProviderRequestError("ERR_RUNWARE_REJECTED");
        return { status: "IN_PROGRESS", operation, providerTaskId: operation.taskUUID };
    }
    async poll(request: ProviderPollRequest): Promise<ProviderPollResult> {
        const operation = operationOf(request);
        const payload = await runwarePost({ taskType: "getResponse", taskUUID: operation.taskUUID }, request.connection, "poll", request.signal);
        return readResult(payload, operation, "poll");
    }
}
