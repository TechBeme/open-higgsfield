import "server-only";

import { assertGeneratedStorageConfigured } from "@/server/media/generated-assets";
import { observationDeadline, taskWorkerMode, type TaskWorkerMode } from "@/server/tasks/runtime";
import { assertSchedulerSecretConfigured, workspaceConfiguration } from "@/server/security/workspace-access";

export function assertRuntimeConfiguration(): { profile: "single-process" | "distributed"; workerMode: TaskWorkerMode } {
    workspaceConfiguration();
    observationDeadline();
    const production = process.env.NODE_ENV === "production";
    const profile = process.env.DEPLOYMENT_PROFILE ?? (production ? undefined : "single-process");
    if (profile !== "single-process" && profile !== "distributed") throw new Error("ERR_DEPLOYMENT_CONFIG");
    const workerMode = taskWorkerMode();
    if (process.env.VERCEL && (profile !== "distributed" || workerMode === "local")) throw new Error("ERR_DEPLOYMENT_CONFIG");
    if (!process.env.DATABASE_URL && (profile !== "single-process" || workerMode === "external" || process.env.VERCEL)) {
        throw new Error("ERR_DEPLOYMENT_CONFIG");
    }
    if (workerMode === "external") {
        assertSchedulerSecretConfigured();
        if (process.env.TASK_SCHEDULER_CONFIGURED !== "true") throw new Error("ERR_SCHEDULER_CONFIG");
    }
    if (workerMode === "workflow" && production && (!process.env.VERCEL || !process.env.VERCEL_DEPLOYMENT_ID
        || (process.env.WORKFLOW_TARGET_WORLD && process.env.WORKFLOW_TARGET_WORLD !== "vercel"))) {
        throw new Error("ERR_WORKFLOW_CONFIG");
    }
    if (process.env.GENERATION_ENABLED !== undefined && !["true", "false"].includes(process.env.GENERATION_ENABLED)) {
        throw new Error("ERR_GENERATION_CONFIG");
    }
    assertGeneratedStorageConfigured();
    return { profile, workerMode };
}

export function assertGenerationEnabled(): void {
    const enabled = process.env.GENERATION_ENABLED ?? (process.env.NODE_ENV === "production" ? "false" : "true");
    if (enabled !== "true") throw new Error(enabled === "false" ? "ERR_GENERATION_DISABLED" : "ERR_GENERATION_CONFIG");
    assertRuntimeConfiguration();
}
