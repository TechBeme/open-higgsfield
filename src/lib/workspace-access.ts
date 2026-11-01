import { createHash, timingSafeEqual } from "node:crypto";

type WorkspaceConfiguration = { origin?: string; username?: string; password?: string };
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
    const username = process.env.APP_ACCESS_USER || undefined;
    const password = process.env.APP_ACCESS_PASSWORD || undefined;
    const rawOrigin = process.env.APP_ORIGIN || undefined;
    if ((username || password || production) && (!username || !/^[A-Za-z0-9._@-]{1,128}$/.test(username) || !isStrongSecret(password))) {
        throw new Error("ERR_ACCESS_CONFIG");
    }
    let origin: string | undefined;
    if (rawOrigin) {
        let url: URL;
        try { url = new URL(rawOrigin); } catch { throw new Error("ERR_ACCESS_CONFIG"); }
        if (url.origin !== rawOrigin || url.username || url.password ||
            (url.protocol !== "https:" && !(url.protocol === "http:" && !production && loopback(url)))) {
            throw new Error("ERR_ACCESS_CONFIG");
        }
        if (!username && !loopback(url)) throw new Error("ERR_ACCESS_CONFIG");
        origin = url.origin;
    } else if (production) throw new Error("ERR_ACCESS_CONFIG");
    return { origin, username, password };
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
    for (const value of ["Authorization", "Origin"]) vary.add(value);
    response.headers.set("Vary", [...vary].join(", "));
    if (process.env.NODE_ENV === "production") response.headers.set("Strict-Transport-Security", "max-age=31536000");
    return response;
}

export function accessFailure(code: string, status: number, challenge = false): Response {
    const response = Response.json({ error: code, accepted: false, recovery_required: false }, { status });
    if (challenge) response.headers.set("WWW-Authenticate", 'Basic realm="Open Higgsfield", charset="UTF-8"');
    return applyWorkspaceHeaders(response);
}

export function guardWorkspaceRequest(request: Request): Response | null {
    let config: WorkspaceConfiguration;
    try { config = workspaceConfiguration(); }
    catch { return accessFailure("ERR_ACCESS_CONFIG", 503); }
    const url = new URL(request.url);
    if ((!config.username || !config.origin) && !loopback(url)) return accessFailure("ERR_LOCAL_ACCESS_ONLY", 403);
    if (config.username) {
        const authorization = request.headers.get("authorization") ?? "";
        const match = authorization.length <= 1024 ? /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization) : null;
        const encoded = match?.[1] ?? "";
        const decoded = Buffer.from(encoded, "base64");
        const canonical = encoded !== "" && decoded.toString("base64") === encoded;
        if (!canonical || !secretEquals(decoded.toString("utf8"), `${config.username}:${config.password}`)) {
            return accessFailure("ERR_UNAUTHORIZED", 401, true);
        }
    }
    if (!SAFE_METHODS.has(request.method.toUpperCase())) {
        const origin = request.headers.get("origin");
        const site = request.headers.get("sec-fetch-site");
        if (origin !== (config.origin ?? url.origin) || site === "cross-site" || site === "same-site") {
            return accessFailure("ERR_ORIGIN_FORBIDDEN", 403);
        }
    }
    return null;
}

export function assertSchedulerSecretConfigured(): void {
    const secret = process.env.CRON_SECRET;
    if (!isStrongSecret(secret) || secret === process.env.APP_ACCESS_PASSWORD) throw new Error("ERR_SCHEDULER_CONFIG");
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
