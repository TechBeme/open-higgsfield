export function publicErrorMessage(error: unknown, fallback = "ERR_GENERATION_FAILED"): string {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    return /^ERR_[A-Z0-9_]+(?:: .+)?$/.test(message) ? message : fallback;
}
