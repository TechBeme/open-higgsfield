let registration: Promise<void> | undefined;

export async function register() {
    // Keep Node-only imports inside the literal guard so both bundlers exclude them from Edge.
    if (process.env.NEXT_RUNTIME === "nodejs") {
        if (process.env.NEXT_PHASE === "phase-production-build") return;
        registration ??= (async () => {
            try {
                const { assertRuntimeConfiguration } = await import("@/server/config/production");
                const { workerMode } = assertRuntimeConfiguration();
                const { initStore } = await import("@/server/tasks/store");
                await initStore();
                if (workerMode === "local") {
                    const { startLocalWorker } = await import("@/server/tasks/poller");
                    startLocalWorker();
                }
            } catch {
                throw new Error("ERR_STARTUP_CONFIGURATION_OR_STORAGE");
            }
        })();
        await registration;
    }
}
