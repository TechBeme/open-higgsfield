const BASE = "https://api.freepik.com";

function getApiKey(): string {
    return process.env.FREEPIK_API_KEY ?? "";
}

export async function freepikPost(path: string, body: unknown): Promise<unknown> {
    const key = getApiKey();
    if (!key) throw new Error("ERR_NO_API_KEY");

    const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: {
            "x-freepik-api-key": key,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
        if (res.status === 429) {
            throw new Error("ERR_FREEPIK_TRIAL_LIMIT");
        }
        const detail = extractErrorMessage(data);
        throw new Error(detail ?? "ERR_FREEPIK_API");
    }
    return data;
}

export async function freepikGet(path: string): Promise<unknown> {
    const key = getApiKey();
    if (!key) throw new Error("ERR_NO_API_KEY");

    const res = await fetch(`${BASE}${path}`, {
        headers: { "x-freepik-api-key": key },
        cache: "no-store",
    });

    const data = await res.json();
    if (!res.ok) {
        if (res.status === 429) {
            throw new Error("ERR_FREEPIK_TRIAL_LIMIT");
        }
        const detail = extractErrorMessage(data);
        throw new Error(detail ?? "ERR_FREEPIK_API");
    }
    return data;
}

export function normaliseAsyncPayload(payload: Record<string, unknown>): { status: string | null; urls: string[] } {
    const root = (payload.data as Record<string, unknown>) ?? payload;
    const status = (root.status ?? root.task_status) as string | null;
    let generated = (root.generated ?? []) as string | string[];
    if (typeof generated === "string") generated = [generated];
    return { status, urls: generated as string[] };
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
