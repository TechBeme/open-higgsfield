import { applyWorkspaceHeaders, guardWorkspaceRequest, accessFailure } from "@/server/security/workspace-access";
import { assertRuntimeConfiguration } from "@/server/config/production";
import { withSignal } from "@/server/tasks/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(request: Request) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    try {
        const configuration = assertRuntimeConfiguration();
        const { initStore, listTasks } = await import("@/server/tasks/store");
        await withSignal(AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]), async () => {
            await initStore();
            await listTasks("image", { limit: 1 });
        });
        return applyWorkspaceHeaders(Response.json({ ready: true, configuration: "valid", task_store: "available",
            profile: configuration.profile, worker_mode: configuration.workerMode,
            scheduler_heartbeat: configuration.workerMode === "workflow" ? "not_applicable" : "unverified",
            ...(configuration.workerMode === "workflow" ? { workflow_execution: "unverified" } : {}) }));
    } catch { return accessFailure("ERR_NOT_READY", 503); }
}
