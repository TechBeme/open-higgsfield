"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, ArrowRight, ChevronRight, KeyRound, Loader2, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import type { ProviderConnectionRecord } from "@/providers/config-types";
import { Button } from "@/components/ui/button";
import { ProviderDetail } from "./ProviderDetail";
import { ProviderMark } from "./ProviderMark";
import { configRequest, providerErrorMessage } from "../lib/api";
import type { CatalogResponse, ProviderDefinition } from "../types";

interface ProviderResponse { providers: ProviderDefinition[]; connections: ProviderConnectionRecord[]; connectedProviderIds?: string[]; environmentProviderIds?: string[] }

export function ProviderSettings() {
    const t = useTranslations("providers");
    const pathname = usePathname();
    const { mutate: mutateCache } = useSWRConfig();
    const params = useSearchParams();
    const [search, setSearch] = useState("");
    const scroller = useRef<HTMLDivElement>(null);
    const selectedId = params.get("provider");
    const { data, error, isLoading: loading, mutate } = useSWR("provider-settings", async () => {
        const [providerData, catalog] = await Promise.all([configRequest<ProviderResponse>("/api/providers"), configRequest<CatalogResponse>("/api/catalog")]);
        return { ...providerData, catalog };
    });
    const providers = data?.providers ?? [];
    const connections = data?.connections ?? [];
    const connected = new Set(data?.connectedProviderIds ?? connections.filter(c => c.enabled && c.secretConfigured).map(c => c.providerId));
    const catalog = data?.catalog;
    const selected = providers.find(provider => provider.id === selectedId);
    const filtered = providers.filter(provider => `${provider.label} ${t(`descriptions.${provider.id}`)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
    async function invalidateStudioModels() { await Promise.all(["/api/image-models", "/api/models"].map(key => mutateCache(key, undefined, { revalidate: true }))); }
    async function reload() { await Promise.all([invalidateStudioModels(), mutate()]); }
    function setCatalog(next: CatalogResponse) {
        void mutate(current => current ? { ...current, catalog: next } : current, { revalidate: false });
        void invalidateStudioModels().catch(() => undefined);
    }
    async function refresh() { try { await reload(); } catch { /* SWR renders the retry state. */ } }
    useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [selectedId]);

    return <div className="flex h-full min-h-0 flex-col">
        <div ref={scroller} data-provider-scroll className="model-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto max-w-[1200px] space-y-6 px-4 py-6 sm:px-7 sm:py-9 lg:px-10">
                {selectedId && <nav aria-label={t("back")} className="flex items-center gap-2 text-sm"><Link href={pathname} className="rounded-md text-muted-foreground hover:text-foreground">{t("back")}</Link>{selected && <><ChevronRight aria-hidden="true" className="size-3.5 text-muted-foreground" /><span className="truncate">{selected.label}</span></>}</nav>}
                {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="size-4 shrink-0" /><span className="min-w-0 flex-1">{providerErrorMessage(error, t, "loadError")}</span><Button variant="outline" size="sm" onClick={() => void refresh()}>{t("retry")}</Button></div>}
                {loading && !catalog ? <div role="status" className="flex items-center justify-center gap-3 py-24 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" />{t("loading")}</div>
                    : selected && catalog ? <ProviderDetail key={selected.id} provider={selected} connections={connections.filter(c => c.providerId === selected.id)} environmentConfigured={data?.environmentProviderIds?.includes(selected.id) ?? false} connected={connected.has(selected.id)} catalog={catalog} reload={reload} setCatalog={setCatalog} />
                        : selectedId && catalog ? <div role="alert" className="space-y-3"><h1 className="text-xl font-semibold">{t("notFound")}</h1><Link href={pathname} className="text-primary">{t("back")}</Link></div>
                            : error && !catalog ? null : <>
                                <div className="flex flex-wrap items-end justify-between gap-5">
                                    <div className="max-w-xl"><p className="mb-3 text-[11px] font-bold tracking-[.2em] text-primary">{t("eyebrow")}</p><h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("subtitle")}</p></div>
                                    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.03] px-3 py-2 text-xs text-muted-foreground"><span className={`size-1.5 rounded-full ${connected.size ? "bg-primary" : "bg-muted-foreground"}`} />{t("connectedCount", { count: connected.size, total: providers.length })}</span>
                                </div>
                                {connected.size === 0 && <div className="flex items-start gap-3 rounded-2xl border border-primary/15 bg-primary/[.035] px-4 py-4 sm:px-5"><ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" /><div><h2 className="text-sm font-semibold">{t("firstTitle")}</h2><p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">{t("firstHint")}</p></div></div>}
                                <div className="flex items-center gap-3"><label className="relative block max-w-md flex-1"><Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-muted-foreground" /><input type="search" aria-label={t("search")} placeholder={t("search")} value={search} onChange={event => setSearch(event.target.value)} className="h-11 w-full appearance-none rounded-xl border border-white/15 bg-[#101214] pl-10 pr-10 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/60 [&::-webkit-search-cancel-button]:appearance-none" />{search && <button type="button" aria-label={t("clearSearch")} onClick={() => setSearch("")} className="absolute right-1 top-1 grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-white/5"><X className="size-4" /></button>}</label><Button variant="outline" size="icon" aria-label={t("refresh")} title={t("refresh")} onClick={() => void refresh()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /></Button></div>
                                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                    {filtered.map(provider => {
                                        const saved = connections.filter(c => c.providerId === provider.id);
                                        const active = saved.filter(c => c.enabled && c.secretConfigured).length;
                                        const ready = connected.has(provider.id);
                                        const modelCount = [...(catalog?.images ?? []), ...(catalog?.videos ?? [])].filter(m => m.provider === provider.id).length;
                                        return <Link key={provider.id} href={`${pathname}?provider=${encodeURIComponent(provider.id)}`} className="provider-card group flex min-w-0 flex-col rounded-2xl border border-white/10 bg-[#101214] p-5 transition-colors hover:border-primary/40 hover:bg-[#141719]">
                                            <div className="flex items-center justify-between gap-3"><ProviderMark id={provider.id} /><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${ready ? "border-primary/20 bg-primary/5 text-primary" : "border-white/10 text-muted-foreground"}`}><span className={`size-1.5 rounded-full ${ready ? "bg-primary" : "bg-muted-foreground"}`} />{t(ready ? "connected" : saved.length ? "paused" : "disconnected")}</span></div>
                                            <h2 className="mt-5 text-base font-semibold tracking-tight">{provider.label}</h2><p className="mt-2 min-h-10 text-sm leading-relaxed text-muted-foreground">{t(`descriptions.${provider.id}`)}</p>
                                            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground"><span>{t("modelsCount", { count: modelCount })}</span><span className="flex items-center gap-1.5"><KeyRound className="size-3.5" />{active ? t("keysCount", { count: active }) : ready ? t("environment") : t(provider.secretKind === "google-service-account" ? "serviceAccount" : "apiKey")}</span></div>
                                            <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4 text-sm font-semibold"><span className={ready ? "text-foreground" : "text-primary"}>{t(ready ? "manage" : "connect")}</span><ArrowRight aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" /></div>
                                        </Link>;
                                    })}
                                </div>
                                {providers.length > 0 && filtered.length === 0 && <div role="status" className="rounded-2xl border border-dashed border-white/15 px-4 py-12 text-center"><p className="text-muted-foreground">{t("emptySearch")}</p><Button variant="ghost" className="mt-3" onClick={() => setSearch("")}>{t("clearSearch")}</Button></div>}
                            </>}
            </div>
        </div>
    </div>;
}
