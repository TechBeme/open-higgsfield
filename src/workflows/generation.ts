import { sleep } from "workflow";
import { advanceGeneration, expireGeneration, type GenerationWorkflowInput } from "@/server/tasks/workflow-steps";

export async function generationWorkflow(input: GenerationWorkflowInput): Promise<void> {
    "use workflow";
    while (Date.now() < input.expiresAt) {
        const wakeAt = await advanceGeneration(input);
        if (wakeAt === null) return;
        await sleep(new Date(Math.min(wakeAt, input.expiresAt)));
    }
    await expireGeneration(input.taskId);
}
