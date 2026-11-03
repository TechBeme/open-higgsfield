/** A private payload keeps generated image URLs intact across browser drag implementations. */
export const STUDIO_MEDIA_TYPE = "application/x-open-higgsfield-media";

export function hasMediaTransfer(transfer: Pick<DataTransfer, "types"> | null): boolean {
    return Array.from(transfer?.types ?? []).some(type => ["Files", STUDIO_MEDIA_TYPE, "text/uri-list", "text/html"].includes(type));
}

export function safeReferenceUrl(value: string, origin: string): string | null {
    try {
        const url = new URL(value, origin);
        if (url.username || url.password) return null;
        if (url.origin === origin && /^\/api\/(download|uploaded)\//.test(url.pathname)) return url.pathname + url.search;
        if (url.protocol === "https:" && url.hostname.includes(".")) return url.href;
    } catch { /* Untrusted drag data is ignored. */ }
    return null;
}

export function isUrlReference(file: File): boolean {
    return file.size === 0 && /^(https:\/\/|\/api\/)/.test(file.name);
}

export function readMediaTransfer(transfer: DataTransfer, origin: string): File[] {
    const files = Array.from(transfer.files);
    if (files.length) return files;
    let candidates: string[] = [];
    try {
        const payload = JSON.parse(transfer.getData(STUDIO_MEDIA_TYPE));
        if (payload.kind === "image" && typeof payload.url === "string") candidates = [payload.url];
    } catch { /* Ordinary external drags have no application payload. */ }
    if (!candidates.length) {
        // Browsers include the actual image in HTML even when URI points to its enclosing link.
        const html = transfer.getData("text/html");
        if (html && typeof DOMParser !== "undefined") {
            const image = new DOMParser().parseFromString(html, "text/html").querySelector("img[src]");
            if (image) candidates.push(image.getAttribute("src") ?? "");
        }
        if (!candidates.length) candidates = transfer.getData("text/uri-list").split(/\r?\n/).filter(line => line.trim() && !line.startsWith("#"));
    }
    return [...new Set(candidates.map(value => safeReferenceUrl(value.trim(), origin)).filter((url): url is string => Boolean(url)))]
        .slice(0, 256).map(url => new File([], url, { type: "image/png" }));
}

export function writeImageTransfer(transfer: DataTransfer, url: string): void {
    transfer.effectAllowed = "copy";
    transfer.setData(STUDIO_MEDIA_TYPE, JSON.stringify({ kind: "image", url }));
    transfer.setData("text/uri-list", new URL(url, window.location.origin).href);
}
