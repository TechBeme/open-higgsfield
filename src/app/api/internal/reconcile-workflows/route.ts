import { guardWorkspaceRequest, applyWorkspaceHeaders, accessFailure } from "@/server/security/workspace-access";
import { assertEmptyBody, requestFailure } from "@/server/http/request-limits";
import { assertRuntimeConfiguration } from "@/server/config/production";
import { getTask, listWorkflowCandidateIds } from "@/server/tasks/store";
import { startTaskWorkflow } from "@/server/tasks/workflow-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Admit existing tasks for recovery; the queued CAS still guards paid submission. */
export async function POST(request: Request) {
    const denial = guardWorkspaceRequest(request);
    if (denial) return denial;
    try { await assertEmptyBody(request); }
    catch (error) { return requestFailure(error); }
    try {
        if (assertRuntimeConfiguration().workerMode !== "workflow") return accessFailure("ERR_WORKFLOW_CONFIG", 503);
        const query = new URL(request.url).searchParams;
        const after = query.get("after") ?? undefined;
        if ([...query.keys()].some(key => key !== "after") || query.getAll("after").length > 1
            || (after !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(after))) return accessFailure("ERR_INVALID_PAGINATION", 400);
        const ids = await listWorkflowCandidateIds(after);
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(50_000)]);
        let started = 0;
        await Promise.all(ids.map(async id => {
            const task = await getTask(id);
            if (!task) return;
            await startTaskWorkflow(task, { signal });
            started++;
        }));
        return applyWorkspaceHeaders(Response.json({ started, nextCursor: ids.length === 20 ? ids.at(-1) : null }));
    } catch { return accessFailure("ERR_WORKFLOW_DISPATCH_FAILED", 503); }
}
