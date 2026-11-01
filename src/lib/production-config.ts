import { assertGeneratedStorageConfigured } from "@/lib/generated-assets";
import { localWorkerEnabled, observationDeadline } from "@/lib/task-runtime";
import { assertSchedulerSecretConfigured, workspaceConfiguration } from "@/lib/workspace-access";

export function assertRuntimeConfiguration(): { profile: "single-process" | "distributed"; workerMode: "local" | "external" } {
    workspaceConfiguration();
    observationDeadline();
    const production = process.env.NODE_ENV === "production";
    const profile = process.env.DEPLOYMENT_PROFILE ?? (production ? undefined : "single-process");
    if (profile !== "single-process" && profile !== "distributed") throw new Error("ERR_DEPLOYMENT_CONFIG");
    const workerMode = localWorkerEnabled() ? "local" : "external";
    if (process.env.VERCEL && (profile !== "distributed" || workerMode !== "external")) throw new Error("ERR_DEPLOYMENT_CONFIG");
    if (!process.env.DATABASE_URL && (profile !== "single-process" || workerMode !== "local" || process.env.VERCEL)) {
        throw new Error("ERR_DEPLOYMENT_CONFIG");
    }
    if (workerMode === "external") {
        assertSchedulerSecretConfigured();
        if (process.env.TASK_SCHEDULER_CONFIGURED !== "true") throw new Error("ERR_SCHEDULER_CONFIG");
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
