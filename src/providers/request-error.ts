import { boundedSignal, POLL_TIMEOUT_MS, SUBMISSION_TIMEOUT_MS } from "@/lib/task-runtime";

type Phase = "submit" | "poll";
interface ErrorOptions {
    retryable?: boolean;
    retryAfterMs?: number;
    submissionUncertain?: boolean;
}

/** Safe diagnostics only: never retain upstream bodies, URLs or credentials. */
export class ProviderRequestError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    readonly retryAfterMs?: number;
    readonly submissionUncertain: boolean;

    constructor(code: string, options: ErrorOptions = {}) {
        super(code);
        this.name = "ProviderRequestError";
        this.code = code;
        this.retryable = options.retryable ?? false;
        this.submissionUncertain = options.submissionUncertain ?? false;
        if (Number.isFinite(options.retryAfterMs) && options.retryAfterMs >= 0) {
            this.retryAfterMs = options.retryAfterMs;
        }
    }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
    if (!value?.trim()) return undefined;
    if (/^-\d/.test(value.trim())) return undefined;
    const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
    return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}

export function providerHttpError(provider: string, phase: Phase, status: number, retryAfter: string | null) {
    const transient = status === 408 || status === 429 || status >= 500;
    return new ProviderRequestError(`ERR_${provider}_HTTP_${status}`, {
        retryable: phase === "poll" && transient,
        retryAfterMs: parseRetryAfter(retryAfter),
        submissionUncertain: phase === "submit" && (status === 408 || status >= 500),
    });
}

export function invalidProviderResponse(provider: string, phase: Phase): ProviderRequestError {
    return new ProviderRequestError(`ERR_${provider}_RESPONSE`, { submissionUncertain: phase === "submit" });
}

export function providerObject(value: unknown, provider: string, phase: Phase): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidProviderResponse(provider, phase);
    return value as Record<string, unknown>;
}

export function publicMediaUrl(value: unknown, code: string, maxLength = 8192): string {
    if (typeof value !== "string" || Buffer.byteLength(value) > maxLength) throw new ProviderRequestError(code);
    let url: URL;
    try { url = new URL(value); } catch { throw new ProviderRequestError(code); }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
        || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
        || !host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) {
        throw new ProviderRequestError(code);
    }
    return url.href;
}

/** One transport attempt. T2 owns observation retries, including read-only SDK POSTs. */
export function createProviderTransport(provider: string, phase: Phase, parent?: AbortSignal, fetcher: typeof fetch = fetch) {
    const timeout = phase === "submit" ? SUBMISSION_TIMEOUT_MS : POLL_TIMEOUT_MS;
    const signal = boundedSignal(timeout, parent);
    let dispatched = false;
    let responseError: ProviderRequestError | undefined;
    let receivedSuccess = false;
    const assertActive = () => {
        if (signal.aborted) throw new ProviderRequestError(`ERR_${provider}_ABORTED`, {
            retryable: phase === "poll", submissionUncertain: phase === "submit" && dispatched,
        });
    };
    const classify = (error: unknown): ProviderRequestError => {
        if (error instanceof ProviderRequestError) return error;
        if (responseError) return responseError;
        if (receivedSuccess && !signal.aborted) return invalidProviderResponse(provider, phase);
        const info = error as { status?: number; statusCode?: number; responseHeaders?: Record<string, string> } | null;
        const status = info?.statusCode ?? info?.status;
        if (Number.isInteger(status) && status >= 400 && status <= 599) {
            return providerHttpError(provider, phase, status, info?.responseHeaders?.["retry-after"] ?? null);
        }
        return new ProviderRequestError(`ERR_${provider}_${signal.aborted ? "ABORTED" : "REQUEST_FAILED"}`, {
            retryable: phase === "poll", submissionUncertain: phase === "submit" && dispatched,
        });
    };
    const request: typeof fetch = async (input, init) => {
        assertActive();
        const inherited = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const requestSignal = inherited ? AbortSignal.any([signal, inherited]) : signal;
        if (requestSignal.aborted) throw new ProviderRequestError(`ERR_${provider}_ABORTED`, { retryable: phase === "poll" });
        dispatched = true;
        responseError = undefined;
        receivedSuccess = false;
        try {
            const response = await fetcher(input, { ...init, signal: requestSignal, redirect: "error" });
            receivedSuccess = response.ok;
            if (!response.ok) responseError = providerHttpError(provider, phase, response.status, response.headers.get("retry-after"));
            return response;
        } catch (error) { throw classify(error); }
    };
    return { signal, timeout, fetch: request, classify, assertActive };
}
