import { applyWorkspaceHeaders, guardWorkspaceRequest, accessFailure } from "@/lib/workspace-access";
import { assertRuntimeConfiguration } from "@/lib/production-config";
import { withSignal } from "@/lib/task-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(request: Request) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    try {
        const configuration = assertRuntimeConfiguration();
        const { initStore, listTasks } = await import("@/lib/task-store");
        await withSignal(AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]), async () => {
            await initStore();
            await listTasks("image", { limit: 1 });
        });
        return applyWorkspaceHeaders(Response.json({ ready: true, configuration: "valid", task_store: "available",
            profile: configuration.profile, worker_mode: configuration.workerMode,
            scheduler_heartbeat: "unverified" }));
    } catch { return accessFailure("ERR_NOT_READY", 503); }
}
