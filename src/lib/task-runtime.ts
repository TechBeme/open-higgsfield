export const SUBMISSION_TIMEOUT_MS = 180_000;
export const SUBMISSION_LEASE_MS = 300_000;
export const POLL_TIMEOUT_MS = 20_000;
export const ASSET_TIMEOUT_MS = 60_000;
export const WORKER_LEASE_MS = 120_000;

export function observationDeadline(now = Date.now()): string {
    const raw = process.env.TASK_OBSERVATION_TIMEOUT_MS;
    const value = raw === undefined ? 86_400_000 : Number(raw);
    if (!Number.isInteger(value) || value < 1_800_000 || value > 604_800_000) throw new Error("ERR_TASK_CONFIG");
    return new Date(now + value).toISOString();
}

export function localWorkerEnabled(): boolean {
    const mode = process.env.TASK_WORKER_MODE ?? (process.env.VERCEL ? "external" : "local");
    if (mode !== "local" && mode !== "external") throw new Error("ERR_TASK_CONFIG");
    return mode === "local" && process.env.NEXT_PHASE !== "phase-production-build";
}

export function boundedSignal(timeout: number, parent?: AbortSignal): AbortSignal {
    const timer = AbortSignal.timeout(Math.max(1, Math.floor(timeout)));
    return parent ? AbortSignal.any([parent, timer]) : timer;
}

// Also fence SDKs that ignore cancellation: late promises cannot publish state.
export function withSignal<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return; }
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", abort));
    });
}

export function safeErrorCode(error: unknown, fallback = "ERR_GENERATION_FAILED"): string {
    const object = error as { code?: unknown; message?: unknown } | null;
    for (const value of [object?.code, object?.message]) {
        if (typeof value === "string" && /^ERR_[A-Z0-9_]{1,100}$/.test(value)) return value;
    }
    return fallback;
}

export function queryRetry(error: unknown, failures: number): { retryable: boolean; delayMs: number; code: string } {
    const info = error as { retryable?: boolean; retryAfterMs?: number } | null;
    const retryAfter = typeof info?.retryAfterMs === "number" && Number.isFinite(info.retryAfterMs)
        ? Math.max(0, info.retryAfterMs) : 0;
    const backoff = Math.min(300_000, 10_000 * 2 ** Math.min(8, failures));
    return {
        retryable: info?.retryable !== false,
        delayMs: Math.max(retryAfter, backoff + Math.floor(Math.random() * Math.min(backoff * 0.2, 5_000))),
        code: safeErrorCode(error, "ERR_PROVIDER_QUERY_RETRY"),
    };
}
