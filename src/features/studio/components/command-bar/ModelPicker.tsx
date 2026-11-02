"use client";

import { useModelCopy } from "@/i18n/use-model-copy";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Check, Search, Wand2, X } from "lucide-react";
import { useRuntimeModels } from "@/features/catalog/hooks/useRuntimeModels";
import { PROVIDER_DEFINITIONS } from "@/providers/definitions";
import type { ModelCapabilities } from "@/models/capabilities/types";
import { ProviderMark } from "@/features/providers/components/ProviderMark";
import { PillPopover } from "./PillPopover";

interface ModelPickerProps {
    mediaType: "image" | "video";
    modelId: string;
    onModelChange: (id: string) => void;
    filterModel?: (model: ModelCapabilities) => boolean;
}

export function ModelPicker({ mediaType, modelId, onModelChange, filterModel }: ModelPickerProps) {
    const { modelLabel } = useModelCopy();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [providerFilter, setProviderFilter] = useState("");
    const locale = useLocale();
    const t = useTranslations("commandBar");
    const catalog = useRuntimeModels(mediaType);
    const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const visible = catalog.models.filter((model) => {
        if (filterModel && !filterModel(model)) return false;
        if (providerFilter && model.provider !== providerFilter) return false;
        const provider = PROVIDER_DEFINITIONS.find(({ id }) => id === model.provider);
        const haystack = `${modelLabel(model.label)} ${model.label} ${model.id} ${model.provider_model_id ?? ""} ${model.group} ${model.family} ${model.provider} ${provider?.label ?? ""}`.toLocaleLowerCase();
        return terms.every(term => haystack.includes(term));
    });
    const providers = PROVIDER_DEFINITIONS.filter(provider => catalog.models.some(model => model.provider === provider.id));
    const groups = [...new Set(visible.map(model => model.provider))];

    function changeOpen(next: boolean) {
        setOpen(next);
        if (next) { setSearch(""); setProviderFilter(""); }
    }

    return (
        <PillPopover open={open} onOpenChange={changeOpen} width="w-[26rem]"
            triggerLabel={t(mediaType === "image" ? "chooseImageModel" : "chooseVideoModel")}
            contentClassName="flex max-h-[70dvh] min-h-0 flex-col overflow-hidden"
            trigger={<><Wand2 className="h-3 w-3 shrink-0" /><span className="max-w-[min(17rem,52vw)] truncate">{catalog.byId[modelId] ? modelLabel(catalog.byId[modelId]!.label) : t("chooseModel")}</span></>}
        >
            <div className="flex min-h-0 flex-1 flex-col">
                <label className="relative mb-3 block shrink-0">
                    <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
                    <input type="search" autoFocus aria-label={t("searchModels")} placeholder={t("searchModels")}
                        value={search} onChange={event => setSearch(event.target.value)}
                        onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }}
                        className="h-10 w-full appearance-none rounded-xl border border-white/15 bg-[#171717] pl-9 pr-9 text-sm text-[#f4f7fb] outline-none placeholder:text-muted-foreground focus:border-primary/60 [&::-webkit-search-cancel-button]:appearance-none" />
                    {search && <button type="button" aria-label={t("clearModelSearch")} onClick={event => {
                        setSearch("");
                        event.currentTarget.parentElement?.querySelector("input")?.focus();
                    }} className="absolute right-1 top-1 grid size-8 place-items-center rounded-lg text-white/65 hover:bg-white/10 hover:text-white"><X className="size-4" /></button>}
                </label>
                {providers.length > 1 && <select aria-label={t("providerFilter")} value={providerFilter} onChange={event => setProviderFilter(event.target.value)} className="mb-3 h-10 w-full shrink-0 rounded-xl border border-white/15 bg-[#111315] px-3 text-xs"><option value="">{t("allProviders")}</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select>}
                <p role="status" className="mb-2 shrink-0 px-1 text-xs text-muted-foreground">{t("modelResults", { count: visible.length })}</p>
                <div className="model-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
                    {catalog.error ? <p role="status" className="px-2 py-5 text-xs text-muted-foreground">{t("modelsLoadError")} <button type="button" className="text-primary hover:underline" onClick={() => void catalog.refresh()}>{t("retryModels")}</button></p>
                        : catalog.isLoading ? <p role="status" className="px-2 py-5 text-xs text-muted-foreground">{t("modelsLoading")}</p>
                        : visible.length === 0 ? <div role="status" className="px-2 py-5 text-xs leading-relaxed text-muted-foreground">
                            <p>{catalog.models.length === 0 ? t("noConnectedModels") : t("noModelsFound")}</p>
                            {catalog.models.length === 0 && <Link href={`/${locale}/settings`} className="mt-2 inline-block font-semibold text-primary hover:underline">{t("manageProviders")}</Link>}
                        </div> : <div className="space-y-3">
                            {groups.map(group => <div key={group}>
                                <div className="mb-2 flex items-center gap-2"><ProviderMark id={group} /><p className="text-xs font-semibold text-muted-foreground">{PROVIDER_DEFINITIONS.find(provider => provider.id === group)?.label ?? group}</p></div>
                                <div className="space-y-0.5">{visible.filter(model => model.provider === group).map(model => <button
                                    key={model.id} data-model-id={model.id} type="button" aria-pressed={model.id === modelId} title={modelLabel(model.label)}
                                    onClick={() => { onModelChange(model.id); changeOpen(false); }}
                                    className={`flex w-full items-center justify-between gap-2 rounded-[10px] min-h-11 px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-primary ${model.id === modelId ? "bg-primary/10 font-bold text-primary" : "font-medium text-[#f4f7fb] hover:bg-white/[.06]"}`}>
                                    <span className="min-w-0 break-words">{modelLabel(model.label)}</span>
                                    {model.id === modelId && <Check className="size-3.5 shrink-0" />}
                                </button>)}</div>
                            </div>)}
                        </div>}
                </div>
            </div>
        </PillPopover>
    );
}
