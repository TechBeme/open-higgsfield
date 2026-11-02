import "server-only";

import { createProviderTransport, invalidProviderResponse, providerHttpError, ProviderRequestError } from "@/server/providers/request-error";

export function validateMagnificPath(path: unknown): asserts path is string {
    if (typeof path !== "string" || path.length > 1000 || !/^\/v1\/ai\/[A-Za-z0-9_./-]+$/.test(path)
        || path.includes("..") || path.includes("//")) throw new ProviderRequestError("ERR_MAGNIFIC_OPERATION");
}

async function magnificRequest(path: string, phase: "submit" | "poll", body?: unknown, signal?: AbortSignal, formEncoded = false, apiKey?: string): Promise<unknown> {
    const key = apiKey ?? process.env.MAGNIFIC_API_KEY ?? "";
    if (!key.trim()) throw new ProviderRequestError("ERR_NO_API_KEY");
    validateMagnificPath(path);
    const transport = createProviderTransport("MAGNIFIC", phase, signal);
    transport.assertActive();
    try {
        const res = await transport.fetch(`https://api.magnific.com${path}`, {
            method: phase === "submit" ? "POST" : "GET", cache: "no-store",
            headers: { "x-magnific-api-key": key, "Content-Type": formEncoded ? "application/x-www-form-urlencoded" : "application/json" },
            ...(phase === "submit" ? { body: formEncoded ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body) } : {}),
        });
        if (!res.ok) {
            await res.body?.cancel();
            throw providerHttpError("MAGNIFIC", phase, res.status, res.headers.get("retry-after"));
        }
        try { return await res.json(); } catch { throw invalidProviderResponse("MAGNIFIC", phase); }
    } catch (error) { throw transport.classify(error); }
}

export function magnificPost(path: string, body: unknown, signal?: AbortSignal, formEncoded = false, apiKey?: string): Promise<unknown> {
    return magnificRequest(path, "submit", body, signal, formEncoded, apiKey);
}

export function magnificGet(path: string, signal?: AbortSignal, apiKey?: string): Promise<unknown> {
    return magnificRequest(path, "poll", undefined, signal, false, apiKey);
}
