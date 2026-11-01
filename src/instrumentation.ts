let registration: Promise<void> | undefined;

export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
    registration ??= (async () => {
        try {
            const { assertRuntimeConfiguration } = await import("@/lib/production-config");
            const { workerMode } = assertRuntimeConfiguration();
            const { initStore } = await import("@/lib/task-store");
            await initStore();
            if (workerMode === "local") {
                const { startLocalWorker } = await import("@/lib/poller");
                startLocalWorker();
            }
        } catch {
            throw new Error("ERR_STARTUP_CONFIGURATION_OR_STORAGE");
        }
    })();
    await registration;
}
