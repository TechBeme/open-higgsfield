import { createProviderTransport, invalidProviderResponse, providerHttpError, ProviderRequestError } from "@/providers/request-error";

const BASE = "https://api.freepik.com";

function getApiKey(): string {
    return process.env.FREEPIK_API_KEY ?? "";
}

export function validateFreepikPath(path: unknown): asserts path is string {
    if (typeof path !== "string" || path.length > 1000 || !/^\/v1\/ai\/[A-Za-z0-9_./-]+$/.test(path)
        || path.includes("..") || path.includes("//")) throw new ProviderRequestError("ERR_FREEPIK_OPERATION");
}

async function freepikRequest(path: string, phase: "submit" | "poll", body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const key = getApiKey();
    if (!key.trim()) throw new ProviderRequestError("ERR_NO_API_KEY");
    validateFreepikPath(path);
    const transport = createProviderTransport("FREEPIK", phase, signal);
    transport.assertActive();
    try {
        const res = await transport.fetch(`${BASE}${path}`, {
            method: phase === "submit" ? "POST" : "GET", cache: "no-store",
            headers: { "x-freepik-api-key": key, "Content-Type": "application/json" },
            ...(phase === "submit" ? { body: JSON.stringify(body) } : {}),
        });
        if (!res.ok) {
            await res.body?.cancel();
            throw providerHttpError("FREEPIK", phase, res.status, res.headers.get("retry-after"));
        }
        try { return await res.json(); } catch { throw invalidProviderResponse("FREEPIK", phase); }
    } catch (error) { throw transport.classify(error); }
}

export function freepikPost(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    return freepikRequest(path, "submit", body, signal);
}

export function freepikGet(path: string, signal?: AbortSignal): Promise<unknown> {
    return freepikRequest(path, "poll", undefined, signal);
}

export function normaliseAsyncPayload(payload: Record<string, unknown>): { status: string | null; urls: string[] } {
    const root = (payload.data as Record<string, unknown>) ?? payload;
    const rawStatus = root.status ?? root.task_status;
    const status = typeof rawStatus === "string" ? rawStatus : null;
    let generated = root.generated ?? [];
    if (typeof generated === "string") generated = [generated];
    return { status, urls: Array.isArray(generated) ? generated.filter((value): value is string => typeof value === "string") : [] };
}

export function extractErrorMessage(payload: unknown): string | null {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const SKIP_KEYS = new Set(["task_id", "id", "request_id"]);
    const GENERIC_TEXTS = new Set([
        "failed",
        "error",
        "cancelled",
        "canceled",
        "in_progress",
        "created",
        "completed",
    ]);
    const seen = new Set<unknown>();

    function isGenericText(text: string): boolean {
        const normalized = text.trim().toLowerCase();
        if (!normalized) return true;
        if (GENERIC_TEXTS.has(normalized)) return true;
        // Avoid surfacing internal generic error identifiers as user-facing messages.
        if (normalized.startsWith("err_") || normalized.startsWith("error_")) return true;
        return false;
    }

    function walk(value: unknown, key?: string): string | null {
        if (value == null) return null;
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (!trimmed) return null;
            if (key && SKIP_KEYS.has(key)) return null;
            if (UUID_RE.test(trimmed)) return null;
            if (isGenericText(trimmed)) return null;
            return trimmed;
        }
        if (seen.has(value)) return null;
        seen.add(value);
        if (typeof value === "object" && !Array.isArray(value)) {
            const obj = value as Record<string, unknown>;
            for (const k of ["message", "error_message", "detail", "status_message", "description", "reason"]) {
                const found = walk(obj[k], k);
                if (found) return found;
            }
            for (const k of ["error", "errors"]) {
                const found = walk(obj[k], k);
                if (found) return found;
            }
            // Also extract invalid_params details
            if (obj.invalid_params && Array.isArray(obj.invalid_params)) {
                const details = (obj.invalid_params as Array<Record<string, unknown>>)
                    .map((p) => `${p.field}: ${p.reason}`)
                    .join("; ");
                if (details) return details;
            }
            for (const [k, v] of Object.entries(obj)) {
                if (SKIP_KEYS.has(k)) continue;
                const f = walk(v, k);
                if (f) return f;
            }
        }
        if (Array.isArray(value)) {
            for (const item of value) { const f = walk(item); if (f) return f; }
        }
        return null;
    }
    return walk(payload);
}
