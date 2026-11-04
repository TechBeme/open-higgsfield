import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

type WorkspaceConfiguration = { origin?: string; demo: boolean };
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PRINTABLE_SECRET = /^[\x21-\x7e]{32,256}$/;

export function isStrongSecret(value: string | undefined): value is string {
    return typeof value === "string" && PRINTABLE_SECRET.test(value);
}

function loopback(url: URL): boolean {
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export function workspaceConfiguration(): WorkspaceConfiguration {
    const production = process.env.NODE_ENV === "production";
    const demo = process.env.APP_DEMO_MODE === "true";
    if ((process.env.APP_DEMO_MODE !== undefined && !["true", "false"].includes(process.env.APP_DEMO_MODE)) ||
        (demo && process.env.GENERATION_ENABLED !== "false")) throw new Error("ERR_ACCESS_CONFIG");
    const rawOrigin = process.env.APP_ORIGIN || undefined;
    let origin: string | undefined;
    if (rawOrigin) {
        let url: URL;
        try { url = new URL(rawOrigin); } catch { throw new Error("ERR_ACCESS_CONFIG"); }
        if (url.origin !== rawOrigin || url.username || url.password ||
            (url.protocol !== "https:" && !(url.protocol === "http:" && !production && loopback(url)))) {
            throw new Error("ERR_ACCESS_CONFIG");
        }
        origin = url.origin;
    } else if (production) throw new Error("ERR_ACCESS_CONFIG");
    return { origin, demo };
}

function secretEquals(candidate: string, expected: string): boolean {
    return timingSafeEqual(createHash("sha256").update(candidate).digest(), createHash("sha256").update(expected).digest());
}

export function applyWorkspaceHeaders<T extends Response>(response: T): T {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    response.headers.set("Referrer-Policy", "same-origin");
    const vary = new Set((response.headers.get("Vary") ?? "").split(",").map((part) => part.trim()).filter(Boolean));
    vary.add("Origin");
    response.headers.set("Vary", [...vary].join(", "));
    if (process.env.NODE_ENV === "production") response.headers.set("Strict-Transport-Security", "max-age=31536000");
    return response;
}

export function accessFailure(code: string, status: number): Response {
    const response = Response.json({ error: code, accepted: false, recovery_required: false }, { status });
    return applyWorkspaceHeaders(response);
}

export function guardWorkspaceRequest(request: Request): Response | null {
    let config: WorkspaceConfiguration;
    try { config = workspaceConfiguration(); }
    catch { return accessFailure("ERR_ACCESS_CONFIG", 503); }
    // Demo deployments expose the interface without allowing shared data changes.
    if (config.demo) return SAFE_METHODS.has(request.method.toUpperCase()) ? null : accessFailure("ERR_DEMO_READ_ONLY", 403);
    const url = new URL(request.url);
    if (!SAFE_METHODS.has(request.method.toUpperCase())) {
        const origin = request.headers.get("origin");
        const site = request.headers.get("sec-fetch-site");
        let expectedOrigin = config.origin ?? url.origin;
        // Next dev can normalize req.url to localhost while the browser uses 127.0.0.1.
        // Trust only the actual loopback Host in unpinned development, never forwarded headers.
        if (!config.origin && process.env.NODE_ENV !== "production" && loopback(url)) {
            const host = request.headers.get("host");
            if (host) {
                try {
                    const local = new URL(`${url.protocol}//${host}`);
                    if (!loopback(local) || local.host !== host) return accessFailure("ERR_ORIGIN_FORBIDDEN", 403);
                    expectedOrigin = local.origin;
                } catch { return accessFailure("ERR_ORIGIN_FORBIDDEN", 403); }
            }
        }
        if (origin !== expectedOrigin || site === "cross-site" || site === "same-site") {
            return accessFailure("ERR_ORIGIN_FORBIDDEN", 403);
        }
    }
    return null;
}

export function assertSchedulerSecretConfigured(): void {
    const secret = process.env.CRON_SECRET;
    if (!isStrongSecret(secret)) throw new Error("ERR_SCHEDULER_CONFIG");
}

export function guardSchedulerRequest(request: Request): Response | null {
    try { assertSchedulerSecretConfigured(); }
    catch { return accessFailure("ERR_SCHEDULER_CONFIG", 503); }
    const authorization = request.headers.get("authorization") ?? "";
    if (authorization.length > 300 || !secretEquals(authorization, `Bearer ${process.env.CRON_SECRET}`)) {
        return accessFailure("ERR_UNAUTHORIZED", 401);
    }
    return null;
}
