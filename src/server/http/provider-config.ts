import "server-only";

import { applyWorkspaceHeaders } from "@/server/security/workspace-access";
import { safeErrorCode } from "@/server/tasks/runtime";
import { readBoundedJson, RequestLimitError, requestFailure } from "./request-limits";

export const CONNECTION_BODY_MAX_BYTES = 96 * 1024;
export const CATALOG_BODY_MAX_BYTES = 256 * 1024;

export async function readConfigObject(request: Request, maxBytes = 16_384): Promise<Record<string, unknown>> {
    const value = await readBoundedJson(request, maxBytes);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestLimitError("ERR_REQUEST_INVALID", 400);
    return value as Record<string, unknown>;
}

export function providerConfigFailure(error: unknown, fallback: string, status = 400): Response {
    if (error instanceof RequestLimitError) return requestFailure(error);
    const code = safeErrorCode(error, "");
    const unavailable = ["ERR_PROVIDER_CONFIG_CORRUPT", "ERR_PROVIDER_CONFIG_SCHEMA_REQUIRED", "ERR_PROVIDER_CONFIG_ENCRYPTION_KEY_REQUIRED", "ERR_PROVIDER_CONFIG_CONFLICT", "ERR_PROVIDER_SECRET_CORRUPT"].includes(code);
    return applyWorkspaceHeaders(Response.json({ error: code || fallback }, { status: unavailable ? 503 : !code && status < 500 ? 503 : status }));
}
