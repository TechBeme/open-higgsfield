/**
 * Shared utility functions for building API payloads.
 */

/** Set a value at a dot-separated path in a nested object */
export function setNested(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
    const parts = dotPath.split(".");
    let cur: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") {
            cur[parts[i]] = {};
        }
        cur = cur[parts[i]] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
}

/** Generate a short random alphanumeric ID */
export function shortId(): string {
    return Math.random().toString(36).slice(2, 12);
}

/** Coerce a value to the appropriate type for a field */
export function coerceFieldValue(value: unknown, type: "number" | "checkbox" | "select" | "text"): unknown {
    if (value === undefined || value === null || value === "") return undefined;
    switch (type) {
        case "number": return Number(value);
        case "checkbox": return Boolean(value);
        default: return String(value);
    }
}
