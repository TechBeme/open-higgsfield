export function providerErrorMessage(error: unknown, t: { (key: string): string; has: (key: string) => boolean }, fallback = "saveError"): string {
    const key = error instanceof Error ? `errors.${error.message}` : "";
    return key && t.has(key) ? t(key) : t(fallback);
}

export async function configRequest<T>(url: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(url, {
        method, cache: "no-store",
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => { throw new Error("ERR_PROVIDER_CONFIG_UNAVAILABLE"); });
    if (!response.ok) throw new Error(typeof data.error === "string" && /^ERR_[A-Z0-9_]+$/.test(data.error) ? data.error : "ERR_PROVIDER_CONFIG_UNAVAILABLE");
    return data as T;
}
