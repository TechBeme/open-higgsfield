import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateIpv4(address: string): boolean {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    return a === 0
        || a === 10
        || a === 127
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 100 && b >= 64 && b <= 127)
        || a >= 224;
}

function isPrivateIpv6(address: string): boolean {
    const normalized = address.toLowerCase();
    return normalized === "::"
        || normalized === "::1"
        || normalized.startsWith("fc")
        || normalized.startsWith("fd")
        || normalized.startsWith("fe8")
        || normalized.startsWith("fe9")
        || normalized.startsWith("fea")
        || normalized.startsWith("feb");
}

function isPrivateAddress(address: string): boolean {
    const version = isIP(address);
    if (version === 4) return isPrivateIpv4(address);
    if (version === 6) return isPrivateIpv6(address);
    return true;
}

export async function assertSafeRemoteUrl(value: string): Promise<URL> {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error("ERR_INVALID_MEDIA_URL");
    }

    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error("ERR_INVALID_MEDIA_URL");
    }

    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
        throw new Error("ERR_UNSAFE_MEDIA_URL");
    }

    if (isIP(hostname)) {
        if (isPrivateAddress(hostname)) throw new Error("ERR_UNSAFE_MEDIA_URL");
        return url;
    }

    let addresses: Array<{ address: string }>;
    try {
        addresses = await lookup(hostname, { all: true });
    } catch {
        throw new Error("ERR_MEDIA_HOST_UNREACHABLE");
    }
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
        throw new Error("ERR_UNSAFE_MEDIA_URL");
    }

    return url;
}
