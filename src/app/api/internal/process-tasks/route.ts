import { applyWorkspaceHeaders, guardSchedulerRequest, accessFailure } from "@/lib/workspace-access";
import { assertRuntimeConfiguration } from "@/lib/production-config";
import { assertEmptyBody, requestFailure } from "@/lib/request-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
    const denial = guardSchedulerRequest(request);
    if (denial) return denial;
    if (request.method !== "GET") return accessFailure("ERR_METHOD_NOT_ALLOWED", 405);
    if (new URL(request.url).search) return accessFailure("ERR_SCHEDULER_INPUT", 400);
    try { await assertEmptyBody(request); }
    catch (error) { return requestFailure(error); }
    const started = Date.now();
    try {
        const { workerMode } = assertRuntimeConfiguration();
        if (workerMode !== "external") return accessFailure("ERR_SCHEDULER_CONFIG", 503);
        const { processDueTasks } = await import("@/lib/poller");
        const result = await processDueTasks({ limit: 10, budgetMs: 50_000 });
        console.info("[task-scheduler] completed", { duration_ms: Date.now() - started, ...result });
        return applyWorkspaceHeaders(Response.json(result));
    } catch {
        console.error("[task-scheduler] deferred", { duration_ms: Date.now() - started, code: "ERR_SCHEDULER_UNAVAILABLE" });
        return accessFailure("ERR_SCHEDULER_UNAVAILABLE", 503);
    }
}
