"use client";

import useSWR from "swr";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Camera, Clapperboard, PenTool } from "lucide-react";
import { useRuntimeModels } from "@/features/catalog/hooks/useRuntimeModels";
import { buttonVariants } from "@/components/ui/button";

export function StudioEmpty({ mode, onIdea, supportsPrompt }: { supportsPrompt: boolean; mode: "image" | "video"; onIdea: (prompt: string) => void }) {
    const t = useTranslations("studioEmpty");
    const command = useTranslations("commandBar");
    const locale = useLocale();
    const catalog = useRuntimeModels(mode);
    const ready = catalog.models.length > 0;
    const { data: providerStatus } = useSWR(!catalog.isLoading && !catalog.error && !ready ? "/api/providers" : null, async (url: string) => {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error("ERR_PROVIDER_CONFIG_UNAVAILABLE");
        return response.json() as Promise<{ connectedProviderIds?: string[] }>;
    });
    const hasConnection = Boolean(providerStatus?.connectedProviderIds?.length);
    return <div className="relative flex min-h-full items-center justify-center overflow-hidden px-5 py-8 sm:py-12">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(213,255,71,0.045),transparent_65%)]" />
        <div className="relative w-full max-w-xl text-center">
            <svg aria-hidden="true" viewBox="0 0 220 140" fill="none" className="mx-auto mb-6 hidden h-28 w-44 sm:block">
                <defs><linearGradient id="creative-frame" x1="45" y1="12" x2="186" y2="132" gradientUnits="userSpaceOnUse"><stop stopColor="#d5ff47" stopOpacity=".8" /><stop offset="1" stopColor="#d5ff47" stopOpacity=".05" /></linearGradient></defs>
                <rect x="23" y="28" width="100" height="90" rx="16" transform="rotate(-12 23 28)" fill="#11150e" stroke="#d5ff47" strokeOpacity=".15" />
                <rect x="106" y="12" width="96" height="104" rx="16" transform="rotate(12 106 12)" fill="#151914" stroke="#d5ff47" strokeOpacity=".2" />
                <rect x="63" y="19" width="100" height="106" rx="17" fill="#151914" stroke="url(#creative-frame)" />
                <path d="m77 105 23-28a7 7 0 0 1 11 0l12 15 12-14a7 7 0 0 1 11 0l5 6" stroke="#d5ff47" strokeOpacity=".65" strokeWidth="2" strokeLinecap="round" />
                <circle cx="132" cy="49" r="9" fill="#d5ff47" fillOpacity=".8" />
                <path d="m185 111 3-8 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="#d5ff47" />
            </svg>
            <p className="mb-3 text-[10px] font-semibold tracking-[.2em] text-primary/85">{t("eyebrow")}</p>
            <h1 className="font-display text-2xl leading-tight tracking-tight sm:text-4xl">{t(ready ? !supportsPrompt ? "referenceTitle" : mode === "image" ? "imageTitle" : "videoTitle" : hasConnection ? "noModelsTitle" : "connectTitle")}</h1>
            <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">{catalog.error ? command("modelsLoadError") : t(ready ? supportsPrompt ? "readyHint" : "referenceHint" : hasConnection ? "noModelsHint" : "connectHint")}</p>
            {catalog.error ? <button type="button" className="mt-5 rounded-lg px-4 py-3 text-sm text-primary" onClick={() => void catalog.refresh()}>{command("retryModels")}</button>
                : !ready && !catalog.isLoading ? <Link href={`/${locale}/settings`} className={`${buttonVariants()} mt-6 min-h-11 px-5`}>{hasConnection ? command("manageProviders") : t("connectAction")}<ArrowRight className="size-4" /></Link>
                : ready && supportsPrompt && <div className="mt-6 flex flex-wrap justify-center gap-2">{(mode === "image" ? [
                    { label: "ideaProduct", prompt: "productPrompt", icon: Camera },
                    { label: "ideaScene", prompt: "scenePrompt", icon: Clapperboard },
                    { label: "ideaIllustration", prompt: "illustrationPrompt", icon: PenTool },
                ] : [{ label: "ideaScene", prompt: "videoPrompt", icon: Clapperboard }]).map(idea => <button key={idea.label} type="button" onClick={() => onIdea(t(idea.prompt))} className="flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-white/[.025] px-3.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"><idea.icon className="size-3.5" />{t(idea.label)}</button>)}</div>}
        </div>
    </div>;
}
