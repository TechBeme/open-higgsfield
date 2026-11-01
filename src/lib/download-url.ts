export function attachmentUrl(previewUrl: string): string {
    if (!previewUrl.startsWith("/api/download/")) return previewUrl;
    const url = new URL(previewUrl, "https://workspace.invalid");
    url.searchParams.delete("inline");
    url.searchParams.set("download", "1");
    return `${url.pathname}${url.search}`;
}
