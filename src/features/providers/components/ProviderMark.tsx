import Image from "next/image";
import { isProviderId } from "@/providers/definitions";
import type { ProviderId } from "@/providers/types";

const providerLogos = {
    "google-ai-studio": "/providers/google-ai-studio.png",
    "google-vertex": "/providers/google-vertex.svg",
    "vercel-ai-gateway": "/providers/vercel-ai-gateway.svg",
    toapis: "/providers/toapis.svg",
    magnific: "/providers/magnific.png",
} satisfies Record<ProviderId, string>;

export function ProviderMark({ id, large = false }: { id: string; large?: boolean }) {
    if (!isProviderId(id)) return null;
    return <Image src={providerLogos[id]} alt="" aria-hidden="true" width={64} height={64} unoptimized className={`shrink-0 object-contain ${large ? "size-16" : "size-11"}`} />;
}
