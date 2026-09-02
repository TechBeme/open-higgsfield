import type { CanonicalMediaInputs, CanonicalParams } from "@/models/canonical";
import type { ModelCapabilities } from "@/models/capabilities/types";
import { attachGeneratedAssets } from "@/lib/generated-assets";
import { publicErrorMessage } from "@/lib/public-error";
import { startPolling } from "@/lib/poller";
import { saveTasks, setTask } from "@/lib/task-store";
import { shortId } from "@/lib/payload-utils";
import { resolveProvider } from "@/providers/registry";
import type { AnyTask, TaskEvent } from "@/types";

interface SubmitGenerationInput {
    mediaType: "image" | "video";
    modelId: string;
    capabilities: ModelCapabilities;
    params: CanonicalParams;
    media: CanonicalMediaInputs;
    reuseState?: Record<string, unknown>;
}

export async function submitGeneration(input: SubmitGenerationInput): Promise<string> {
    const taskId = shortId();
    const { provider, providerId, providerModelId } = resolveProvider(input.capabilities);
    const submission = await provider.submit({
        mediaType: input.mediaType,
        modelId: input.modelId,
        providerModelId,
        providerMode: input.capabilities.provider_mode,
        capabilities: input.capabilities,
        params: input.params,
        media: input.media,
    });

    const events: TaskEvent[] = [];
    const task = {
        task_id: taskId,
        status: submission.status,
        freepik_status: submission.status,
        provider_id: providerId,
        provider_model_id: providerModelId,
        provider_task_id: submission.providerTaskId,
        provider_operation: "operation" in submission ? submission.operation : undefined,
        freepik_task_id: providerId === "freepik" ? submission.providerTaskId : undefined,
        poll_url: providerId === "freepik" && "operation" in submission
            ? (submission.operation as { pollUrl?: string }).pollUrl
            : undefined,
        prompt: input.params.prompt,
        params: input.params as unknown as Record<string, unknown>,
        model_id: input.modelId,
        created_at: new Date().toISOString(),
        media_type: input.mediaType,
        reuse_state: input.reuseState,
        events,
        _done: submission.status === "COMPLETED",
        result_paths: [],
        result_urls: [],
    } as AnyTask & { events: TaskEvent[]; _done: boolean };

    setTask(task);

    if (submission.status === "COMPLETED") {
        try {
            await attachGeneratedAssets(task, submission.assets);
            if (input.mediaType === "image") {
                events.push({
                    type: "completed",
                    media_type: "image",
                    result_urls: task.result_urls ?? [],
                    result_count: task.result_urls?.length ?? 0,
                    has_download: !!task.result_paths?.length,
                });
            } else {
                events.push({
                    type: "completed",
                    video_urls: "video_urls" in task ? task.video_urls : [],
                    has_download: "video_path" in task && !!task.video_path,
                });
            }
        } catch (error) {
            const message = publicErrorMessage(error);
            task.status = "ERROR";
            task.freepik_status = "ERROR";
            task.error_message = message;
            events.push({ type: "error", status: "ERROR", message });
        }
    }

    await saveTasks();
    if (submission.status !== "COMPLETED") startPolling(taskId);
    return taskId;
}
