import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function publicIpv4(address: string): boolean {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99)))
        || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
        || (a === 203 && b === 0 && c === 113));
}

function ipv6Words(address: string): number[] {
    let value = address.toLowerCase();
    if (value.includes(".")) {
        const last = value.lastIndexOf(":");
        const octets = value.slice(last + 1).split(".").map(Number);
        value = `${value.slice(0, last)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    }
    const [left, right] = value.split("::");
    const first = left ? left.split(":") : [];
    const second = right ? right.split(":") : [];
    const parts = right === undefined ? first : [...first, ...Array(8 - first.length - second.length).fill("0"), ...second];
    return parts.map((part) => parseInt(part, 16));
}

export function isPublicAddress(address: string): boolean {
    const version = isIP(address);
    if (version === 4) return publicIpv4(address);
    if (version !== 6) return false;
    const words = ipv6Words(address);
    if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
        return publicIpv4(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
    }
    // Only global unicast, excluding transition, documentation and special-use ranges.
    return (words[0] & 0xe000) === 0x2000 && words[0] !== 0x2002
        && !(words[0] === 0x2001 && (words[1] <= 0x01ff || words[1] === 0x0db8))
        && !(words[0] === 0x3fff && words[1] <= 0x0fff);
}

export function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new Error("ERR_MEDIA_CANCELLED"));
        signal.addEventListener("abort", abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}

export async function resolveSafeRemoteUrl(value: string, options: { signal?: AbortSignal } = {}) {
    const signal = options.signal ?? AbortSignal.timeout(60_000);
    signal.throwIfAborted();
    let url: URL;
    try {
        if (typeof value !== "string" || value.length > 8_192) throw new Error();
        url = new URL(value);
    } catch { throw new Error("ERR_INVALID_MEDIA_URL"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
        throw new Error("ERR_INVALID_MEDIA_URL");
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")
        || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".")) {
        throw new Error("ERR_UNSAFE_MEDIA_URL");
    }
    const version = isIP(hostname);
    let addresses: Array<{ address: string; family: number }>;
    if (version) addresses = [{ address: hostname, family: version }];
    else {
        try { addresses = await withAbort(lookup(hostname, { all: true }), signal); }
        catch {
            signal.throwIfAborted();
            throw new Error("ERR_MEDIA_HOST_UNREACHABLE");
        }
    }
    if (!addresses.length || addresses.some(({ address, family }) => !isPublicAddress(address) || isIP(address) !== family)) {
        throw new Error("ERR_UNSAFE_MEDIA_URL");
    }
    signal.throwIfAborted();
    return { url, address: addresses[0].address, family: addresses[0].family };
}

export async function assertSafeRemoteUrl(value: string, options: { signal?: AbortSignal } = {}): Promise<URL> {
    return (await resolveSafeRemoteUrl(value, options)).url;
}
